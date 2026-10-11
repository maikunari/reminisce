import { expect, test, type Page } from "@playwright/test";

const PRESETS = [
  { id: "michiko", name: "Michiko", hometown: "Osaka", seed: "Hibari Misora" },
  { id: "frank", name: "Frank", hometown: "Chicago", seed: "Frank Sinatra" },
];

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
    await page.getByTestId(`preset-${preset.id}`).click();
    await expect(page).toHaveURL(/\/session\/[a-z0-9-]+/);
    await expect(page.getByTestId("person-summary")).toContainText(preset.hometown);

    // The deck appears (planning streams trace events first).
    await expect(page.getByTestId("memory-card")).toBeVisible({ timeout: 45_000 });
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

    // Feedback re-tunes upcoming cards, then the deck moves on by itself.
    const before = await deckTitles(page);
    const currentTitle = await page.getByTestId("card-title").innerText();
    await page.getByTestId("react-lit-up").click();
    await expect(page.getByTestId("react-lit-up")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("react-lit-up")).toBeDisabled();
    await expect(page.getByTestId("notice")).toContainText(/of the next cards now lean/, { timeout: 45_000 });
    const after = await deckTitles(page);
    expect(after).not.toEqual(before);
    expect(after[0]).toBe(before[0]);
    expect(after.length).toBe(before.length);
    await expect(page.getByTestId("card-title")).not.toHaveText(currentTitle, { timeout: 5_000 });
    await expect(page.getByTestId("card-title")).toHaveText(after[1]!);
    await expect(page.getByTestId("react-lit-up")).toHaveAttribute("aria-pressed", "false");

    // Keyboard navigation and persistence across reload.
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("card-title")).toHaveText(currentTitle);
    await page.keyboard.press("ArrowRight");
    const secondTitle = await page.getByTestId("card-title").innerText();
    expect(secondTitle).toBe(after[1]);
    await page.reload();
    await expect(page.getByTestId("memory-card")).toBeVisible();
    await expect(page.getByTestId("card-title")).toHaveText(secondTitle);
    expect(await deckTitles(page)).toEqual(after);
  });
}

test("the two presets produce culturally different sessions", async ({ page }) => {
  const sets: string[][] = [];
  for (const preset of PRESETS) {
    await page.goto("/");
    await page.getByTestId(`preset-${preset.id}`).click();
    await expect(page.getByTestId("memory-card")).toBeVisible({ timeout: 45_000 });
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
  await expect(page.getByTestId("memory-card")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("card-prompt")).toHaveText(/[¿?]/);
  await expect(page.getByTestId("person-summary")).toContainText("Madrid");
  // Not only the prompt: the chrome, the buttons and the Why Qloo panel speak Spanish too.
  await expect(page.getByTestId("session-root")).toHaveAttribute("lang", "es");
  await expect(page.getByTestId("react-lit-up")).toHaveText(/Le encantó/);
  await expect(page.getByTestId("react-not-this")).toHaveText("Esta no");
  await expect(page.getByRole("navigation", { name: "Tarjetas de la sesión" })).toBeVisible();
  await expect(page.getByTestId("memory-card")).toContainText("De Qloo:");
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
  await expect(page.getByTestId("memory-card")).toBeVisible({ timeout: 45_000 });
  const titles = await deckTitles(page);
  expect(titles.length).toBeGreaterThanOrEqual(8);
  for (const wrong of ["The Beatles", "Eiffel Tower", "Café de Flore", "Paris"]) expect(titles).not.toContain(wrong);
  expect(titles).toContain("Jorge Negrete");
  await expect(page.getByTestId("memory-card")).toContainText("Pedro Infante");
});

test("the programme strip keeps long titles readable and fully named", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preset-frank").click();
  await expect(page.getByTestId("memory-card")).toBeVisible({ timeout: 45_000 });
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

test("reacting to every card ends in a printable keepsake", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preset-frank").click();
  await expect(page.getByTestId("memory-card")).toBeVisible({ timeout: 45_000 });
  const total = await page.getByTestId("deck-strip").locator("li").count();
  for (let i = 0; i < total; i++) {
    const title = await page.getByTestId("card-title").innerText();
    const button = page.getByTestId(i % 3 === 2 ? "react-not-this" : "react-lit-up");
    await expect(button).toBeEnabled();
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("retuning-banner")).toBeHidden({ timeout: 45_000 });
    // No "Next" needed: the deck moves on by itself once the re-tune is done.
    if (i < total - 1) await expect(page.getByTestId("card-title")).not.toHaveText(title, { timeout: 5_000 });
  }
  const keepsake = page.getByTestId("keepsake");
  await expect(keepsake).toBeVisible();
  await expect(keepsake).toContainText("What lit Frank up today");
  expect(await keepsake.locator("ol li").count()).toBeGreaterThanOrEqual(5);
  await expect(keepsake.getByRole("button", { name: "Print for the care file" })).toBeVisible();
});
