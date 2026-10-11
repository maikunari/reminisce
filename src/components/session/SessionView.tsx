"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Footer } from "@/components/Footer";
import { Masthead } from "@/components/Masthead";
import { useIsClient } from "@/lib/client/hooks";
import { postNdjson } from "@/lib/client/ndjson";
import { loadSession, saveSession } from "@/lib/session/storage";
import { pronounsFor, type Reaction, type Session, type StreamEvent, type TraceEvent } from "@/lib/session/types";

import { DeckStrip } from "./DeckStrip";
import { Keepsake } from "./Keepsake";
import { MemoryCard } from "./MemoryCard";
import { PlanningView } from "./PlanningView";
import { RetuningBanner } from "./RetuningBanner";
import { TracePanel } from "./TracePanel";

type Loaded = { kind: "missing" } | { kind: "ready"; session: Session };

const NUMBER_WORD = ["One", "Two", "Three", "Four", "Five", "Six"];
function numberWord(n: number): string {
  return NUMBER_WORD[n - 1] ?? String(n);
}

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

  const session = state.kind === "ready" ? state.session : null;
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
              }));
              setLiveEvents([]);
            } else if (ev.type === "error") throw new Error(ev.message);
          },
          controller.signal,
        );
        if (!planned) throw new Error("The planner stopped before finishing. Please try again.");
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Planning failed";
        update((s) => ({ ...s, status: "error", error: message }));
      }
    })();
    return () => controller.abort();
  }, [needsPlan, id, update]);

  const go = useCallback(
    (index: number) => {
      update((s) => ({ ...s, currentIndex: Math.max(0, Math.min(s.cards.length - 1, index)) }));
    },
    [update],
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
      const pronouns = pronounsFor(s.person.pronoun);
      const cards = s.cards.map((c) => (c.id === cardId ? { ...c, reaction } : c));
      const hasUpcoming = cards.some((c, i) => i > index && !c.reaction);
      update((prev) => ({ ...prev, cards, status: hasUpcoming ? "retuning" : "ready" }));
      if (!hasUpcoming) {
        setNotice(reaction === "lit_up" ? `Noted. That one lit ${pronouns.object} up.` : "Noted. Nothing left ahead to change.");
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
            setNotice(
              n === 0
                ? "Nothing new came back for this one. The deck stays as it is."
                : reaction === "lit_up"
                  ? `${numberWord(n)} of the next cards now lean${n === 1 ? "s" : ""} toward ${card.title}.`
                  : `${numberWord(n)} of the next cards now steer${n === 1 ? "s" : ""} away from that.`,
            );
          } else if (ev.type === "error") throw new Error(ev.message);
        });
        if (!adapted) throw new Error("the agent stopped before finishing");
      } catch (error) {
        setLiveEvents([]);
        update((prev) => ({ ...prev, status: "ready" }));
        setNotice(`Couldn't re-tune: ${error instanceof Error ? error.message : "unknown error"}.`);
      }
    },
    [update],
  );

  if (state.kind === "missing") {
    return (
      <div className="wrap wrap-wide flex flex-1 flex-col">
        <Masthead
          actions={
            <Link href="/" className="btn-text btn-text-muted">
              New session
            </Link>
          }
        />
        <main id="main" className="flex-1 py-16 sm:py-24">
          <div className="mx-auto max-w-[36rem] text-center">
            <h1 className="balance text-3xl sm:text-4xl">This session isn&apos;t on this device</h1>
            <p className="lede mt-4">Sessions live in the browser that created them. Nothing is stored on a server.</p>
            <Link href="/" className="btn btn-primary mt-8">
              Build a new session
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
    <div className="wrap wrap-wide flex flex-1 flex-col">
      <Masthead
        centre={
          <p className="label label-ink sm:truncate" data-testid="person-summary">
            {s.person.name} · {s.person.hometown} · {s.youthWindow.start} to {s.youthWindow.end}
            {s.person.favorites.length > 0 ? ` · loved ${s.person.favorites.map((f) => f.name).join(", ")}` : ""}
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
              Why Qloo
            </button>
            <Link href="/" className="btn-text btn-text-muted print-hide">
              New session
            </Link>
          </>
        }
      />

      <div className={`flex-1 pt-6 ${traceOpen ? "xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start xl:gap-8" : ""}`}>
        <main id="main" className="min-w-0">
          <h1 className="sr-only">{s.person.name}&apos;s session</h1>
          {s.status === "error" ? (
            <div role="alert" className="surface p-6">
              <p className="notice font-semibold text-ember-700">Couldn&apos;t build the session.</p>
              <p className="mt-2 text-md text-ink-700">{s.error}</p>
              <button type="button" onClick={() => update((prev) => ({ ...prev, status: "planning", error: undefined }))} className="btn btn-outline mt-4">
                Try again
              </button>
            </div>
          ) : s.cards.length === 0 ? (
            <PlanningView person={s.person} youthWindow={s.youthWindow} events={liveEvents} />
          ) : (
            <>
              <div className="print-hide mb-4 flex min-h-[2rem] items-baseline justify-between gap-4">
                {retuning ? (
                  <RetuningBanner events={liveEvents} label="Re-tuning the next cards with Qloo…" />
                ) : notice ? (
                  <p role="status" className="notice" data-testid="notice">
                    {notice}
                  </p>
                ) : (
                  <span />
                )}
                {litUp.length > 0 ? <p className="label flex-none">{litUp.length} lit up so far</p> : null}
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
                  ← Previous
                </button>
                <p className="hidden text-center text-sm text-ink-500 sm:block" aria-live="polite">
                  Tap how they respond. The rest of the deck follows their lead.
                </p>
                <button type="button" onClick={() => go(s.currentIndex + 1)} disabled={s.currentIndex >= s.cards.length - 1} data-testid="next-card" className="btn btn-quiet">
                  Next →
                </button>
              </div>
              <div className="mt-6">
                <DeckStrip cards={s.cards} currentIndex={s.currentIndex} onSelect={go} retuning={retuning} />
              </div>
              {reactedAll ? <Keepsake session={s} /> : null}
            </>
          )}
        </main>
        <TracePanel open={traceOpen} onClose={() => setTraceOpen(false)} session={s} card={current} liveEvents={liveEvents} />
      </div>
      <Footer />
    </div>
  );
}
