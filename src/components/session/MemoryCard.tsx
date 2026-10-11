"use client";

import { CardArt } from "@/components/CardArt";
import { DOMAIN_INK } from "@/lib/session/domain-ink";
import { DOMAIN_INFO, type Card, type Language, type Pronouns, type Reaction } from "@/lib/session/types";

interface Props {
  card: Card;
  index: number;
  total: number;
  onReact: (reaction: Reaction) => void;
  onWhy: () => void;
  disabled?: boolean;
  language: Language;
  pronouns: Pronouns;
}

/** The card as a two-page spread: the sleeve on the left, the text on the right. */
export function MemoryCard({ card, index, total, onReact, onWhy, disabled, language, pronouns }: Props) {
  const reacted = card.reaction;
  const affinity = card.signals.affinity !== null ? ` · affinity ${card.signals.affinity.toFixed(2)}` : "";
  return (
    <article key={card.id} aria-labelledby={`card-title-${card.id}`} className="surface animate-fade-in grid overflow-hidden md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" data-testid="memory-card">
      <div className="aspect-[4/3] border-b border-paper-300 md:aspect-auto md:min-h-[30rem] md:border-r md:border-b-0">
        <CardArt
          title={card.title}
          domain={card.domain}
          imageUrl={card.imageUrl}
          year={card.year}
          subtitle={card.subtitle}
          className="h-full w-full text-[20px] md:text-[clamp(14px,1.6vw,22px)]"
        />
      </div>
      <div className="@container flex min-w-0 flex-col gap-4 p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="label">
            <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle ${DOMAIN_INK[card.domain].swatch}`} aria-hidden="true" />
            {DOMAIN_INFO[card.domain].label} · Card {index + 1} of {total}
          </p>
          {card.addedBy === "adapt" ? <p className="label">Re-tuned for {pronouns.object}</p> : null}
        </div>
        <div>
          <h2 id={`card-title-${card.id}`} className="balance text-3xl sm:text-4xl" data-testid="card-title">
            {card.title}
          </h2>
          {card.subtitle ? <p className="mt-2 text-md text-ink-500">{card.subtitle}</p> : null}
        </div>
        <blockquote className="prompt my-2 ml-[1.1em]" lang={language === "en" ? undefined : language} data-testid="card-prompt">
          {card.prompt}
        </blockquote>
        {card.description ? <p className="max-w-[44ch] text-md text-ink-700">{card.description}</p> : null}
        <p className="border-t border-paper-200 pt-3 text-sm text-ink-500">
          From Qloo: {card.why}
          {affinity} ·{" "}
          <button type="button" onClick={onWhy} className="btn-text btn-text-inline text-sm text-ember-700">
            Show the call
          </button>
        </p>
        <div className="mt-auto grid gap-3 pt-2 @md:grid-cols-2" role="group" aria-label="How did they respond?">
          <button
            type="button"
            onClick={() => onReact("lit_up")}
            disabled={disabled || !!reacted}
            aria-pressed={reacted === "lit_up"}
            data-testid="react-lit-up"
            className={`btn btn-primary btn-lg ${reacted === "lit_up" ? "disabled:opacity-100" : ""}`}
          >
            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="currentColor" aria-hidden="true">
              <path d="M12 21s-7.5-4.6-9.5-9.2C1 8 3.3 4.5 6.8 4.5c2 0 3.4 1.1 5.2 3 1.8-1.9 3.2-3 5.2-3 3.5 0 5.8 3.5 4.3 7.3C19.5 16.4 12 21 12 21Z" />
            </svg>
            {reacted === "lit_up" ? "They lit up!" : "They lit up"}
          </button>
          <button
            type="button"
            onClick={() => onReact("not_this")}
            disabled={disabled || !!reacted}
            aria-pressed={reacted === "not_this"}
            data-testid="react-not-this"
            className={`btn btn-lg ${reacted === "not_this" ? "bg-ink-900 text-white disabled:opacity-100" : "btn-outline"}`}
          >
            Not this one
          </button>
        </div>
      </div>
    </article>
  );
}
