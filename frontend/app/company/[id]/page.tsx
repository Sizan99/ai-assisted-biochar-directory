import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { mockCompanies } from "@/lib/mock-data";
import { BiocharCompany, VerificationStatus } from "@/lib/types";

export const dynamic = 'force-dynamic';

interface StatusStyle {
  label: string;
  description: (c: BiocharCompany) => string;
  accent: string;
  bg: string;
  border: string;
  icon: "check" | "cross" | "question" | "clock";
}

const STATUS_STYLES: Record<VerificationStatus, StatusStyle> = {
  VERIFIED: {
    label: "Active",
    description: (c) =>
      `Registered and active at Companies House${c.companies_house_number ? ` under #${c.companies_house_number}` : ""}.`,
    accent: "#2FBF83",
    bg: "bg-[#2FBF83]/[0.08]",
    border: "border-[#2FBF83]/25",
    icon: "check",
  },
  DISSOLVED: {
    label: "Dissolved",
    description: (c) =>
      `Companies House lists this entity as dissolved${c.companies_house_number ? ` (#${c.companies_house_number})` : ""}. Treat this listing as historical.`,
    accent: "#D6483D",
    bg: "bg-[#D6483D]/[0.08]",
    border: "border-[#D6483D]/25",
    icon: "cross",
  },
  UNREGISTERED: {
    label: "Unregistered",
    description: () =>
      "No matching record found at Companies House. Likely a sole trader or unincorporated business.",
    accent: "#E8A03D",
    bg: "bg-[#E8A03D]/[0.08]",
    border: "border-[#E8A03D]/25",
    icon: "question",
  },
  UNKNOWN_STATUS: {
    label: "Unclear status",
    description: (c) =>
      `A candidate match was found${c.companies_house_number ? ` (#${c.companies_house_number})` : ""}, but its Companies House status didn't map to a standard category.`,
    accent: "#8B98A6",
    bg: "bg-[#8B98A6]/[0.08]",
    border: "border-[#8B98A6]/25",
    icon: "question",
  },
  API_ERROR: {
    label: "Check pending",
    description: () => "The live Companies House lookup failed and hasn't been retried yet.",
    accent: "#8B98A6",
    bg: "bg-[#8B98A6]/[0.08]",
    border: "border-[#8B98A6]/25",
    icon: "clock",
  },
  PENDING: {
    label: "Pending review",
    description: () => "This company hasn't been run through the verifier agent yet.",
    accent: "#8B98A6",
    bg: "bg-[#8B98A6]/[0.08]",
    border: "border-[#8B98A6]/25",
    icon: "clock",
  },
};

function StatusIcon({ icon, color }: { icon: StatusStyle["icon"]; color: string }) {
  const common = { fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" {...common}>
      {icon === "check" && <path d="M20 6L9 17l-5-5" />}
      {icon === "cross" && <path d="M18 6L6 18M6 6l12 12" />}
      {icon === "question" && (
        <>
          <path d="M9.5 9a2.5 2.5 0 015 0c0 2-2.5 2-2.5 4" />
          <path d="M12 17h.01" />
        </>
      )}
      {icon === "clock" && (
        <>
          <circle cx={12} cy={12} r={9} />
          <path d="M12 7v5l3 3" />
        </>
      )}
    </svg>
  );
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function isPdfSource(source: string): boolean {
  return source.toLowerCase().includes("pdf");
}

function isYouTubeLink(url: string): boolean {
  return /youtube\.com|youtu\.be/i.test(url);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function ensureHttps(url: string): string {
  if (!url) return "#";
  
  // The LLM sometimes hallucinates/combines multiple URLs (e.g. "www.a.com, www.b.com")
  let cleanUrl = url;
  try {
    cleanUrl = decodeURI(url);
  } catch (e) {}

  // Split by comma or space, and take the first valid chunk
  const firstUrl = cleanUrl.split(/[\s,]+/)[0].trim();
  if (!firstUrl) return "#";
  
  if (firstUrl.startsWith("http://") || firstUrl.startsWith("https://")) return firstUrl;
  return `https://${firstUrl}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "Not yet run";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

import { Pool } from "pg";

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        user: process.env.POSTGRES_USER ?? 'postgres',
        password: process.env.POSTGRES_PASSWORD,
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: parseInt(process.env.POSTGRES_PORT ?? '5432'),
        database: process.env.POSTGRES_DB ?? 'biochar_db',
      }
);

async function getCompany(id: string): Promise<BiocharCompany | undefined> {
  const numericId = Number(id);
  if (Number.isNaN(numericId)) return undefined;

  try {
    const result = await pool.query(
      "SELECT * FROM biochar_companies WHERE id = $1",
      [numericId]
    );
    if (result.rows.length === 0) return undefined;
    
    // DB returns some nulls as strings "null", so clean them up just in case
    const row = result.rows[0];
    return {
      ...row,
      web_youtube_link: row.web_youtube_link === "null" ? null : row.web_youtube_link,
      contact: row.contact === "null" ? null : row.contact,
    } as BiocharCompany;
  } catch (err) {
    console.error("Failed to fetch company", err);
    return undefined;
  }
}

/** Larger standalone kiln port for the profile header — mirrors CompanyCard's signature element. */
function KilnPortLarge({ company, accent }: { company: BiocharCompany; accent: string }) {
  return (
    <div className="relative h-20 w-20 shrink-0">
      <div
        className="absolute inset-0 rounded-full opacity-70 blur-lg"
        style={{ background: `radial-gradient(circle, ${accent}55 0%, transparent 70%)` }}
        aria-hidden
      />
      <div className="relative flex h-20 w-20 items-center justify-center rounded-full border bg-[var(--kiln-bg)]" style={{ borderColor: `${accent}66` }}>
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 200deg, ${accent}, transparent 65%)`,
            mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), black calc(100% - 1.5px))",
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2px), black calc(100% - 1.5px))",
          }}
          aria-hidden
        />
        <span className="font-[var(--font-display)] text-lg font-medium tracking-wide text-[var(--text-primary)]">
          {initials(company.company_name)}
        </span>
      </div>
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed text-[var(--text-body)]">
        {value ?? <span className="text-[var(--text-muted)]">Not provided</span>}
      </dd>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const company = await getCompany(id);
  return {
    title: company ? `${company.company_name} · Biochar Directory Hub` : "Company not found",
  };
}

export default async function CompanyProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const company = await getCompany(id);

  if (!company) notFound();

  const style = STATUS_STYLES[company.verification_status] || STATUS_STYLES.UNKNOWN_STATUS;
  const fromPdf = isPdfSource(company.source);
  // If the extractor missed the web link but it was scraped from the web, the source is the website!
  const webLinkUrl = company.web_youtube_link || (!fromPdf ? company.source : null);
  const hasWebLink = !!webLinkUrl;
  const webIsYouTube = hasWebLink && isYouTubeLink(webLinkUrl!);
  const contactIsEmail = !!company.contact && isEmail(company.contact);

  return (
    <div className="px-6 pb-16 pt-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <span aria-hidden>←</span> Return to Directory
      </Link>

      {/* --- Header --- */}
      <div className="mt-6 flex flex-col gap-5 border-b border-[var(--border-color)] pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <KilnPortLarge company={company} accent={style.accent} />
          <div>
            <h1 className="font-[var(--font-display)] text-2xl font-semibold leading-tight text-[var(--text-primary)]">
              {company.company_name}
            </h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {company.geographical_coverage ?? "Coverage unspecified"}
            </p>
          </div>
        </div>

        <span className="inline-flex w-fit items-center gap-1.5 self-start rounded-full border border-[var(--border-input)] bg-[var(--bg-input)] px-3 py-1.5 text-xs text-[var(--text-secondary)] sm:self-auto">
          {fromPdf ? "📄 Sourced from PDF Guide" : `🌐 Scraped from ${company.source}`}
        </span>
      </div>

      {/* --- Live verification status banner --- */}
      <div className={`mt-6 flex items-start gap-3 rounded-2xl border p-4 ${style.bg} ${style.border}`}>
        <div className="mt-0.5">
          <StatusIcon icon={style.icon} color={style.accent} />
        </div>
        <div>
          <p className="text-sm font-medium" style={{ color: style.accent }}>
            {style.label} — Live Companies House standing
          </p>
          <p className="mt-1 text-sm text-[var(--text-body)]">{style.description(company)}</p>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* --- Main column: company profile --- */}
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 backdrop-blur-xl">
            <h2 className="font-[var(--font-display)] text-sm font-medium uppercase tracking-wide text-[var(--text-primary)]">
              Company Profile
            </h2>
            <dl className="mt-4 space-y-5">
              <ProfileField label="Product / Service" value={company.product_service} />
              <ProfileField label="Benefit / Unique Selling Point" value={company.benefit_usp} />
              <ProfileField label="Opportunities" value={company.opportunities} />
            </dl>
          </section>

          <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 backdrop-blur-xl">
            <h2 className="font-[var(--font-display)] text-sm font-medium uppercase tracking-wide text-[var(--text-primary)]">
              Data Provenance
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-body)]">
              {fromPdf
                ? "Extracted from Biochar-and-Pyrolysis-Guide-Issue-2-November-2024.pdf by the extractor agent."
                : (
                  <>
                    Scraped from{" "}
                    <a
                      href={ensureHttps(company.source)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--accent-green)] transition-colors hover:text-[var(--accent-green-hover)]"
                    >
                      {company.source}
                    </a>{" "}
                    by the extractor agent.
                  </>
                )}
            </p>
          </section>
        </div>

        {/* --- Side column: contact, links, verification detail --- */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 backdrop-blur-xl">
            <h2 className="font-[var(--font-display)] text-sm font-medium uppercase tracking-wide text-[var(--text-primary)]">
              Contact
            </h2>
            <p className="mt-3 text-sm text-[#C7D0CB]">
              {company.contact ? (
                contactIsEmail ? (
                  <a href={`mailto:${company.contact}`} className="text-[#5FE3AC] transition-colors hover:text-[#8CF0C4]">
                    {company.contact}
                  </a>
                ) : (
                  company.contact
                )
              ) : (
                <span className="text-[var(--text-muted)]">No contact information on file.</span>
              )}
            </p>

            {hasWebLink ? (
              <a
                href={ensureHttps(webLinkUrl!)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center justify-center gap-2 rounded-full border border-[#2FBF83]/30 bg-[#2FBF83]/10 px-4 py-2.5 text-sm font-medium text-[var(--accent-green)] transition-colors hover:bg-[#2FBF83]/20"
              >
                {webIsYouTube ? "▶ Watch on YouTube" : "Visit Official Website"}
              </a>
            ) : (
              <p className="mt-4 text-xs text-[var(--text-muted)]">No public web link on file.</p>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-6 backdrop-blur-xl">
            <h2 className="font-[var(--font-display)] text-sm font-medium uppercase tracking-wide text-[var(--text-primary)]">
              Verification Details
            </h2>
            <dl className="mt-4 space-y-4 font-[var(--font-mono)] text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">CH number</dt>
                <dd className="text-right text-[var(--text-body)]">{company.companies_house_number ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">CH status</dt>
                <dd className="text-right text-[var(--text-body)]">{company.companies_house_status ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">AI confidence</dt>
                <dd className="text-right text-[var(--text-body)]">{company.ai_confidence ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[var(--text-muted)]">Verified</dt>
                <dd className="text-right text-[var(--text-body)]">{formatDate(company.verified_at)}</dd>
              </div>
            </dl>

            {company.ai_reasoning && (
              <p className="mt-4 border-t border-[var(--border-color)] pt-4 text-xs leading-relaxed text-[var(--text-secondary)]">
                <span className="text-[var(--text-muted)]">AI reasoning: </span>
                {company.ai_reasoning}
              </p>
            )}

            {company.verification_notes && (
              <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                <span className="text-[var(--text-muted)]">Notes: </span>
                {company.verification_notes}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
