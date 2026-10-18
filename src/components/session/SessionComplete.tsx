"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { dictionary } from "@/lib/i18n";
import type { Session } from "@/lib/session/types";

import { Keepsake } from "./Keepsake";

interface Props {
  session: Session;
  /** `complete` is the thank-you and the summary; `closed` is the quiet screen after "Done". */
  closed: boolean;
  onDone: () => void;
  onBack: () => void;
  onReopen: () => void;
}

/** The calm end of a session: thanks, what lit them up, a summary to keep, and a way on. */
export function SessionComplete({ session, closed, onDone, onBack, onReopen }: Props) {
  const t = dictionary(session.person.language);
  const name = session.person.name;
  const litCount = session.cards.filter((c) => c.reaction === "lit_up").length;
  const heading = useRef<HTMLHeadingElement>(null);
  // Arriving here moves focus to the heading, so a screen reader starts with the thanks and the page is at its top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    heading.current?.focus();
  }, [closed]);

  if (closed) {
    return (
      <section className="line-in mx-auto max-w-[36rem] py-12 text-center sm:py-20" aria-labelledby="closed-heading" data-testid="session-closed">
        <h2 id="closed-heading" ref={heading} tabIndex={-1} className="balance text-3xl outline-none sm:text-4xl">
          {t.ending.closedTitle(name)}
        </h2>
        <p className="lede mt-4">{t.ending.closedBody}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className="btn btn-primary" data-testid="start-another">
            {t.ending.startAnother}
          </Link>
          <button type="button" onClick={onReopen} className="btn btn-outline" data-testid="show-summary">
            {t.ending.showSummary}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="line-in mx-auto max-w-[44rem] py-6 sm:py-10" aria-labelledby="complete-heading" data-testid="session-complete">
      <div className="print-hide text-center">
        <p className="label">{t.ending.stats(session.cards.length, litCount)}</p>
        <h2 id="complete-heading" ref={heading} tabIndex={-1} className="balance mt-3 text-3xl outline-none sm:text-4xl">
          {t.ending.complete}
        </h2>
        <p className="mt-4 text-lg text-ink-900" data-testid="complete-thanks">
          {t.ending.thanks(name)}
        </p>
        <p className="lede mt-2">{t.ending.lede}</p>
      </div>
      <div className="mt-8">
        <p className="print-hide label mb-2">{t.ending.summaryNote}</p>
        <Keepsake session={session} />
      </div>
      <div className="print-hide mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className="btn btn-primary" data-testid="start-another">
          {t.ending.startAnother}
        </Link>
        <button type="button" onClick={onDone} className="btn btn-outline" data-testid="session-done">
          {t.ending.done}
        </button>
        <button type="button" onClick={onBack} className="btn-text btn-text-muted" data-testid="back-to-cards">
          {t.ending.backToCards}
        </button>
      </div>
    </section>
  );
}
