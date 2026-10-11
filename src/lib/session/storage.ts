/**
 * Client-side session persistence. Sessions live only in the browser's
 * localStorage; nothing personal is stored on the server.
 */
import type { Person, Session } from "./types";

const INDEX_KEY = "reminisce:sessions";
const SESSION_PREFIX = "reminisce:session:";
const MAX_SESSIONS = 20;

export interface SessionSummary {
  id: string;
  name: string;
  createdAt: string;
  cardCount: number;
}

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
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(SESSION_PREFIX + session.id, JSON.stringify(session));
    const index = listSessions().filter((s) => s.id !== session.id);
    index.unshift({
      id: session.id,
      name: session.person.name,
      createdAt: session.createdAt,
      cardCount: session.cards.length,
    });
    for (const stale of index.slice(MAX_SESSIONS)) store.removeItem(SESSION_PREFIX + stale.id);
    store.setItem(INDEX_KEY, JSON.stringify(index.slice(0, MAX_SESSIONS)));
  } catch {
    // Quota or privacy mode: the session still works in memory for this page.
  }
}

export function deleteSession(id: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(SESSION_PREFIX + id);
    store.setItem(INDEX_KEY, JSON.stringify(listSessions().filter((s) => s.id !== id)));
  } catch {
    // ignore
  }
}

export function listSessions(): SessionSummary[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(INDEX_KEY);
    const parsed = raw ? (JSON.parse(raw) as SessionSummary[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
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
