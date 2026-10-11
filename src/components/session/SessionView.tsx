"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Footer } from "@/components/Footer";
import { Masthead } from "@/components/Masthead";
import { useIsClient, useReducedMotion } from "@/lib/client/hooks";
import { postNdjson } from "@/lib/client/ndjson";
import { dictionary } from "@/lib/i18n";
import { autoAdvanceDelay, nextCardIndex } from "@/lib/session/auto-advance";
import { loadSession, saveSession } from "@/lib/session/storage";
import { pronounsFor, type Reaction, type Session, type StreamEvent, type TraceEvent } from "@/lib/session/types";

import { DeckStrip } from "./DeckStrip";
import { Keepsake } from "./Keepsake";
import { MemoryCard } from "./MemoryCard";
import { PlanningView } from "./PlanningView";
import { RetuningBanner } from "./RetuningBanner";
import { TracePanel } from "./TracePanel";

type Loaded = { kind: "missing" } | { kind: "ready"; session: Session };

/** Sessions live in localStorage, so the view mounts only in the browser. */
export function SessionView({ id }: { id: string }) {
  const isClient = useIsClient();
  if (!isClient) {
    return (
      <main id="main" className="wrap wrap-wide py-16" aria-busy="true">
        <div className="sleeve-blank h-10 w-64" />
        <div className="sleeve-blank mt-8 h-[28rem]" />
      </main>
    );
  }
  return <SessionClient key={id} id={id} />;
}

function SessionClient({ id }: { id: string }) {
  const [state, setState] = useState<Loaded>(() => {
    const loaded = loadSession(id);
    return loaded ? { kind: "ready", session: loaded } : { kind: "missing" };
  });
  const [liveEvents, setLiveEvents] = useState<TraceEvent[]>([]);
  const [traceOpen, setTraceOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const advanceTimer = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();

  const session = state.kind === "ready" ? state.session : null;
  const language = session?.person.language;
  const t = dictionary(language);
  // Latest-session ref for event handlers; written in an effect, never during render.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const update = useCallback((fn: (s: Session) => Session) => {
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      const next = { ...fn(prev.session), updatedAt: new Date().toISOString() };
      saveSession(next);
      return { kind: "ready", session: next };
    });
  }, []);

  const needsPlan = !!session && session.cards.length === 0 && session.status === "planning";

  useEffect(() => {
    if (!needsPlan) return;
    const person = sessionRef.current?.person;
    if (!person) return;
    const strings = dictionary(person.language).session;
    const controller = new AbortController();
    setLiveEvents([]);
    (async () => {
      try {
        let planned = false;
        await postNdjson<StreamEvent>(
          "/api/plan",
          { person },
          (ev) => {
            if (ev.type === "trace") setLiveEvents((list) => [...list, ev.event]);
            else if (ev.type === "plan") {
              planned = true;
              const r = ev.result;
              update((s) => ({
                ...s,
                cards: r.cards,
                trace: r.trace,
                youthWindow: r.youthWindow,
                ageBucket: r.ageBucket,
                planner: r.planner,
                qlooMode: r.qlooMode,
                person: { ...s.person, favorites: r.favorites },
                status: "ready",
                currentIndex: 0,
                error: undefined,
                notice: r.notice,
                replayedAt: r.replayedAt,
              }));
              setLiveEvents([]);
            } else if (ev.type === "error") throw new Error(ev.message);
          },
          controller.signal,
        );
        if (!planned) throw new Error(strings.plannerStopped);
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : strings.planningFailed;
        update((s) => ({ ...s, status: "error", error: message }));
      }
    })();
    return () => controller.abort();
  }, [needsPlan, id, update]);

  const cancelAdvance = useCallback(() => {
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  }, []);
  useEffect(() => cancelAdvance, [cancelAdvance]);

  /** Any deliberate move cancels a pending automatic one. */
  const go = useCallback(
    (index: number) => {
      cancelAdvance();
      update((s) => ({ ...s, currentIndex: Math.max(0, Math.min(s.cards.length - 1, index)) }));
    },
    [update, cancelAdvance],
  );

  /**
   * After a reaction the deck moves on by itself once the re-tune has
   * finished: a short pause to read the notice, then the next card that has
   * not been reacted to. Pressing a key or a card in the meantime wins.
   */
  const scheduleAdvance = useCallback(
    (from: number) => {
      cancelAdvance();
      advanceTimer.current = window.setTimeout(() => {
        advanceTimer.current = null;
        const s = sessionRef.current;
        if (!s || s.currentIndex !== from) return;
        const next = nextCardIndex(s.cards, from);
        if (next !== null) go(next);
      }, autoAdvanceDelay(reducedMotion));
    },
    [cancelAdvance, go, reducedMotion],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const s = sessionRef.current;
      if (!s || s.cards.length === 0) return;
      if (e.key === "ArrowRight") go(s.currentIndex + 1);
      if (e.key === "ArrowLeft") go(s.currentIndex - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const react = useCallback(
    async (cardId: string, reaction: Reaction) => {
      const s = sessionRef.current;
      if (!s || s.status === "retuning") return;
      const index = s.cards.findIndex((c) => c.id === cardId);
      const card = s.cards[index];
      if (!card) return;
      const strings = dictionary(s.person.language).session;
      const pronouns = pronounsFor(s.person.pronoun);
      const cards = s.cards.map((c) => (c.id === cardId ? { ...c, reaction } : c));
      const hasUpcoming = cards.some((c, i) => i > index && !c.reaction);
      cancelAdvance();
      update((prev) => ({ ...prev, cards, status: hasUpcoming ? "retuning" : "ready" }));
      if (!hasUpcoming) {
        setNotice(reaction === "lit_up" ? strings.notedLitUp(pronouns) : strings.notedNothingAhead);
        return;
      }
      setLiveEvents([]);
      setNotice(null);
      try {
        let adapted = false;
        await postNdjson<StreamEvent>("/api/adapt", { person: s.person, cards, feedback: { cardId, reaction }, currentIndex: index }, (ev) => {
          if (ev.type === "trace") setLiveEvents((list) => [...list, ev.event]);
          else if (ev.type === "adapt") {
            adapted = true;
            const byReplaced = new Map(ev.result.replacements.map((r) => [r.replacedEntityId, r]));
            update((prev) => ({
              ...prev,
              cards: prev.cards.map((c) => byReplaced.get(c.entityId) ?? c),
              trace: [...prev.trace, ...ev.result.trace],
              status: "ready",
            }));
            setLiveEvents([]);
            const n = ev.result.replacements.length;
            const line = n === 0 ? strings.nothingNew : reaction === "lit_up" ? strings.leanToward(n, card.title) : strings.steerAway(n);
            setNotice(ev.result.notice ? `${line} ${ev.result.notice}` : line);
          } else if (ev.type === "error") throw new Error(ev.message);
        });
        if (!adapted) throw new Error(strings.agentStopped);
      } catch (error) {
        setLiveEvents([]);
        update((prev) => ({ ...prev, status: "ready" }));
        setNotice(strings.retuneFailed(error instanceof Error ? error.message : "unknown error"));
      }
      scheduleAdvance(index);
    },
    [update, cancelAdvance, scheduleAdvance],
  );

  if (state.kind === "missing") {
    return (
      <div className="wrap wrap-wide flex flex-1 flex-col">
        <Masthead
          actions={
            <Link href="/" className="btn-text btn-text-muted">
              {t.nav.newSession}
            </Link>
          }
        />
        <main id="main" className="flex-1 py-16 sm:py-24">
          <div className="mx-auto max-w-[36rem] text-center">
            <h1 className="balance text-3xl sm:text-4xl">{t.missing.title}</h1>
            <p className="lede mt-4">{t.missing.body}</p>
            <Link href="/" className="btn btn-primary mt-8">
              {t.missing.cta}
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const s = state.session;
  const current = s.cards[s.currentIndex];
  const litUp = s.cards.filter((c) => c.reaction === "lit_up");
  const reactedAll = s.cards.length > 0 && s.cards.every((c) => c.reaction);
  const retuning = s.status === "retuning";
  const pronouns = pronounsFor(s.person.pronoun);

  return (
    <div className="wrap wrap-wide flex flex-1 flex-col" lang={language} data-testid="session-root">
      <Masthead
        centre={
          <p className="label label-ink sm:truncate" data-testid="person-summary">
            {t.session.summary({
              name: s.person.name,
              hometown: s.person.hometown,
              start: s.youthWindow.start,
              end: s.youthWindow.end,
              favorites: s.person.favorites.map((f) => f.name),
            })}
          </p>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => setTraceOpen((o) => !o)}
              aria-expanded={traceOpen}
              aria-controls="trace-panel"
              data-testid="why-qloo-toggle"
              className="btn-text print-hide"
            >
              {t.nav.whyQloo}
            </button>
            <Link href="/" className="btn-text btn-text-muted print-hide">
              {t.nav.newSession}
            </Link>
          </>
        }
      />

      <div className={`flex-1 pt-6 ${traceOpen ? "xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start xl:gap-8" : ""}`}>
        <main id="main" className="min-w-0">
          <h1 className="sr-only">{t.session.heading(s.person.name)}</h1>
          {s.status === "error" ? (
            <div role="alert" className="surface p-6">
              <p className="notice font-semibold text-ember-700">{t.session.buildFailed}</p>
              <p className="mt-2 text-md text-ink-700">{s.error}</p>
              <button type="button" onClick={() => update((prev) => ({ ...prev, status: "planning", error: undefined }))} className="btn btn-outline mt-4">
                {t.session.tryAgain}
              </button>
            </div>
          ) : s.cards.length === 0 ? (
            <PlanningView person={s.person} youthWindow={s.youthWindow} events={liveEvents} />
          ) : (
            <>
              {s.notice ? (
                <p role="status" className="notice print-hide mb-4 text-ink-500" data-testid="session-notice">
                  {s.notice}
                </p>
              ) : null}
              <div className="print-hide mb-4 flex min-h-[2rem] items-baseline justify-between gap-4">
                {retuning ? (
                  <RetuningBanner events={liveEvents} label={t.session.retuning} />
                ) : notice ? (
                  <p role="status" className="notice" data-testid="notice">
                    {notice}
                  </p>
                ) : (
                  <span />
                )}
                {litUp.length > 0 ? <p className="label flex-none">{t.session.litUpCount(litUp.length)}</p> : null}
              </div>
              {current ? (
                <div className={reactedAll ? "print-hide" : ""}>
                  <MemoryCard
                    key={current.id}
                    card={current}
                    index={s.currentIndex}
                    total={s.cards.length}
                    onReact={(r) => react(current.id, r)}
                    onWhy={() => setTraceOpen(true)}
                    disabled={retuning}
                    language={s.person.language}
                    pronouns={pronouns}
                  />
                </div>
              ) : null}
              <div className="print-hide mt-6 grid grid-cols-2 items-center gap-4 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                <button type="button" onClick={() => go(s.currentIndex - 1)} disabled={s.currentIndex === 0} className="btn btn-quiet">
                  {t.session.previous}
                </button>
                <p className="hidden text-center text-sm text-ink-500 sm:block" aria-live="polite">
                  {t.session.tapHint}
                </p>
                <button type="button" onClick={() => go(s.currentIndex + 1)} disabled={s.currentIndex >= s.cards.length - 1} data-testid="next-card" className="btn btn-quiet">
                  {t.session.next}
                </button>
              </div>
              <div className="mt-6">
                <DeckStrip cards={s.cards} currentIndex={s.currentIndex} onSelect={go} retuning={retuning} language={s.person.language} />
              </div>
              {reactedAll ? <Keepsake session={s} /> : null}
            </>
          )}
        </main>
        <TracePanel open={traceOpen} onClose={() => setTraceOpen(false)} session={s} card={current} liveEvents={liveEvents} />
      </div>
      <Footer language={language} />
    </div>
  );
}
