"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface Suggestion {
  entityId: string;
  name: string;
  type: string;
  year?: number;
  imageUrl?: string;
  disambiguation?: string;
  description?: string;
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
}

export const TYPE_LABEL: Record<string, string> = {
  "urn:entity:artist": "Singer or band",
  "urn:entity:movie": "Film",
  "urn:entity:tv_show": "Television",
  "urn:entity:book": "Book",
  "urn:entity:person": "Person",
  "urn:entity:brand": "Brand",
  "urn:entity:place": "Place",
  "urn:entity:destination": "Destination",
  "urn:entity:locality": "City",
  "urn:entity:album": "Album",
  "urn:entity:actor": "Actor",
  "urn:entity:author": "Author",
  "urn:entity:director": "Director",
};

/** Accessible combobox backed by Qloo entity search (GET /api/search). */
export function EntityAutocomplete({ id, label, placeholder, types, value, onChange, onSelect, onFreeText, hint, required, autoComplete }: Props) {
  const reactId = useId();
  const inputId = id ?? `combo-${reactId}`;
  const listId = `${inputId}-list`;
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const query = value.trim();
  const visible = open && query.length >= 2 && items.length > 0;

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) return;
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const params = new URLSearchParams({ q });
        if (types) params.set("types", types);
        const res = await fetch(`/api/search?${params.toString()}`, { signal: controller.signal });
        const data = (await res.json()) as { results?: Suggestion[] };
        if (!controller.signal.aborted) {
          setItems(data.results ?? []);
          setOpen(true);
          setActive(-1);
        }
      } catch {
        if (!controller.signal.aborted) setItems([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [value, types]);

  const choose = (s: Suggestion) => {
    onSelect(s);
    setOpen(false);
    setItems([]);
    setActive(-1);
  };

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
        aria-describedby={hint ? `${inputId}-hint` : undefined}
        autoComplete={autoComplete ?? "off"}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => items.length > 0 && setOpen(true)}
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
      <div aria-live="polite" className="sr-only">
        {loading ? "Searching Qloo" : visible ? `${items.length} suggestions` : ""}
      </div>
      {visible ? (
        <ul id={listId} role="listbox" aria-label={`${label} suggestions`} className="suggest">
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
                  {TYPE_LABEL[s.type] ?? s.type.replace("urn:entity:", "")}
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
