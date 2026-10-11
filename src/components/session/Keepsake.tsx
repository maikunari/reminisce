"use client";

import Link from "next/link";

import type { Session } from "@/lib/session/types";

/** The end of a session as something to keep: what lit them up, printable for the care file. */
export function Keepsake({ session }: { session: Session }) {
  const lit = session.cards.filter((c) => c.reaction === "lit_up");
  const started = new Date(session.createdAt);
  const dateLabel = started.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const minutes = Math.max(1, Math.round((Date.parse(session.updatedAt) - Date.parse(session.createdAt)) / 60_000));
  return (
    <section className="surface mt-8 max-w-[640px] p-6 sm:p-8" aria-labelledby="keepsake-heading" data-testid="keepsake">
      <p className="label">
        {dateLabel} · {minutes} minute{minutes === 1 ? "" : "s"}
      </p>
      <h2 id="keepsake-heading" className="mt-2 text-2xl">
        {lit.length > 0 ? `What lit ${session.person.name} up today` : `Nothing landed for ${session.person.name} today`}
      </h2>
      {lit.length > 0 ? (
        <ol className="mt-4 list-decimal space-y-2 pl-6 text-md leading-[1.5] marker:font-display marker:text-ember-700">
          {lit.map((c) => (
            <li key={c.id}>
              {c.title} <span className="font-display text-ink-500 italic">· “{c.prompt}”</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-md text-ink-700">That happens. Another day, another table.</p>
      )}
      <div className="print-hide mt-6 flex flex-wrap items-center gap-4">
        {lit.length > 0 ? (
          <button type="button" className="btn btn-outline" onClick={() => window.print()}>
            Print for the care file
          </button>
        ) : null}
        <Link href="/" className="btn-text btn-text-muted">
          Make another session
        </Link>
      </div>
    </section>
  );
}
