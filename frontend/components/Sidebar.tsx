"use client";

import { useEffect, useRef, useState } from "react";

import { NewsItem } from "@/lib/types";

const PAGE_SIZE = 3;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function ensureHttps(url: string): string {
  if (!url) return "#";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `https://${url}`;
}

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <article className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-4 backdrop-blur-xl transition-colors duration-300 hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-hover)]">
      <div className="flex items-center justify-between">
        <span className="font-[var(--font-mono)] text-[11px] uppercase tracking-wide text-[var(--text-secondary)]">
          {formatDate(item.publishedAt)}
        </span>
        <span className="h-1.5 w-1.5 rounded-full bg-[#E8A03D]" aria-hidden />
      </div>

      <ul className="mt-3 space-y-2">
        {item.bullets.filter(bullet => bullet !== "...").map((bullet, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-[var(--text-body)]">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#5C6864]" aria-hidden />
            <span>{bullet}</span>
          </li>
        ))}
      </ul>

      <a
        href={ensureHttps(item.sourceUrl)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#1A8F60] transition-colors hover:text-[#2FBF83]"
      >
        Read original article · {item.sourceName}
        <span aria-hidden>→</span>
      </a>
    </article>
  );
}

export default function Sidebar() {
  const [mockNews, setMockNews] = useState<NewsItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/news')
      .then(res => res.json())
      .then(data => {
        setMockNews(data);
      })
      .catch(err => {
        console.error(err);
      });
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((count) => Math.min(count + PAGE_SIZE, mockNews.length));
        }
      },
      { rootMargin: "120px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [mockNews.length]);

  const items = mockNews.slice(0, visibleCount);
  const hasMore = visibleCount < mockNews.length;

  return (
    <aside className="hidden w-[340px] shrink-0 border-l border-[var(--border-color)] bg-[var(--bg-main)] lg:block">
      <div className="sticky top-[64px] flex h-[calc(100vh-64px)] flex-col">
        <div className="px-5 pb-3 pt-6">
          <h2 className="font-[var(--font-display)] text-sm font-medium uppercase tracking-wide text-[var(--text-primary)]">
            Market Intelligence
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            AI-summarized biochar industry news, refreshed daily.
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 pb-6">
          {items.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}

          {hasMore && (
            <div ref={sentinelRef} className="py-2 text-center text-xs text-[var(--text-muted)]">
              Loading more news…
            </div>
          )}

          {!hasMore && (
            <p className="py-2 text-center text-xs text-[var(--text-muted)]">You&apos;re caught up.</p>
          )}
        </div>
      </div>
    </aside>
  );
}
