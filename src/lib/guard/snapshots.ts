/**
 * Preset snapshots.
 *
 * Michiko and Frank are opened far more often than any custom person, and
 * their plans are deterministic in everything but the model's prose. So the
 * first live run of the day is kept in Redis for 24 hours, and later visitors
 * get it replayed: the same cards, the same Qloo provenance, and the trace
 * streamed again with a short gap between events so the planning view still
 * animates. The replay says so in the trace and in the Why Qloo panel.
 *
 * Nothing is written to the repository: the hackathon guide forbids Qloo
 * data in public repositories, and Redis is private to the deployment.
 */
import { withCleanNarration } from "@/lib/session/narration";
import { PRESETS, type Preset } from "@/lib/session/presets";
import type { Person, PlanResult, TraceEvent } from "@/lib/session/types";

import { GUARD_COPY, type Guard } from "./index";
import type { RedisLike } from "./redis";

/** Version 3: cards carry the favorite they were chosen near, and artists are seeded without the age bucket. Version 2: decks dealt by fixed rules with the model's prompts, and narration that is fit to show. */
export const SNAPSHOT_VERSION = 3;
export const SNAPSHOT_TTL_SECONDS = 24 * 60 * 60;
/** Gap between replayed trace events: the planning view still fills in, and a preset opens in about a second. */
export const REPLAY_SPACING_MS = 40;
/** A replay never takes longer than this, whatever the trace length. */
export const REPLAY_MAX_MS = 2_000;

export interface PresetSnapshot {
  version: typeof SNAPSHOT_VERSION;
  presetId: string;
  /** When the live run happened (ISO 8601, UTC). */
  recordedAt: string;
  result: PlanResult;
}

/**
 * Whether a plan is worth replaying all day: Qloo live and undegraded, and a
 * full deck. Who wrote the prompts does not matter: a replay whose prompts are
 * still templates gets the model's on its next run (see the plan route).
 */
export function isFullStrength(result: PlanResult, guard: Pick<Guard, "env" | "degraded" | "fallbacks">): boolean {
  if (guard.env.qlooMode !== "live" || guard.degraded.qloo) return false;
  return guard.fallbacks.budget === 0 && guard.fallbacks.error === 0 && result.cards.length >= 8;
}

export function snapshotKey(presetId: string, prefix = "reminisce:"): string {
  return `${prefix}preset:${presetId}:v${SNAPSHOT_VERSION}`;
}

const MODEL_ALLOWANCE_NOTES: ReadonlySet<string> = new Set([GUARD_COPY.llmSpent, GUARD_COPY.llmUnknown]);

/** The trace fit to keep for later visitors: clean narration, and no note about that day's model allowance. */
function keptTrace(trace: TraceEvent[]): TraceEvent[] {
  return withCleanNarration(trace).filter((e) => !(e.kind === "note" && MODEL_ALLOWANCE_NOTES.has(e.summary)));
}

function fold(text: string): string {
  return text.normalize("NFKD").toLowerCase().trim();
}

/** The preset this person is, if the request still matches it field for field (favorites by name). */
export function matchingPreset(person: Person): Preset | undefined {
  const preset = PRESETS.find((p) => p.id === person.presetId);
  if (!preset) return undefined;
  const p = preset.person;
  const same =
    fold(person.name) === fold(p.name) &&
    person.birthYear === p.birthYear &&
    fold(person.hometown) === fold(p.hometown) &&
    person.language === p.language &&
    person.favorites.length === p.favorites.length &&
    person.favorites.every((f, i) => fold(f.name) === fold(p.favorites[i]?.name ?? ""));
  return same ? preset : undefined;
}

function isSnapshot(value: unknown): value is PresetSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<PresetSnapshot>;
  return (
    s.version === SNAPSHOT_VERSION &&
    typeof s.presetId === "string" &&
    typeof s.recordedAt === "string" &&
    !!s.result &&
    Array.isArray(s.result.cards) &&
    Array.isArray(s.result.trace) &&
    s.result.cards.length > 0
  );
}

/** A snapshot for the preset that is less than a day old, or null. Any storage error reads as "none". */
export async function loadSnapshot(redis: RedisLike, presetId: string, now: Date, prefix?: string): Promise<PresetSnapshot | null> {
  try {
    const [raw] = await redis.pipeline([["GET", snapshotKey(presetId, prefix)]]);
    if (typeof raw !== "string") return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSnapshot(parsed) || parsed.presetId !== presetId) return null;
    const age = now.getTime() - Date.parse(parsed.recordedAt);
    if (!Number.isFinite(age) || age < 0 || age > SNAPSHOT_TTL_SECONDS * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function storeSnapshot(redis: RedisLike, presetId: string, result: PlanResult, now: Date, prefix?: string): Promise<PresetSnapshot> {
  const snapshot: PresetSnapshot = { version: SNAPSHOT_VERSION, presetId, recordedAt: now.toISOString(), result: { ...result, trace: keptTrace(result.trace) } };
  await redis.pipeline([["SET", snapshotKey(presetId, prefix), JSON.stringify(snapshot), "EX", SNAPSHOT_TTL_SECONDS]]);
  return snapshot;
}

/** "09:14 UTC on 5 November", for the trace and the panel. */
export function describeRecordedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an earlier time today";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const month = d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return `${hh}:${mm} UTC on ${d.getUTCDate()} ${month}`;
}

export function replayNote(snapshot: PresetSnapshot): string {
  return `Replayed from a live Qloo run at ${describeRecordedAt(snapshot.recordedAt)}. Nothing was fetched for this session; the cards and every call below are that run's.`;
}

let replayCounter = 0;

/**
 * Stream the stored trace through `emit` with a short gap between events and
 * return the stored plan, marked with when the live run happened.
 */
export async function replaySnapshot(
  snapshot: PresetSnapshot,
  emit: (event: TraceEvent) => void,
  opts: { spacingMs?: number; maxMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<PlanResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const events = keptTrace(snapshot.result.trace);
  const spacing = Math.min(opts.spacingMs ?? REPLAY_SPACING_MS, Math.floor((opts.maxMs ?? REPLAY_MAX_MS) / Math.max(1, events.length)));
  replayCounter += 1;
  const note: TraceEvent = { id: `replay${Date.now().toString(36)}${replayCounter}`, at: Date.now(), phase: "plan", kind: "note", summary: replayNote(snapshot) };
  emit(note);
  const trace: TraceEvent[] = [note];
  for (const event of events) {
    if (spacing > 0) await sleep(spacing);
    emit(event);
    trace.push(event);
  }
  return { ...snapshot.result, trace, replayedAt: snapshot.recordedAt };
}
