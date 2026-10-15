"use client";

import { useEffect, useRef } from "react";

import { joinNames } from "@/lib/agent/prompts";
import { describeRecordedAt } from "@/lib/guard/snapshots";
import { dictionary, type Dictionary } from "@/lib/i18n";
import { withCleanNarration } from "@/lib/session/narration";
import { sessionModeLabel } from "@/lib/session/provenance";
import type { Card, Session, TraceEvent } from "@/lib/session/types";
import { isAgeBucket } from "@/lib/session/youth-window";

interface Props {
  open: boolean;
  onClose: () => void;
  session: Session;
  card?: Card;
  /** Events from the operation in flight (not yet merged into session.trace). */
  liveEvents: TraceEvent[];
}

function tagWords(ids: string): string {
  return ids
    .split(",")
    .map((id) => id.trim().split(":").at(-1)?.replace(/_/g, " ") ?? id)
    .join(", ");
}

/** The human-labelled request table: one row per parameter that was sent. */
function requestRows(card: Card, names: Map<string, string>, t: Dictionary, replayedAt: string | undefined): [string, string][] {
  const p = card.signals.params;
  const r = t.trace.rows;
  const rows: [string, string][] = [];
  rows.push([r.type, t.entityType[p["filter.type"] ?? ""] ?? p["filter.type"] ?? ""]);
  const seeds = p["signal.interests.entities"];
  if (seeds) rows.push([r.interests, seeds.split(",").map((id) => names.get(id) ?? t.trace.unnamed).join(", ")]);
  if (p["signal.location.query"]) rows.push([r.location, r.tunedTo(p["signal.location.query"])]);
  if (p["filter.location.query"]) rows.push([r.within, p["filter.location.query"]]);
  const age = p["signal.demographics.age"];
  if (age) rows.push([r.age, isAgeBucket(age) ? t.age[age] : age]);
  if (p["filter.release_year.min"] || p["filter.release_year.max"]) rows.push([r.years, r.yearsValue(p["filter.release_year.min"] ?? "", p["filter.release_year.max"] ?? "")]);
  if (p["filter.release_country"]) rows.push([r.releasedIn, p["filter.release_country"]]);
  if (p["filter.tags"]) rows.push([r.tagged, tagWords(p["filter.tags"])]);
  if (p["filter.geocode.country_code"]) rows.push([r.country, p["filter.geocode.country_code"]]);
  const excluded = p["filter.exclude.entities"];
  if (excluded) rows.push([r.excluding, r.excludingValue(excluded.split(",").length)]);
  rows.push([r.explain, r.explainValue(p["feature.explainability"] === "true", p.take ?? "10")]);
  rows.push([r.source, replayedAt && card.signals.source === "live" ? t.provenance.sourceReplayedRun(describeRecordedAt(replayedAt)) : t.provenance.source[card.signals.source]]);
  return rows;
}

/** The provenance note: what Qloo was asked, what came back, and how the session was built. */
export function TracePanel({ open, onClose, session, card, liveEvents }: Props) {
  const t = dictionary(session.person.language);
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
  // Narration that is not a plain sentence (a model's tool-call markup, JSON) is never shown.
  const events = withCleanNarration([...session.trace, ...liveEvents]);
  const qlooCalls = events.filter((e) => e.qloo).length;
  const take = card ? Number(card.signals.params.take ?? "10") : 10;
  const sources = [...session.cards.map((c) => c.signals.source), ...events.flatMap((e) => (e.qloo ? [e.qloo.source] : []))];
  const modeLabel = sessionModeLabel(session.qlooMode, sources, t.provenance);

  return (
    <aside
      id="trace-panel"
      role="complementary"
      aria-label={t.trace.ariaLabel}
      className="surface print-hide mt-8 p-6 xl:sticky xl:top-4 xl:mt-0 xl:max-h-[calc(100dvh-2rem)] xl:overflow-y-auto"
      data-testid="trace-panel"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl">{t.trace.title}</h2>
        <button ref={closeRef} type="button" onClick={onClose} aria-label={t.trace.closeAria} className="btn-text btn-text-muted">
          {t.trace.close}
        </button>
      </div>
      <p className="mt-1 text-sm text-ink-500" data-testid="trace-policy">
        {t.trace.calls(qlooCalls)} · <span data-testid="trace-mode">{modeLabel}</span> · {session.planner === "llm" ? t.trace.llmAgent : t.trace.scriptedAgent} · {t.trace.youthWindow(session.youthWindow.start, session.youthWindow.end)}
      </p>
      {session.replayedAt ? (
        <p className="mt-1 text-sm text-ink-500" data-testid="trace-replayed">
          {t.provenance.replayedRun(describeRecordedAt(session.replayedAt))}
        </p>
      ) : null}

      {card ? (
        <section className="mt-6 border-t border-paper-200 pt-4" aria-labelledby="trace-card-heading" data-testid="trace-card">
          <p id="trace-card-heading" className="label">
            {t.trace.thisCard}
          </p>
          <p className="font-display mt-2 text-lg leading-[1.35]">
            {t.trace.asked({
              plural: t.domain[card.domain].plural,
              seeds: card.signals.seedNames.length > 0 ? joinNames(card.signals.seedNames, 6, session.person.language) : undefined,
              within: card.signals.locationQuery && card.signals.params["filter.location.query"] ? card.signals.locationQuery : undefined,
              tunedTo: card.signals.locationQuery && !card.signals.params["filter.location.query"] ? card.signals.locationQuery : undefined,
              age: card.signals.ageBucket ? t.age[card.signals.ageBucket] : undefined,
            })}{" "}
            {t.trace.cameBack(card.title, card.signals.rank, take)}
          </p>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-2">
            <span className="label">{t.trace.affinity}</span>
            <span className="font-display text-3xl" data-testid="trace-affinity">
              {card.signals.affinity !== null ? card.signals.affinity.toFixed(3) : t.trace.notAvailable}
            </span>
            <div className="bar col-span-2" aria-hidden="true">
              <i style={{ width: `${Math.max(2, Math.min(100, Math.round((card.signals.affinity ?? 0) * 100)))}%` }} />
            </div>
          </div>
          <p className="mt-1.5 text-xs text-ink-500">
            {t.trace.rank(card.signals.rank, take)}
            {typeof card.signals.popularity === "number" ? ` · ${t.trace.popularity(card.signals.popularity.toFixed(2))}` : ""}
          </p>
          {card.promptSource === "template" ? (
            <p className="mt-3 text-sm text-ink-700" data-testid="trace-prompt-source">
              {t.trace.templatePrompt}
            </p>
          ) : null}

          {card.signals.explainability ? (
            <div className="mt-6 border-t border-paper-200 pt-4">
              <p className="label">{t.trace.pulledInBy}</p>
              <ul className="mt-3 grid gap-2.5">
                {Object.entries(card.signals.explainability)
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, score]) => (
                    <li key={id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
                      <span className="text-ink-900">{names.get(id) ?? t.trace.unnamed}</span>
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
            <p className="label">{t.trace.request}</p>
            <dl className="mt-3 grid grid-cols-[minmax(0,9em)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
              {requestRows(card, names, t, session.replayedAt).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-xs font-semibold tracking-[0.06em] text-ink-500 uppercase">{k}</dt>
                  <dd className="text-sm break-words text-ink-900">{v}</dd>
                </div>
              ))}
            </dl>
            {card.signals.warnings.length > 0 ? <p className="mt-3 text-xs text-ink-500">{t.trace.dropped(card.signals.warnings)}</p> : null}
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-ember-700">{t.trace.rawRequest}</summary>
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
          {t.trace.timeline}
        </p>
        {/* The agent's own log lines are its trace and stay as written. */}
        <ol className="mt-3" data-testid="trace-timeline">
          {events.map((e, i) => (
            <li key={e.id} className="grid grid-cols-[2em_minmax(0,1fr)] gap-2 border-t border-paper-200 py-2.5 first:border-t-0">
              <span className="font-display text-md leading-[1.3] text-ember-700">{i + 1}</span>
              <div className="min-w-0">
                {e.kind === "narration" ? (
                  <p className="font-display text-sm leading-[1.4] text-ink-700 italic" lang="en">
                    {e.summary}
                  </p>
                ) : (
                  <p className={`text-sm leading-[1.4] ${e.kind === "error" ? "text-ember-700" : "text-ink-900"}`} lang="en">
                    {e.summary}
                  </p>
                )}
                {e.qloo || e.policy ? (
                  <p className="mt-0.5 text-xs text-ink-500">
                    {e.policy ? (
                      <span className="label" data-testid="trace-step-policy">
                        {e.policy === "llm" ? t.trace.policyModel : t.trace.policyScripted}
                      </span>
                    ) : null}
                    {e.policy && e.qloo ? " · " : ""}
                    {e.qloo ? `${t.trace.results(e.qloo.resultCount)} · ${t.trace.ms(e.qloo.durationMs)} · ${e.qloo.path} · ${t.provenance.sourceWord[e.qloo.source]}${e.qloo.cached ? `, ${t.provenance.cached}` : ""}` : ""}
                    {e.qloo && e.qloo.warnings.length > 0 ? ` · ${t.trace.droppedCount(e.qloo.warnings.length)}` : ""}
                  </p>
                ) : null}
                {e.kind === "tool_call" && e.args ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-ember-700">{t.trace.arguments}</summary>
                    <pre className="raw">{JSON.stringify(e.args, null, 2)}</pre>
                  </details>
                ) : null}
                {e.qloo ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-ember-700">{t.trace.requestDetails}</summary>
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
