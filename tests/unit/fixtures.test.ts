import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { QlooClient } from "@/lib/qloo/client";
import { SyntheticQloo, findRecordedFixture, recordedFixtureFilename, requestHash, writeRecordedFixture } from "@/lib/qloo/fixtures";
import { buildInsightsParams } from "@/lib/qloo/params";

const HIBARI = "ffffffff-0000-4000-8000-0000000a0001";
const SINATRA = "ffffffff-0000-4000-8000-0000000b0001";

describe("synthetic Qloo engine", () => {
  const engine = new SyntheticQloo();

  it("search returns results shaped like GET /search", () => {
    const res = engine.search({ query: "hibari", types: "urn:entity:artist", take: "5" });
    expect(res._fixture?.source).toBe("synthetic");
    expect(res.results[0]).toMatchObject({ name: "Hibari Misora", entity_id: HIBARI, types: ["urn:entity:artist"] });
    expect(res.results[0]?.properties).toBeDefined();
    const locality = engine.search({ query: "osaka", types: "urn:entity:locality" });
    expect(locality.results[0]?.types).toEqual(["urn:entity:locality"]);
    expect(engine.search({ query: "zzzz-nothing" }).results).toEqual([]);
  });

  it("tags returns results shaped like GET /v2/tags", () => {
    const res = engine.tags({ "filter.query": "restaurant", "filter.parents.types": "urn:entity:place", take: "5" });
    expect(res.success).toBe(true);
    expect(res.results.tags[0]).toMatchObject({ id: "urn:tag:genre:place:restaurant", name: "Restaurant" });
    expect(res.results.tags.every((t) => t.parents?.some((p) => p.type === "urn:entity:place"))).toBe(true);
  });

  it("insights returns entities shaped like GET /v2/insights with affinity and explainability", () => {
    const { params } = buildInsightsParams({
      type: "urn:entity:artist",
      signals: { entities: [HIBARI], locationQuery: "Osaka", age: ["55_and_older"] },
      take: 5,
      explainability: true,
    });
    const res = engine.insights(params);
    expect(res.success).toBe(true);
    expect(res._fixture?.source).toBe("synthetic");
    expect(res.query?.locality?.signal?.name).toBe("Osaka");
    expect(res.results.entities).toHaveLength(5);
    const first = res.results.entities[0]!;
    expect(first).toMatchObject({ type: "urn:entity", subtype: "urn:entity:artist" });
    expect(first.entity_id).not.toBe(HIBARI);
    expect(typeof first.popularity).toBe("number");
    expect(first.query?.affinity).toBeGreaterThan(0);
    expect(first.query?.explainability?.entities?.[HIBARI]).toBeGreaterThan(0);
    expect(first).not.toHaveProperty("_syn");
    const affinities = res.results.entities.map((e) => e.query?.affinity ?? 0);
    expect(affinities).toEqual([...affinities].sort((a, b) => b - a));
  });

  it("applies release year, country and location filters", () => {
    const { params } = buildInsightsParams({
      type: "urn:entity:movie",
      signals: { entities: [HIBARI] },
      filters: { releaseYearMin: 1965, releaseYearMax: 1980, releaseCountry: ["Japan"] },
      take: 20,
    });
    const movies = engine.insights(params).results.entities;
    expect(movies.length).toBeGreaterThan(3);
    for (const m of movies) {
      expect(m.properties?.release_year).toBeGreaterThanOrEqual(1965);
      expect(m.properties?.release_year).toBeLessThanOrEqual(1980);
      expect(m.properties?.release_country).toContain("Japan");
    }
    const places = engine.insights(buildInsightsParams({ type: "urn:entity:place", filters: { locationQuery: "Chicago", tags: ["urn:tag:genre:place:restaurant"] } }).params);
    expect(places.results.entities.length).toBeGreaterThan(3);
    expect(places.results.entities.every((p) => p.properties?.geocode?.admin1_region === "Illinois")).toBe(true);
    expect(places.results.entities.every((p) => p.tags?.some((t) => t.id === "urn:tag:genre:place:restaurant"))).toBe(true);
  });

  it("separates the two preset worlds", () => {
    const jp = engine.insights(buildInsightsParams({ type: "urn:entity:artist", signals: { entities: [HIBARI], locationQuery: "Osaka" }, take: 8 }).params);
    const us = engine.insights(buildInsightsParams({ type: "urn:entity:artist", signals: { entities: [SINATRA], locationQuery: "Chicago" }, take: 8 }).params);
    const jpIds = new Set(jp.results.entities.map((e) => e.entity_id));
    expect(us.results.entities.some((e) => jpIds.has(e.entity_id))).toBe(false);
  });

  it("is deterministic", () => {
    const { params } = buildInsightsParams({ type: "urn:entity:destination", signals: { entities: [SINATRA], locationQuery: "Chicago" } });
    expect(engine.insights(params)).toEqual(engine.insights(params));
  });
});

describe("recorded fixtures", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "reminisce-fixtures-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("hashes requests independently of parameter order", () => {
    const a = { path: "/v2/insights" as const, params: { "filter.type": "urn:entity:artist", take: "5" } };
    const b = { path: "/v2/insights" as const, params: { take: "5", "filter.type": "urn:entity:artist" } };
    expect(requestHash(a)).toBe(requestHash(b));
    expect(recordedFixtureFilename(a)).toMatch(/^v2-insights__[0-9a-f]{16}\.json$/);
  });

  it("round-trips a recorded response and serves it before the synthetic catalog", async () => {
    const req = { path: "/search" as const, params: { query: "Hibari Misora", types: "urn:entity:artist", take: "5" } };
    const body = { results: [{ name: "Hibari Misora (recorded)", entity_id: "11111111-2222-4333-8444-555555555555", types: ["urn:entity:artist"] }], duration: 9 };
    await writeRecordedFixture(req, 200, body, root);
    const found = await findRecordedFixture<typeof body>(req, root);
    expect(found?._meta.source).toBe("live");
    expect(found?.body).toEqual(body);

    const client = new QlooClient({ mode: "fixture", recordedRoot: root });
    const res = await client.search("Hibari Misora", { types: ["urn:entity:artist"], take: 5 });
    expect(res.source).toBe("recorded");
    expect(res.body.results[0]?.name).toBe("Hibari Misora (recorded)");

    const miss = await client.search("Frank Sinatra", { types: ["urn:entity:artist"], take: 5 });
    expect(miss.source).toBe("synthetic");
  });
});
