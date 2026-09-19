"use client";

import { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

import { BiocharCompany, VerificationStatus } from "@/lib/types";
import CompanyCard from "@/components/CompanyCard";
import { motion } from "framer-motion";

type SourceToggle = "PDF" | "WEB";
type StatusFilter = "ALL" | "VERIFIED" | "DISSOLVED" | "UNREGISTERED" | "OTHER";
type SortOption = "NAME_ASC" | "RECENTLY_VERIFIED";

const STATUS_COLORS: Record<VerificationStatus, string> = {
  VERIFIED: "#2FBF83",
  DISSOLVED: "#D6483D",
  UNREGISTERED: "#E8A03D",
  UNKNOWN_STATUS: "#8B98A6",
  API_ERROR: "#5C6864",
  PENDING: "#5C6864",
};

const STATUS_LABELS: Record<VerificationStatus, string> = {
  VERIFIED: "Active",
  DISSOLVED: "Dissolved",
  UNREGISTERED: "Unregistered",
  UNKNOWN_STATUS: "Unclear",
  API_ERROR: "Check pending",
  PENDING: "Pending",
};

function isPdfSource(source: string): boolean {
  return source.toLowerCase().includes("pdf");
}

function matchesStatusFilter(status: VerificationStatus, filter: StatusFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "OTHER") return !["VERIFIED", "DISSOLVED", "UNREGISTERED"].includes(status);
  return status === filter;
}

function regionOf(company: BiocharCompany): string {
  const raw = (company.geographical_coverage ?? "").toLowerCase();
  if (!raw || raw === "null") return "Unspecified";

  const hasUK = /\buk\b|united kingdom|england|scotland|wales|shropshire|herefordshire|gloucestershire|mainland/i.test(raw);
  const hasEurope = /europe/i.test(raw);
  const hasIntl = /world|international|usa|canada|far east|middle east|africa|worldwide/i.test(raw);

  if (hasIntl) return "International";
  if (hasEurope) return "Europe";
  if (hasUK) return "UK";
  return "Unspecified";
}

export default function DashboardPage() {
  const [search, setSearch] = useState("");
  const [sources, setSources] = useState<Record<SourceToggle, boolean>>({ PDF: true, WEB: true });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [regionFilter, setRegionFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<SortOption>("NAME_ASC");
  const [activeHeroTab, setActiveHeroTab] = useState(0);
  const [mockCompanies, setMockCompanies] = useState<BiocharCompany[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/companies')
      .then(res => res.json())
      .then(data => {
        setMockCompanies(data);
        setIsLoading(false);
      })
      .catch(err => {
        console.error(err);
        setIsLoading(false);
      });
  }, []);

  // Listen for live filtering from the header search bar
  useEffect(() => {
    function handleFilter(e: Event) {
      setSearch((e as CustomEvent).detail);
    }
    window.addEventListener("header-filter", handleFilter);
    return () => window.removeEventListener("header-filter", handleFilter);
  }, []);


  const statusDistribution = useMemo(() => {
    const counts = new Map<VerificationStatus, number>();
    for (const c of mockCompanies) {
      counts.set(c.verification_status, (counts.get(c.verification_status) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([status, value]) => ({
      status,
      name: STATUS_LABELS[status],
      value,
      color: STATUS_COLORS[status],
    }));
  }, [mockCompanies]);

  const regionDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of mockCompanies) {
      const region = regionOf(c);
      counts.set(region, (counts.get(region) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [mockCompanies]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    let list = mockCompanies.filter((c) => {
      const fromPdf = isPdfSource(c.source);
      if (fromPdf && !sources.PDF) return false;
      if (!fromPdf && !sources.WEB) return false;
      if (!matchesStatusFilter(c.verification_status, statusFilter)) return false;
      if (regionFilter !== "ALL" && regionOf(c) !== regionFilter) return false;
      if (query) {
        const haystack = `${c.company_name} ${c.product_service ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sortBy === "NAME_ASC") return a.company_name.localeCompare(b.company_name);
      // RECENTLY_VERIFIED — newest first, unverified entries sink to the bottom
      const aTime = a.verified_at ? new Date(a.verified_at).getTime() : 0;
      const bTime = b.verified_at ? new Date(b.verified_at).getTime() : 0;
      return bTime - aTime;
    });

    return list;
  }, [search, sources, statusFilter, regionFilter, sortBy, mockCompanies]);

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-[var(--text-secondary)]">Loading dashboard...</div>;
  }

  return (
    <div className="px-6 pt-8 pb-12">
      {/* --- Hero Section --- */}
      <section className="relative mb-12 overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--bg-card)] px-8 py-14 shadow-sm">
        {/* Visible Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#2FBF83]/20 via-[#1A8F60]/5 to-transparent" />
        
        {/* Dot Pattern Background */}
        <div className="absolute inset-0 opacity-[0.04] dark:opacity-[0.08]" style={{ backgroundImage: "radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)", backgroundSize: "24px 24px" }} />

        {/* Decorative Light Orbs */}
        <motion.div
          className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#2FBF83]/30 blur-[120px]"
          animate={{
            scale: [1, 1.1, 1],
            x: [0, -30, 0],
            y: [0, 30, 0],
            opacity: [0.7, 0.9, 0.7],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-40 left-10 h-80 w-80 rounded-full bg-[#2FBF83]/15 blur-[100px]"
          animate={{
            scale: [1, 1.15, 1],
            x: [0, 30, 0],
            y: [0, -30, 0],
            opacity: [0.5, 0.7, 0.5],
          }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        />
        
        <div className="relative z-10 max-w-2xl">
          {/* Decorative Icons as Tabs */}
          <div className="mb-6 flex items-center gap-3">
            <button 
              onClick={() => setActiveHeroTab(0)}
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-300 ${activeHeroTab === 0 ? "bg-gradient-to-br from-[#2FBF83] to-[#1A8F60] shadow-lg shadow-[#2FBF83]/20" : "border border-[var(--border-color)] bg-[var(--bg-main)] shadow-sm hover:border-[#2FBF83]/50"}`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={activeHeroTab === 0 ? "white" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={activeHeroTab === 0 ? "" : "text-[#2FBF83]"}>
                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
                <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
              </svg>
            </button>
            <button 
              onClick={() => setActiveHeroTab(1)}
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-300 ${activeHeroTab === 1 ? "bg-gradient-to-br from-[#2FBF83] to-[#1A8F60] shadow-lg shadow-[#2FBF83]/20" : "border border-[var(--border-color)] bg-[var(--bg-main)] shadow-sm hover:border-[#2FBF83]/50"}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={activeHeroTab === 1 ? "white" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={activeHeroTab === 1 ? "" : "text-[#2FBF83]"}>
                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                <path d="M5 3v4M7 5H3"/>
              </svg>
            </button>
            <button 
              onClick={() => setActiveHeroTab(2)}
              className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-300 ${activeHeroTab === 2 ? "bg-gradient-to-br from-[#2FBF83] to-[#1A8F60] shadow-lg shadow-[#2FBF83]/20" : "border border-[var(--border-color)] bg-[var(--bg-main)] shadow-sm hover:border-[#2FBF83]/50"}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={activeHeroTab === 2 ? "white" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={activeHeroTab === 2 ? "" : "text-[#2FBF83]"}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
                <path d="m9 12 2 2 4-4"/>
              </svg>
            </button>
          </div>
          
          <motion.div 
            key={activeHeroTab} 
            initial={{ opacity: 0, y: 4 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ duration: 0.3 }}
          >
            <h1 className="mb-4 font-[var(--font-display)] text-4xl font-semibold tracking-tight text-[var(--text-primary)] md:text-5xl">
              {activeHeroTab === 0 && <>AI Assisted <span className="bg-gradient-to-r from-[#2FBF83] to-[#4AA883] bg-clip-text text-transparent">Biochar Directory</span></>}
              {activeHeroTab === 1 && <>Autonomous <span className="bg-gradient-to-r from-[#2FBF83] to-[#4AA883] bg-clip-text text-transparent">Discovery</span></>}
              {activeHeroTab === 2 && <>Verified <span className="bg-gradient-to-r from-[#2FBF83] to-[#4AA883] bg-clip-text text-transparent">Legitimacy</span></>}
            </h1>
            
            <p className="text-base leading-relaxed text-[var(--text-secondary)] md:text-lg min-h-[84px]">
              {activeHeroTab === 0 && "Discover, explore, and connect with verified biochar and pyrolysis companies. Our smart directory automatically finds the latest businesses and checks them against official registries so you always have reliable, up-to-date market information."}
              {activeHeroTab === 1 && "Our intelligent web scrapers continuously scour the internet to find emerging biochar startups, using Named Entity Recognition to extract unstructured company data and compile it automatically."}
              {activeHeroTab === 2 && "Every company in our database is cross-referenced with the UK Companies House registry in real-time. We ensure that you only interact with active, legally registered businesses, highlighting dissolved or unregistered entities."}
            </p>
          </motion.div>
        </div>
      </section>

      {/* --- Analytics --- */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5 lg:col-span-2">
          <h2 className="font-[var(--font-display)] text-sm font-medium text-[var(--text-primary)]">
            Verification status
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Live standing across all {mockCompanies.length} listed companies.
          </p>
          <div className="mt-2 flex items-center gap-6">
            <div className="h-[160px] w-[160px] shrink-0">
              {!isLoading ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusDistribution}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={72}
                      paddingAngle={3}
                      stroke="none"
                      isAnimationActive={true}
                      animationDuration={800}
                      animationEasing="ease-out"
                    >
                      {statusDistribution.map((entry) => (
                        <Cell key={entry.status} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "#131917",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 10,
                        fontSize: 12,
                        color: "#EDF2EF",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full w-full animate-pulse rounded-full bg-white/5" />
              )}
            </div>
            <ul className="space-y-1.5">
              {statusDistribution.map((entry) => (
                <li key={entry.status} className="flex items-center gap-2 text-xs text-[var(--text-body-alt)]">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                  {entry.name}
                  <span className="font-[var(--font-mono)] text-[var(--text-muted)]">{entry.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5 lg:col-span-3">
          <h2 className="font-[var(--font-display)] text-sm font-medium text-[var(--text-primary)]">
            Geographic coverage
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Company count by listed region.</p>
          <div className="mt-4 h-[160px]">
            {!isLoading ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={regionDistribution} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.06)" />
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="region"
                    width={110}
                    tick={{ fill: "#8A968F", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.04)" }}
                    contentStyle={{
                      background: "#131917",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 10,
                      fontSize: 12,
                      color: "#EDF2EF",
                    }}
                  />
                  <Bar 
                    dataKey="count" 
                    fill="#E8A03D" 
                    radius={[0, 6, 6, 0]} 
                    barSize={14} 
                    isAnimationActive={true}
                    animationDuration={800}
                    animationEasing="ease-out"
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full animate-pulse rounded-md bg-white/5" />
            )}
          </div>
        </div>
      </section>

      {/* --- Filters --- */}
      <section className="mt-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSources((s) => ({ ...s, PDF: !s.PDF }))}
            aria-pressed={sources.PDF}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              sources.PDF
                ? "border-[#2FBF83]/40 bg-[#2FBF83]/10 text-[#5FE3AC]"
                : "border-[var(--border-input)] bg-[var(--bg-card)] text-[var(--text-muted)]"
            }`}
          >
            📄 PDF Guide
          </button>
          <button
            onClick={() => setSources((s) => ({ ...s, WEB: !s.WEB }))}
            aria-pressed={sources.WEB}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              sources.WEB
                ? "border-[#2FBF83]/40 bg-[#2FBF83]/10 text-[#5FE3AC]"
                : "border-[var(--border-input)] bg-[var(--bg-card)] text-[var(--text-muted)]"
            }`}
          >
            🌐 Web Scraping
          </button>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-full border border-[var(--border-input)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-body-alt)] outline-none transition-colors focus:border-[#2FBF83]/40"
          >
            <option value="ALL">All statuses</option>
            <option value="VERIFIED">Active</option>
            <option value="DISSOLVED">Dissolved</option>
            <option value="UNREGISTERED">Unregistered</option>
            <option value="OTHER">Other</option>
          </select>

          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="rounded-full border border-[var(--border-input)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-body-alt)] outline-none transition-colors focus:border-[#2FBF83]/40"
          >
            <option value="ALL">All regions</option>
            <option value="UK">UK</option>
            <option value="Europe">Europe</option>
            <option value="International">International</option>
            <option value="Unspecified">Unspecified</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="rounded-full border border-[var(--border-input)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-body-alt)] outline-none transition-colors focus:border-[#2FBF83]/40"
          >
            <option value="NAME_ASC">Sort: Name (A-Z)</option>
            <option value="RECENTLY_VERIFIED">Sort: Recently verified</option>
          </select>
        </div>
      </section>


      {/* --- Grid --- */}
      <section className="mt-6">
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          {filtered.length} of {mockCompanies.length} companies
        </p>
        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((company) => (
              <CompanyCard key={company.id} company={company} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--border-input)] py-16 text-center text-sm text-[#5C6864]">
            No companies match these filters.
          </div>
        )}
      </section>
    </div>
  );
}
