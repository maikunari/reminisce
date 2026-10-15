import type { QlooAgeBucket, QlooEntityType } from "@/lib/qloo/types";

export type Language = "en" | "ja" | "es";

export const LANGUAGES: { code: Language; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
];

/** A favorite the caregiver entered. Resolved to a Qloo entity when possible. */
export interface Favorite {
  name: string;
  entityId?: string;
  /** Qloo subtype, e.g. urn:entity:artist */
  type?: string;
  imageUrl?: string;
}

/** How to refer to the person in caregiver-facing copy. Defaults to "they". */
export type Pronoun = "she" | "he" | "they";

export interface Pronouns {
  subject: string;
  object: string;
  possessive: string;
}

export function pronounsFor(pronoun: Pronoun | undefined): Pronouns {
  switch (pronoun) {
    case "she":
      return { subject: "she", object: "her", possessive: "her" };
    case "he":
      return { subject: "he", object: "him", possessive: "his" };
    default:
      return { subject: "they", object: "them", possessive: "their" };
  }
}

export interface Person {
  name: string;
  birthYear: number;
  hometown: string;
  favorites: Favorite[];
  language: Language;
  pronoun?: Pronoun;
  presetId?: string;
}

export const DOMAINS = ["music", "film", "tv", "dining", "place", "destination"] as const;
export type Domain = (typeof DOMAINS)[number];

export interface DomainInfo {
  label: string;
  plural: string;
  qlooType: QlooEntityType;
  /** Short verb phrase used in the trace and "why" lines. */
  verb: string;
}

export const DOMAIN_INFO: Record<Domain, DomainInfo> = {
  music: { label: "Music", plural: "artists", qlooType: "urn:entity:artist", verb: "listened to" },
  film: { label: "Film", plural: "films", qlooType: "urn:entity:movie", verb: "watched" },
  tv: { label: "Television", plural: "shows", qlooType: "urn:entity:tv_show", verb: "watched" },
  dining: { label: "Food", plural: "places to eat", qlooType: "urn:entity:place", verb: "ate at" },
  place: { label: "Places", plural: "places", qlooType: "urn:entity:place", verb: "visited" },
  destination: { label: "Trips", plural: "destinations", qlooType: "urn:entity:destination", verb: "travelled to" },
};

export type Reaction = "lit_up" | "not_this";

export type QlooSource = "live" | "recorded" | "synthetic";

/** Everything needed to show "why Qloo picked this" for one card. */
export interface CardSignals {
  qlooType: QlooEntityType;
  path: "/v2/insights";
  /** Exact query parameters that were sent. */
  params: Record<string, string>;
  affinity: number | null;
  popularity?: number;
  source: QlooSource;
  /** Input entity id -> contribution, from feature.explainability when present. */
  explainability?: Record<string, number>;
  /** Names of the seed entities used in signal.interests.entities. */
  seedNames: string[];
  locationQuery?: string;
  ageBucket?: QlooAgeBucket;
  yearRange?: [number, number];
  /** 1-based rank in the Qloo result list. */
  rank: number;
  warnings: string[];
}

export interface Card {
  id: string;
  entityId: string;
  domain: Domain;
  title: string;
  subtitle?: string;
  year?: number;
  /** Artists: the year they started performing (Qloo's start_year), when known. */
  startYear?: number;
  imageUrl?: string;
  description?: string;
  tags: string[];
  /** One line: which Qloo signal chose this card. */
  why: string;
  /** Gentle conversation prompt for the caregiver to read aloud. */
  prompt: string;
  /** Who wrote the prompt: the LLM, or the offline template set. */
  promptSource: "llm" | "template";
  signals: CardSignals;
  reaction?: Reaction;
  addedBy: "plan" | "adapt";
  /** When added by adaptation: the entity id of the card it replaced. */
  replacedEntityId?: string;
}

export interface TraceQloo {
  path: string;
  params: Record<string, string>;
  source: QlooSource;
  status: number;
  durationMs: number;
  resultCount: number;
  warnings: string[];
  /** True when a live response was served from the response cache rather than the API. */
  cached?: boolean;
}

export interface TraceEvent {
  id: string;
  at: number;
  phase: "plan" | "adapt";
  kind: "narration" | "tool_call" | "tool_result" | "note" | "error";
  /** Which policy produced this step; absent for steps outside the loop. */
  policy?: "llm" | "scripted";
  tool?: string;
  args?: Record<string, unknown>;
  summary: string;
  qloo?: TraceQloo;
  /** For Insights calls: the session domain the call is filling. */
  domain?: Domain;
  /** For Insights results: the first few entities, so the planning view can fill its sleeves. */
  preview?: TracePreviewItem[];
}

export interface TracePreviewItem {
  name: string;
  imageUrl?: string;
  year?: number;
}

export interface YouthWindow {
  start: number;
  end: number;
  ageFrom: number;
  ageTo: number;
}

export type SessionStatus = "planning" | "ready" | "retuning" | "error";

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  person: Person;
  youthWindow: YouthWindow;
  ageBucket: QlooAgeBucket;
  cards: Card[];
  trace: TraceEvent[];
  status: SessionStatus;
  /** Which policy drove the agent loop. */
  planner: "llm" | "deterministic";
  qlooMode: "live" | "fixture";
  currentIndex: number;
  error?: string;
  /** `empty` when Qloo had too little for this person to make a deck; otherwise the build failed. */
  errorCode?: "empty" | "failed";
  /** Server-written line for the session header when the session was built with less than full Qloo access. */
  notice?: string;
  /** When the plan was replayed from an earlier live run of a preset: that run's time (ISO 8601). */
  replayedAt?: string;
}

/** The subset of Session the server computes; the client owns id/index/status. */
export interface PlanResult {
  youthWindow: YouthWindow;
  ageBucket: QlooAgeBucket;
  cards: Card[];
  trace: TraceEvent[];
  planner: "llm" | "deterministic";
  qlooMode: "live" | "fixture";
  /** The person's favorites with Qloo entity ids filled in where resolved. */
  favorites: Favorite[];
  /** One caregiver-facing line when the session was built with less than full Qloo access. */
  notice?: string;
  /** Set when the plan is an earlier live run replayed: that run's time (ISO 8601). */
  replayedAt?: string;
}

export interface AdaptResult {
  /** Cards to insert, each naming the card it replaces. */
  replacements: Card[];
  trace: TraceEvent[];
  planner: "llm" | "deterministic";
  /** One caregiver-facing line when the replacements came from the offline catalog. */
  notice?: string;
}

/** Events streamed from /api/plan and /api/adapt as NDJSON. */
export type StreamEvent =
  | { type: "trace"; event: TraceEvent }
  | { type: "plan"; result: PlanResult }
  | { type: "adapt"; result: AdaptResult }
  /** After a plan or adapt result: the model's prompts for those cards, to put in place of the templates. */
  | { type: "prompts"; prompts: { cardId: string; prompt: string }[]; trace: TraceEvent[] }
  /** `empty`: Qloo had too little for these inputs to build a deck; anything else is a failure. */
  | { type: "error"; message: string; code?: "empty" | "failed" };
