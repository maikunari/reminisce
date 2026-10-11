"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useCurrentYear } from "@/lib/client/hooks";
import { createSessionShell } from "@/lib/session/storage";
import { LANGUAGES, type Favorite, type Language } from "@/lib/session/types";
import { MIN_BIRTH_YEAR, computeYouthWindow } from "@/lib/session/youth-window";

import { EntityAutocomplete, TYPE_LABEL, type Suggestion } from "./EntityAutocomplete";

const FAVORITE_TYPES = "urn:entity:artist,urn:entity:movie,urn:entity:tv_show,urn:entity:book,urn:entity:person,urn:entity:brand,urn:entity:place";

export function IntakeForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [hometown, setHometown] = useState("");
  const [favoriteText, setFavoriteText] = useState("");
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [language, setLanguage] = useState<Language>("en");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const year = Number.parseInt(birthYear, 10);
  const thisYear = useCurrentYear();
  const maxYear = thisYear === null ? null : thisYear - 18;
  const yearValid = maxYear !== null && Number.isInteger(year) && year >= MIN_BIRTH_YEAR && year <= maxYear;
  const window = yearValid && thisYear !== null ? computeYouthWindow(year, thisYear) : null;

  const addFavorite = (fav: Favorite) => {
    if (favorites.length >= 3) return;
    if (favorites.some((f) => f.name.toLowerCase() === fav.name.toLowerCase())) return;
    setFavorites((list) => [...list, fav]);
    setFavoriteText("");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const list = [...favorites];
    if (list.length === 0 && favoriteText.trim()) list.push({ name: favoriteText.trim() });
    if (!name.trim()) return setError("Please add their name, or what you call them.");
    if (!yearValid) return setError(`The birth year should be between ${MIN_BIRTH_YEAR} and ${maxYear ?? "today"}.`);
    if (!hometown.trim()) return setError("Please add where they grew up.");
    if (list.length === 0) return setError("Add at least one thing they loved: a singer, a film, a dish, a place.");
    setBusy(true);
    const session = createSessionShell({
      name: name.trim(),
      birthYear: year,
      hometown: hometown.trim(),
      favorites: list.slice(0, 3),
      language,
    });
    router.push(`/session/${session.id}`);
  };

  return (
    <form onSubmit={submit} noValidate className="surface p-6 sm:p-8" aria-describedby={error ? "intake-error" : undefined}>
      <div className="grid gap-6 md:grid-cols-2 md:gap-x-8">
        <div>
          <label htmlFor="person-name" className="field-label">
            Their name
          </label>
          <input id="person-name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Grandma Michiko" autoComplete="off" className="field-input" />
          <p className="hint">Or what you call them.</p>
        </div>
        <div>
          <label htmlFor="birth-year" className="field-label">
            Year they were born
          </label>
          <input
            id="birth-year"
            name="birthYear"
            inputMode="numeric"
            pattern="[0-9]*"
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
            placeholder="1950"
            aria-describedby="birth-year-hint"
            className="field-input"
          />
          <p id="birth-year-hint" className="hint" aria-live="polite">
            {window ? `They were 15 to 30 from ${window.start} to ${window.end}. That is where we will look.` : "We build around the years they were 15 to 30."}
          </p>
        </div>
        <div>
          <EntityAutocomplete
            id="hometown"
            label="Where they grew up"
            placeholder="Osaka"
            types="urn:entity:locality"
            value={hometown}
            onChange={setHometown}
            onSelect={(s) => setHometown(s.name)}
            onFreeText={(t) => setHometown(t)}
            hint="A city or town. Qloo uses it as a location signal."
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor="language" className="field-label">
            Language for the prompts
          </label>
          <select id="language" name="language" value={language} onChange={(e) => setLanguage(e.target.value as Language)} className="field-input">
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeLabel}
                {l.nativeLabel !== l.label ? ` (${l.label})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <EntityAutocomplete
            id="favorite"
            label={`Things they loved (${favorites.length}/3)`}
            placeholder="A singer, a film, a dish, a place…"
            types={FAVORITE_TYPES}
            value={favoriteText}
            onChange={setFavoriteText}
            onSelect={(s: Suggestion) => addFavorite({ name: s.name, entityId: s.entityId, type: s.type, imageUrl: s.imageUrl })}
            onFreeText={(t) => addFavorite({ name: t })}
            hint="Up to three. Pick from the suggestions when you can; Qloo uses them as seeds. Press Enter to add a name as typed."
            autoComplete="off"
          />
          {favorites.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Chosen favorites">
              {favorites.map((f) => (
                <li key={f.name} className="tag">
                  {f.name}
                  <small>{f.type ? (TYPE_LABEL[f.type] ?? "").toLowerCase() : "as typed"}</small>
                  <button
                    type="button"
                    onClick={() => setFavorites((list) => list.filter((x) => x.name !== f.name))}
                    aria-label={`Remove ${f.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-sm text-xl text-ink-500 hover:bg-paper-100 hover:text-ember-700"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      {error ? (
        <p id="intake-error" role="alert" className="notice mt-6 font-semibold text-ember-700">
          {error}
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-paper-200 pt-6">
        <p className="max-w-[42ch] text-sm text-ink-500">Nothing here leaves your browser except the search terms sent to Qloo.</p>
        <button type="submit" disabled={busy} className="btn btn-primary btn-lg">
          {busy ? "Opening…" : "Make their session"}
        </button>
      </div>
    </form>
  );
}
