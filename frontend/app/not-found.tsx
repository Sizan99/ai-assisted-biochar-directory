import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[75vh] flex-col items-center justify-center px-6 text-center">
      <div className="flex flex-col items-center justify-center space-y-6 rounded-3xl border border-[var(--border-color)] bg-[var(--bg-card)] p-12 shadow-sm backdrop-blur-xl transition-colors duration-300">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-[#2FBF83]/20 to-[#1A8F60]/5 border border-[#2FBF83]/20 transition-all duration-300">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#2FBF83]">
            <circle cx="12" cy="12" r="10" />
            <path d="M16 16s-1.5-2-4-2-4 2-4 2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </div>
        
        <div className="space-y-2">
          <h1 className="font-[var(--font-display)] text-3xl font-semibold tracking-tight text-[var(--text-primary)] transition-colors duration-300">
            Page Under Construction
          </h1>
          <p className="max-w-md text-sm text-[var(--text-secondary)] transition-colors duration-300">
            This section hasn't been built yet. Check back later for updates as we continue to expand the intelligence platform.
          </p>
        </div>

        <Link
          href="/"
          className="mt-4 rounded-full bg-gradient-to-r from-[#2FBF83] to-[#1A8F60] px-6 py-2.5 text-sm font-medium text-white shadow-md shadow-[#2FBF83]/20 transition-all hover:scale-105 hover:shadow-lg hover:shadow-[#2FBF83]/30"
        >
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
