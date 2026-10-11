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

const TYPE_LABEL: Record<string, string> = {
  "urn:entity:artist": "Artist",
  "urn:entity:movie": "Film",
  "urn:entity:tv_show": "TV show",
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
      <label htmlFor={inputId} className="mb-2 block text-lg font-bold text-ink-900">
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
        className="min-h-14 w-full rounded-2xl border-2 border-cream-300 bg-white px-4 text-xl text-ink-900 placeholder:text-ink-300 focus:border-ember-600"
      />
      {hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-base text-ink-500">
          {hint}
        </p>
      ) : null}
      <div aria-live="polite" className="sr-only">
        {loading ? "Searching Qloo" : visible ? `${items.length} suggestions` : ""}
      </div>
      {visible ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute z-20 mt-2 max-h-80 w-full overflow-auto rounded-2xl bg-white p-2 shadow-lift ring-1 ring-cream-300"
        >
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
              className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ${i === active ? "bg-ember-100" : "hover:bg-cream-100"}`}
            >
              {s.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.imageUrl} alt="" className="h-11 w-11 rounded-lg object-cover" loading="lazy" />
              ) : (
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-cream-200 font-display text-xl italic text-ink-700" aria-hidden="true">
                  {[...s.name][0]}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-bold text-ink-900">{s.name}</span>
                <span className="block truncate text-base text-ink-500">
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
