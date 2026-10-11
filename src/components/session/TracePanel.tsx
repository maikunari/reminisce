"use client";

import { useEffect, useRef } from "react";

import { ageLabel, joinNames } from "@/lib/agent/prompts";
import { DOMAIN_INFO, type Card, type Session, type TraceEvent } from "@/lib/session/types";
import { isAgeBucket } from "@/lib/session/youth-window";

interface Props {
  open: boolean;
  onClose: () => void;
  session: Session;
  card?: Card;
  /** Events from the operation in flight (not yet merged into session.trace). */
  liveEvents: TraceEvent[];
}

const SOURCE_LABEL = {
  live: "Live Qloo response",
  recorded: "Recorded Qloo response, replayed",
  synthetic: "Synthetic fixture, shaped like a Qloo response",
} as const;

const TYPE_HUMAN: Record<string, string> = {
  "urn:entity:artist": "Artist",
  "urn:entity:movie": "Film",
  "urn:entity:tv_show": "Television show",
  "urn:entity:place": "Place",
  "urn:entity:destination": "Destination",
  "urn:entity:book": "Book",
  "urn:entity:person": "Person",
  "urn:entity:brand": "Brand",
  "urn:entity:podcast": "Podcast",
  "urn:entity:video_game": "Video game",
};

function ordinal(n: number): string {
  const words = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  return words[n - 1] ?? `${n}th`;
}

function tagWords(ids: string): string {
  return ids
    .split(",")
    .map((id) => id.trim().split(":").at(-1)?.replace(/_/g, " ") ?? id)
    .join(", ");
}

/** The human-labelled request table: one row per parameter that was sent. */
function requestRows(card: Card, names: Map<string, string>): [string, string][] {
  const p = card.signals.params;
  const rows: [string, string][] = [];
  rows.push(["Type", TYPE_HUMAN[p["filter.type"] ?? ""] ?? p["filter.type"] ?? ""]);
  const seeds = p["signal.interests.entities"];
  if (seeds) rows.push(["Interests", seeds.split(",").map((id) => names.get(id) ?? "an unnamed entity").join(", ")]);
  if (p["signal.location.query"]) rows.push(["Location", `tuned to ${p["signal.location.query"]}`]);
  if (p["filter.location.query"]) rows.push(["Within", p["filter.location.query"]]);
  const age = p["signal.demographics.age"];
  if (age) rows.push(["Age", isAgeBucket(age) ? ageLabel(age).replace(/^people /, "") : age]);
  if (p["filter.release_year.min"] || p["filter.release_year.max"]) rows.push(["Years", `${p["filter.release_year.min"] ?? ""} to ${p["filter.release_year.max"] ?? ""}`]);
  if (p["filter.release_country"]) rows.push(["Released in", p["filter.release_country"]]);
  if (p["filter.tags"]) rows.push(["Tagged", tagWords(p["filter.tags"])]);
  if (p["filter.geocode.country_code"]) rows.push(["Country", p["filter.geocode.country_code"]]);
  const excluded = p["filter.exclude.entities"];
  if (excluded) {
    const n = excluded.split(",").length;
    rows.push(["Excluding", `${n} entit${n === 1 ? "y" : "ies"} already in the session`]);
  }
  rows.push(["Explain", `${p["feature.explainability"] === "true" ? "On" : "Off"} · take ${p.take ?? "10"}`]);
  rows.push(["Source", SOURCE_LABEL[card.signals.source]]);
  return rows;
}

/** The provenance note: what Qloo was asked, what came back, and how the session was built. */
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
  const sessionPolicy = session.planner === "llm" ? "llm" : "scripted";
  const mixed = events.some((e) => e.policy && e.policy !== sessionPolicy);
  const take = card ? Number(card.signals.params.take ?? "10") : 10;

  return (
    <aside
      id="trace-panel"
      role="complementary"
      aria-label="Why Qloo"
      className="surface print-hide mt-8 p-6 xl:sticky xl:top-4 xl:mt-0 xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto"
      data-testid="trace-panel"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl">Why Qloo chose this</h2>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close Why Qloo panel" className="btn-text btn-text-muted">
          Close
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-500" data-testid="trace-policy">
        {qlooCalls} call{qlooCalls === 1 ? "" : "s"} to the Qloo Insights API · {session.qlooMode === "live" ? "live API" : "fixture replay"} ·{" "}
        {session.planner === "llm" ? "LLM-driven agent" : "deterministic agent"}
        {mixed ? ", with offline fallback steps" : ""} · youth window {session.youthWindow.start} to {session.youthWindow.end}
      </p>

      {card ? (
        <section className="mt-6 border-t border-paper-200 pt-4" aria-labelledby="trace-card-heading" data-testid="trace-card">
          <p id="trace-card-heading" className="label">
            This card
          </p>
          <p className="font-display mt-2 text-lg leading-[1.35]">
            Qloo was asked for <em>{DOMAIN_INFO[card.domain].plural}</em>
            {card.signals.seedNames.length > 0 ? ` with taste affinity to ${joinNames(card.signals.seedNames, 6)}` : ""}
            {card.signals.locationQuery ? (card.signals.params["filter.location.query"] ? ` in ${card.signals.locationQuery}` : `, tuned to ${card.signals.locationQuery}`) : ""}
            {card.signals.ageBucket ? `, for ${ageLabel(card.signals.ageBucket)}` : ""}. {card.title} came back {ordinal(card.signals.rank)} of {take}.
          </p>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-2">
            <span className="label">Affinity</span>
            <span className="font-display text-3xl" data-testid="trace-affinity">
              {card.signals.affinity !== null ? card.signals.affinity.toFixed(3) : "n/a"}
            </span>
            <div className="bar col-span-2" aria-hidden="true">
              <i style={{ width: `${Math.max(2, Math.min(100, Math.round((card.signals.affinity ?? 0) * 100)))}%` }} />
            </div>
          </div>
          <p className="mt-1.5 text-xs text-ink-500">
            Rank {card.signals.rank} of {take}
            {typeof card.signals.popularity === "number" ? ` · popularity ${card.signals.popularity.toFixed(2)}` : ""}
          </p>

          {card.signals.explainability ? (
            <div className="mt-6 border-t border-paper-200 pt-4">
              <p className="label">Pulled in by</p>
              <ul className="mt-3 grid gap-2.5">
                {Object.entries(card.signals.explainability)
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, score]) => (
                    <li key={id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
                      <span className="text-ink-900">{names.get(id) ?? "an unnamed entity"}</span>
                      <span className="text-ink-500">{score.toFixed(2)}</span>
                      <div className="bar bar-moss col-span-2" aria-hidden="true">
                        <i style={{ width: `${Math.max(2, Math.min(100, Math.round(score * 100)))}%` }} />
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-6 border-t border-paper-200 pt-4">
            <p className="label">The request</p>
            <dl className="mt-3 grid grid-cols-[minmax(0,9em)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
              {requestRows(card, names).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-xs font-semibold tracking-[0.06em] text-ink-500 uppercase">{k}</dt>
                  <dd className="text-sm break-words text-ink-900">{v}</dd>
                </div>
              ))}
            </dl>
            {card.signals.warnings.length > 0 ? (
              <p className="mt-3 text-xs text-ink-500">Dropped before sending, because the docs do not list them for this type: {card.signals.warnings.join("; ")}</p>
            ) : null}
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-ember-700">Raw request</summary>
              <pre className="raw">
                {`GET ${card.signals.path}\n` +
                  Object.entries(card.signals.params)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("\n")}
              </pre>
            </details>
          </div>
        </section>
      ) : null}

      <section className="mt-6 border-t border-paper-200 pt-4" aria-labelledby="trace-timeline-heading">
        <p id="trace-timeline-heading" className="label">
          How this session was built
        </p>
        <ol className="mt-3" data-testid="trace-timeline">
          {events.map((e, i) => (
            <li key={e.id} className="grid grid-cols-[2em_minmax(0,1fr)] gap-2 border-t border-paper-200 py-2.5 first:border-t-0">
              <span className="font-display text-md leading-[1.3] text-ember-700">{i + 1}</span>
              <div className="min-w-0">
                {e.kind === "narration" ? (
                  <p className="font-display text-sm leading-[1.4] text-ink-700 italic">{e.summary}</p>
                ) : (
                  <p className={`text-sm leading-[1.4] ${e.kind === "error" ? "text-ember-700" : "text-ink-900"}`}>{e.summary}</p>
                )}
                {e.qloo ? (
                  <p className="mt-0.5 text-xs text-ink-500">
                    {e.qloo.resultCount} result{e.qloo.resultCount === 1 ? "" : "s"} · {e.qloo.durationMs} ms · {e.qloo.path} · {e.qloo.source}
                    {e.qloo.warnings.length > 0 ? ` · ${e.qloo.warnings.length} dropped` : ""}
                  </p>
                ) : null}
                {e.policy && e.policy !== sessionPolicy ? (
                  <p className="mt-0.5 text-xs text-ink-500">{e.policy === "scripted" ? "Offline fallback step" : "Model step"}</p>
                ) : null}
                {e.kind === "tool_call" && e.args ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-ember-700">Arguments</summary>
                    <pre className="raw">{JSON.stringify(e.args, null, 2)}</pre>
                  </details>
                ) : null}
                {e.qloo ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-ember-700">Request</summary>
                    <pre className="raw">
                      {`GET ${e.qloo.path}\n` +
                        Object.entries(e.qloo.params)
                          .map(([k, v]) => `${k}=${v}`)
                          .join("\n")}
                    </pre>
                  </details>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
