"use client";

import { CardArt } from "@/components/CardArt";
import { DomainBadge } from "@/components/DomainBadge";
import type { Card, Reaction } from "@/lib/session/types";

interface Props {
  card: Card;
  index: number;
  total: number;
  onReact: (reaction: Reaction) => void;
  onWhy: () => void;
  disabled?: boolean;
}

export function MemoryCard({ card, index, total, onReact, onWhy, disabled }: Props) {
  const reacted = card.reaction;
  return (
    <article
      key={card.id}
      aria-labelledby={`card-title-${card.id}`}
      className="animate-rise grid overflow-hidden rounded-card bg-white shadow-lift ring-1 ring-cream-300 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
      data-testid="memory-card"
    >
      <CardArt title={card.title} domain={card.domain} imageUrl={card.imageUrl} year={card.year} className="aspect-[4/3] md:aspect-auto md:min-h-[32rem]" />
      <div className="flex flex-col gap-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <DomainBadge domain={card.domain} />
          {card.addedBy === "adapt" ? (
            <span className="rounded-full bg-sage-100 px-3 py-1.5 text-base font-bold text-sage-700">Re-tuned for them</span>
          ) : null}
          <span className="ml-auto text-base font-bold text-ink-500">
            Card {index + 1} of {total}
          </span>
        </div>
        <div>
          <h2 id={`card-title-${card.id}`} className="font-display text-4xl leading-[1.08] font-semibold text-ink-900 sm:text-5xl" data-testid="card-title">
            {card.title}
          </h2>
          {card.subtitle ? <p className="mt-2 text-lg text-ink-500">{card.subtitle}</p> : null}
        </div>
        <blockquote className="border-l-4 border-ember-500 pl-5 font-display text-2xl leading-snug text-ink-900 italic sm:text-[1.9rem]" data-testid="card-prompt">
          {card.prompt}
        </blockquote>
        {card.description ? <p className="text-lg leading-relaxed text-ink-700">{card.description}</p> : null}
        <p className="text-base leading-relaxed text-ink-500">
          <span className="font-bold text-ink-700">Why this: </span>
          {card.why}{" "}
          <button type="button" onClick={onWhy} className="inline-flex min-h-11 items-center font-bold text-ember-700 underline decoration-2 underline-offset-4 hover:text-ember-600">
            See the Qloo call
          </button>
        </p>
        <div className="mt-auto grid gap-3 pt-2 sm:grid-cols-2" role="group" aria-label="How did they respond?">
          <button
            type="button"
            onClick={() => onReact("lit_up")}
            disabled={disabled || !!reacted}
            aria-pressed={reacted === "lit_up"}
            data-testid="react-lit-up"
            className={`inline-flex min-h-16 items-center justify-center gap-3 rounded-2xl px-5 text-xl font-bold shadow-card transition disabled:cursor-default ${
              reacted === "lit_up" ? "bg-ember-700 text-white ring-4 ring-ember-100" : "bg-ember-600 text-white hover:bg-ember-700 disabled:opacity-40"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor" aria-hidden="true">
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
            className={`inline-flex min-h-16 items-center justify-center gap-3 rounded-2xl border-2 px-5 text-xl font-bold transition disabled:cursor-default ${
              reacted === "not_this"
                ? "border-ink-700 bg-ink-700 text-white"
                : "border-ink-700 bg-white text-ink-900 hover:bg-cream-100 disabled:opacity-40"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
            </svg>
            {reacted === "not_this" ? "Not this one" : "Not this one"}
          </button>
        </div>
      </div>
    </article>
  );
}
