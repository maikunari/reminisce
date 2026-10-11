/**
 * Client-side session persistence. Sessions live only in the browser's
 * localStorage; nothing personal is stored on the server.
 */
import type { Person, Session } from "./types";

const SESSION_PREFIX = "reminisce:session:";

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function newSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().slice(0, 8);
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2, 10);
}

export function loadSession(id: string): Session | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(SESSION_PREFIX + id);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    return session.status === "retuning" ? { ...session, status: "ready" } : session;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  const store = storage();
  if (!store) return;
  try {
    // A re-tune lives only as long as its request, so it is never stored.
    const durable = session.status === "retuning" ? { ...session, status: "ready" } : session;
    store.setItem(SESSION_PREFIX + session.id, JSON.stringify(durable));
  } catch {
    // Quota or privacy mode: the session still works in memory for this page.
  }
}

/** Create and persist an empty session shell for a person; planning fills it. */
export function createSessionShell(person: Person, now: Date = new Date()): Session {
  const session: Session = {
    id: newSessionId(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    person,
    youthWindow: { start: person.birthYear + 15, end: person.birthYear + 30, ageFrom: 15, ageTo: 30 },
    ageBucket: "55_and_older",
    cards: [],
    trace: [],
    status: "planning",
    planner: "deterministic",
    qlooMode: "fixture",
    currentIndex: 0,
  };
  saveSession(session);
  return session;
}
