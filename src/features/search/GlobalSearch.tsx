"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Command, Search, X } from "lucide-react";

type Result = { id: string; category: string; label: string; subtitle: string; href: string };
const searchableRoles = new Set([
  "school_admin",
  "school_owner",
  "principal",
  "vice_principal",
  "section_head",
  "administrative_staff",
]);
function mark(value: string, query: string) {
  if (!query) return value;
  const parts = value.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return parts.map((part, index) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={`${part}-${index}`}>{part}</mark>
    ) : (
      part
    ),
  );
}
export function GlobalSearch({ role }: { role: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handle = window.setTimeout(async () => {
      if (query.trim().length < 2 || !searchableRoles.has(role)) {
        setResults([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}&pageSize=8`,
          { cache: "no-store" },
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Search unavailable");
        setResults(body.suggestions ?? []);
        setActive(0);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Search unavailable");
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query, role]);
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(value + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter" && results[active]) {
      window.location.href = results[active].href;
    } else if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }
  if (!searchableRoles.has(role)) return null;
  return (
    <div className="global-search">
      <div className={`global-search-input ${open ? "focused" : ""}`}>
        <Search size={15} />
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search school records"
          aria-label="Search school records"
        />
        <span className="search-shortcut">
          <Command size={11} /> K
        </span>
        {query && (
          <button className="search-clear" onClick={() => setQuery("")} aria-label="Clear search">
            <X size={13} />
          </button>
        )}
      </div>
      {open && query.trim().length >= 2 && (
        <div className="global-search-results">
          <div className="global-search-header">
            <span>
              {loading ? "Searching authorized records…" : error || `${results.length} suggestions`}
            </span>
            <span>
              <ArrowUp size={11} />
              <ArrowDown size={11} /> navigate
            </span>
          </div>
          {results.map((result, index) => (
            <Link
              className={`global-search-result ${index === active ? "active" : ""}`}
              key={`${result.category}-${result.id}`}
              href={result.href}
              onClick={() => setOpen(false)}
            >
              <div className="search-result-icon">{result.category.slice(0, 1)}</div>
              <div>
                <strong>{mark(result.label, query)}</strong>
                <span>
                  {result.category}
                  {result.subtitle ? ` · ${mark(result.subtitle, query)}` : ""}
                </span>
              </div>
            </Link>
          ))}
          {!loading && !results.length && !error && (
            <div className="search-empty">No authorized records matched “{query}”.</div>
          )}
        </div>
      )}
    </div>
  );
}
