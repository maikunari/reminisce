"use client";

import { useEffect, useId, useRef, useState } from "react";

import { dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/session/types";

export interface Suggestion {
  entityId: string;
  name: string;
  type: string;
  year?: number;
  imageUrl?: string;
  disambiguation?: string;
  description?: string;
  genres?: string[];
}

interface Props {
  id?: string;
  label: string;
  placeholder?: string;
  /** Qloo search `types` filter, comma separated. */
  types?: string;
  value: string;
  onChange: (text: string) => void;
  onSelect: (suggestion: Suggestion) => void;
  /** Called when the user presses Enter with no suggestion highlighted. */
  onFreeText?: (text: string) => void;
  hint?: string;
  required?: boolean;
  autoComplete?: string;
  language?: Language;
}

/** What the last search said: nothing yet, a list, no matches, or that search itself could not be reached. */
type SearchState = "idle" | "loading" | "results" | "empty" | "unavailable";

export const TYPE_LABEL: Record<string, string> = dictionary("en").intake.typeLabel;

/**
 * Accessible combobox backed by Qloo entity search (GET /api/search). Typing
 * is never blocked on the search: when nothing matches, or the search cannot
 * be reached (a bot challenge page, a network error), a hint says so and
 * Enter adds the text as typed.
 */
export function EntityAutocomplete({ id, label, placeholder, types, value, onChange, onSelect, onFreeText, hint, required, autoComplete, language }: Props) {
  const t = dictionary(language).intake;
  const reactId = useId();
  const inputId = id ?? `combo-${reactId}`;
  const listId = `${inputId}-list`;
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [search, setSearch] = useState<SearchState>("idle");
  const abortRef = useRef<AbortController | null>(null);

  const query = value.trim();
  const visible = open && query.length >= 2 && items.length > 0;
  const standing = query.length >= 2 && (search === "empty" || search === "unavailable");

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) return;
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSearch("loading");
      try {
        const params = new URLSearchParams({ q });
        if (types) params.set("types", types);
        const res = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal, headers: { Accept: "application/json" } });
        const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
        // A challenge page or a proxy error is not JSON; treat it as "search unavailable", not as "no matches".
        if (!res.ok || !isJson) throw new Error(`search returned ${res.status}`);
        const data = (await res.json()) as { results?: Suggestion[] };
        if (!controller.signal.aborted) {
          const results = data.results ?? [];
          setItems(results);
          setOpen(true);
          setActive(-1);
          setSearch(results.length > 0 ? "results" : "empty");
        }
      } catch {
        if (!controller.signal.aborted) {
          setItems([]);
          setSearch("unavailable");
        }
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [value, types]);

  const choose = (s: Suggestion) => {
    onSelect(s);
    setOpen(false);
    setItems([]);
    setActive(-1);
    setSearch("idle");
  };

  const describedBy = [hint ? `${inputId}-hint` : null, standing ? `${inputId}-status` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="relative">
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={visible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        autoComplete={autoComplete ?? "off"}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (e.target.value.trim().length < 2) {
            setItems([]);
            setSearch("idle");
          }
        }}
        style={{ scrollMarginTop: "1rem" }}
        onFocus={(e) => {
          if (items.length > 0) setOpen(true);
          // On a phone the keyboard covers the suggestion list; bring the field to the top once it is up.
          const field = e.currentTarget;
          if (window.matchMedia("(max-width: 640px)").matches) window.setTimeout(() => field.scrollIntoView({ block: "start" }), 300);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && items.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === "ArrowUp" && items.length > 0) {
            e.preventDefault();
            setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
          } else if (e.key === "Enter") {
            if (visible && active >= 0 && items[active]) {
              e.preventDefault();
              choose(items[active]);
            } else if (onFreeText && value.trim()) {
              e.preventDefault();
              onFreeText(value.trim());
              setOpen(false);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="field-input"
      />
      {hint ? (
        <p id={`${inputId}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
      <p id={`${inputId}-status`} role="status" aria-live="polite" className={standing ? "hint text-ink-700" : "sr-only"} data-testid={`${inputId}-status`}>
        {search === "loading" ? t.searching : visible ? t.suggestionCount(items.length) : search === "empty" && standing ? t.noMatches : search === "unavailable" && standing ? t.searchUnavailable : ""}
      </p>
      {visible ? (
        <ul id={listId} role="listbox" aria-label={t.suggestions(label)} className="suggest">
          {items.map((s, i) => (
            <li
              key={`${s.entityId}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`grid cursor-pointer grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-sm px-2.5 py-2 ${i === active ? "bg-paper-100" : "hover:bg-paper-50"}`}
            >
              {s.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.imageUrl} alt="" className="h-11 w-11 rounded-sm border border-paper-200 object-cover" loading="lazy" />
              ) : (
                <span
                  className="grid h-11 w-11 place-content-center rounded-sm border border-paper-200 bg-paper-100 font-display text-md text-ink-700 italic"
                  aria-hidden="true"
                >
                  {[...s.name][0]}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold text-ink-900">{s.name}</span>
                <span className="block truncate text-sm text-ink-500">
                  {t.typeLabel[s.type] ?? s.type.replace("urn:entity:", "")}
                  {s.year ? ` · ${s.year}` : ""}
                  {s.disambiguation ? ` · ${s.disambiguation}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
