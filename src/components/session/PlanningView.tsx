"use client";

import type { CSSProperties } from "react";
import { useMemo } from "react";

import { CardArt } from "@/components/CardArt";
import { dictionary } from "@/lib/i18n";
import { DOMAIN_INK } from "@/lib/session/domain-ink";
import { planningProgress, type DomainProgress } from "@/lib/session/planning-progress";
import type { Language, Person, TraceEvent, YouthWindow } from "@/lib/session/types";

interface Props {
  person: Person;
  youthWindow: YouthWindow;
  events: TraceEvent[];
  /** The deck is chosen; the view holds for a moment before the session appears. */
  done?: boolean;
}

/** A little disorder, like sleeves set down on a table. */
const TILT = [-2.2, 1.4, -0.8, 1.8, -1.4, 0.9];

/**
 * Shown while the agent builds the deck: six sleeves on the table, one per
 * kind of memory, each filling with what Qloo found as its answer arrives, and
 * beside them one line per kind that updates in place. Nothing scrolls or
 * jumps; the agent's full log stays in the Why Qloo panel.
 */
export function PlanningView({ person, youthWindow, events, done = false }: Props) {
  const t = dictionary(person.language);
  const progress = useMemo(() => planningProgress(events), [events]);
  const total = progress.domains.length;
  const asking = progress.domains.filter((d) => d.status === "asking").length;
  // Settled kinds count fully and kinds in flight partly, so the bar keeps easing forward.
  const filled = done ? total : Math.max(0.3, progress.settled + asking * 0.4);
  const line = done ? t.planning.ready : progress.narration;
  return (
    <section aria-busy={!done} className="grid min-h-[60vh] gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12" data-testid="planning-view">
      <ol className="grid grid-cols-3 content-start gap-x-3 gap-y-4 sm:gap-x-5 sm:gap-y-6" aria-hidden="true" data-testid="planning-sleeves">
        {progress.domains.map((d, i) => (
          <SleeveSlot key={d.domain} progress={d} index={i} done={done} language={person.language} />
        ))}
      </ol>
      <div className="min-w-0">
        <p className="label">{t.planning.building(person.name)}</p>
        <h2 className="balance mt-3 text-3xl sm:text-4xl">{t.planning.asking(person.hometown, youthWindow.start, youthWindow.end)}</h2>
        <p className="mt-3 text-md text-ink-500 tabular-nums">
          {t.planning.calls(progress.qlooCalls)} {t.planning.seeds(person.favorites.map((f) => f.name))}
        </p>
        <div
          className="meter mt-6"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done ? total : progress.settled}
          aria-label={t.planning.progress(done ? total : progress.settled, total)}
        >
          <i style={{ width: `${Math.round((filled / total) * 100)}%` }} />
        </div>
        {/* The agent's own narration is its trace and stays as written; one line, replaced in place. */}
        <p className="mt-6 min-h-[3em] font-display text-lg text-ink-700 italic" aria-live="polite" lang={done ? undefined : "en"} data-testid="planning-now">
          {line ? (
            <span key={line} className="line-in block">
              {line}
            </span>
          ) : null}
        </p>
        <ul className="mt-4 hidden divide-y divide-paper-200 sm:block" data-testid="planning-trace">
          {progress.domains.map((d) => (
            <DomainLine key={d.domain} progress={d} language={person.language} done={done} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function SleeveSlot({ progress, index, done, language }: { progress: DomainProgress; index: number; done: boolean; language: Language }) {
  const t = dictionary(language);
  const top = progress.items[0];
  const status = done && (progress.status === "waiting" || progress.status === "asking") ? "unused" : progress.status;
  const style = { "--tilt": `${TILT[index % TILT.length]}deg`, "--i": index } as CSSProperties;
  return (
    <li className={`slot slot-${status}`} style={style} data-domain={progress.domain} data-status={status}>
      <div className="slot-frame aspect-square">
        {progress.status === "found" ? (
          <div className="slot-art">
            {top ? (
              <CardArt title={top.name} domain={progress.domain} imageUrl={top.imageUrl} year={top.year} variant="thumb" className="h-full w-full" />
            ) : (
              <span className="slot-label">{t.domain[progress.domain].label}</span>
            )}
          </div>
        ) : (
          <span className="slot-label">{t.domain[progress.domain].label}</span>
        )}
      </div>
      <p key={progress.status} className="slot-caption truncate">{progress.status === "found" ? (top?.name ?? t.domain[progress.domain].label) : " "}</p>
    </li>
  );
}

function DomainLine({ progress, language, done }: { progress: DomainProgress; language: Language; done: boolean }) {
  const t = dictionary(language);
  const names = progress.items.slice(0, 2).map((i) => i.name);
  const text =
    progress.status === "found"
      ? names.length > 0
        ? t.planning.found(names, Math.max(0, progress.count - names.length))
        : t.domain[progress.domain].plural
      : progress.status === "empty"
        ? t.planning.empty
        : progress.status === "asking" && !done
          ? t.planning.askingDomain
          : done
            ? "—"
            : t.planning.waiting;
  return (
    <li className="grid min-h-[2.9rem] grid-cols-[8.5rem_minmax(0,1fr)] items-baseline gap-4 py-2.5" data-domain={progress.domain} data-status={progress.status}>
      <span className="label label-ink flex items-center gap-2">
        <span className={`inline-block size-2.5 flex-none rounded-[2px] ${DOMAIN_INK[progress.domain].swatch}`} aria-hidden="true" />
        {t.domain[progress.domain].label}
      </span>
      <span className={`truncate text-md transition-colors duration-300 ${progress.status === "found" ? "text-ink-900" : "text-ink-400"}`}>
        <span key={`${progress.status}:${text}`} className="line-in inline">
          {text}
        </span>
      </span>
    </li>
  );
}
