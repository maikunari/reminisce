import { expect, test, type Page } from "@playwright/test";

/** Exactly one main landmark and one id="main" in the document, however the page got there, with the masthead and footer beside it as the one banner and contentinfo. */
async function expectOneMain(page: Page) {
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("[id=main]")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
}

test("the home page is one main landmark, a banner and a contentinfo, and the skip link lands on it", async ({ page }) => {
  await page.goto("/");
  await expectOneMain(page);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("a session stays one main landmark while planning, on the overview and after a client-side navigation from the home page", async ({ page }) => {
  // Next keeps the page you came from mounted, hidden; it must not bring a second main with it.
  await page.goto("/");
  await page.getByTestId("preset-frank").click();
  await expect(page).toHaveURL(/\/session\/[a-z0-9-]+/);
  await expectOneMain(page);
  await expect(page.getByTestId("session-overview")).toBeVisible({ timeout: 45_000 });
  await expectOneMain(page);
  // The session moves focus into its own content, so reach the skip link directly rather than by Tab.
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.getByTestId("start-session").click();
  await expect(page.getByTestId("memory-card")).toBeVisible();
  await expectOneMain(page);
  // The page's own heading is inside it.
  await expect(page.locator("main").getByRole("heading", { level: 1 })).toHaveCount(1);
});

test("a session opened directly keeps its masthead and footer outside the main landmark, and Why Qloo still opens the trace", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preset-michiko").click();
  await expect(page.getByTestId("session-overview")).toBeVisible({ timeout: 45_000 });
  await page.reload();
  await expect(page.getByTestId("session-overview")).toBeVisible({ timeout: 45_000 });
  await expectOneMain(page);
  await expect(page.getByRole("banner").getByTestId("person-summary")).toBeVisible();
  await page.getByRole("banner").getByTestId("why-qloo-toggle").click();
  await expect(page.locator("main #trace-panel")).toBeVisible();
});

test("a session that is not in this browser is one main landmark too", async ({ page }) => {
  await page.goto("/session/not-a-session");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectOneMain(page);
});

test("a shared link carries a picture: absolute Open Graph and Twitter image tags that resolve", async ({ page, request, baseURL }) => {
  await page.goto("/");
  const meta = async (selector: string) => page.locator(`head meta[${selector}]`).first().getAttribute("content");
  const ogImage = await meta('property="og:image"');
  const twitterImage = await meta('name="twitter:image"');
  expect(ogImage).toMatch(/^https?:\/\/[^/]+\/og\.png$/);
  expect(twitterImage).toBe(ogImage);
  expect(await meta('property="og:image:width"')).toBe("1200");
  expect(await meta('property="og:image:height"')).toBe("630");
  expect(await meta('property="og:image:alt"')).toBeTruthy();
  expect(await meta('name="twitter:card"')).toBe("summary_large_image");
  // metadataBase is the deploy's origin in production and localhost here; fetch the path so the test runs anywhere.
  const res = await request.get(new URL(new URL(ogImage!).pathname, baseURL).href);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
});
