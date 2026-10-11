"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Logo";
import { useIsClient } from "@/lib/client/hooks";
import { postNdjson } from "@/lib/client/ndjson";
import { loadSession, saveSession } from "@/lib/session/storage";
import type { Reaction, Session, StreamEvent, TraceEvent } from "@/lib/session/types";

import { DeckStrip } from "./DeckStrip";
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
      <main id="main" className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8" aria-busy="true">
        <div className="skeleton h-10 w-64 rounded-xl" />
        <div className="skeleton mt-8 h-[28rem] rounded-card" />
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
        await postNdjson<StreamEvent>(
          "/api/plan",
          { person },
          (ev) => {
            if (ev.type === "trace") setLiveEvents((list) => [...list, ev.event]);
            else if (ev.type === "plan") {
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
      if (index < 0) return;
      const cards = s.cards.map((c) => (c.id === cardId ? { ...c, reaction } : c));
      const hasUpcoming = cards.some((c, i) => i > index && !c.reaction);
      update((prev) => ({ ...prev, cards, status: hasUpcoming ? "retuning" : "ready" }));
      if (!hasUpcoming) {
        setNotice(reaction === "lit_up" ? "Noted. That one lit them up." : "Noted. Nothing left to re-tune.");
        return;
      }
      setLiveEvents([]);
      setNotice(null);
      try {
        await postNdjson<StreamEvent>("/api/adapt", { person: s.person, cards, feedback: { cardId, reaction }, currentIndex: index }, (ev) => {
          if (ev.type === "trace") setLiveEvents((list) => [...list, ev.event]);
          else if (ev.type === "adapt") {
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
                ? "Qloo had nothing new for this one; the deck stays as it is."
                : reaction === "lit_up"
                  ? `Re-tuned ${n} upcoming card${n === 1 ? "" : "s"} toward what lit them up.`
                  : `Steered ${n} upcoming card${n === 1 ? "" : "s"} away from that.`,
            );
          } else if (ev.type === "error") throw new Error(ev.message);
        });
      } catch (error) {
        update((prev) => ({ ...prev, status: "ready" }));
        setNotice(`Couldn't re-tune: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    },
    [update],
  );

  if (state.kind === "missing") {
    return (
      <main id="main" className="mx-auto w-full max-w-3xl px-5 py-20 text-center sm:px-8">
        <h1 className="font-display text-4xl font-semibold text-ink-900">This session isn&apos;t on this device</h1>
        <p className="mt-4 text-xl text-ink-700">Sessions live in the browser that created them. Nothing is stored on a server.</p>
        <Link href="/" className="mt-8 inline-flex min-h-14 items-center rounded-2xl bg-ember-600 px-6 text-xl font-bold text-white">
          Build a new session
        </Link>
      </main>
    );
  }

  const s = state.session;
  const current = s.cards[s.currentIndex];
  const litUp = s.cards.filter((c) => c.reaction === "lit_up");
  const reactedAll = s.cards.length > 0 && s.cards.every((c) => c.reaction);
  const retuning = s.status === "retuning";

  return (
    <>
      <header className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-5 pt-5 sm:px-8">
        <Logo compact />
        <p className="order-last w-full text-lg text-ink-700 sm:order-none sm:w-auto sm:flex-1 sm:px-4" data-testid="person-summary">
          <strong className="text-ink-900">{s.person.name}</strong> · born {s.person.birthYear} · {s.person.hometown}
          {s.person.favorites.length > 0 ? <> · loved {s.person.favorites.map((f) => f.name).join(", ")}</> : null}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <span className={`hidden rounded-full px-3 py-1.5 text-sm font-bold sm:inline ${s.qlooMode === "live" ? "bg-sage-100 text-sage-700" : "bg-gold-100 text-gold-700"}`}>
            Qloo {s.qlooMode === "live" ? "live" : "fixtures"}
          </span>
          <button
            type="button"
            onClick={() => setTraceOpen((o) => !o)}
            aria-expanded={traceOpen}
            aria-controls="trace-panel"
            data-testid="why-qloo-toggle"
            className="inline-flex min-h-12 items-center gap-2 rounded-full border-2 border-ink-900 bg-white px-4 text-base font-bold text-ink-900 hover:bg-ink-900 hover:text-white"
          >
            <span aria-hidden="true">✦</span> Why Qloo
          </button>
          <Link href="/" className="hidden min-h-12 items-center rounded-full px-3 text-base font-bold text-ink-700 underline decoration-2 underline-offset-4 sm:inline-flex">
            New session
          </Link>
        </div>
      </header>

      <div className={`mx-auto w-full max-w-7xl px-5 pt-6 sm:px-8 ${traceOpen ? "xl:grid xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start xl:gap-6" : ""}`}>
        <main id="main" className="min-w-0">
          <h1 className="sr-only">{s.person.name}&apos;s session</h1>
          {s.status === "error" ? (
            <div role="alert" className="rounded-card bg-ember-100 p-6 text-lg text-ember-700">
              <p className="font-bold">Couldn&apos;t build the session.</p>
              <p className="mt-1">{s.error}</p>
              <button
                type="button"
                onClick={() => update((prev) => ({ ...prev, status: "planning", error: undefined }))}
                className="mt-4 inline-flex min-h-12 items-center rounded-2xl bg-ember-600 px-5 font-bold text-white"
              >
                Try again
              </button>
            </div>
          ) : s.cards.length === 0 ? (
            <PlanningView person={s.person} youthWindow={s.youthWindow} events={liveEvents} />
          ) : (
            <>
              <div className="mb-5 space-y-3">
                {retuning ? <RetuningBanner events={liveEvents} label={`Re-tuning upcoming cards with Qloo…`} /> : null}
                {notice && !retuning ? (
                  <p role="status" className="rounded-2xl bg-sage-100 px-5 py-3 text-lg font-bold text-sage-700" data-testid="notice">
                    {notice}
                  </p>
                ) : null}
              </div>
              {current ? (
                <MemoryCard
                  key={current.id}
                  card={current}
                  index={s.currentIndex}
                  total={s.cards.length}
                  onReact={(r) => react(current.id, r)}
                  onWhy={() => setTraceOpen(true)}
                  disabled={retuning}
                />
              ) : null}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => go(s.currentIndex - 1)}
                  disabled={s.currentIndex === 0}
                  className="inline-flex min-h-14 items-center gap-2 rounded-2xl border-2 border-cream-300 bg-white px-5 text-lg font-bold text-ink-900 hover:border-ink-900 disabled:opacity-40"
                >
                  ← Previous
                </button>
                <p className="order-last w-full text-center text-base text-ink-500 sm:order-none sm:w-auto" aria-live="polite">
                  {litUp.length > 0 ? `${litUp.length} lit up so far` : "Tap how they respond; upcoming cards re-tune."}
                </p>
                <button
                  type="button"
                  onClick={() => go(s.currentIndex + 1)}
                  disabled={s.currentIndex >= s.cards.length - 1}
                  data-testid="next-card"
                  className="inline-flex min-h-14 items-center gap-2 rounded-2xl bg-ink-900 px-5 text-lg font-bold text-white hover:bg-ember-700 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
              <div className="mt-8">
                <DeckStrip cards={s.cards} currentIndex={s.currentIndex} onSelect={go} retuning={retuning} />
              </div>
              {reactedAll ? (
                <section className="mt-8 rounded-card bg-white p-6 shadow-card ring-1 ring-cream-300" aria-labelledby="done-heading">
                  <h2 id="done-heading" className="font-display text-3xl font-semibold text-ink-900">
                    That&apos;s the session.
                  </h2>
                  <p className="mt-2 text-lg text-ink-700">
                    {litUp.length > 0 ? `${litUp.length} thing${litUp.length === 1 ? "" : "s"} lit ${s.person.name} up: ${litUp.map((c) => c.title).join(", ")}.` : "Nothing landed this time; that happens. Try again another day."}
                  </p>
                  <Link href="/" className="mt-4 inline-flex min-h-12 items-center rounded-2xl bg-ember-600 px-5 text-lg font-bold text-white">
                    Build another session
                  </Link>
                </section>
              ) : null}
            </>
          )}
        </main>
        <TracePanel open={traceOpen} onClose={() => setTraceOpen(false)} session={s} card={current} liveEvents={liveEvents} />
      </div>
      <Footer />
    </>
  );
}
