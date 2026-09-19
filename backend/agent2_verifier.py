import json
import os
import requests
import time
import re
import argparse
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# CONFIGURATION (loaded from .env)

# Claude API (Anthropic) for AI judging
CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY")
CLAUDE_MODEL = "claude-sonnet-4-5"
CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"

# UK Companies House API Key (REST)
COMPANIES_HOUSE_API_KEY = os.getenv("COMPANIES_HOUSE_API_KEY")
COMPANIES_HOUSE_BASE_URL = "https://api.companieshouse.gov.uk"

# PostgreSQL Configurations (must match agent1_extractor.py)
POSTGRES_DB = os.getenv("POSTGRES_DB", "biochar_db")
POSTGRES_USER = os.getenv("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD")
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))

# Rate Limiting
CH_API_PAUSE = 0.6       # Companies House: 600 req / 5 min
CLAUDE_API_PAUSE = 2     # Claude: small pause between calls to avoid overload

# DATABASE FUNCTIONS

def get_db_connection():
    """Connect to the PostgreSQL database."""
    import psycopg2
    return psycopg2.connect(
        dbname=POSTGRES_DB,
        user=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        host=POSTGRES_HOST,
        port=POSTGRES_PORT
    )

def add_verification_columns():
    """Add verification columns to the biochar_companies table if they don't exist."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    alter_statements = [
        "ALTER TABLE biochar_companies ADD COLUMN IF NOT EXISTS verification_status VARCHAR(50) DEFAULT 'PENDING';",
        "ALTER TABLE biochar_companies ADD COLUMN IF NOT EXISTS companies_house_number VARCHAR(50);",
        "ALTER TABLE biochar_companies ADD COLUMN IF NOT EXISTS companies_house_status VARCHAR(100);",
        "ALTER TABLE biochar_companies ADD COLUMN IF NOT EXISTS verification_notes TEXT;",
        "ALTER TABLE biochar_companies ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;",
        "ALTER TABLE biochar_companies ADD COLUMN IF NOT EXISTS ai_confidence VARCHAR(20);",
        "ALTER TABLE biochar_companies ADD COLUMN IF NOT EXISTS ai_reasoning TEXT;",
    ]
    
    for stmt in alter_statements:
        cursor.execute(stmt)
    
    conn.commit()
    cursor.close()
    conn.close()
    print("[Database] Verification columns added/confirmed.")

def reset_verification_status():
    """Reset all verification statuses to PENDING for re-verification."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        UPDATE biochar_companies 
        SET verification_status = 'PENDING',
            companies_house_number = NULL,
            companies_house_status = NULL,
            verification_notes = NULL,
            verified_at = NULL,
            ai_confidence = NULL,
            ai_reasoning = NULL;
    """)
    
    affected = cursor.rowcount
    conn.commit()
    cursor.close()
    conn.close()
    print(f"[Database] Reset {affected} companies to PENDING status.")

def fetch_unverified_companies():
    """Fetch all companies from the database that haven't been verified yet."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT id, company_name, product_service, web_youtube_link, contact, source
        FROM biochar_companies
        WHERE verification_status = 'PENDING' OR verification_status IS NULL
        ORDER BY id;
    """)
    
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    
    companies = []
    for row in rows:
        companies.append({
            "id": row[0],
            "company_name": row[1],
            "product_service": row[2],
            "web_youtube_link": row[3],
            "contact": row[4],
            "source": row[5],
        })
    
    return companies

def update_verification_result(company_id: int, status: str, ch_number: str, 
                                ch_status: str, notes: str, ai_confidence: str, 
                                ai_reasoning: str):
    """Update a company's verification result in the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        UPDATE biochar_companies
        SET verification_status = %s,
            companies_house_number = %s,
            companies_house_status = %s,
            verification_notes = %s,
            verified_at = %s,
            ai_confidence = %s,
            ai_reasoning = %s
        WHERE id = %s;
    """, (status, ch_number, ch_status, notes, datetime.now(), 
          ai_confidence, ai_reasoning, company_id))
    
    conn.commit()
    cursor.close()
    conn.close()

# COMPANIES HOUSE API

def search_companies_house(company_name: str) -> dict:
    """
    Search the UK Companies House API for a company by name.
    Uses HTTP Basic Auth (API key as username, blank password).
    Returns the parsed JSON response or an error dict.
    """
    search_url = f"{COMPANIES_HOUSE_BASE_URL}/search/companies"
    
    try:
        response = requests.get(
            search_url,
            params={"q": company_name, "items_per_page": 3},
            auth=(COMPANIES_HOUSE_API_KEY, ""),
            timeout=15
        )
        
        if response.status_code == 200:
            return response.json()
        elif response.status_code == 401:
            print(f"  [ERROR] Companies House authentication failed. Check your API key.")
            return {"error": "Authentication failed", "status_code": 401}
        elif response.status_code == 429:
            print(f"  [RATE LIMIT] Companies House rate limit hit. Waiting 30 seconds...")
            time.sleep(30)
            return search_companies_house(company_name)
        else:
            print(f"  [ERROR] Companies House API returned status {response.status_code}")
            return {"error": f"HTTP {response.status_code}", "status_code": response.status_code}
            
    except Exception as e:
        print(f"  [ERROR] Companies House API request failed: {e}")
        return {"error": str(e)}

# FAST RULE-BASED MATCHING (Skips AI for obvious matches)

def normalize_name(name: str) -> str:
    """Normalize a company name by lowering, stripping suffixes and extra spaces."""
    n = name.lower().strip()
    for suffix in [" limited", " ltd", " plc", " llp", " cic", " inc", " co"]:
        if n.endswith(suffix):
            n = n[:-len(suffix)].strip()
    return n

def try_exact_match(company_name: str, items: list) -> dict:
    """
    Attempts a fast, rule-based exact match by normalizing both names
    and comparing. Returns the matched item or None if no exact match.
    This avoids an AI call for obvious cases like 'CapChar' -> 'CAPCHAR LTD'.
    """
    clean_search = normalize_name(company_name)
    
    for item in items:
        clean_candidate = normalize_name(item.get("title", ""))
        if clean_search == clean_candidate:
            return item
    
    return None

# CLAUDE AI JUDGE (ACTOR-CRITIC PATTERN)

def call_ai_judge(company_name: str, search_results: list) -> dict:
    """
    Uses Claude (Anthropic) as an AI judge ONLY for ambiguous matches.
    Minimal prompt — sends only company names to reduce token usage.
    
    Returns a dict with: match_index, confidence, reasoning
    """
    
    # Build a compact candidate list — names only.
    candidates = ""
    for i, item in enumerate(search_results):
        candidates += f"{i+1}. {item.get('title', 'N/A')} ({item.get('company_status', 'N/A')})\n"

    prompt = f"""You are a verification system. Match "{company_name}" to the correct UK Companies House candidate.

Candidates:
{candidates}
Rules:
1. Companies often append suffixes like "Ltd", "Limited", "CIC", "LLP".
2. Do NOT match completely different businesses that just share a generic word (e.g. "Farmers", "Environmental", "Coppice", "Wood", "Charcoal").
3. A match must refer to the same physical business entity.
4. If no candidate is a clear match, you MUST return 0.
5. Output EXACTLY this JSON format (no other text):
{{"match_index": <0 if no match, or 1-{len(search_results)}>, "confidence": "HIGH/MEDIUM/LOW", "reasoning": "<1 sentence reasoning>"}}

Few-Shot Examples:
Example 1:
Company: "Carbon Farmers"
Candidates:
1. ABBEY FARMERS LIMITED (active)
2. FARMERS LTD (dissolved)
Output: {{"match_index": 0, "confidence": "HIGH", "reasoning": "None of the candidates are 'Carbon Farmers'. Abbey Farmers is a different business."}}

Example 2:
Company: "Argoed Coppice"
Candidates:
1. ARGOED AUTOMOTIVE CENTRE LTD (active)
2. ARGOED BUSINESS SERVICES LTD (active)
Output: {{"match_index": 0, "confidence": "HIGH", "reasoning": "Automotive and Business Services are completely different industries from a forestry/coppice business."}}

Example 3:
Company: "Black Bull Biochar"
Candidates:
1. BLACK BULL BIOCHAR LTD (active)
2. BLACK BULL TRADING LTD (active)
Output: {{"match_index": 1, "confidence": "HIGH", "reasoning": "Black Bull Biochar Ltd is an exact match for Black Bull Biochar."}}"""

    headers = {
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": CLAUDE_MODEL,
        "max_tokens": 150,
        "system": "You are a precise database verification system. Reply with valid JSON only. If there is no clear match, set match_index to 0.",
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.0
    }
    
    try:
        response = requests.post(CLAUDE_API_URL, headers=headers, json=payload, timeout=30)
        
        if response.status_code == 429:
            print(f"  [CLAUDE RATE LIMIT] Waiting 30s...")
            time.sleep(30)
            return call_ai_judge(company_name, search_results)
        
        response.raise_for_status()
        
        ai_response = response.json()["content"][0]["text"].strip()
        
        # Handle markdown code block wrapping.
        if ai_response.startswith("```"):
            ai_response = ai_response.split("```")[1]
            if ai_response.startswith("json"):
                ai_response = ai_response[4:]
            ai_response = ai_response.strip()
        
        result = json.loads(ai_response)
        return {
            "match_index": int(result.get("match_index", 0)),
            "confidence": result.get("confidence", "LOW"),
            "reasoning": result.get("reasoning", "No reasoning provided.")
        }
        
    except json.JSONDecodeError:
        print(f"  [CLAUDE] Failed to parse AI response: {ai_response[:80]}")
        return {"match_index": 0, "confidence": "LOW", "reasoning": "AI response was not valid JSON."}
    except Exception as e:
        print(f"  [CLAUDE ERROR] {e}")
        return {"match_index": 0, "confidence": "LOW", "reasoning": f"Claude API error: {e}"}

# STATUS CLASSIFICATION HELPER

def classify_status(ch_status: str) -> str:
    """Classify a Companies House status string into a verification status."""
    if ch_status in ["active"]:
        return "VERIFIED"
    elif ch_status in ["dissolved", "liquidation", "receivership", 
                       "administration", "voluntary-arrangement", 
                       "insolvency-proceedings", "converted-closed"]:
        return "DISSOLVED"
    else:
        return "UNKNOWN_STATUS"

# DATA INTEGRITY CHECKS

def check_data_integrity(company: dict) -> list:
    """
    Performs basic data integrity checks on the extracted company data.
    Returns a list of issues found.
    """
    issues = []
    
    # Check company name.
    name = company.get("company_name", "")
    if not name or len(name.strip()) < 3:
        issues.append("Company name is missing or too short.")
    
    # Check web/YouTube link format.
    url = company.get("web_youtube_link", "")
    if url and url != "null":
        url_pattern = re.compile(r'(https?://|www\.)\S+', re.IGNORECASE)
        if not url_pattern.search(url):
            issues.append(f"Web link does not appear to be a valid URL: '{url}'")
    else:
        issues.append("No web link provided.")
    
    # Check contact information.
    contact = company.get("contact", "")
    if not contact or contact == "null" or len(contact.strip()) < 5:
        issues.append("Contact information is missing or incomplete.")
    
    return issues

# MAIN VERIFICATION WORKFLOW

def verify_company(company: dict) -> dict:
    """
    Verifies a single company using the Actor-Critic pattern:
      1. Actor: Companies House API retrieves candidate matches
      2. Critic: Claude AI judges whether any candidate is the correct match
      3. Data integrity checks flag incomplete records
    """
    company_name = company["company_name"]
    company_id = company["id"]
    product_service = company.get("product_service", "")
    
    print(f"\n{'='*50}")
    print(f"[Verifying] '{company_name}' (ID: {company_id})")
    print(f"{'='*50}")
    
    # Step 1: Data Integrity Checks.
    integrity_issues = check_data_integrity(company)
    if integrity_issues:
        print(f"  [Data Check] Issues: {', '.join(integrity_issues)}")
    else:
        print(f"  [Data Check] All fields present.")
    
    # Step 2: Actor — Companies House API Lookup.
    print(f"  [Actor] Querying Companies House for '{company_name}'...")
    search_results = search_companies_house(company_name)
    
    if "error" in search_results:
        return {
            "id": company_id,
            "company_name": company_name,
            "verification_status": "API_ERROR",
            "companies_house_number": None,
            "companies_house_status": None,
            "notes": f"Companies House API Error: {search_results['error']}",
            "ai_confidence": None,
            "ai_reasoning": None,
        }
    
    items = search_results.get("items", [])
    total_results = search_results.get("total_results", 0)
    print(f"  [Actor] Companies House returned {len(items)} candidates (total: {total_results})")
    
    if not items:
        # No results at all — definitely unregistered.
        print(f"  [Result] UNREGISTERED — No candidates found.")
        notes = "No results found in Companies House. Likely a sole trader or unincorporated business."
        if integrity_issues:
            notes += f" Data issues: {'; '.join(integrity_issues)}"
        return {
            "id": company_id,
            "company_name": company_name,
            "verification_status": "UNREGISTERED",
            "companies_house_number": None,
            "companies_house_status": None,
            "notes": notes,
            "ai_confidence": "HIGH",
            "ai_reasoning": "No search results returned from Companies House register.",
        }
    
    # Step 3a: FAST PATH — Try rule-based exact match first (no AI needed).
    exact_match = try_exact_match(company_name, items)
    
    if exact_match:
        ch_number = exact_match.get("company_number", "N/A")
        ch_status = exact_match.get("company_status", "unknown")
        matched_name = exact_match.get("title", "N/A")
        
        print(f"  [Fast Match] Exact name match: '{matched_name}' (#{ch_number}) — SKIPPED AI")
        
        verification_status = classify_status(ch_status)
        notes = f"Exact match to '{matched_name}' (#{ch_number}). Status: {ch_status}."
        if integrity_issues:
            notes += f" Data issues: {'; '.join(integrity_issues)}"
        
        print(f"  [Result] {verification_status} — {ch_status}")
        return {
            "id": company_id,
            "company_name": company_name,
            "verification_status": verification_status,
            "companies_house_number": ch_number,
            "companies_house_status": ch_status,
            "notes": notes,
            "ai_confidence": "HIGH",
            "ai_reasoning": f"Exact name match after normalizing: '{company_name}' = '{matched_name}'.",
        }
    
    # Step 3b: SLOW PATH — Ambiguous case, call Claude AI judge.
    print(f"  [Critic] No exact match. Sending to Claude AI for judgment...")
    time.sleep(CLAUDE_API_PAUSE)
    
    ai_judgment = call_ai_judge(company_name, items)
    match_index = ai_judgment["match_index"]
    ai_confidence = ai_judgment["confidence"]
    ai_reasoning = ai_judgment["reasoning"]
    
    print(f"  [Critic] AI: {ai_confidence} — {ai_reasoning}")
    
    if match_index > 0 and match_index <= len(items):
        matched_item = items[match_index - 1]
        ch_number = matched_item.get("company_number", "N/A")
        ch_status = matched_item.get("company_status", "unknown")
        matched_name = matched_item.get("title", "N/A")
        
        verification_status = classify_status(ch_status)
        notes = f"AI matched to '{matched_name}' (#{ch_number}). Status: {ch_status}."
        if integrity_issues:
            notes += f" Data issues: {'; '.join(integrity_issues)}"
        
        print(f"  [Result] {verification_status} — '{matched_name}' (#{ch_number})")
        return {
            "id": company_id,
            "company_name": company_name,
            "verification_status": verification_status,
            "companies_house_number": ch_number,
            "companies_house_status": ch_status,
            "notes": notes,
            "ai_confidence": ai_confidence,
            "ai_reasoning": ai_reasoning,
        }
    else:
        print(f"  [Result] UNREGISTERED — AI found no genuine match.")
        notes = f"AI reviewed {len(items)} candidates, no genuine match. Likely sole trader."
        if integrity_issues:
            notes += f" Data issues: {'; '.join(integrity_issues)}"
        
        return {
            "id": company_id,
            "company_name": company_name,
            "verification_status": "UNREGISTERED",
            "companies_house_number": None,
            "companies_house_status": None,
            "notes": notes,
            "ai_confidence": ai_confidence,
            "ai_reasoning": ai_reasoning,
        }

# MAIN ENTRY POINT

def run_verifier():
    """Main function to run the AI-powered verification pipeline."""
    print("=" * 60)
    print("  STAGE 2: THE VERIFIER AGENT (AI-Powered)")
    print("=" * 60)
    print(f"  Actor:  UK Companies House REST API")
    print(f"  Critic: Claude AI ({CLAUDE_MODEL})")
    print(f"  Database: {POSTGRES_DB} @ {POSTGRES_HOST}:{POSTGRES_PORT}")
    print("=" * 60)
    
    # Step 1: Ensure verification columns exist.
    print("\n--- Step 1: Preparing database schema ---")
    add_verification_columns()
    
    # Step 2: Fetch unverified companies.
    print("\n--- Step 2: Fetching unverified companies ---")
    companies = fetch_unverified_companies()
    print(f"[Database] Found {len(companies)} companies to verify.")
    
    if not companies:
        print("\nAll companies have already been verified. Use --reset to re-verify.")
        return
    
    # Step 3: Verify each company with Actor-Critic pattern.
    print(f"\n--- Step 3: Running Actor-Critic verification on {len(companies)} companies ---")
    results = []
    
    for i, company in enumerate(companies):
        print(f"\n[Progress] Company {i+1}/{len(companies)}")
        result = verify_company(company)
        results.append(result)
        
        # Update the database immediately after each verification.
        update_verification_result(
            company_id=result["id"],
            status=result["verification_status"],
            ch_number=result["companies_house_number"],
            ch_status=result["companies_house_status"],
            notes=result["notes"],
            ai_confidence=result["ai_confidence"],
            ai_reasoning=result["ai_reasoning"],
        )
        
        # Rate limit pause between companies.
        if i < len(companies) - 1:
            time.sleep(CH_API_PAUSE)
    
    # Step 4: Print comprehensive summary report.
    print("\n" + "=" * 60)
    print("  VERIFICATION SUMMARY REPORT")
    print("=" * 60)
    
    verified = [r for r in results if r["verification_status"] == "VERIFIED"]
    dissolved = [r for r in results if r["verification_status"] == "DISSOLVED"]
    unregistered = [r for r in results if r["verification_status"] == "UNREGISTERED"]
    api_errors = [r for r in results if r["verification_status"] == "API_ERROR"]
    unknown = [r for r in results if r["verification_status"] == "UNKNOWN_STATUS"]
    
    total = len(results)
    print(f"\n  Total companies verified:   {total}")
    print(f"  [PASS] VERIFIED (Active):    {len(verified):>3}  ({100*len(verified)/total:.0f}%)")
    print(f"  [FAIL] DISSOLVED:            {len(dissolved):>3}  ({100*len(dissolved)/total:.0f}%)")
    print(f"  [WARN] UNREGISTERED:         {len(unregistered):>3}  ({100*len(unregistered)/total:.0f}%)")
    if api_errors:
        print(f"  [ERR]  API ERRORS:           {len(api_errors):>3}  ({100*len(api_errors)/total:.0f}%)")
    if unknown:
        print(f"  [????] UNKNOWN STATUS:       {len(unknown):>3}  ({100*len(unknown)/total:.0f}%)")
    
    # AI Confidence Breakdown.
    high_conf = [r for r in results if r.get("ai_confidence") == "HIGH"]
    med_conf = [r for r in results if r.get("ai_confidence") == "MEDIUM"]
    low_conf = [r for r in results if r.get("ai_confidence") == "LOW"]
    
    print(f"\n  AI Confidence Breakdown:")
    print(f"    HIGH:   {len(high_conf):>3}")
    print(f"    MEDIUM: {len(med_conf):>3}")
    print(f"    LOW:    {len(low_conf):>3}")
    
    if verified:
        print(f"\n  --- Verified Companies (Active) ---")
        for r in verified:
            conf = r.get('ai_confidence', 'N/A')
            print(f"    [PASS] {r['company_name']} (#{r['companies_house_number']}) [AI: {conf}]")
    
    if dissolved:
        print(f"\n  --- Dissolved Companies ---")
        for r in dissolved:
            print(f"    [FAIL] {r['company_name']} (#{r['companies_house_number']})")
            print(f"           AI: {r.get('ai_reasoning', 'N/A')}")
    
    if unregistered:
        print(f"\n  --- Unregistered Companies (Sole Traders / Unincorporated) ---")
        for r in unregistered:
            print(f"    [WARN] {r['company_name']}")
            print(f"           AI: {r.get('ai_reasoning', 'N/A')}")
    
    if low_conf:
        print(f"\n  --- Low Confidence Results (Needs Manual Review) ---")
        for r in low_conf:
            print(f"    [????] {r['company_name']} -- Status: {r['verification_status']}")
            print(f"           AI: {r.get('ai_reasoning', 'N/A')}")
    
    # Save results to JSON for reference.
    output_file = "verification_results.json"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n  Full results saved to: {output_file}")
    print("\n" + "=" * 60)
    print("  VERIFICATION COMPLETE")
    print("=" * 60)

# CLI ENTRY POINT

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Stage 2: AI-Powered Verifier Agent")
    parser.add_argument("--reset", action="store_true", 
                        help="Reset all verification statuses and re-verify all companies.")
    args = parser.parse_args()
    
    if args.reset:
        print("[CLI] Resetting all verification statuses...")
        add_verification_columns()
        reset_verification_status()
    
    run_verifier()
