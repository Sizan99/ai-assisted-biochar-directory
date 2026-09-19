"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  score?: number;
}

export default function AskPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  function ensureHttps(url: string): string {
    if (!url) return "#";
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    return `https://${url}`;
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Listen for header search bar queries
  useEffect(() => {
    function handleHeaderAsk(e: Event) {
      const question = (e as CustomEvent).detail;
      if (!question || isLoading) return;
      setIsOpen(true);
      setMessages((prev) => [...prev, { role: "user", content: question }]);
      submitQuestion(question);
    }
    window.addEventListener("header-ask", handleHeaderAsk);
    return () => window.removeEventListener("header-ask", handleHeaderAsk);
  }, [isLoading]);

  async function submitQuestion(question: string) {
    setIsLoading(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();

      if (data.error) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${data.error}` },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.answer,
            sources: data.sources,
            score: data.topScore,
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Network error — is the server running?" },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || isLoading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    submitQuestion(question);
  }

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-14 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-gradient-to-br from-[#2FBF83] to-[#1A8F60] shadow-lg shadow-[#2FBF83]/20 transition-all duration-300 hover:scale-110 hover:shadow-xl hover:shadow-[#2FBF83]/30"
        aria-label="Ask AI"
      >
        {isOpen ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="10" r="0.5" fill="white" />
            <circle cx="8" cy="10" r="0.5" fill="white" />
            <circle cx="16" cy="10" r="0.5" fill="white" />
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-32 right-6 z-50 flex h-[500px] w-[380px] flex-col rounded-2xl border border-[var(--border-color)] bg-[var(--bg-main)]/95 shadow-2xl shadow-black/40 backdrop-blur-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-5 py-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#2FBF83] to-[#1A8F60]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Market Intelligence AI</h3>
              <p className="text-[11px] text-[var(--text-muted)]">RAG-powered · Claude · Zero hallucination</p>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <span className="text-2xl">🔍</span>
                <p className="text-sm text-[var(--text-secondary)]">Ask me anything about biochar markets, regulations, or carbon offsets.</p>
                <p className="text-xs text-[var(--text-muted)]">Answers are grounded in crawled data only.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-[#2FBF83]/20 text-[var(--text-primary)]"
                      : "border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-body)]"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                  {msg.score !== undefined && msg.score > 0 && (
                    <p className="mt-2 text-[10px] font-medium text-[#1A8F60]">
                      Top match score: {(msg.score * 100).toFixed(1)}%
                    </p>
                  )}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 space-y-1 border-t border-[var(--border-color)] pt-2">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Sources</p>
                      {msg.sources.map((src, j) => (
                        <a
                          key={j}
                          href={ensureHttps(src)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-[11px] text-[#1A8F60] transition-colors hover:text-[#2FBF83]"
                        >
                          {src}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl border border-[var(--border-color)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-secondary)]">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[#2FBF83]" />
                  Thinking…
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t border-[var(--border-color)] p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about biochar…"
                disabled={isLoading}
                className="flex-1 rounded-xl border border-[var(--border-input)] bg-[var(--bg-input)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-colors focus:border-[#2FBF83]/40 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2FBF83] text-white transition-all hover:bg-[#36D994] disabled:opacity-30"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
