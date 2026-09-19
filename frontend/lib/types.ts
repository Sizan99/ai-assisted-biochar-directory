// lib/types.ts
//
// These types mirror the *actual* data shapes produced by the Python agents:
//   - Base fields come from the `BiocharCompany` Pydantic model in agent1_extractor.py
//   - Verification fields come from the columns agent2_verifier.py adds via
//     `add_verification_columns()` and populates via `update_verification_result()`
//
// No fields are invented here. Notably, the extractor schema does NOT capture
// "Pyrolysis Temperature" or "Carbon Sequestration Capacity" (only Product/Service,
// Benefit/USP, Web/YouTube link, Opportunities, Geographical Coverage, and Contact),
// so those are intentionally absent — see the note in the chat response.

export type VerificationStatus =
  | "VERIFIED" // company_status === "active"
  | "DISSOLVED" // dissolved / liquidation / administration / etc.
  | "UNREGISTERED" // no Companies House match — likely sole trader
  | "UNKNOWN_STATUS" // matched, but status doesn't map cleanly
  | "API_ERROR" // Companies House lookup failed
  | "PENDING"; // not yet run through agent2_verifier.py

export type AIConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface BiocharCompany {
  id: number;
  company_name: string;
  product_service: string | null;
  benefit_usp: string | null;
  web_youtube_link: string | null;
  opportunities: string | null;
  geographical_coverage: string | null;
  contact: string | null;
  /** Either "PDF Guide" (Biochar-and-Pyrolysis-Guide) or the source URL scraped. */
  source: string;

  // --- populated by agent2_verifier.py ---
  verification_status: VerificationStatus;
  companies_house_number: string | null;
  companies_house_status: string | null;
  verification_notes: string | null;
  ai_confidence: AIConfidence | null;
  ai_reasoning: string | null;
  verified_at: string | null; // ISO timestamp
}

export interface NewsItem {
  id: string;
  publishedAt: string; // ISO timestamp
  bullets: [string, string, string];
  sourceName: string;
  sourceUrl: string;
}
