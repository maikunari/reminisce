import type { QlooAgeBucket } from "@/lib/qloo/types";
import type { ProvenanceStrings } from "@/lib/session/provenance";
import type { Domain, Language, Pronouns } from "@/lib/session/types";

/**
 * Every string the session UI shows, typed so a language cannot ship with a
 * key missing. Strings that need a value are functions; nothing is
 * interpolated by key at runtime. Agent log lines and raw Qloo parameters are
 * not translated: they are the trace, not the interface.
 */
export interface Dictionary {
  /** BCP 47 tag for dates and numbers. */
  locale: string;
  nav: {
    newSession: string;
    whyQloo: string;
    makeAnother: string;
    skipToContent: string;
  };
  missing: {
    title: string;
    body: string;
    cta: string;
  };
  session: {
    heading: (name: string) => string;
    summary: (p: { name: string; hometown: string; start: number; end: number; favorites: string[] }) => string;
    buildFailed: string;
    /** Under buildFailed: a kind word that a second try usually works. */
    failedBody: string;
    /** When Qloo had too little for this person to make a deck at all. */
    emptyTitle: (name: string) => string;
    emptyBody: string;
    tryAgain: string;
    retuning: string;
    litUpCount: (n: number) => string;
    previous: string;
    next: string;
    tapHint: string;
    notedLitUp: (pronouns: Pronouns) => string;
    notedNothingAhead: string;
    nothingNew: string;
    leanToward: (n: number, title: string) => string;
    steerAway: (n: number) => string;
    retuneFailed: (message: string) => string;
    plannerStopped: string;
    planningFailed: string;
    /** When the bot check cannot confirm the browser; never the server's own wording. */
    blocked: string;
    agentStopped: string;
  };
  card: {
    counter: (index: number, total: number) => string;
    retunedFor: (pronouns: Pronouns) => string;
    fromQloo: string;
    affinity: (value: string) => string;
    showCall: string;
    howRespond: string;
    litUp: string;
    litUpDone: string;
    notThis: string;
  };
  strip: {
    title: string;
    ariaLabel: string;
    cardLabel: (n: number, title: string) => string;
    litUp: string;
    notThis: string;
    isNew: string;
  };
  planning: {
    building: (name: string) => string;
    asking: (hometown: string, start: number, end: number) => string;
    calls: (n: number) => string;
    seeds: (names: string[]) => string;
    /** One domain's line while the session is built. */
    waiting: string;
    askingDomain: string;
    found: (names: string[], more: number) => string;
    empty: string;
    /** Shown for a moment once the deck is chosen. */
    ready: string;
    /** Accessible name of the progress bar. */
    progress: (settled: number, total: number) => string;
  };
  keepsake: {
    duration: (dateLabel: string, minutes: number) => string;
    litTitle: (name: string) => string;
    nothingTitle: (name: string) => string;
    nothingBody: string;
    print: string;
  };
  trace: {
    title: string;
    ariaLabel: string;
    close: string;
    closeAria: string;
    calls: (n: number) => string;
    llmAgent: string;
    scriptedAgent: string;
    youthWindow: (start: number, end: number) => string;
    thisCard: string;
    asked: (p: { plural: string; seeds?: string; within?: string; tunedTo?: string; age?: string }) => string;
    cameBack: (title: string, rank: number, take: number) => string;
    affinity: string;
    notAvailable: string;
    rank: (rank: number, take: number) => string;
    popularity: (value: string) => string;
    templatePrompt: string;
    pulledInBy: string;
    unnamed: string;
    request: string;
    rows: {
      type: string;
      interests: string;
      location: string;
      tunedTo: (place: string) => string;
      within: string;
      age: string;
      years: string;
      yearsValue: (min: string, max: string) => string;
      releasedIn: string;
      tagged: string;
      country: string;
      excluding: string;
      excludingValue: (n: number) => string;
      explain: string;
      explainValue: (on: boolean, take: string) => string;
      source: string;
    };
    dropped: (warnings: string[]) => string;
    rawRequest: string;
    timeline: string;
    policyModel: string;
    policyScripted: string;
    results: (n: number) => string;
    ms: (n: number) => string;
    droppedCount: (n: number) => string;
    arguments: string;
    requestDetails: string;
  };
  provenance: ProvenanceStrings;
  entityType: Record<string, string>;
  domain: Record<Domain, { label: string; plural: string }>;
  age: Record<QlooAgeBucket, string>;
  why: {
    from: (start: number, end: number) => string;
    releasedIn: (country: string) => string;
    closeTo: (names: string) => string;
    within: (place: string) => string;
    tunedTo: (place: string) => string;
    forAge: (age: string) => string;
    and: string;
    others: (n: number) => string;
    /** Puts the already-worded fragments in this language's order. */
    line: (p: { plural: string; from?: string; releasedIn?: string; closeTo?: string; location?: string; age?: string }) => string;
  };
  subtitle: {
    born: (year: string) => string;
    closedNow: string;
  };
  footer: {
    strong: string;
    disclaimer: string;
    privacy: string;
    api: string;
    builtFor: string;
    source: string;
    licence: string;
  };
  intake: {
    name: string;
    nameHint: string;
    namePlaceholder: string;
    birthYear: string;
    birthHint: (start: number, end: number) => string;
    birthHintDefault: string;
    hometown: string;
    hometownPlaceholder: string;
    hometownHint: string;
    language: string;
    favorites: (count: number, max: number) => string;
    favoritesPlaceholder: string;
    favoritesHint: string;
    chosenFavorites: string;
    asTyped: string;
    remove: (name: string) => string;
    errorName: string;
    errorYear: (min: number, max: number | string) => string;
    errorHometown: string;
    errorFavorite: string;
    privacy: string;
    submit: string;
    opening: string;
    suggestions: (label: string) => string;
    searching: string;
    suggestionCount: (n: number) => string;
    noMatches: string;
    searchUnavailable: string;
    typeLabel: Record<string, string>;
  };
}

export type { Language };
