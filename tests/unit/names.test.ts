import { describe, expect, it } from "vitest";

import { displayName, romanisedName, stripMunicipalSuffix } from "@/lib/session/names";

describe("stripMunicipalSuffix", () => {
  it("drops -shi from a Latin-script city", () => {
    expect(stripMunicipalSuffix("Kobe-shi")).toBe("Kobe");
    expect(stripMunicipalSuffix("Sapporo-shi")).toBe("Sapporo");
  });
  it("leaves other titles alone", () => {
    expect(stripMunicipalSuffix("Kyoto")).toBe("Kyoto");
    expect(stripMunicipalSuffix("神戸市")).toBe("神戸市");
    expect(stripMunicipalSuffix("Shi")).toBe("Shi");
  });
});

describe("romanisedName", () => {
  it("reads the name a description opens with", () => {
    expect(romanisedName("岩崎宏美", "Hiromi Iwasaki is a Japanese singer who rose to fame in the 1970s.")).toBe("Hiromi Iwasaki");
    expect(romanisedName("榊原郁恵", "Ikue Sakakibara is a Japanese singer and actress.")).toBe("Ikue Sakakibara");
  });
  it("reads a name in brackets after the native one", () => {
    expect(romanisedName("前川清", "前川清 (Kiyoshi Maekawa) is a renowned Japanese enka singer and actor.")).toBe("Kiyoshi Maekawa");
  });
  it("returns null for a Latin title, no description, or no name in it", () => {
    expect(romanisedName("Yujiro Ishihara", "Yujiro Ishihara was an actor.")).toBeNull();
    expect(romanisedName("岩崎宏美", undefined)).toBeNull();
    expect(romanisedName("矢沢永吉", "A Japanese rock singer.")).toBeNull();
  });
});

describe("displayName", () => {
  const card = { title: "岩崎宏美", description: "Hiromi Iwasaki is a Japanese singer." };
  it("shows the romanised name with the native title beneath, outside a Japanese session", () => {
    expect(displayName(card, "en")).toEqual({ title: "Hiromi Iwasaki", native: "岩崎宏美" });
    expect(displayName(card, "es")).toEqual({ title: "Hiromi Iwasaki", native: "岩崎宏美" });
  });
  it("keeps the native title in a Japanese session", () => {
    expect(displayName(card, "ja")).toEqual({ title: "岩崎宏美" });
  });
  it("cleans a -shi city in any language", () => {
    expect(displayName({ title: "Kobe-shi" }, "en")).toEqual({ title: "Kobe" });
    expect(displayName({ title: "Kobe-shi" }, "ja")).toEqual({ title: "Kobe" });
  });
});
