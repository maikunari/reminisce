"use client";

import { dictionary } from "@/lib/i18n";
import { displayName } from "@/lib/session/names";
import type { Session } from "@/lib/session/types";

/**
 * The memory summary: what lit them up, as something to keep or hand to family
 * and caregivers. It is what prints, so it carries its own heading and who it
 * is for; browser print can save it as a PDF.
 */
export function Keepsake({ session }: { session: Session }) {
  const t = dictionary(session.person.language);
  const lit = session.cards.filter((c) => c.reaction === "lit_up");
  const started = new Date(session.createdAt);
  const dateLabel = started.toLocaleDateString(t.locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const minutes = Math.max(1, Math.round((Date.parse(session.updatedAt) - Date.parse(session.createdAt)) / 60_000));
  const { person, youthWindow } = session;
  return (
    <section className="surface p-6 sm:p-8" aria-labelledby="keepsake-heading" data-testid="keepsake">
      <p className="label">{t.ending.summaryTitle}</p>
      <h2 id="keepsake-heading" className="mt-2 text-2xl">
        {lit.length > 0 ? t.keepsake.litTitle(person.name) : t.keepsake.nothingTitle(person.name)}
      </h2>
      <p className="mt-2 text-sm text-ink-500">{t.ending.summaryFor(person.name, person.hometown, youthWindow.start, youthWindow.end)}</p>
      <p className="text-sm text-ink-500">{t.keepsake.duration(dateLabel, minutes)}</p>
      {lit.length > 0 ? (
        <ol className="mt-5 space-y-4 text-md leading-[1.5]">
          {lit.map((c) => {
            const name = displayName(c, person.language);
            // A film's subtitle already carries its year and country; a song or place has no year of its own to add.
            const detail = c.subtitle ?? (c.year ? String(c.year) : "");
            return (
              <li key={c.id} className="break-inside-avoid border-t border-paper-200 pt-3 first:border-t-0 first:pt-0" data-testid="keepsake-moment">
                <p className="text-ink-900">{name.title}</p>
                <p className="label mt-0.5">{t.ending.cardLine(t.domain[c.domain].label, detail)}</p>
                <p className="mt-1 font-display text-ink-500 italic">“{c.prompt}”</p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-md text-ink-700">{t.keepsake.nothingBody}</p>
      )}
      <p className="mt-6 hidden text-sm text-ink-400 print:block">{t.ending.madeWith}</p>
      <div className="print-hide mt-6">
        <button type="button" className="btn btn-outline" onClick={() => window.print()} data-testid="print-summary">
          {t.keepsake.print}
        </button>
      </div>
    </section>
  );
}
