"use client";

import { CardArt } from "@/components/CardArt";
import { DomainIcon } from "@/components/DomainIcon";
import { DOMAIN_STYLE } from "@/lib/session/domain-style";
import type { Card } from "@/lib/session/types";

interface Props {
  cards: Card[];
  currentIndex: number;
  onSelect: (index: number) => void;
  retuning: boolean;
}

export function DeckStrip({ cards, currentIndex, onSelect, retuning }: Props) {
  return (
    <nav aria-label="Session cards" className="relative">
      <ol className="flex gap-3 overflow-x-auto pb-3 [scrollbar-width:thin]" data-testid="deck-strip">
        {cards.map((card, i) => {
          const current = i === currentIndex;
          const upcoming = i > currentIndex && !card.reaction;
          const style = DOMAIN_STYLE[card.domain];
          return (
            <li key={card.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-current={current ? "step" : undefined}
                aria-label={`Card ${i + 1}: ${card.title}${card.reaction === "lit_up" ? ", they lit up" : card.reaction === "not_this" ? ", not this one" : ""}`}
                className={`group relative flex w-40 flex-col overflow-hidden rounded-2xl bg-white text-left shadow-card ring-2 transition ${
                  current ? `${style.ring} ring-offset-2 ring-offset-cream-50` : "ring-transparent hover:ring-cream-300"
                } ${retuning && upcoming ? "animate-breathe opacity-70" : ""}`}
              >
                <CardArt title={card.title} domain={card.domain} imageUrl={card.imageUrl} variant="thumb" className="h-24 w-full" />
                <span className="flex items-center gap-1.5 px-3 pt-2 text-sm font-bold uppercase tracking-wide text-ink-500">
                  <DomainIcon domain={card.domain} className="h-4 w-4" />
                  {card.domain}
                </span>
                <span className="line-clamp-2 px-3 pt-0.5 pb-3 text-base leading-tight font-bold text-ink-900">{card.title}</span>
                {card.reaction ? (
                  <span
                    className={`absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full text-white ${
                      card.reaction === "lit_up" ? "bg-ember-600" : "bg-ink-700"
                    }`}
                    aria-hidden="true"
                  >
                    {card.reaction === "lit_up" ? "♥" : "–"}
                  </span>
                ) : null}
                {card.addedBy === "adapt" && !card.reaction ? (
                  <span className="absolute top-2 left-2 rounded-full bg-sage-600 px-2 py-0.5 text-xs font-bold text-white">new</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
