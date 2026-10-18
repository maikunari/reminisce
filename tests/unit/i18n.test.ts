import { describe, expect, it } from "vitest";

import { whyLine } from "@/lib/agent/prompts";
import type { QlooEntity } from "@/lib/qloo/types";
import { subtitleFor } from "@/lib/agent/tools";
import { DICTIONARIES, dictionary } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { PROVENANCE_EN, sessionModeLabel } from "@/lib/session/provenance";
import { LANGUAGES, pronounsFor, type CardSignals } from "@/lib/session/types";

/** Every leaf of `expected` exists in `actual` with the same type, so a language cannot ship a hole. */
function sameShape(actual: unknown, expected: unknown, path: string, problems: string[]) {
  if (typeof expected === "function") {
    if (typeof actual !== "function") problems.push(`${path}: expected a function`);
    return;
  }
  if (typeof expected === "string") {
    if (typeof actual !== "string" || actual.trim().length === 0) problems.push(`${path}: expected a non-empty string`);
    return;
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return problems.push(`${path}: expected an object`);
    for (const key of Object.keys(expected)) sameShape((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${path}.${key}`, problems);
    for (const key of Object.keys(actual)) if (!(key in (expected as object))) problems.push(`${path}.${key}: not in the English dictionary`);
  }
}

const signals: CardSignals = {
  qlooType: "urn:entity:artist",
  path: "/v2/insights",
  params: { "filter.type": "urn:entity:artist", "signal.location.query": "Osaka", "signal.demographics.age": "55_and_older" },
  affinity: 0.9,
  source: "synthetic",
  seedNames: ["Hibari Misora"],
  locationQuery: "Osaka",
  ageBucket: "55_and_older",
  rank: 1,
  warnings: [],
};

describe("dictionaries", () => {
  it("cover every language the intake form offers", () => {
    for (const l of LANGUAGES) expect(DICTIONARIES[l.code]).toBeDefined();
    expect(dictionary(undefined)).toBe(en);
  });

  it.each(Object.keys(DICTIONARIES))("%s has every key English has, and nothing else", (code) => {
    const problems: string[] = [];
    sameShape(DICTIONARIES[code as keyof typeof DICTIONARIES], en, code, problems);
    expect(problems).toEqual([]);
  });

  it.each(Object.keys(DICTIONARIES))("%s fills its values in", (code) => {
    const t = DICTIONARIES[code as keyof typeof DICTIONARIES];
    expect(t.card.counter(2, 9)).toMatch(/2/);
    expect(t.card.counter(2, 9)).toMatch(/9/);
    expect(t.session.leanToward(2, "Kyoto")).toContain("Kyoto");
    expect(t.session.summary({ name: "Michiko", hometown: "Osaka", start: 1965, end: 1980, favorites: ["Hibari Misora"] })).toContain("Hibari Misora");
    expect(t.session.notedLitUp(pronounsFor("she")).length).toBeGreaterThan(0);
    expect(t.trace.asked({ plural: t.domain.music.plural, seeds: "Hibari Misora", tunedTo: "Osaka", age: t.age["55_and_older"] })).toContain("Osaka");
    expect(t.trace.cameBack("Kyoto", 3, 10)).toContain("Kyoto");
    expect(t.keepsake.litTitle("Frank")).toContain("Frank");
    expect(t.card.because("Frank", "Frank Sinatra")).toContain("Frank Sinatra");
    expect(t.card.because("Frank", "Frank Sinatra")).toContain("Frank");
    expect(t.ending.thanks("Frank")).toContain("Frank");
    expect(t.ending.summaryFor("Frank", "Chicago", 1960, 1975)).toContain("Chicago");
    expect(t.intake.favorites(1, 3)).toContain("1/3");
    expect(t.intake.errorYear(1900, 2008)).toContain("2008");
    expect(Object.keys(t.intake.typeLabel)).toEqual(Object.keys(en.intake.typeLabel));
    expect(Object.keys(t.entityType)).toEqual(Object.keys(en.entityType));
  });

  it("writes the why line in the session's language", () => {
    expect(whyLine("music", signals)).toBe("artists close to Hibari Misora, tuned to Osaka, for people 55 and older");
    expect(whyLine("music", signals, "es")).toBe("artistas cercanos a Hibari Misora, ajustado a Osaka, para personas de 55 años o más");
    expect(whyLine("music", signals, "ja")).toBe("Hibari Misoraに近いアーティスト、大阪に合わせて、55歳以上の方向け".replace("大阪", "Osaka"));
    const films = { ...signals, qlooType: "urn:entity:movie" as const, yearRange: [1965, 1980] as [number, number], params: { ...signals.params, "filter.release_country": "Japan" } };
    expect(whyLine("film", films, "ja")).toBe("1965〜1980年のJapan公開のHibari Misoraに近い映画、Osakaに合わせて、55歳以上の方向け");
    expect(whyLine("film", films, "es")).toMatch(/^películas de 1965 a 1980 con estreno en Japan cercanos a Hibari Misora/);
  });

  it("writes the subtitle in the session's language", () => {
    const artist: QlooEntity = { name: "X", entity_id: "e1", type: "urn:entity", subtype: "urn:entity:artist", properties: { date_of_birth: "1937-05-29", place_of_birth: "Yokohama, Japan" } };
    expect(subtitleFor("music", artist)).toBe("born 1937 · Yokohama");
    expect(subtitleFor("music", artist, "ja")).toBe("1937年生まれ · Yokohama");
    const place: QlooEntity = { name: "Y", entity_id: "e2", type: "urn:entity", subtype: "urn:entity:place", properties: { geocode: { name: "Osaka" }, is_closed: true } };
    expect(subtitleFor("place", place, "es")).toBe("Osaka · ya cerrado");
  });

  it("keeps provenance wording in one place and never calls a live session canned", () => {
    expect(en.provenance).toBe(PROVENANCE_EN);
    for (const t of Object.values(DICTIONARIES)) {
      for (const text of [...Object.values(t.provenance.source), ...Object.values(t.provenance.sourceWord), ...Object.values(t.provenance.mode)]) {
        expect(text.toLowerCase()).not.toContain("fixture");
        expect(text.toLowerCase()).not.toContain("replay ");
      }
      expect(sessionModeLabel("live", ["live"], t.provenance)).toBe(t.provenance.mode.live);
      expect(sessionModeLabel("fixture", ["recorded"], t.provenance)).toBe(t.provenance.mode.recorded);
      expect(sessionModeLabel("fixture", ["recorded", "synthetic"], t.provenance)).toBe(t.provenance.mode.mixed);
      expect(sessionModeLabel("fixture", ["synthetic"], t.provenance)).toBe(t.provenance.mode.synthetic);
      expect(sessionModeLabel("fixture", [], t.provenance)).toBe(t.provenance.mode.synthetic);
      expect(t.provenance.replayedRun("3 pm")).toContain("3 pm");
      expect(t.provenance.sourceReplayedRun("3 pm")).toContain("3 pm");
    }
  });
});
