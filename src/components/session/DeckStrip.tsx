"use client";

import type { CSSProperties } from "react";

import { CardArt } from "@/components/CardArt";
import { dictionary } from "@/lib/i18n";
import type { Card, Language } from "@/lib/session/types";

interface Props {
  cards: Card[];
  currentIndex: number;
  onSelect: (index: number) => void;
  retuning: boolean;
  language?: Language;
  /** The session has just arrived: the programme deals in one card at a time. */
  reveal?: boolean;
}

/**
 * "The programme": numbered mini sleeves with the title beneath. A long title
 * wraps to two lines and then ends in an ellipsis; hovering or focusing the
 * card lets it run to its full length, and the button's accessible name
 * always carries the whole title.
 */
export function DeckStrip({ cards, currentIndex, onSelect, retuning, language, reveal = false }: Props) {
  const t = dictionary(language).strip;
  return (
    <nav aria-label={t.ariaLabel} className="print-hide">
      <span className="label mb-3 block">{t.title}</span>
      <ol className="scrollbar-none flex items-start gap-3 overflow-x-auto px-1 pt-1 pb-3" data-testid="deck-strip">
        {cards.map((card, i) => {
          const current = i === currentIndex;
          const upcoming = i > currentIndex && !card.reaction;
          const isNew = card.addedBy === "adapt" && !card.reaction;
          const reactionWord = card.reaction === "lit_up" ? `, ${t.litUp}` : card.reaction === "not_this" ? `, ${t.notThis}` : "";
          return (
            <li
              key={card.id}
              className={`w-[148px] flex-none ${reveal ? "reveal-rise" : ""}`}
              style={reveal ? ({ "--i": i + 2 } as CSSProperties) : undefined}
              data-domain={card.domain}
              aria-current={current ? "step" : undefined}
            >
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-label={`${t.cardLabel(i + 1, card.title)}${reactionWord}`}
                title={card.title}
                className="group block w-full rounded-md text-left"
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
                  <span className="line-clamp-2 text-sm leading-[1.25] font-medium break-words hyphens-auto text-ink-900 group-hover:line-clamp-none group-focus-visible:line-clamp-none" data-testid="strip-title">
                    {card.title}
                    {isNew ? <span className="ml-1.5 text-[10px] font-semibold tracking-[0.12em] text-moss-700 uppercase">{t.isNew}</span> : null}
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
