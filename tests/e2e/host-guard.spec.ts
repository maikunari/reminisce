import { expect, test } from "./fixtures";

test("the browser never reaches a host other than the local app", async ({ page }) => {
  await page.goto("/");
  const outside = await page.evaluate(() => fetch("https://example.com/").then(() => "reached", () => "blocked"));
  expect(outside).toBe("blocked");
  // Last, so the error page Chromium commits after the blocked navigation can't cut into another goto.
  await expect(page.goto("https://example.com/")).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
});
