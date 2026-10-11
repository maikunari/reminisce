"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { createSessionShell } from "@/lib/session/storage";
import { LANGUAGES, type Favorite, type Language } from "@/lib/session/types";
import { useCurrentYear } from "@/lib/client/hooks";
import { MIN_BIRTH_YEAR, computeYouthWindow } from "@/lib/session/youth-window";

import { EntityAutocomplete, type Suggestion } from "./EntityAutocomplete";

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
    if (!name.trim()) return setError("Please add their name (or what you call them).");
    if (!yearValid) return setError(`Birth year should be between ${MIN_BIRTH_YEAR} and ${maxYear ?? "today"}.`);
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
    <form onSubmit={submit} noValidate className="rounded-card bg-white p-6 shadow-card ring-1 ring-cream-300 sm:p-8" aria-describedby={error ? "intake-error" : undefined}>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <label htmlFor="person-name" className="mb-2 block text-lg font-bold text-ink-900">
            Their name
          </label>
          <input
            id="person-name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Grandma Michiko"
            autoComplete="off"
            className="min-h-14 w-full rounded-2xl border-2 border-cream-300 bg-white px-4 text-xl text-ink-900 placeholder:text-ink-300 focus:border-ember-600"
          />
        </div>
        <div>
          <label htmlFor="birth-year" className="mb-2 block text-lg font-bold text-ink-900">
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
            className="min-h-14 w-full rounded-2xl border-2 border-cream-300 bg-white px-4 text-xl text-ink-900 placeholder:text-ink-300 focus:border-ember-600"
          />
          <p id="birth-year-hint" className="mt-1.5 text-base text-ink-500" aria-live="polite">
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
          <label htmlFor="language" className="mb-2 block text-lg font-bold text-ink-900">
            Language for the prompts
          </label>
          <select
            id="language"
            name="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className="min-h-14 w-full rounded-2xl border-2 border-cream-300 bg-white px-4 text-xl text-ink-900 focus:border-ember-600"
          >
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
            hint="Pick from Qloo's suggestions so the taste graph can use them as seeds. Press Enter to add a free-text favorite."
            autoComplete="off"
          />
          {favorites.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Chosen favorites">
              {favorites.map((f) => (
                <li key={f.name} className="inline-flex items-center gap-2 rounded-full bg-ember-100 py-1.5 pr-1.5 pl-4 text-lg font-bold text-ember-700">
                  {f.name}
                  {!f.entityId ? <span className="text-sm font-normal text-ember-700/80">(unmatched)</span> : null}
                  <button
                    type="button"
                    onClick={() => setFavorites((list) => list.filter((x) => x.name !== f.name))}
                    aria-label={`Remove ${f.name}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-ember-600 hover:text-white"
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
        <p id="intake-error" role="alert" className="mt-5 rounded-2xl bg-ember-100 px-4 py-3 text-lg font-bold text-ember-700">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-base text-ink-500">Nothing here leaves your browser except the search terms sent to Qloo.</p>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-ink-900 px-7 text-xl font-bold text-white shadow-card transition hover:bg-ember-700 disabled:opacity-70"
        >
          {busy ? "Opening…" : "Build their session"}
        </button>
      </div>
    </form>
  );
}
