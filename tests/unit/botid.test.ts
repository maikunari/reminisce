import { describe, expect, it } from "vitest";

import { botIdEnabled } from "@/lib/guard/botid";

describe("BotID switch", () => {
  it("runs only on Vercel and honours the off switch", () => {
    expect(botIdEnabled({})).toBe(false);
    expect(botIdEnabled({ VERCEL: "1" })).toBe(true);
    expect(botIdEnabled({ VERCEL: "1", NEXT_PUBLIC_BOTID: "off" })).toBe(false);
    expect(botIdEnabled({ VERCEL: "1", NEXT_PUBLIC_BOTID: "on" })).toBe(true);
  });
});
