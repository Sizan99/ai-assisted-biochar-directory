"use client";

import { useState, useCallback } from "react";

export default function HeaderSearch() {
  const [value, setValue] = useState("");

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    // Dispatch live filter event as user types
    window.dispatchEvent(new CustomEvent("header-filter", { detail: v }));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && value.trim()) {
        // Dispatch RAG query event on Enter
        window.dispatchEvent(new CustomEvent("header-ask", { detail: value.trim() }));
        setValue("");
        // Clear the filter too
        window.dispatchEvent(new CustomEvent("header-filter", { detail: "" }));
      }
    },
    [value]
  );

  return (
    <div className="mx-auto w-full max-w-md">
      <label className="relative block">
        <span className="sr-only">Search or ask AI</span>
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m0 0a7.5 7.5 0 10-10.6 0 7.5 7.5 0 0010.6 0z" />
        </svg>
        <input
          type="search"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Filter companies… or press Enter to ask AI"
          className="w-full rounded-full border border-[var(--border-input)] bg-[var(--bg-input)] py-2 pl-9 pr-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-colors focus:border-[#2FBF83]/40 focus:bg-[var(--bg-card-hover)]"
        />
      </label>
    </div>
  );
}
