"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { BiocharCompany, VerificationStatus } from "@/lib/types";

interface StatusStyle {
  label: string;
  glow: string; // hex used for the kiln-port ring + badge dot
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
}

const STATUS_STYLES: Record<VerificationStatus, StatusStyle> = {
  VERIFIED: {
    label: "Active",
    glow: "#2FBF83",
    badgeBg: "bg-[#2FBF83]/10",
    badgeText: "text-[#1A8F60]",
    badgeBorder: "border-[#2FBF83]/30",
  },
  DISSOLVED: {
    label: "Dissolved",
    glow: "#D6483D",
    badgeBg: "bg-[#D6483D]/10",
    badgeText: "text-[#C0352A]",
    badgeBorder: "border-[#D6483D]/30",
  },
  UNREGISTERED: {
    label: "Unregistered",
    glow: "#E8A03D",
    badgeBg: "bg-[#E8A03D]/10",
    badgeText: "text-[#C4850F]",
    badgeBorder: "border-[#E8A03D]/30",
  },
  UNKNOWN_STATUS: {
    label: "Unclear status",
    glow: "#8B98A6",
    badgeBg: "bg-[#8B98A6]/10",
    badgeText: "text-[#6B7885]",
    badgeBorder: "border-[#8B98A6]/30",
  },
  API_ERROR: {
    label: "Check pending",
    glow: "#8B98A6",
    badgeBg: "bg-[#8B98A6]/10",
    badgeText: "text-[#6B7885]",
    badgeBorder: "border-[#8B98A6]/30",
  },
  PENDING: {
    label: "Pending review",
    glow: "#8B98A6",
    badgeBg: "bg-[#8B98A6]/10",
    badgeText: "text-[#6B7885]",
    badgeBorder: "border-[#8B98A6]/30",
  },
};

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function isPdfSource(source: string): boolean {
  return source.toLowerCase().includes("pdf");
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The "kiln port" — this directory's signature element. Every company is
 * represented as a glowing circular viewport rather than a stock logo,
 * echoing the pyrolysis kilns the whole dataset is built around. The glow
 * color encodes live Companies House standing at a glance.
 */
function KilnPort({ company }: { company: BiocharCompany }) {
  const style = STATUS_STYLES[company.verification_status];
  return (
    <div className="relative h-14 w-14 shrink-0">
      <div
        className="absolute inset-0 rounded-full opacity-60 blur-md transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(circle, ${style.glow}55 0%, transparent 70%)` }}
        aria-hidden
      />
      <div
        className="relative flex h-14 w-14 items-center justify-center rounded-full border bg-[var(--kiln-bg)]"
        style={{ borderColor: `${style.glow}66` }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 200deg, ${style.glow}, transparent 65%)`,
            mask: "radial-gradient(farthest-side, transparent calc(100% - 2px), black calc(100% - 1.5px))",
            WebkitMask:
              "radial-gradient(farthest-side, transparent calc(100% - 2px), black calc(100% - 1.5px))",
          }}
          aria-hidden
        />
        <span className="font-[var(--font-display)] text-sm font-medium tracking-wide text-[var(--text-primary)]">
          {initials(company.company_name)}
        </span>
      </div>
    </div>
  );
}

export default function CompanyCard({ company }: { company: BiocharCompany }) {
  const style = STATUS_STYLES[company.verification_status];
  const fromPdf = isPdfSource(company.source);

  return (
    <Link href={`/company/${company.id}`} className="group block">
      <motion.article
        whileHover={{ y: -4 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
        className="relative flex h-full flex-col gap-4 overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5 backdrop-blur-xl transition-colors duration-300 hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-hover)]"
      >
        {/* ambient ember wash on hover, tinted by verification status */}
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-30"
          style={{ background: style.glow }}
          aria-hidden
        />

        <div className="relative flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <KilnPort company={company} />
            <div className="min-w-0">
              <h3 className="truncate font-[var(--font-display)] text-base font-medium leading-tight text-[var(--text-primary)]">
                {company.company_name}
              </h3>
              <p className="mt-1 line-clamp-2 text-xs text-[var(--text-secondary)]">
                {company.geographical_coverage && company.geographical_coverage !== "null" && company.geographical_coverage !== "None"
                  ? company.geographical_coverage
                  : "Coverage unspecified"}
              </p>
            </div>
          </div>
        </div>

        <p className="relative line-clamp-2 text-sm leading-relaxed text-[var(--text-body-alt)]">
          {company.product_service ?? "No product or service description on file."}
        </p>

        <div className="relative mt-auto flex flex-wrap items-center gap-2 pt-1">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-[var(--font-mono)] text-[11px] uppercase tracking-wide ${style.badgeBg} ${style.badgeText} ${style.badgeBorder}`}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: style.glow }} />
            {style.label}
          </span>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-input)] bg-[var(--bg-input)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
            {fromPdf ? "📄 PDF Guide" : `🌐 ${hostnameOf(company.source)}`}
          </span>

          {company.companies_house_number && (
            <span className="ml-auto font-[var(--font-mono)] text-[11px] text-[var(--text-muted)]">
              #{company.companies_house_number}
            </span>
          )}
        </div>
      </motion.article>
    </Link>
  );
}
