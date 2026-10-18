/**
 * What may be dealt: no mature films or shows, and no artist twice. The cases
 * are the ones the pre-submission audit found in live decks.
 */
import { describe, expect, it } from "vitest";

import { adaptSession, planSession } from "@/lib/agent";
import { EntityPool, distinctArtistIds, executeTool, type PoolEntry, type ToolContext } from "@/lib/agent/tools";
import { artistKeys, artistKeysOf, isMatureTitle, ledgerOfCards } from "@/lib/agent/suitability";
import { readServerEnv } from "@/lib/env";
import { QlooClient } from "@/lib/qloo/client";
import type { QlooEntity } from "@/lib/qloo/types";
import { CardSchema } from "@/lib/session/schemas";
import type { Card, Person } from "@/lib/session/types";

import { liveQlooFake } from "./helpers/live-qloo";

const NOW = new Date("2026-10-11T00:00:00Z");
const env = readServerEnv({ QLOO_MODE: "live", QLOO_API_KEY: "test", LLM_MODE: "fixture" });
const osaka: Person = { name: "Michiko", birthYear: 1950, hometown: "Osaka", favorites: [{ name: "Hibari Misora" }], language: "ja", pronoun: "she" };

function entity(name: string, extra: Partial<QlooEntity> = {}): QlooEntity {
  return { name, entity_id: `aaaaaaaa-0000-4000-8000-${String(name.length).padStart(4, "0")}${String(name.charCodeAt(0)).padStart(8, "0")}`, type: "urn:entity", subtype: "urn:entity:movie", ...extra };
}

describe("mature titles", () => {
  it("are recognised by title, by Qloo tag and by rating, and ordinary films are not", () => {
    expect(isMatureTitle(entity("Story of a Prostitute"))).toBe(true);
    expect(isMatureTitle(entity("Funeral Parade of Roses"))).toBe(true);
    expect(isMatureTitle(entity("薔薇の葬列"))).toBe(true);
    expect(isMatureTitle(entity("The Red Angel", { tags: [{ name: "Wartime romance" } as never] }))).toBe(true);
    expect(isMatureTitle(entity("Quiet Harbor", { tags: [{ name: "Drama" } as never, { name: "Sexual violence" } as never] }))).toBe(true);
    expect(isMatureTitle(entity("Quiet Harbor", { properties: { content_rating: "NC-17" } }))).toBe(true);
    for (const name of ["Osaka Story", "The Naked Island", "Tokyo Story", "Sussex Summer"]) {
      expect(isMatureTitle(entity(name, { tags: [{ name: "Drama" } as never], properties: { content_rating: "PG" } }))).toBe(false);
    }
  });

  it("does not count Qloo's audience tag \"Mature\", which sits on nearly every classic Japanese film", () => {
    const mature = { id: "urn:tag:audience:qloo:mature", name: "Mature" } as never;
    expect(isMatureTitle(entity("Tora-san, Our Lovable Tramp", { tags: [mature, { name: "Comedy" } as never], properties: { content_rating: "PG" } }))).toBe(false);
    expect(isMatureTitle(entity("The Yellow Handkerchief", { tags: [mature] }))).toBe(false);
    // Adult content is still the rating and the sexual-content keyword tags, with or without the audience tag.
    expect(isMatureTitle(entity("The Red Angel", { tags: [mature, { name: "Rape" } as never] }))).toBe(true);
    expect(isMatureTitle(entity("Nanami", { tags: [mature, { name: "Prostitution" } as never] }))).toBe(true);
    expect(isMatureTitle(entity("Story of a Prostitute", { tags: [mature] }))).toBe(true);
    expect(isMatureTitle(entity("Quiet Harbor", { tags: [mature], properties: { content_rating: "NC-17" } }))).toBe(true);
  });

  it("never reach a dealt deck, even when Qloo ranks them first", async () => {
    const fake = liveQlooFake();
    const film = (id: string, name: string, year: number, tags: string[] = []) => ({
      entity_id: `dddddddd-3333-4000-8000-${id.padStart(12, "0")}`,
      name,
      properties: { release_year: year, release_country: ["Japan"] },
      tags: tags.map((t) => ({ name: t, tag_id: `urn:tag:keyword:media:${t}` })),
      query: { affinity: 0.99 },
    });
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.searchParams.get("filter.type") === "urn:entity:movie") {
        const entities = [
          film("1", "Story of a Prostitute", 1965),
          film("2", "Funeral Parade of Roses", 1969),
          film("3", "The Red Angel", 1966, ["Morphine", "Rape", "Mature"]),
          film("4", "Osaka Story", 1970, ["Drama"]),
          film("5", "Harbour Lights", 1972),
        ];
        return new Response(JSON.stringify({ success: true, results: { entities } }), { status: 200 });
      }
      return fake.fetch(input, init);
    }) as unknown as typeof fetch;
    const live = new QlooClient({ mode: "live", apiKey: "test", fetchImpl });
    const result = await planSession(osaka, { env, qloo: live, now: NOW });
    const films = result.cards.filter((c) => c.domain === "film").map((c) => c.title);
    expect(films.length).toBeGreaterThan(0);
    expect(films).toEqual(expect.arrayContaining(["Osaka Story"]));
    for (const banned of ["Story of a Prostitute", "Funeral Parade of Roses", "The Red Angel"]) expect(result.cards.map((c) => c.title)).not.toContain(banned);
  });
});

describe("the same artist under two Qloo entities", () => {
  it("is one artist when an alias or a romanisation agrees, in either name order", () => {
    const romanised = artistKeys({ name: "Yukihiro Takahashi" });
    const native = artistKeys({ name: "高橋幸宏", aliases: ["Yukihiro Takahashi"] });
    expect([...native].some((k) => romanised.has(k))).toBe(true);
    const byDescription = artistKeys({ name: "岩崎宏美", description: "岩崎宏美 (Hiromi Iwasaki) is a Japanese singer." });
    expect([...byDescription].some((k) => artistKeys({ name: "Hiromi Iwasaki" }).has(k))).toBe(true);
    expect([...artistKeys({ name: "Takahashi Yukihiro" })].some((k) => romanised.has(k))).toBe(true);
    expect([...artistKeys({ name: "Yukihiro Tanaka" })].some((k) => romanised.has(k))).toBe(false);
  });

  it("keeps the first of a pair out of a pool deck", () => {
    const pool = new EntityPool();
    const add = (e: QlooEntity) => pool.add({ entity: e, qlooType: "urn:entity:artist", params: {}, source: "live", status: 200, durationMs: 0, warnings: [], rank: 1, seedIds: [], seedNames: [] } as PoolEntry);
    const a = entity("Yukihiro Takahashi", { subtype: "urn:entity:artist" });
    const b = entity("高橋幸宏", { subtype: "urn:entity:artist", properties: { aliases: ["Yukihiro Takahashi"] } });
    const c = entity("Hibari Misora", { subtype: "urn:entity:artist" });
    [a, b, c].forEach(add);
    expect(distinctArtistIds([a.entity_id, b.entity_id, c.entity_id], pool)).toEqual([a.entity_id, c.entity_id]);
  });

  it("is one artist when Qloo's akas name the other entity", () => {
    const native = entity("高橋幸宏", { subtype: "urn:entity:artist", properties: { akas: [{ value: "Yukihiro Takahashi", languages: ["en"] }] } });
    const romanised = artistKeysOf(entity("Yukihiro Takahashi", { subtype: "urn:entity:artist" }));
    expect([...artistKeysOf(native)].some((k) => romanised.has(k))).toBe(true);
  });

  it("is already in the deck when a card's pool entity goes by the incoming name", () => {
    const native = entity("高橋幸宏", { subtype: "urn:entity:artist", properties: { aliases: ["Yukihiro Takahashi"] } });
    const card = { domain: "music", entityId: native.entity_id, title: "高橋幸宏" };
    const incoming = artistKeysOf(entity("Yukihiro Takahashi", { subtype: "urn:entity:artist" }));
    expect(ledgerOfCards([card], () => undefined).has(incoming)).toBe(false);
    expect(ledgerOfCards([card], (id) => (id === native.entity_id ? native : undefined)).has(incoming)).toBe(true);
  });

  it("is named when a plan is rejected for dealing it twice", async () => {
    const pool = new EntityPool();
    const a = entity("Yukihiro Takahashi", { subtype: "urn:entity:artist" });
    const b = entity("高橋幸宏", { subtype: "urn:entity:artist", properties: { akas: [{ value: "Yukihiro Takahashi" }] } });
    for (const e of [a, b]) pool.add({ entity: e, qlooType: "urn:entity:artist", params: {}, source: "live", status: 200, durationMs: 0, warnings: [], rank: 1, seedIds: [], seedNames: [] } as PoolEntry);
    const ctx = { pool, existingCards: [], phase: "plan" } as unknown as ToolContext;
    const outcome = await executeTool("plan_session", { cards: [a, b].map((e) => ({ entity_id: e.entity_id, domain: "music" })) }, ctx);
    expect(outcome.ok).toBe(false);
    expect((outcome.result as { errors: string[] }).errors).toContain("高橋幸宏 is an artist already in the deck");
  });

  it("is dealt once in Kenji's kind of deck", async () => {
    const fake = liveQlooFake();
    const artist = (id: string, name: string, affinity: number, properties: Record<string, unknown> = {}) => ({
      entity_id: `abababab-4444-4000-8000-${id.padStart(12, "0")}`,
      name,
      popularity: 0.8,
      properties: { start_year: 1972, ...properties },
      query: { affinity },
    });
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.searchParams.get("filter.type") === "urn:entity:artist") {
        const entities = [
          artist("1", "Yukihiro Takahashi", 0.99, { aliases: ["Yukihiro Takahashi"] }),
          artist("2", "高橋幸宏", 0.98, { aliases: ["Yukihiro Takahashi"] }),
          artist("3", "Enka Singer A", 0.9),
          artist("4", "Enka Singer B", 0.89),
          artist("5", "Enka Singer C", 0.88),
        ];
        return new Response(JSON.stringify({ success: true, results: { entities } }), { status: 200 });
      }
      return fake.fetch(input, init);
    }) as unknown as typeof fetch;
    const live = new QlooClient({ mode: "live", apiKey: "test", fetchImpl });
    const result = await planSession(osaka, { env, qloo: live, now: NOW });
    const music = result.cards.filter((c) => c.domain === "music").map((c) => c.title);
    expect(music.filter((t) => t === "Yukihiro Takahashi" || t === "高橋幸宏")).toHaveLength(1);
    expect(music.length).toBeGreaterThanOrEqual(3);
    expect(new Set(result.cards.map((c) => c.entityId)).size).toBe(result.cards.length);
  });

  it("is not swapped back in by a re-tune when only the card's own entity named the other", async () => {
    const fake = liveQlooFake();
    let phase: "plan" | "adapt" = "plan";
    const artist = (id: string, name: string, affinity: number, properties: Record<string, unknown> = {}) => ({
      entity_id: `cdcdcdcd-4444-4000-8000-${id.padStart(12, "0")}`,
      name,
      popularity: 0.8,
      properties: { start_year: 1972, ...properties },
      query: { affinity },
    });
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.searchParams.get("filter.type") === "urn:entity:artist") {
        // The deck's own entities are excluded from a re-tune, so 細野晴臣 never returns then.
        const entities =
          phase === "plan"
            ? [artist("1", "細野晴臣", 0.99, { description: "日本の音楽家。", akas: [{ value: "Haruomi Hosono" }] }), artist("2", "Enka Singer A", 0.9), artist("3", "Enka Singer B", 0.89), artist("4", "Enka Singer C", 0.88)]
            : [artist("5", "Haruomi Hosono", 0.99), artist("6", "Teresa Teng", 0.95), artist("7", "Enka Singer D", 0.9), artist("8", "Enka Singer E", 0.89)];
        return new Response(JSON.stringify({ success: true, results: { entities } }), { status: 200 });
      }
      return fake.fetch(input, init);
    }) as unknown as typeof fetch;
    const live = new QlooClient({ mode: "live", apiKey: "test", fetchImpl });
    const plan = await planSession(osaka, { env, qloo: live, now: NOW });
    const index = plan.cards.findIndex((c) => c.title === "細野晴臣");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(plan.cards[index]!.description).toBe("日本の音楽家。");
    // The deck comes back from the browser through the adapt request's schema.
    const cards = plan.cards.map((c) => CardSchema.parse(JSON.parse(JSON.stringify(c))) as unknown as Card);
    phase = "adapt";
    const result = await adaptSession(
      { person: { ...osaka, favorites: plan.favorites }, cards, feedback: { cardId: cards[index]!.id, reaction: "lit_up" }, currentIndex: index },
      { env, qloo: live, now: NOW },
    );
    const titles = result.replacements.map((c) => c.title);
    expect(result.replacements.some((c) => c.domain === "music")).toBe(true);
    expect(titles).not.toContain("Haruomi Hosono");
  });
});
