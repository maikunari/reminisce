import { expect, test, type Page } from "@playwright/test";

const PRESETS = [
  { id: "michiko", name: "Michiko", hometown: "Osaka", seed: "Hibari Misora" },
  { id: "frank", name: "Frank", hometown: "Chicago", seed: "Frank Sinatra" },
];

/** Planning ends at the "session ready" overview; this presses Start and waits for the first card. */
async function startSession(page: Page) {
  await expect(page.getByTestId("session-overview")).toBeVisible({ timeout: 45_000 });
  await page.getByTestId("start-session").click();
  await expect(page.getByTestId("memory-card")).toBeVisible();
}

async function deckTitles(page: Page): Promise<string[]> {
  const labels = await page.getByTestId("deck-strip").locator("li button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
  return labels.map((l) => l.replace(/^Card \d+: /, "").replace(/, (they lit up|not this one)$/, ""));
}

async function deckDomains(page: Page): Promise<string[]> {
  return page.getByTestId("deck-strip").locator("li").evaluateAll((els) => els.map((el) => el.getAttribute("data-domain") ?? ""));
}

for (const preset of PRESETS) {
  test(`preset ${preset.name}: builds a session, explains Qloo, re-tunes on feedback, persists`, async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Music and memories");
    await expect(page.locator("body")).toContainText("eight to ten cards");
    await page.getByTestId(`preset-${preset.id}`).click();
    await expect(page).toHaveURL(/\/session\/[a-z0-9-]+/);
    await expect(page.getByTestId("person-summary")).toContainText(preset.hometown);

    // The deck appears (planning streams trace events first).
    await startSession(page);
    const titles = await deckTitles(page);
    expect(titles.length).toBeGreaterThanOrEqual(8);
    expect(titles.length).toBeLessThanOrEqual(10);
    expect(new Set(titles).size).toBe(titles.length);
    const domains = new Set((await deckDomains(page)).map((d) => d.trim().toLowerCase()));
    expect(domains.size).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId("card-prompt")).not.toBeEmpty();

    // Why Qloo: the call, the signals, the affinity and the timeline.
    await page.getByTestId("why-qloo-toggle").click();
    const panel = page.getByTestId("trace-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("trace-affinity")).toHaveText(/^\d\.\d{3}$/);
    await expect(panel.getByTestId("trace-card")).toContainText(preset.seed);
    await panel.getByTestId("trace-card").getByText("Raw request").click();
    await expect(panel.getByTestId("trace-card")).toContainText("filter.type=urn:entity:");
    expect(await panel.getByTestId("trace-timeline").locator("li").count()).toBeGreaterThanOrEqual(10);
    await expect(panel).toContainText("GET /v2/insights");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();

    // Feedback moves the deck on at once; the re-tune lands behind it, on cards further ahead.
    const before = await deckTitles(page);
    const currentTitle = await page.getByTestId("card-title").innerText();
    await page.getByTestId("react-lit-up").click();
    await expect(page.getByTestId("card-title")).toHaveText(before[1]!, { timeout: 3_000 });
    await expect(page.getByTestId("react-lit-up")).toBeEnabled();
    await expect(page.getByTestId("notice")).toContainText(/of the next cards now lean/, { timeout: 45_000 });
    const after = await deckTitles(page);
    expect(after).not.toEqual(before);
    // The card the deck moved to is never swapped under the caregiver.
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after.length).toBe(before.length);
    await expect(page.getByTestId("card-title")).toHaveText(after[1]!);
    await expect(page.getByTestId("react-lit-up")).toHaveAttribute("aria-pressed", "false");

    // Keyboard navigation and persistence across reload.
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("card-title")).toHaveText(currentTitle);
    await expect(page.getByTestId("react-lit-up")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("react-lit-up")).toBeDisabled();
    await page.keyboard.press("ArrowRight");
    const secondTitle = await page.getByTestId("card-title").innerText();
    expect(secondTitle).toBe(after[1]);
    await page.reload();
    await expect(page.getByTestId("memory-card")).toBeVisible();
    await expect(page.getByTestId("card-title")).toHaveText(secondTitle);
    expect(await deckTitles(page)).toEqual(after);
  });
}

test("the hero offers each prepared person in one tap, above the intake form", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hero-preset-michiko")).toHaveText(/Try Michiko's session/);
  await expect(page.getByTestId("hero-preset-frank")).toHaveText(/Try Frank's session/);
  await page.getByTestId("hero-preset-frank").click();
  await expect(page).toHaveURL(/\/session\/[a-z0-9-]+/);
  await expect(page.getByTestId("person-summary")).toContainText("Chicago");
  await startSession(page);
});

test("a bot-check refusal reads as a kind line, never the server's wording", async ({ page }) => {
  await page.route("**/api/plan", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Automated requests are not allowed" }) }));
  await page.goto("/");
  await page.getByTestId("preset-michiko").click();
  const failed = page.getByTestId("build-failed");
  await expect(failed).toBeVisible();
  await expect(failed).toContainText("We couldn't confirm this browser");
  await expect(failed).not.toContainText("Automated requests");
});

test("the two presets produce culturally different sessions", async ({ page }) => {
  const sets: string[][] = [];
  for (const preset of PRESETS) {
    await page.goto("/");
    await page.getByTestId(`preset-${preset.id}`).click();
    await startSession(page);
    sets.push(await deckTitles(page));
  }
  const [a, b] = sets as [string[], string[]];
  expect(a.filter((t) => b.includes(t))).toEqual([]);
});

test("intake form: autocomplete from Qloo search, the whole session in the chosen language", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Their name").fill("Maria");
  await page.getByLabel("Year they were born").fill("1948");
  await expect(page.getByText(/They were 15 to 30 from 1963 to 1978/)).toBeVisible();
  const hometown = page.getByLabel("Where they grew up");
  await hometown.fill("Madr");
  await page.getByRole("option", { name: /Madrid/ }).first().click();
  await expect(hometown).toHaveValue("Madrid");
  // Choosing the language flips the form itself.
  await page.getByLabel("Language for the session").selectOption("es");
  const favorite = page.getByLabel(/Cosas que le encantaban/);
  await favorite.fill("Julio");
  await page.getByRole("option", { name: /Julio Iglesias/ }).first().click();
  await expect(page.getByRole("list", { name: "Favoritos elegidos" })).toContainText("Julio Iglesias");
  await page.getByRole("button", { name: "Crear su sesión" }).click();
  await expect(page).toHaveURL(/\/session\//);
  await startSession(page);
  await expect(page.getByTestId("card-prompt")).toHaveText(/[¿?]/);
  await expect(page.getByTestId("person-summary")).toContainText("Madrid");
  // Not only the prompt: the chrome, the buttons and the Why Qloo panel speak Spanish too.
  await expect(page.getByTestId("session-root")).toHaveAttribute("lang", "es");
  await expect(page.getByTestId("react-lit-up")).toHaveText(/Le encantó/);
  await expect(page.getByTestId("react-not-this")).toHaveText("Esta no");
  await expect(page.getByRole("navigation", { name: "Tarjetas de la sesión" })).toBeVisible();
  await expect(page.getByTestId("card-because")).toHaveText("Porque a Maria le gusta Julio Iglesias");
  await page.getByTestId("why-qloo-toggle").click();
  await expect(page.getByTestId("trace-panel")).toContainText("Por qué Qloo eligió esto");
  await expect(page.getByTestId("trace-mode")).toHaveText("catálogo de demostración");
  await expect(page.getByTestId("trace-panel")).not.toContainText(/fixture/i);
});

test("intake form: a town Qloo does not list still works as typed, with an honest hint", async ({ page }) => {
  await page.goto("/");
  const hometown = page.getByLabel("Where they grew up");
  await hometown.fill("Smallville");
  await expect(page.getByTestId("hometown-status")).toHaveText(/No matches in Qloo yet/);
  await hometown.press("Enter");
  await expect(hometown).toHaveValue("Smallville");
  // A town in a country the catalogue knows is offered as a suggestion.
  await hometown.fill("Puebla");
  await expect(page.getByRole("option", { name: /Puebla, Mexico/ })).toBeVisible();
});

test("a custom person from Mexico City who loved Pedro Infante gets a Mexican deck, not a European one", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Their name").fill("Rosa");
  await page.getByLabel("Year they were born").fill("1948");
  const hometown = page.getByLabel("Where they grew up");
  await hometown.fill("Mexico City");
  await page.getByRole("option", { name: /Mexico City/ }).first().click();
  const favorite = page.getByLabel(/Things they loved/);
  await favorite.fill("Pedro Infante");
  await page.getByRole("option", { name: /Pedro Infante/ }).first().click();
  await page.getByRole("button", { name: "Make their session" }).click();
  await startSession(page);
  const titles = await deckTitles(page);
  expect(titles.length).toBeGreaterThanOrEqual(8);
  for (const wrong of ["The Beatles", "Eiffel Tower", "Café de Flore", "Paris"]) expect(titles).not.toContain(wrong);
  expect(titles).toContain("Jorge Negrete");
  await expect(page.getByTestId("memory-card")).toContainText("Pedro Infante");
});

test("the programme strip keeps long titles readable and fully named", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preset-frank").click();
  await startSession(page);
  const strip = page.getByTestId("deck-strip");
  const buttons = strip.locator("li button");
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    const title = await button.locator('[data-testid="strip-title"]').innerText();
    expect(await button.getAttribute("title")).toBe(title.replace(/\s*new$/i, "").trim());
    expect(await button.getAttribute("aria-label")).toContain(title.replace(/\s*new$/i, "").trim());
  }
  // No title spills past its two lines; hovering lets a clamped one run on.
  const longest = (await strip.locator('[data-testid="strip-title"]').evaluateAll((els) => els.map((el, i) => ({ i, length: el.textContent?.length ?? 0 })))).sort((a, b) => b.length - a.length)[0]!;
  const span = strip.locator('[data-testid="strip-title"]').nth(longest.i);
  const clamped = await span.evaluate((el) => el.scrollHeight > el.clientHeight);
  if (clamped) {
    await span.hover();
    await expect.poll(() => span.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  }
});

test("session pages for unknown ids explain that sessions stay on the device", async ({ page }) => {
  await page.goto("/session/does-not-exist");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("isn't on this device");
  await expect(page.getByRole("link", { name: "Build a new session" })).toBeVisible();
});

test("reacting to every card ends in a calm Session complete screen with a printable summary", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preset-frank").click();
  await startSession(page);
  const total = await page.getByTestId("deck-strip").locator("li").count();
  for (let i = 0; i < total; i++) {
    const title = await page.getByTestId("card-title").innerText();
    const button = page.getByTestId(i % 3 === 2 ? "react-not-this" : "react-lit-up");
    await expect(button).toBeEnabled();
    await button.click();
    // No "Next" needed, and no waiting for the re-tune: the deck moves on by itself at once.
    if (i < total - 1) await expect(page.getByTestId("card-title")).not.toHaveText(title, { timeout: 3_000 });
  }
  // The last reaction ends the session by itself, after a beat.
  const complete = page.getByTestId("session-complete");
  await expect(complete).toBeVisible();
  await expect(complete.getByRole("heading", { level: 2, name: "Session complete" })).toBeVisible();
  await expect(page.getByTestId("complete-thanks")).toContainText("Frank");
  const keepsake = page.getByTestId("keepsake");
  await expect(keepsake).toContainText("What lit Frank up today");
  expect(await keepsake.getByTestId("keepsake-moment").count()).toBeGreaterThanOrEqual(5);
  await expect(keepsake.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
  await expect(complete.getByRole("link", { name: "Start another session" })).toHaveAttribute("href", "/");

  // It survives a reload, and "Done" leaves the session for the start page.
  await page.reload();
  await expect(page.getByTestId("session-complete")).toBeVisible();
  await page.getByTestId("session-done").click();
  await expect(page).toHaveURL(/\/$/);
});

test("the last card can end the session before every card has a reaction", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preset-frank").click();
  await startSession(page);
  const total = await page.getByTestId("deck-strip").locator("li").count();
  for (let i = 0; i < total - 1; i++) await page.getByTestId("next-card").click();
  await page.getByTestId("finish-session").click();
  await expect(page.getByTestId("session-complete")).toBeVisible();
  await expect(page.getByTestId("keepsake")).toContainText("Nothing landed for Frank today");
  await expect(page.getByTestId("back-to-cards")).toHaveCount(0);
});

test("when Qloo has too little for a person, planning ends in a kind empty state with a way on", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/plan", (route) => {
    attempts += 1;
    const lines = [
      { type: "trace", event: { id: "t1", at: 1, phase: "plan", kind: "narration", summary: "Asking Qloo for films from 1960 to 1975." } },
      { type: "error", code: "empty", message: "Qloo returned too little to build a session" },
    ];
    return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines.map((l) => JSON.stringify(l)).join("\n") });
  });
  await page.goto("/");
  await page.getByTestId("preset-frank").click();
  const empty = page.getByTestId("build-failed");
  await expect(empty).toHaveAttribute("data-code", "empty");
  await expect(empty).toContainText("Qloo didn't find enough from Frank's years to fill a session");
  await expect(empty).not.toContainText("returned too little");
  await expect(empty.getByRole("link", { name: "New session" })).toBeVisible();
  await empty.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => attempts).toBe(2);
});

test("the model's prompts land on the dealt cards in place, and its markup never reaches the screen", async ({ page }) => {
  await page.route("**/api/plan", async (route) => {
    const response = await route.fetch();
    const lines = (await response.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as { type: string; result?: { cards: { id: string }[] } });
    const plan = lines.find((l) => l.type === "plan")!;
    const leak = { type: "trace", event: { id: "leak", at: 1, phase: "plan", kind: "narration", policy: "llm", summary: '<｜DSML｜invoke name="plan_session"><｜DSML｜parameter name="cards">[{"entity_id": "x"}]' } };
    const prompts = { type: "prompts", prompts: [{ cardId: plan.result!.cards[0]!.id, prompt: "Who did you sing these songs with, back home?" }], trace: [] };
    const body = [leak, ...lines, prompts].map((l) => JSON.stringify(l)).join("\n");
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
  });
  await page.goto("/");
  await page.getByTestId("preset-michiko").click();
  await startSession(page);
  await expect(page.getByTestId("card-prompt")).toHaveText("Who did you sing these songs with, back home?");
  await page.getByTestId("why-qloo-toggle").click();
  await expect(page.getByTestId("trace-timeline")).not.toContainText("DSML");
  await expect(page.getByTestId("trace-policy")).toContainText("prompts written by a model");
});

test("planning stops at a session-ready overview; nothing opens card 1 until Start", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("hero-preset-michiko").click();
  const overview = page.getByTestId("session-overview");
  await expect(overview).toBeVisible({ timeout: 45_000 });
  // Give an auto-open a chance to happen: it must not.
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId("memory-card")).toHaveCount(0);
  await expect(overview).toContainText("Michiko's session is ready");

  // How Qloo built it, and the lineup: grouped by kind, each card with its Qloo line.
  await expect(page.getByTestId("overview-built")).toContainText("Qloo call");
  const cards = page.getByTestId("overview-card");
  const total = await cards.count();
  expect(total).toBeGreaterThanOrEqual(8);
  expect(await page.getByTestId("overview-lineup").locator("section").count()).toBeGreaterThanOrEqual(3);
  await expect(cards.first()).toContainText("From Qloo:");

  // Drop a card, then put it back.
  const firstTitle = await cards.first().getByTestId("overview-title").innerText();
  await cards.first().getByTestId("drop-card").click();
  await expect(cards).toHaveCount(total - 1);
  await expect(page.getByTestId("overview-dropped")).toContainText(firstTitle);
  await page.getByTestId("undo-drop").click();
  await expect(cards).toHaveCount(total);

  // Swap one card for another of its kind, in the same place; the rest of the lineup stays put.
  const before = await page.getByTestId("overview-title").allInnerTexts();
  const swapTitle = before[2]!;
  const swapPosition = (await cards.nth(2).locator(".label").first().textContent())!;
  await cards.nth(2).getByTestId("swap-card").click();
  await expect(page.getByTestId("overview-notice")).toContainText(`Swapped ${swapTitle} for`);
  await expect(cards).toHaveCount(total);
  const after = await page.getByTestId("overview-title").allInnerTexts();
  expect(after).not.toContain(swapTitle);
  expect(after.filter((t, i) => t !== before[i])).toHaveLength(1);
  await expect(cards.nth(2).locator(".label").first()).toHaveText(swapPosition);

  // Drop a different one for good, shuffle, and survive a reload still on the overview.
  const dropTitle = await cards.nth(1).getByTestId("overview-title").innerText();
  await cards.nth(1).getByTestId("drop-card").click();
  await expect(cards).toHaveCount(total - 1);
  await page.getByTestId("shuffle-order").click();
  await page.reload();
  await expect(page.getByTestId("session-overview")).toBeVisible();
  await expect(page.getByTestId("memory-card")).toHaveCount(0);
  await expect(page.getByTestId("overview-card")).toHaveCount(total - 1);

  // Start opens the first card of the deck as arranged, without the dropped one.
  await page.getByTestId("start-session").click();
  await expect(page.getByTestId("memory-card")).toBeVisible();
  const titles = await deckTitles(page);
  expect(titles.length).toBe(total - 1);
  expect(titles).not.toContain(dropTitle);
  await expect(page.getByTestId("card-title")).toHaveText(titles[0]!);
  await page.reload();
  await expect(page.getByTestId("memory-card")).toBeVisible();
});

test("the overview fits a phone: no sideways scroll, a tappable Start above the fold", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("hero-preset-frank").click();
  await expect(page.getByTestId("session-overview")).toBeVisible({ timeout: 45_000 });
  const start = page.getByTestId("start-session");
  await expect(start).toBeInViewport();
  expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(56);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const drop = page.getByTestId("drop-card").first();
  expect((await drop.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const swap = page.getByTestId("swap-card").first();
  expect((await swap.boundingBox())!.height).toBeGreaterThanOrEqual(47.5);
});
