"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";

import { CardArt } from "@/components/CardArt";
import { dictionary } from "@/lib/i18n";
import { DOMAIN_INK } from "@/lib/session/domain-ink";
import { displayName } from "@/lib/session/names";
import { OVERVIEW_MIN_CARDS, canDrop, groupByDomain } from "@/lib/session/overview";
import { planningProgress } from "@/lib/session/planning-progress";
import type { Card, Session } from "@/lib/session/types";

interface Props {
  session: Session;
  /** The last card dropped, offered back until something else changes. */
  dropped: Card | null;
  /** Announced to screen readers after a shuffle. */
  shuffled: boolean;
  /** The deck has just been dealt: the groups arrive one after another. */
  reveal?: boolean;
  onStart: () => void;
  onShuffle: () => void;
  onDrop: (cardId: string) => void;
  onUndo: () => void;
  onWhy: () => void;
}

/**
 * "Session ready": where planning stops. The lineup as small sleeves grouped
 * by kind of memory, each with the Qloo line that chose it, a large Start
 * button, a drop button per card and a shuffle for the order, and under the
 * heading a short strip of how Qloo built the deck. Nothing here calls Qloo
 * or a model; it only reads what planning already returned.
 */
export function SessionOverview({ session: s, dropped, shuffled, reveal = false, onStart, onShuffle, onDrop, onUndo, onWhy }: Props) {
  const language = s.person.language;
  const t = dictionary(language);
  const o = t.overview;
  const groups = useMemo(() => groupByDomain(s.cards), [s.cards]);
  const progress = useMemo(() => planningProgress(s.trace), [s.trace]);
  const found = progress.domains.filter((d) => d.status === "found" && d.count > 0);
  const droppable = canDrop(s.cards);
  return (
    <section aria-labelledby="overview-title" className="mx-auto max-w-[64rem] pb-10" data-testid="session-overview">
      <header className="max-w-[44rem]">
        <p className="label">{o.label}</p>
        <h2 id="overview-title" className="balance mt-3 text-3xl sm:text-4xl">
          {o.title(s.person.name)}
        </h2>
        <p className="lede mt-3">{o.lede(s.cards.length, s.person.hometown, s.youthWindow.start, s.youthWindow.end)}</p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onStart} className="btn btn-primary btn-lg px-8" data-testid="start-session">
            {o.start}
          </button>
          <button type="button" onClick={onShuffle} className="btn btn-outline" data-testid="shuffle-order">
            {o.shuffle}
          </button>
        </div>
        <p role="status" className="sr-only">
          {shuffled ? o.shuffled : ""}
        </p>
      </header>

      <div className="mt-8 border-y border-paper-300 py-4" data-testid="overview-built">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="label label-ink">{o.built}</p>
          <button type="button" onClick={onWhy} className="btn-text btn-text-inline text-sm text-ember-700">
            {o.seeCalls}
          </button>
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-md text-ink-700">
          <li className="tabular-nums">{o.builtCalls(progress.qlooCalls)}</li>
          {found.map((d) => (
            <li key={d.domain} className="flex items-center gap-2" data-domain={d.domain}>
              <span className={`inline-block size-2.5 flex-none rounded-[2px] ${DOMAIN_INK[d.domain].swatch}`} aria-hidden="true" />
              {o.builtKind(t.domain[d.domain].label, d.count)}
            </li>
          ))}
        </ul>
      </div>

      {dropped ? (
        <p role="status" className="notice mt-5" data-testid="overview-dropped">
          <span>{o.dropped(displayName(dropped, language).title)}</span>
          <button type="button" onClick={onUndo} className="btn-text btn-text-inline text-ember-700" data-testid="undo-drop">
            {o.undo}
          </button>
        </p>
      ) : null}
      {!droppable ? (
        <p role="status" className="mt-5 text-sm text-ink-500">
          {o.atMinimum(OVERVIEW_MIN_CARDS)}
        </p>
      ) : null}

      <div role="group" className="mt-6 grid gap-8 lg:grid-cols-2" aria-label={o.lineup} data-testid="overview-lineup">
        {groups.map((group, g) => (
          <section key={group.domain} aria-labelledby={`overview-${group.domain}`} data-domain={group.domain}>
            <h3 id={`overview-${group.domain}`} className="label label-ink flex items-center gap-2">
              <span className={`inline-block size-2.5 flex-none rounded-[2px] ${DOMAIN_INK[group.domain].swatch}`} aria-hidden="true" />
              {t.domain[group.domain].label}
            </h3>
            <ol className="mt-3 flex flex-col gap-3">
              {group.entries.map(({ card, position }) => {
                const name = displayName(card, language).title;
                return (
                  <li
                    key={card.id}
                    className={`surface grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-4 p-3 sm:grid-cols-[6.5rem_minmax(0,1fr)] ${reveal ? "reveal-rise" : ""}`.trim()}
                    style={reveal ? ({ "--i": g + 1 } as CSSProperties) : undefined}
                    data-testid="overview-card"
                  >
                    <div className="aspect-square overflow-hidden rounded-md border border-paper-300">
                      <CardArt title={name} domain={card.domain} imageUrl={card.imageUrl} year={card.year} variant="thumb" className="h-full w-full text-[10px]" />
                    </div>
                    <div className="min-w-0">
                      <p className="label tabular-nums">{o.position(position)}</p>
                      <h4 className="mt-1 font-display text-lg leading-tight break-words" data-testid="overview-title">
                        {name}
                      </h4>
                      <p className="mt-1 text-sm text-ink-500">
                        {t.card.fromQloo} {card.why}
                      </p>
                      <button
                        type="button"
                        onClick={() => onDrop(card.id)}
                        disabled={!droppable}
                        aria-label={o.dropAria(name)}
                        className="btn btn-quiet mt-2 min-h-[48px] px-4 text-sm"
                        data-testid="drop-card"
                      >
                        {o.drop}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      <div className="mt-10 flex justify-center">
        <button type="button" onClick={onStart} className="btn btn-primary btn-lg px-8" data-testid="start-session-bottom">
          {o.start}
        </button>
      </div>
    </section>
  );
}
