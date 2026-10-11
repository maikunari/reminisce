"use client";

import { useEffect, useRef } from "react";

import { DomainBadge } from "@/components/DomainBadge";
import type { Card, Session, TraceEvent } from "@/lib/session/types";

interface Props {
  open: boolean;
  onClose: () => void;
  session: Session;
  card?: Card;
  /** Events from the operation in flight (not yet merged into session.trace). */
  liveEvents: TraceEvent[];
}

const SOURCE_LABEL = {
  live: { label: "Live Qloo", className: "bg-sage-100 text-sage-700" },
  recorded: { label: "Recorded Qloo response", className: "bg-sea-100 text-sea-700" },
  synthetic: { label: "Synthetic fixture", className: "bg-gold-100 text-gold-700" },
} as const;

function splitParams(params: Record<string, string>) {
  const signals: [string, string][] = [];
  const filters: [string, string][] = [];
  const other: [string, string][] = [];
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith("signal.")) signals.push([k, v]);
    else if (k.startsWith("filter.")) filters.push([k, v]);
    else other.push([k, v]);
  }
  return { signals, filters, other };
}

function ParamRows({ rows, names }: { rows: [string, string][]; names: Map<string, string> }) {
  if (rows.length === 0) return <p className="text-base text-ink-500">none</p>;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="mono rounded bg-cream-100 px-1.5 py-0.5 text-ink-700">{k}</dt>
          <dd className="min-w-0 text-base break-words text-ink-900">
            {v
              .split(",")
              .map((part) => names.get(part) ?? part)
              .join(", ")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

const POLICY_LABEL = {
  llm: { label: "LLM", className: "bg-sea-100 text-sea-700" },
  scripted: { label: "Scripted", className: "bg-gold-100 text-gold-700" },
} as const;

function Bar({ value, className }: { value: number; className: string }) {
  const pct = Math.max(2, Math.min(100, Math.round(value * 100)));
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-cream-200" aria-hidden="true">
      <div className={`h-full rounded-full ${className}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function kindIcon(kind: TraceEvent["kind"]): { glyph: string; className: string; label: string } {
  switch (kind) {
    case "narration":
      return { glyph: "✦", className: "text-ember-600", label: "agent" };
    case "tool_call":
      return { glyph: "▶", className: "text-ink-500", label: "tool call" };
    case "tool_result":
      return { glyph: "✓", className: "text-sage-700", label: "result" };
    case "note":
      return { glyph: "i", className: "text-sea-700", label: "note" };
    case "error":
      return { glyph: "!", className: "text-ember-700", label: "error" };
  }
}

export function TracePanel({ open, onClose, session, card, liveEvents }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const names = new Map<string, string>();
  for (const c of session.cards) names.set(c.entityId, c.title);
  for (const f of session.person.favorites) if (f.entityId) names.set(f.entityId, f.name);
  const events = [...session.trace, ...liveEvents];
  const qlooCalls = events.filter((e) => e.qloo).length;
  const signals = card ? splitParams(card.signals.params) : null;
  const source = card ? SOURCE_LABEL[card.signals.source] : null;

  return (
    <>
      {/* Backdrop for the drawer; the panel becomes a sticky column from xl up. */}
      <div className="fixed inset-0 z-30 bg-ink-900/30 xl:hidden" aria-hidden="true" onClick={onClose} />
      <aside
        id="trace-panel"
        role="complementary"
        aria-label="Why Qloo"
        className="fixed inset-0 z-40 overflow-y-auto bg-cream-50 p-5 shadow-lift md:left-auto md:w-[28rem] md:max-w-full md:rounded-l-card xl:sticky xl:inset-auto xl:top-4 xl:z-auto xl:max-h-[calc(100dvh-2rem)] xl:w-auto xl:rounded-card xl:bg-white xl:p-6 xl:ring-1 xl:ring-cream-300"
        data-testid="trace-panel"
      >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl font-semibold text-ink-900">Why Qloo</h2>
          <p className="mt-1 text-base text-ink-500">
            {qlooCalls} Qloo call{qlooCalls === 1 ? "" : "s"} · {session.qlooMode === "live" ? "live API" : "fixture mode"} ·{" "}
            {session.planner === "llm" ? "LLM-driven agent" : "deterministic agent"}
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close Why Qloo panel"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cream-200 text-2xl text-ink-900 hover:bg-ember-100"
        >
          ×
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-base">
        <div className="rounded-2xl bg-cream-100 p-3">
          <dt className="font-bold text-ink-500">Youth window</dt>
          <dd className="text-xl font-bold text-ink-900">
            {session.youthWindow.start}–{session.youthWindow.end}
          </dd>
        </div>
        <div className="rounded-2xl bg-cream-100 p-3">
          <dt className="font-bold text-ink-500">Age signal</dt>
          <dd className="mono text-ink-900">{session.ageBucket}</dd>
        </div>
      </dl>

      {card && signals && source ? (
        <section aria-labelledby="trace-card-heading" className="mt-6 rounded-2xl border-2 border-cream-300 p-4" data-testid="trace-card">
          <h3 id="trace-card-heading" className="text-base font-bold tracking-wide text-ink-500 uppercase">
            This card
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DomainBadge domain={card.domain} size="sm" />
            <span className={`rounded-full px-2.5 py-1 text-sm font-bold ${source.className}`}>{source.label}</span>
            {card.promptSource ? (
              <span className={`rounded-full px-2.5 py-1 text-sm font-bold ${card.promptSource === "llm" ? POLICY_LABEL.llm.className : POLICY_LABEL.scripted.className}`}>
                {card.promptSource === "llm" ? "LLM-written prompt" : "Offline template prompt"}
              </span>
            ) : null}
          </div>
          <p className="mt-3 font-display text-2xl font-semibold text-ink-900">{card.title}</p>
          <p className="mono mt-1 text-ink-500">
            GET {card.signals.path} · filter.type={card.signals.qlooType}
          </p>

          <div className="mt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-base font-bold text-ink-700">Affinity</span>
              <span className="font-display text-3xl font-semibold text-ink-900" data-testid="trace-affinity">
                {card.signals.affinity !== null ? card.signals.affinity.toFixed(3) : "n/a"}
              </span>
            </div>
            <Bar value={card.signals.affinity ?? 0} className="bg-ember-600" />
            <p className="mt-1 text-base text-ink-500">
              Rank #{card.signals.rank} in the result list
              {typeof card.signals.popularity === "number" ? ` · popularity ${card.signals.popularity.toFixed(2)}` : ""}
            </p>
          </div>

          {card.signals.explainability ? (
            <div className="mt-4">
              <h4 className="text-base font-bold text-ink-700">Which seeds pulled it in</h4>
              <ul className="mt-2 space-y-2">
                {Object.entries(card.signals.explainability)
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, score]) => (
                    <li key={id}>
                      <div className="flex justify-between text-base">
                        <span className="font-bold text-ink-900">{names.get(id) ?? id}</span>
                        <span className="text-ink-500">{score.toFixed(2)}</span>
                      </div>
                      <Bar value={score} className="bg-sage-600" />
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            <div>
              <h4 className="text-base font-bold text-ink-700">Signals</h4>
              <ParamRows rows={signals.signals} names={names} />
            </div>
            <div>
              <h4 className="text-base font-bold text-ink-700">Filters</h4>
              <ParamRows rows={signals.filters} names={names} />
            </div>
            <div>
              <h4 className="text-base font-bold text-ink-700">Output</h4>
              <ParamRows rows={signals.other} names={names} />
            </div>
          </div>

          {card.signals.warnings.length > 0 ? (
            <div className="mt-4 rounded-xl bg-gold-100 p-3 text-base text-gold-700">
              <strong>Dropped before sending:</strong>
              <ul className="mt-1 list-disc pl-5">
                {card.signals.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {card.signals.source === "synthetic" ? (
            <p className="mt-3 text-base text-ink-500">
              Synthetic fixture: shaped like a Qloo response, scored by a deterministic stand-in. Set QLOO_API_KEY to go live.
            </p>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="trace-timeline-heading" className="mt-6">
        <h3 id="trace-timeline-heading" className="text-base font-bold tracking-wide text-ink-500 uppercase">
          Agent timeline
        </h3>
        <ol className="mt-2 space-y-2" data-testid="trace-timeline">
          {events.map((e) => {
            const icon = kindIcon(e.kind);
            return (
              <li key={e.id} className="flex items-start gap-3 rounded-xl px-2 py-1.5 odd:bg-cream-100/60">
                <span className={`mt-0.5 w-5 shrink-0 text-center text-lg font-bold ${icon.className}`} aria-label={icon.label}>
                  {icon.glyph}
                </span>
                <div className="min-w-0 flex-1">
                  {e.policy ? (
                    <span className={`mr-2 rounded-full px-2 py-0.5 text-sm font-bold ${POLICY_LABEL[e.policy].className}`} data-testid="trace-policy">
                      {POLICY_LABEL[e.policy].label}
                    </span>
                  ) : null}
                  <p className={`text-base leading-snug ${e.kind === "narration" ? "text-ink-900 italic" : "text-ink-700"}`}>
                    {e.tool && e.kind === "tool_call" ? <span className="mono mr-1 text-ink-900">{e.tool}</span> : null}
                    {e.summary}
                  </p>
                  {e.qloo ? (
                    <p className="mono mt-1 flex flex-wrap gap-x-2 text-ink-500">
                      <span>GET {e.qloo.path}</span>
                      <span>· {e.qloo.resultCount} results</span>
                      <span>· {e.qloo.durationMs} ms</span>
                      <span>· {e.qloo.source}</span>
                      {e.qloo.warnings.length > 0 ? <span className="text-gold-700">· {e.qloo.warnings.length} dropped</span> : null}
                    </p>
                  ) : null}
                  {e.kind === "tool_call" && e.args ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-base text-ember-700">arguments</summary>
                      <pre className="mono mt-1 overflow-x-auto rounded-lg bg-ink-900 p-3 text-cream-100">{JSON.stringify(e.args, null, 2)}</pre>
                    </details>
                  ) : null}
                  {e.qloo ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-base text-ember-700">request parameters</summary>
                      <pre className="mono mt-1 overflow-x-auto rounded-lg bg-ink-900 p-3 whitespace-pre-wrap text-cream-100">
                        {Object.entries(e.qloo.params)
                          .map(([k, v]) => `${k}=${v}`)
                          .join("\n")}
                      </pre>
                    </details>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      </aside>
    </>
  );
}
