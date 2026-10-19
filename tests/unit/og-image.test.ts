import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("public/og.png", () => {
  it("is a 1200 by 630 PNG, the size link previews expect", () => {
    const png = readFileSync(path.join(process.cwd(), "public", "og.png"));
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    expect(png.length).toBeLessThan(1_000_000);
  });
});
