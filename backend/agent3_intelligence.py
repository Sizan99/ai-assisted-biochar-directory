import os
import json
import math
import time
import requests
import psycopg2
from bs4 import BeautifulSoup
from duckduckgo_search import DDGS
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# API Keys (loaded from .env)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY")
CLAUDE_MODEL = "claude-sonnet-4-5"  # Verified working model identifier
CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"

# Database Configuration (loaded from .env)
DB_NAME = os.getenv("POSTGRES_DB", "biochar_db")
DB_USER = os.getenv("POSTGRES_USER", "postgres")
DB_PASSWORD = os.getenv("POSTGRES_PASSWORD")
DB_HOST = os.getenv("POSTGRES_HOST", "localhost")
DB_PORT = os.getenv("POSTGRES_PORT", "5432")

def init_db():
    try:
        conn = psycopg2.connect(dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD, host=DB_HOST, port=DB_PORT)
        cur = conn.cursor()
        # Ensure the table uses TEXT for the embedding since we serialize the float array to JSON
        cur.execute("""
            CREATE TABLE IF NOT EXISTS biochar_news (
                id SERIAL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                chunk_text TEXT NOT NULL,
                url VARCHAR(255) NOT NULL,
                embedding TEXT NOT NULL,
                publish_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.commit()
        cur.close()
        conn.close()
        print("[Database] biochar_news table initialized.")
    except Exception as e:
        print(f"[Database Error] {e}")

def get_gemini_embedding(text: str) -> list[float]:
    """Generates a 768-dimensional embedding using Gemini via direct REST API call."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key={GEMINI_API_KEY}"
    headers = {'Content-Type': 'application/json'}
    data = {
        "model": "models/gemini-embedding-2",
        "content": {
            "parts": [{"text": text}]
        }
    }
    response = requests.post(url, headers=headers, json=data)
    response.raise_for_status()
    result = response.json()
    return result['embedding']['values']

def cosine_similarity(vec1: list[float], vec2: list[float]) -> float:
    """Computes cosine similarity between two vectors mathematically in pure Python."""
    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    magnitude1 = math.sqrt(sum(a * a for a in vec1))
    magnitude2 = math.sqrt(sum(b * b for b in vec2))
    if magnitude1 == 0 or magnitude2 == 0:
        return 0.0
    return dot_product / (magnitude1 * magnitude2)

def chunk_text(text: str, chunk_size: int = 800, overlap: int = 150) -> list[str]:
    """Splits text into overlapping chunks for RAG."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks

# Junk phrases — chunks containing these are discarded before embedding
JUNK_PHRASES = [
    "access to this resource on the server is denied",
    "log out from all devices", "institutional subscriber",
    "forward-looking statements", "i'll now turn the call over",
    "cookie policy", "subscribe to continue reading", "sign in to read",
    "we have migrated to a new commenting platform", "403 forbidden",
    "please log in", "create a free account", "enable javascript",
    "vercel security checkpoint", "personal fin",
]

def scrape_publish_date(soup) -> str:
    """Try to extract the article's actual publish date from HTML meta tags."""
    # 1. OpenGraph / article meta tags (most common)
    for attr in ["article:published_time", "og:article:published_time",
                 "datePublished", "date", "DC.date", "pubdate"]:
        tag = soup.find("meta", property=attr) or soup.find("meta", attrs={"name": attr})
        if tag and tag.get("content"):
            return tag["content"]
    # 2. JSON-LD structured data
    import json as _json
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = _json.loads(script.string or "{}")
            if isinstance(data, list):
                data = data[0]
            for key in ["datePublished", "dateCreated", "dateModified"]:
                if data.get(key):
                    return data[key]
        except Exception:
            pass
    # 3. <time> elements
    tag = soup.find("time", attrs={"datetime": True})
    if tag:
        return tag["datetime"]
    return None

def scrape_url(url: str) -> str:
    """Scrapes article body text from a webpage using BeautifulSoup."""
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
        response = requests.get(url, headers=headers, timeout=12, verify=True)
        soup = BeautifulSoup(response.text, 'html.parser')
        # Strip non-content tags
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form"]):
            tag.extract()
        # Prefer <article> or <main> body for higher quality text
        main_content = soup.find('article') or soup.find('main') or soup.find(id='content') or soup
        text = main_content.get_text(separator=' ')
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        return '\n'.join(chunk for chunk in chunks if chunk)
    except Exception as e:
        print(f"[Web Scraper] Failed to scrape {url}: {e}")
        return ""

def scrape_url_with_date(url: str):
    """Scrapes article body text AND tries to extract the publish date from HTML meta tags.
    Returns a tuple of (text: str, published_date: str | None)."""
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
        response = requests.get(url, headers=headers, timeout=12, verify=True)
        soup = BeautifulSoup(response.text, 'html.parser')
        published_date = scrape_publish_date(soup)
        # Strip non-content tags
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form"]):
            tag.extract()
        main_content = soup.find('article') or soup.find('main') or soup.find(id='content') or soup
        text = main_content.get_text(separator=' ')
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        return '\n'.join(chunk for chunk in chunks if chunk), published_date
    except Exception as e:
        print(f"[Web Scraper] Failed to scrape {url}: {e}")
        return "", None

def phase_1_crawl_and_embed():
    """Crawls targeted sources and DDG for news, chunks, embeds, and stores in PostgreSQL."""
    print("=== Phase 1: Web Crawling & Vectorization ===")

    # --- Verified working targeted sources (scraped directly for highest quality) ---
    TARGETED_SOURCES = [
        {"url": "https://www.biochar-international.org/news/", "title": "IBI - International Biochar Initiative News"},
        {"url": "https://www.biochar-industry.com/news/", "title": "Biochar Industry - News"},
        {"url": "https://www.bbc.co.uk/search?q=biochar&filter=news", "title": "BBC News - Biochar"},
        {"url": "https://www.carboncopy.info/tag/biochar/", "title": "Carbon Copy - Biochar News"},
    ]

    # --- DDG queries targeting 2026 live news ---
    # Many varied queries ensure different articles are returned on each run
    DDG_QUERIES = [
        "biochar news August 2026",
        "biochar UK 2026",
        "pyrolysis carbon capture 2026",
        "biochar soil carbon 2026",
        "biochar investment funding 2026",
        "biochar policy regulation 2026",
        "biochar carbon market prices 2026",
        "agricultural biochar UK farmers 2026",
        "biochar carbon credit 2026",
        "biochar climate net zero 2026",
    ]

    conn = psycopg2.connect(dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD, host=DB_HOST, port=DB_PORT)
    cur = conn.cursor()

    def process_article(url: str, title: str, published_date: str = None):
        """Core pipeline: scrape -> junk-filter -> chunk -> embed -> store."""
        if not url:
            return

        # Domain blocklist — sites that consistently return off-topic or paywalled content
        BLOCKED_DOMAINS = [
            'yahoo.com', 'fool.com', 'dmagazine.com', 'weeklytimesnow.com.au',
            'thehindubusinessline.com', 'seekingalpha.com', 'businesswire.com',
            'prnewswire.com', 'globenewswire.com', 'accesswire.com',
        ]
        if any(domain in url for domain in BLOCKED_DOMAINS):
            print(f"  -> Blocked domain, skipping: {url[:60]}")
            return
        # Skip if already stored
        cur.execute("SELECT id FROM biochar_news WHERE url = %s", (url,))
        if cur.fetchone():
            print(f"  -> Skipping (already in database).")
            return

        print(f"  [Scraping] {url}")
        full_text, scraped_date = scrape_url_with_date(url)
        # Prefer date scraped directly from the article HTML over the DDGS feed date
        resolved_date = scraped_date or published_date
        if resolved_date:
            print(f"  -> Publish date: {resolved_date}")
        if not full_text or len(full_text) < 200:
            print(f"  -> Too short or empty, skipping.")
            return

        # Pre-filter: discard if text is saturated with junk/paywall content
        lower = full_text.lower()
        junk_hits = sum(1 for phrase in JUNK_PHRASES if phrase in lower)
        if junk_hits >= 3:
            print(f"  -> Junk page detected ({junk_hits} indicators), skipping.")
            return

        chunks = chunk_text(full_text)
        # Deduplicate identical chunks from overlapping windows
        chunks = list(dict.fromkeys(chunks))
        # Filter out chunks that are too short or contain junk phrases
        chunks = [c for c in chunks if len(c.strip()) >= 150 and not any(p in c.lower() for p in JUNK_PHRASES)]

        if not chunks:
            print(f"  -> No usable chunks after filtering, skipping.")
            return

        print(f"  -> {len(chunks)} clean chunks. Generating embeddings...")
        for chunk in chunks:
            try:
                embedding = get_gemini_embedding(chunk)
                if resolved_date:
                    cur.execute(
                        "INSERT INTO biochar_news (title, chunk_text, url, embedding, publish_date) VALUES (%s, %s, %s, %s, %s)",
                        (title, chunk, url, json.dumps(embedding), resolved_date)
                    )
                else:
                    cur.execute(
                        "INSERT INTO biochar_news (title, chunk_text, url, embedding) VALUES (%s, %s, %s, %s)",
                        (title, chunk, url, json.dumps(embedding))
                    )
            except Exception as e:
                print(f"  -> Embedding error: {e}")
        conn.commit()
        print(f"  -> Saved to database.")

    # Step 1: Targeted direct sources
    print("\n[Step 1] Scraping targeted biochar news sources...")
    for source in TARGETED_SOURCES:
        print(f"\n[Targeted] {source['title']}")
        process_article(source['url'], source['title'])
        time.sleep(1)  # Small pause between targeted scrapes

    # Step 2: DDG news search with adaptive timelimit fallback
    # Tries: past 24h → past week → past month, until enough new articles are found
    print("\n[Step 2] Running DuckDuckGo news searches (adaptive timeframe)...")
    
    TIMELIMIT_FALLBACK = [
        ("d", "past 24 hours"),
        ("w", "past week"),
        ("m", "past month"),
    ]
    MIN_NEW_ARTICLES = 5  # Target: find at least this many new URLs before stopping

    all_results = []

    for timelimit, label in TIMELIMIT_FALLBACK:
        print(f"\n  [Timeframe] Trying {label}...")
        round_results = []

        for i, query in enumerate(DDG_QUERIES):
            if i > 0:
                time.sleep(5)  # Prevent 403 rate limiting between queries
            try:
                with DDGS() as ddgs:
                    hits = list(ddgs.news(query, max_results=6, timelimit=timelimit))
                    round_results.extend(hits)
            except Exception as e:
                print(f"  [DDGS Error] {e}")

        # Count how many URLs from this round are genuinely new (not already in DB)
        new_count = 0
        for res in round_results:
            url = res.get("url")
            if url:
                cur.execute("SELECT id FROM biochar_news WHERE url = %s", (url,))
                if not cur.fetchone():
                    new_count += 1

        print(f"  [Timeframe] Found {new_count} new articles in {label}.")
        all_results.extend(round_results)

        if new_count >= MIN_NEW_ARTICLES:
            print(f"  [Timeframe] Enough news found in {label}. Stopping search expansion.")
            break
        else:
            print(f"  [Timeframe] Not enough news in {label}. Expanding to wider window...")

    # Process all collected articles (dedup handled inside process_article)
    print(f"\n[Step 2] Processing {len(all_results)} total discovered articles...")
    for res in all_results:
        process_article(res.get("url"), res.get("title", "Biochar Industry News"), res.get("date"))

    cur.close()
    conn.close()
    print("\n[Phase 1] Complete! Vector data saved to PostgreSQL.")

def phase_2_query_rag(user_query: str):
    """Embeds the query, finds top 3 semantic matches using Python math, and prompts Claude."""
    print(f"\n=== Phase 2: RAG Semantic Query ===")
    print(f"User Query: '{user_query}'")
    
    # 1. Embed query using Gemini
    print("[RAG] Generating embedding for query...")
    query_embedding = get_gemini_embedding(user_query)
    
    # 2. Fetch all chunks from DB
    conn = psycopg2.connect(dbname=DB_NAME, user=DB_USER, password=DB_PASSWORD, host=DB_HOST, port=DB_PORT)
    cur = conn.cursor()
    cur.execute("SELECT chunk_text, url, embedding, title FROM biochar_news")
    rows = cur.fetchall()
    cur.close()
    conn.close()

    if not rows:
        print("[RAG Error] No news data in database. Please run Phase 1 first.")
        return

    # 3. Calculate cosine similarity locally in Python
    print(f"[RAG] Calculating Cosine Similarity mathematically for {len(rows)} chunks...")
    scored_chunks = []
    for chunk_text, url, embedding_str, title in rows:
        db_embedding = json.loads(embedding_str)
        score = cosine_similarity(query_embedding, db_embedding)
        scored_chunks.append((score, chunk_text, url, title))
    
    # Sort by score descending
    scored_chunks.sort(key=lambda x: x[0], reverse=True)
    top_3 = scored_chunks[:3]

    print(f"[RAG] Top Match Score: {top_3[0][0]:.4f}")

    # 4. Construct Context for Claude
    context_text = ""
    sources = set()
    for i, (score, chunk, url, title) in enumerate(top_3):
        context_text += f"\n--- Source {i+1} (Relevance Score: {score:.4f}): {title} ---\n{chunk}\n"
        sources.add(url)

    system_prompt = (
        "You are an expert biochar industry analyst. "
        "You have been provided with live news context chunks below, which you should use to inform your answer if they are relevant. "
        "If the context does not contain the answer, rely on your extensive general knowledge about the biochar industry, pyrolysis, carbon markets, and agriculture to answer the user's question. "
        "Be factual, concise, and do not hallucinate."
    )

    prompt = f"Context Data:\n{context_text}\n\nUser Question: {user_query}"

    print("[RAG] Sending audited context to Claude for synthesis...")
    headers = {
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
    }
    data = {
        "model": CLAUDE_MODEL,
        "max_tokens": 512,
        "system": system_prompt,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.0
    }
    
    try:
        response = requests.post(CLAUDE_API_URL, headers=headers, json=data)
        response.raise_for_status()
        answer = response.json()["content"][0]["text"]

        print("\n================ FINAL AI RESPONSE ================\n")
        print(answer)
        print("\n[Sources Cited]:")
        for s in sources:
            print(f" - {s}")
        print("\n===================================================")
    except Exception as e:
        print(f"[RAG Error] Claude API failed: {e}")

if __name__ == "__main__":
    init_db()
    
    print("\n--- Biochar Market Intelligence Engine ---")
    print("1. Crawl Web for News & Generate Vectors")
    print("2. Ask a Question (RAG Query)")
    choice = input("Enter choice (1 or 2): ")
    
    if choice == '1':
        phase_1_crawl_and_embed()
    elif choice == '2':
        query = input("\nEnter your question: ")
        phase_2_query_rag(query)
    else:
        print("Invalid choice.")
