import { describe, expect, it } from "vitest";

import { buildInsightsParams, buildSearchParams, buildTagsParams, isParamSupported, toQueryString } from "@/lib/qloo/params";

describe("buildInsightsParams", () => {
  it("maps a full request to the documented parameter names", () => {
    const { params, warnings } = buildInsightsParams({
      type: "urn:entity:movie",
      signals: { entities: ["aaa", "bbb"], locationQuery: "Osaka", age: ["55_and_older"] },
      filters: { releaseYearMin: 1965, releaseYearMax: 1980, releaseCountry: ["Japan"], excludeEntities: ["ccc"] },
      take: 10,
      explainability: true,
    });
    expect(warnings).toEqual([]);
    expect(params).toEqual({
      "feature.explainability": "true",
      "filter.exclude.entities": "ccc",
      "filter.release_country": "Japan",
      "filter.release_year.max": "1980",
      "filter.release_year.min": "1965",
      "filter.type": "urn:entity:movie",
      "signal.demographics.age": "55_and_older",
      "signal.interests.entities": "aaa,bbb",
      "signal.location.query": "Osaka",
      take: "10",
    });
    expect(Object.keys(params)).toEqual([...Object.keys(params)].sort());
  });

  it("drops parameters the docs do not list for the entity type and reports them", () => {
    const { params, warnings } = buildInsightsParams({
      type: "urn:entity:artist",
      signals: { entities: ["aaa"] },
      filters: { releaseYearMin: 1960, releaseYearMax: 1975, locationQuery: "Osaka", releaseCountry: ["Japan"] },
    });
    expect(params["filter.release_year.min"]).toBeUndefined();
    expect(params["filter.location.query"]).toBeUndefined();
    expect(params["filter.release_country"]).toBeUndefined();
    expect(params["signal.interests.entities"]).toBe("aaa");
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toMatch(/not documented for urn:entity:artist/);
  });

  it("keeps place and destination location filters", () => {
    const place = buildInsightsParams({ type: "urn:entity:place", filters: { locationQuery: "Chicago", tags: ["urn:tag:genre:place:restaurant"] } });
    expect(place.params["filter.location.query"]).toBe("Chicago");
    expect(place.params["filter.tags"]).toBe("urn:tag:genre:place:restaurant");
    const dest = buildInsightsParams({ type: "urn:entity:destination", signals: { entities: ["x"], locationQuery: "Chicago" }, filters: { geocodeCountryCode: "US" } });
    expect(dest.params["filter.geocode.country_code"]).toBe("US");
    expect(dest.params["signal.location.query"]).toBe("Chicago");
    expect(dest.warnings).toEqual([]);
  });

  it("clamps take to 1..50, dedupes lists and skips empty values", () => {
    expect(buildInsightsParams({ type: "urn:entity:artist", take: 500 }).params.take).toBe("50");
    expect(buildInsightsParams({ type: "urn:entity:artist", take: 0 }).params.take).toBe("1");
    expect(buildInsightsParams({ type: "urn:entity:artist" }).params.take).toBe("10");
    const { params } = buildInsightsParams({ type: "urn:entity:artist", signals: { entities: ["a", " a ", "", "b"], locationQuery: "   " } });
    expect(params["signal.interests.entities"]).toBe("a,b");
    expect(params["signal.location.query"]).toBeUndefined();
  });
});

describe("isParamSupported", () => {
  it("follows the Entity Type Parameter Guide and the Parameter Reference", () => {
    expect(isParamSupported("urn:entity:movie", "filter.release_year.min")).toBe(true);
    expect(isParamSupported("urn:entity:tv_show", "filter.release_year.min")).toBe(true);
    expect(isParamSupported("urn:entity:artist", "filter.release_year.min")).toBe(false);
    expect(isParamSupported("urn:entity:book", "filter.publication_year.min")).toBe(true);
    expect(isParamSupported("urn:entity:artist", "signal.location.query")).toBe(true);
    expect(isParamSupported("urn:entity:artist", "feature.explainability")).toBe(true);
    expect(isParamSupported("urn:entity:artist", "filter.location.query")).toBe(false);
    expect(isParamSupported("urn:entity:place", "filter.location.query")).toBe(true);
    expect(isParamSupported("urn:entity:place", "filter.release_country")).toBe(false);
  });
});

describe("query strings and other endpoints", () => {
  it("encodes deterministically with sorted keys", () => {
    expect(toQueryString({ b: "2", a: "urn:entity:artist", c: "x y" })).toBe("a=urn%3Aentity%3Aartist&b=2&c=x+y");
  });
  it("builds search and tag params", () => {
    expect(buildSearchParams({ query: " Hibari ", types: ["urn:entity:artist", "urn:entity:locality"], take: 5 })).toEqual({
      query: "Hibari",
      types: "urn:entity:artist,urn:entity:locality",
      take: "5",
    });
    expect(buildTagsParams({ query: "restaurant", parentTypes: ["urn:entity:place"] })).toEqual({
      "filter.query": "restaurant",
      "filter.parents.types": "urn:entity:place",
      take: "10",
    });
  });
});
