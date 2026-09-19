import type { Metadata } from "next";
import Link from "next/link";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import AskPanel from "@/components/AskPanel";
import HeaderSearch from "@/components/HeaderSearch";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Biochar Directory Hub",
  description:
    "A read-only directory of UK biochar and pyrolysis companies, verified against UK Companies House.",
};

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-color)] bg-[var(--bg-main)]/80 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-6 px-6">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{ background: "conic-gradient(from 200deg, #E8A03D, #D6483D, transparent 70%)" }}
            aria-hidden
          />
          <span className="font-[var(--font-display)] text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
            Biochar Directory Hub
          </span>
        </Link>

        <HeaderSearch />

        <nav className="hidden shrink-0 items-center gap-6 text-sm text-[var(--text-secondary)] md:flex">
          <Link href="/" className="transition-colors hover:text-[var(--text-primary)]">
            Home
          </Link>
          <Link href="/analytics" className="transition-colors hover:text-[var(--text-primary)]">
            Analytics
          </Link>
          <Link href="/about" className="transition-colors hover:text-[var(--text-primary)]">
            About
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

function LegalBanner() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--banner-border)] bg-[var(--banner-bg)] backdrop-blur-xl">
      <p className="mx-auto max-w-7xl px-6 py-2 text-center text-[11px] leading-relaxed text-[#D9B677]">
        <span className="font-medium text-[#F3C077]">Disclaimer:</span> This directory is
        AI-generated based on the November 2024 Biochar Guide, live web scraping, automated UK
        Companies House verification, and AI news aggregation. Verify all data independently.
      </p>
    </div>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (localStorage.getItem('theme') === 'light') {
                  document.documentElement.setAttribute('data-theme', 'light');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-[var(--bg-main)] font-[var(--font-body)] text-[var(--text-primary)] antialiased">
        <Header />
        <div className="mx-auto flex max-w-[1600px]">
          <main className="min-w-0 flex-1 pb-16">{children}</main>
          <Sidebar />
        </div>
        <LegalBanner />
        <AskPanel />
      </body>
    </html>
  );
}
