import json
import os
import requests
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict
from dotenv import load_dotenv

load_dotenv()

# API Configurations (loaded from .env)
CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY")
CLAUDE_MODEL = "claude-sonnet-4-5"  # Verified working model identifier
CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"

# PostgreSQL Configurations (loaded from .env)
POSTGRES_ENABLED = True
POSTGRES_DB = os.getenv("POSTGRES_DB", "biochar_db")
POSTGRES_USER = os.getenv("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))

# No other client initialization required. Using direct REST calls to Anthropic.

# Define the company schema using Pydantic.
class BiocharCompany(BaseModel):
    company_name: str = Field(..., alias="Company Name", description="Name of the company.")
    product_service: Optional[str] = Field(None, alias="Product / Service", description="Products or services provided.")
    benefit_usp: Optional[str] = Field(None, alias="Benefit / Unique Selling Point", description="Unique selling points or benefits.")
    web_youtube_link: Optional[str] = Field(None, alias="Web page / YouTube link", description="Web page or video links.")
    opportunities: Optional[str] = Field(None, alias="Opportunities", description="Opportunities or future work listed.")
    geographical_coverage: Optional[str] = Field(None, alias="Geographical Coverage", description="Operating regions.")
    contact: Optional[str] = Field(None, alias="Contact", description="Contact information.")
    
    model_config = ConfigDict(populate_by_name=True)

# Extract text from a PDF.
def extract_text_from_pdf(pdf_path: str) -> str:
    """
    Reads the Biochar Guide PDF and returns the text.
    Uses pypdf to read the text.
    """
    print(f"[PDF] Extracting text from {pdf_path}...")
    import pypdf
    text_chunks = []
    try:
        reader = pypdf.PdfReader(pdf_path)
        print(f"[PDF] Total pages in PDF: {len(reader.pages)}")
        # Read first 20 pages for testing.
        for i in range(min(20, len(reader.pages))):
            text = reader.pages[i].extract_text()
            if text:
                text_chunks.append(text)
    except Exception as e:
        print(f"Error reading PDF: {e}")
    return "\n".join(text_chunks)

# Scrape text from a URL.
def scrape_text_from_url(url: str) -> str:
    """
    Scrapes unstructured text from a given website URL.
    Uses requests and BeautifulSoup.
    """
    print(f"[Web] Scraping text from {url}...")
    import requests
    from bs4 import BeautifulSoup
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Remove script and style elements
        for script in soup(["script", "style"]):
            script.decompose()
            
        # Get text and clean it up
        text = soup.get_text()
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        cleaned_text = '\n'.join(chunk for chunk in chunks if chunk)
        return cleaned_text
    except Exception as e:
        print(f"Error scraping web: {e}")
        return ""

# Run the extractor agent on text content.
def run_extractor_agent(text_content: str, source_label: str) -> str:
    """
    Passes the text content to Claude (Anthropic) and asks it to return JSON 
    matching the BiocharCompany schema, with retry logic.
    """
    import time
    
    if not CLAUDE_API_KEY or CLAUDE_API_KEY == "YOUR_ANTHROPIC_API_KEY_HERE":
        return json.dumps({"error": "Claude API Key is missing. Please set CLAUDE_API_KEY at the top of the script."})
        
    print(f"[{source_label}] Sending content to Claude ({CLAUDE_MODEL}) for Named Entity Recognition...")
    headers = {
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
    }
    
    prompt = f"""You are an expert environmental data extractor. Read the provided text (either from the 'Biochar-and-Pyrolysis-Guide' PDF or unstructured web sources). Extract the following entities: 1. Company Name, 2. Product / Service, 3. Benefit / Unique Selling Point, 4. Web page / YouTube link, 5. Opportunities, 6. Geographical Coverage, 7. Contact.

You must output your findings ONLY as a strict JSON object with NO additional text, markdown, or explanation before or after the JSON. If a piece of data is missing, output null (not the string 'null'). Do not invent data.

Output strictly this JSON schema:
{{
  "Company Name": "string or null",
  "Product / Service": "string or null",
  "Benefit / Unique Selling Point": "string or null",
  "Web page / YouTube link": "string or null",
  "Opportunities": "string or null",
  "Geographical Coverage": "string or null",
  "Contact": "string or null"
}}

Text to process:
{text_content}"""
    
    payload = {
        "model": CLAUDE_MODEL,
        "max_tokens": 1024,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.1
    }
    
    max_retries = 5
    delay = 10
    for attempt in range(max_retries):
        try:
            response = requests.post(CLAUDE_API_URL, headers=headers, json=payload, timeout=60)
            
            # Handle API errors.
            if response.status_code in [429, 529, 503, 500]:
                try:
                    import re
                    err_body = response.json()
                    err_msg = err_body.get("error", {}).get("message", "")
                    match = re.search(r"Please try again in ([\d.]+)s", err_msg)
                    suggested_wait = float(match.group(1)) + 2.0 if match else delay
                except Exception:
                    suggested_wait = delay
                print(f"Claude API returned {response.status_code}. Retrying in {suggested_wait:.1f} seconds...")
                time.sleep(suggested_wait)
                delay *= 2
                continue
                
            response.raise_for_status()
            res_json = response.json()
            # Claude returns content as a list of blocks
            content = res_json['content'][0]['text'].strip()
            # Strip markdown code fences if Claude wraps the JSON
            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.strip()
            return content
            
        except Exception as e:
            print(f"Claude Attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            return json.dumps({"error": str(e)})

# Parse companies from the PDF table of contents.
def parse_companies_from_pdf(pdf_path: str, test_mode: bool = True) -> list:
    """
    Parses the Table of Contents from Page 5, extracts the text belonging
    to each company profile, and runs the extractor agent on each block.
    """
    print(f"\n[PDF] Parsing companies from PDF guide: {pdf_path}")
    import pypdf
    import re
    import time
    
    try:
        reader = pypdf.PdfReader(pdf_path)
    except Exception as e:
        print(f"Error reading PDF: {e}")
        return []

    # Parse the table of contents on page 5.
    toc_text = reader.pages[4].extract_text()
    lines = toc_text.split('\n')
    profile_started = False
    companies_map = []

    for line in lines:
        line = line.strip()
        if "Business Profiles" in line:
            profile_started = True
            continue
        if "Case Studies" in line:
            profile_started = False
            # Mark end of profile parsing.
            companies_map.append({"name": "Sentinel", "page": 115})
            break
            
        if profile_started and line:
            match = re.search(r"^(.*?)\s+(\d+)$", line)
            if match:
                name = match.group(1).strip()
                page = int(match.group(2).strip())
                companies_map.append({"name": name, "page": page})

    if not companies_map:
        print("Failed to parse companies from Table of Contents.")
        return []

    # Extract profile text for each company.
    results = []
    
    # Limit companies in test mode.
    num_to_process = min(6, len(companies_map) - 1) if test_mode else (len(companies_map) - 1)
    print(f"[PDF] Found {len(companies_map) - 1} companies. Test mode: {test_mode} (processing {num_to_process})")
    
    for idx in range(num_to_process):
        comp = companies_map[idx]
        next_comp = companies_map[idx + 1]
        
        comp_name = comp["name"]
        start_page = comp["page"]  # 1-based page
        end_page = next_comp["page"]  # 1-based page
        
        print(f"\n[PDF] Processing company: '{comp_name}' (Pages {start_page} to {end_page - 1})")
        
        # Extract text for these pages
        comp_text_chunks = []
        for p_idx in range(start_page - 1, end_page - 1):
            if p_idx < len(reader.pages):
                page_text = reader.pages[p_idx].extract_text()
                if page_text:
                    comp_text_chunks.append(page_text)
                    
        comp_text = "\n".join(comp_text_chunks)
        
        # Send text block to Claude
        response_str = run_extractor_agent(comp_text, source_label=f"PDF Page {start_page}")
        
        try:
            extracted_data = json.loads(response_str)
            # Use name from table of contents if empty.
            if not extracted_data.get("Company Name"):
                extracted_data["Company Name"] = comp_name
            results.append(extracted_data)
        except Exception as e:
            print(f"Error parsing response as JSON: {e}")
            results.append({
                "Company Name": comp_name,
                "error": "Failed to parse response",
                "raw_response": response_str
            })
            
        # Pause to prevent rate limit.
        time.sleep(3)
        
    return results

# Save company data to PostgreSQL database.
def save_to_postgres(companies_list: list):
    """
    Connects to PostgreSQL and inserts/updates the extracted biochar companies.
    """
    try:
        import psycopg2
    except ModuleNotFoundError:
        print("\n[Database] Error: 'psycopg2' is not installed. To enable database storage, run:")
        print("    pip install psycopg2-binary")
        return

    print(f"\n[Database] Connecting to database '{POSTGRES_DB}' on {POSTGRES_HOST}:{POSTGRES_PORT}...")
    conn_params = {
        "dbname": POSTGRES_DB,
        "user": POSTGRES_USER,
        "password": POSTGRES_PASSWORD,
        "host": POSTGRES_HOST,
        "port": POSTGRES_PORT
    }
    
    try:
        conn = psycopg2.connect(**conn_params)
        cursor = conn.cursor()
        
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS biochar_companies (
                id SERIAL PRIMARY KEY,
                company_name VARCHAR(255) UNIQUE NOT NULL,
                product_service TEXT,
                benefit_usp TEXT,
                web_youtube_link TEXT,
                opportunities TEXT,
                geographical_coverage VARCHAR(255),
                contact TEXT,
                source TEXT,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        
        insert_query = """
            INSERT INTO biochar_companies (
                company_name, product_service, benefit_usp, 
                web_youtube_link, opportunities, geographical_coverage, contact, source
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (company_name) DO UPDATE SET
                product_service = EXCLUDED.product_service,
                benefit_usp = EXCLUDED.benefit_usp,
                web_youtube_link = EXCLUDED.web_youtube_link,
                opportunities = EXCLUDED.opportunities,
                geographical_coverage = EXCLUDED.geographical_coverage,
                contact = EXCLUDED.contact,
                source = EXCLUDED.source,
                last_updated = CURRENT_TIMESTAMP;
        """
        
        inserted_count = 0
        for company in companies_list:
            comp_name = company.get("Company Name")
            if not comp_name or (company.get("error") and not comp_name):
                continue
                
            cursor.execute(insert_query, (
                comp_name,
                company.get("Product / Service"),
                company.get("Benefit / Unique Selling Point"),
                company.get("Web page / YouTube link"),
                company.get("Opportunities"),
                company.get("Geographical Coverage"),
                company.get("Contact"),
                company.get("source", "PDF/Web")
            ))
            inserted_count += 1
            
        conn.commit()
        print(f"[Database] Successfully saved/updated {inserted_count} companies in PostgreSQL!")
        
    except Exception as e:
        print(f"[Database] Connection or query failure: {e}")
    finally:
        if 'conn' in locals() and conn:
            cursor.close()
            conn.close()

# Discover new biochar URLs dynamically using DuckDuckGo and Claude AI filtering.
def discover_biochar_urls_from_web(existing_companies: list = None) -> list:
    """
    Searches the live web and uses Claude to find biochar company websites
    that are NOT already in the database.
    """
    try:
        from duckduckgo_search import DDGS
    except ImportError:
        print("\n[AI Discover] Warning: 'ddgs' package is not installed.")
        return []

    print("\n" + "="*50)
    print("[AI Discover] Querying DuckDuckGo for NEW biochar entities...")
    if existing_companies:
        print(f"[AI Discover] Will exclude {len(existing_companies)} already-known companies.")
    print("="*50)
    
    search_queries = [
        "UK biochar company producer supplier",
        "pyrolysis equipment manufacturer UK company",
        "biochar soil amendment UK supplier buy",
        "biochar carbon removal startup UK 2026",
        "pyrolysis plant UK commercial operator",
        "biochar carbon credit producer UK",
        "UK charcoal biochar small producer farm",
        "biochar energy recovery UK business",
        "biomass pyrolysis UK company",
        "biochar agriculture UK supplier site",
        "torrefaction biochar UK company",
        "UK biochar wholesale distributor",
    ]
    
    raw_urls = set()
    try:
        with DDGS() as ddgs:
            for query in search_queries:
                print(f"  [Search] Executing: '{query}'")
                results = ddgs.text(query, max_results=8)
                for r in results:
                    url = r.get("href")
                    if url:
                        raw_urls.add(url)
    except Exception as e:
        print(f"  [Search] Error querying DuckDuckGo: {e}")
        return []
        
    # Standard domains to skip
    ignored_domains = [
        "wikipedia.org", "linkedin.com", "facebook.com", "twitter.com", 
        "youtube.com", "amazon.co.uk", "amazon.com", "ebay.co.uk", 
        "gov.uk", "sciencedirect.com", "researchgate.net", "mdpi.com",
        "bbc.co.uk", "theguardian.com", "medium.com", "crunchbase.com",
        "yell.com", "tripadvisor.co.uk", "pinterest.com", "instagram.com"
    ]
    
    filtered_urls = []
    for url in raw_urls:
        if any(domain in url.lower() for domain in ignored_domains):
            continue
        filtered_urls.append(url)
        
    if not filtered_urls:
        print("  [AI Discover] No candidates found after domain filtering.")
        return []
        
    print(f"  [AI Discover] Found {len(filtered_urls)} candidate URLs. Asking Claude to pick NEW companies...")
    
    # Build the existing companies exclusion note for Claude
    exclusion_note = ""
    if existing_companies and len(existing_companies) > 0:
        known_list = ", ".join(existing_companies[:50])  # Cap at 50 to stay within token limits
        exclusion_note = f"""

IMPORTANT: The following companies are ALREADY in our database. Do NOT select URLs belonging to them:
{known_list}

Only select URLs for companies that are genuinely new and not already listed above."""
    
    # Use Claude to filter the most relevant individual company domains
    claude_headers = {
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
    }
    
    urls_list_str = "\n".join(f"- {url}" for url in filtered_urls[:20])
    
    prompt = f"""You are an AI directory manager. We are building a directory of UK biochar and pyrolysis businesses.
Below is a list of candidate URLs from a search query.
Select the top 8 URLs that are most likely to be the official home page or about page of individual commercial biochar suppliers, producers, or pyrolysis equipment developers.
Exclude general news sites, scientific reports, or directory hubs.{exclusion_note}

Discovered URLs:
{urls_list_str}

Respond strictly with a valid JSON array of strings containing only the top 8 URLs. No other text.
Example: ["https://example-biochar.co.uk", "https://another-biochar-pro.com"]"""
    
    payload = {
        "model": CLAUDE_MODEL,
        "max_tokens": 256,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.0
    }
    
    try:
        response = requests.post(CLAUDE_API_URL, headers=claude_headers, json=payload, timeout=30)
        response.raise_for_status()
        
        res_content = response.json()["content"][0]["text"].strip()
        # Strip markdown fences if present
        if res_content.startswith("```"):
            res_content = res_content.split("```")[1]
            if res_content.startswith("json"):
                res_content = res_content[4:]
            res_content = res_content.strip()
        data = json.loads(res_content)
        
        # Extract the list from JSON
        selected_urls = []
        if isinstance(data, list):
            selected_urls = data
        elif isinstance(data, dict):
            for val in data.values():
                if isinstance(val, list):
                    selected_urls = val
                    break
            else:
                selected_urls = list(data.values())
        
        # Clean selected list
        selected_urls = [u for u in selected_urls if isinstance(u, str) and u.startswith("http")]
        
        if selected_urls:
            print(f"  [AI Discover] Selected URLs:")
            for url in selected_urls[:8]:
                print(f"    - {url}")
            return selected_urls[:8]
            
    except Exception as e:
        print(f"  [AI Discover] AI filtering failed: {e}. Using top 8 raw URLs.")
        
    return filtered_urls[:8]

# Run main process.
if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Biochar Directory Extractor Agent")
    parser.add_argument("--pdf", action="store_true", help="Run the one-time PDF baseline extraction")
    parser.add_argument("--web", action="store_true", help="Run the continuous Web scraping extraction (default)")
    parser.add_argument("--all", action="store_true", help="Run both PDF and Web extraction")
    args = parser.parse_args()

    run_pdf = args.pdf or args.all
    run_web = args.web or args.all or (not args.pdf and not args.all)

    print("=== Starting Hybrid AI Extractor Agent ===")
    if run_pdf and not run_web:
        print("Mode: ONE-TIME PDF BASELINE INGESTION")
    elif run_web and not run_pdf:
        print("Mode: CONTINUOUS WEB SCRAPING & DYNAMIC DISCOVERY")
    else:
        print("Mode: FULL RUN (PDF + WEB)")
    
    TEST_MODE = False
    PDF_FILE_PATH = "E:/Dissertation/Biochar-and-Pyrolysis-Guide-Issue-2-November-2024.pdf"
    
    final_directory = []
    
    # 1. Process PDF Data (Run Once)
    if run_pdf:
        print("\n--- Phase 1: PDF Baseline Extraction ---")
        pdf_results = parse_companies_from_pdf(PDF_FILE_PATH, test_mode=TEST_MODE)
        final_directory.extend(pdf_results)
    else:
        print("\n--- Phase 1: PDF Baseline Extraction [SKIPPED] ---")
        
    print("\n" + "="*50 + "\n")
    
    # 2. Process Web Data (Continuous & Dynamic)
    if run_web:
        print("--- Phase 2: Web Scraping & Dynamic Discovery ---")

        # ----------------------------------------------------------------
        # Fetch already-known companies from DB to guide Claude discovery
        # ----------------------------------------------------------------
        existing_companies = []
        existing_sources = set()
        if POSTGRES_ENABLED:
            try:
                import psycopg2
                conn_check = psycopg2.connect(
                    dbname=POSTGRES_DB, user=POSTGRES_USER, password=POSTGRES_PASSWORD,
                    host=POSTGRES_HOST, port=POSTGRES_PORT
                )
                cur_check = conn_check.cursor()
                cur_check.execute("SELECT company_name, source FROM biochar_companies")
                db_rows = cur_check.fetchall()
                existing_companies = [row[0] for row in db_rows]
                existing_sources = {row[1] for row in db_rows if row[1] and row[1].startswith("http")}
                cur_check.close()
                conn_check.close()
                print(f"\n[DB] Found {len(existing_companies)} existing companies. Will search for new ones only.")
            except Exception as e:
                print(f"[DB] Could not fetch existing companies: {e}")

        # ----------------------------------------------------------------
        # SEED LIST: Known UK biochar & pyrolysis companies
        # Only add seeds not already in the database
        # ----------------------------------------------------------------
        ALL_SEED_URLS = [
            # ---- Verified working UK/EU biochar companies ----
            "https://earthlybiochar.com/pages/about-us",
            "https://blackbullbiochar.com",
            "https://www.carbogenics.com",
            "https://www.carbon-gold.com",
            "https://www.soilfixer.co.uk",
            "https://www.woodlandbiochar.co.uk",
            "https://www.dorsetcharcoal.co.uk/horticultural-charcoal",
            "https://www.carbonscape.com/about",
            "https://www.oxfordbiochar.co.uk",
            "https://www.pyreg.de/en",
            "https://www.cquest.eu/en/biochar",
        ]
        # Skip seeds already recorded as sources in the DB
        SEED_URLS = [u for u in ALL_SEED_URLS if u not in existing_sources]
        skipped = len(ALL_SEED_URLS) - len(SEED_URLS)
        if skipped:
            print(f"[Seed] Skipping {skipped} seed URLs already in database. Processing {len(SEED_URLS)} new seeds.")

        # Dynamically discover additional URLs via DuckDuckGo + Claude
        # Pass existing companies so Claude actively avoids them
        discovered_urls = discover_biochar_urls_from_web(existing_companies=existing_companies)

        # Merge: seed list first, then discovered (deduplicated)
        seen = set(SEED_URLS) | existing_sources
        WEB_URLS = list(SEED_URLS)
        for url in discovered_urls:
            if url not in seen:
                WEB_URLS.append(url)
                seen.add(url)

        print(f"\n[Web] Total new URLs to process: {len(WEB_URLS)} ({len(SEED_URLS)} new seeds + {len(discovered_urls)} discovered)")
            
        for url in WEB_URLS:
            print(f"\n[Web] Processing URL: {url}")
            web_text = scrape_text_from_url(url)
            if web_text:
                web_result_str = run_extractor_agent(web_text, source_label=url)
                try:
                    web_data = json.loads(web_result_str)
                    # Enforce the source label
                    web_data["source"] = url
                    
                    # Ensure Company Name is populated
                    if not web_data.get("Company Name") or web_data.get("Company Name") == "null":
                        # Guess from domain name
                        domain = url.split("//")[-1].split("/")[0].replace("www.", "")
                        web_data["Company Name"] = domain.split(".")[0].replace("-", " ").title()
                        
                    final_directory.append(web_data)
                except Exception as e:
                    print(f"Error parsing web extraction JSON: {e}")
                    final_directory.append({
                        "Company Name": url,
                        "error": "Failed to parse response",
                        "raw_response": web_result_str,
                        "source": url
                    })
            else:
                print(f"Skipping {url} due to scraping failure.")
    else:
        print("--- Phase 2: Web Scraping & Dynamic Discovery [SKIPPED] ---")
            
    if not final_directory:
        print("\nNo data extracted in this run.")
    else:
        # 3. Save integrated directory to JSON file
        output_file = "extracted_biochar_directory.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(final_directory, f, indent=2)
            
        print(f"\n=== EXTRACTION COMPLETE ===")
        print(f"Results saved to: {output_file}")
        
        # 4. Save to PostgreSQL database if enabled
        if POSTGRES_ENABLED:
            save_to_postgres(final_directory)
            
        print(json.dumps(final_directory, indent=2))
