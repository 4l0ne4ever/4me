"use client";

import type { SearchResults } from "@4me/shared";
import { useEffect, useState } from "react";
import { API_URL, shortDate } from "@/lib/api";
import { DeskLink } from "../DeskLink";

/** Search for diaries (by name or address) and public pages (by words in them), with or without accents. */
export function Search({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const [results, setResults] = useState<SearchResults | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setState("idle");
      return;
    }
    const ctl = new AbortController();
    const t = window.setTimeout(async () => {
      setState("loading");
      try {
        const res = await fetch(`${API_URL}/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        if (!res.ok) throw new Error();
        setResults((await res.json()) as SearchResults);
        setState("idle");
      } catch (e) {
        if ((e as Error).name !== "AbortError") setState("error");
      }
    }, 300);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [query]);

  const none = results && results.people.length === 0 && results.pages.length === 0;

  return (
    <div className="body srch">
      <label htmlFor="srch-q" className="sr">
        Search
      </label>
      <input
        id="srch-q"
        className="field"
        type="search"
        placeholder="a name, a word, a line you remember…"
        value={query}
        maxLength={80}
        // biome-ignore lint/a11y/noAutofocus: the reader opened Search to type into it
        autoFocus
        onChange={(e) => onQuery(e.target.value)}
      />
      {state === "loading" && <p className="srch-note">Searching…</p>}
      {state === "error" && (
        <p className="srch-note err" role="alert">
          Search isn&apos;t answering, try again in a moment.
        </p>
      )}
      {none && <p className="srch-note">Nothing found for “{query.trim()}”.</p>}
      {results && results.people.length > 0 && (
        <section>
          <h3>Diaries</h3>
          <ul className="srch-people">
            {results.people.map((p) => (
              <li key={p.handle}>
                <DeskLink href={`/u/${p.handle}`}>
                  <img src={p.avatar} alt="" width={36} height={36} />
                  <span>
                    <b>{p.name}</b>
                    <small>{p.bio || `4me://${p.handle}`}</small>
                  </span>
                </DeskLink>
              </li>
            ))}
          </ul>
        </section>
      )}
      {results && results.pages.length > 0 && (
        <section>
          <h3>Pages</h3>
          <ul className="srch-pages">
            {results.pages.map((e) => (
              <li key={e.id}>
                <DeskLink href={`/u/${e.author.handle}/${e.slug}`}>
                  <b>{e.title}</b>
                  <small>
                    {e.author.name} · {shortDate(e.writtenAt)}
                    {e.mood && ` · ${e.mood}`}
                  </small>
                </DeskLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
