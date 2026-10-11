"use client";

import { CardArt } from "@/components/CardArt";
import type { Card } from "@/lib/session/types";

interface Props {
  cards: Card[];
  currentIndex: number;
  onSelect: (index: number) => void;
  retuning: boolean;
}

/** "The programme": numbered mini sleeves with the title beneath. */
export function DeckStrip({ cards, currentIndex, onSelect, retuning }: Props) {
  return (
    <nav aria-label="Session cards" className="print-hide">
      <span className="label mb-3 block">The programme</span>
      <ol className="scrollbar-none flex gap-3 overflow-x-auto px-1 pt-1 pb-3" data-testid="deck-strip">
        {cards.map((card, i) => {
          const current = i === currentIndex;
          const upcoming = i > currentIndex && !card.reaction;
          const isNew = card.addedBy === "adapt" && !card.reaction;
          return (
            <li key={card.id} className="w-[148px] flex-none" data-domain={card.domain} aria-current={current ? "step" : undefined}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-label={`Card ${i + 1}: ${card.title}${card.reaction === "lit_up" ? ", they lit up" : card.reaction === "not_this" ? ", not this one" : ""}`}
                className="block w-full rounded-md text-left"
              >
                <div
                  className={`h-[100px] overflow-hidden rounded-md border transition-opacity duration-160 ${current ? "border-ink-900" : "border-paper-300"} ${
                    retuning && upcoming ? "opacity-50" : ""
                  }`}
                >
                  <CardArt title={card.title} domain={card.domain} imageUrl={card.imageUrl} variant="thumb" className="h-full w-full text-[10px]" />
                </div>
                <div className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-1.5 border-b-2 px-0.5 pt-2 pb-1.5 ${current ? "border-ember-600" : "border-transparent"}`}>
                  <span className="font-display text-sm text-ink-500">{i + 1}</span>
                  <span className="line-clamp-2 text-sm leading-[1.25] font-medium text-ink-900">
                    {card.title}
                    {isNew ? <span className="ml-1.5 text-[10px] font-semibold tracking-[0.12em] text-moss-700 uppercase">new</span> : null}
                  </span>
                  <span className={`text-sm ${card.reaction === "lit_up" ? "text-ember-600" : "text-ink-400"}`} aria-hidden="true">
                    {card.reaction === "lit_up" ? "♥" : card.reaction === "not_this" ? "—" : ""}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
