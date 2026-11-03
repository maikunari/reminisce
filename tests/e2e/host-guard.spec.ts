import { expect, test } from "./fixtures";

test("the browser never reaches a host other than the local app", async ({ page }) => {
  await expect(page.goto("https://example.com/")).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
  await page.goto("/");
  const outside = await page.evaluate(() => fetch("https://example.com/").then(() => "reached", () => "blocked"));
  expect(outside).toBe("blocked");
});
