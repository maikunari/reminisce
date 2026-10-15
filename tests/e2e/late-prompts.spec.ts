import { expect, test } from "@playwright/test";

import { PRESETS } from "../../src/lib/session/presets";
import type { PlanResult, StreamEvent } from "../../src/lib/session/types";

/**
 * The plan stream deals the deck first and the model's prompts follow seconds
 * later, after the deck is already on screen. A mocked stream that sends
 * `prompts` well after `plan` must still put the model's words on the cards.
 */
test("model prompts that arrive after the deck is dealt replace the templates, card 1 included", async ({ page, request }) => {
  const person = PRESETS.find((p) => p.id === "frank")!.person;
  const real = await request.post("/api/plan", { data: { person } });
  expect(real.ok()).toBe(true);
  const events = (await real.text())
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as StreamEvent);
  const plan = events.find((e): e is Extract<StreamEvent, { type: "plan" }> => e.type === "plan")!.result as PlanResult;
  const prompts = plan.cards.map((c, i) => ({ cardId: c.id, prompt: `Model prompt ${i + 1} for ${c.title}` }));
  const lines = [...events.filter((e) => e.type === "trace"), { type: "plan", result: plan }].map((e) => JSON.stringify(e) + "\n");
  const late = JSON.stringify({ type: "prompts", prompts, trace: [] }) + "\n";

  await page.addInitScript(
    ({ lines, late }) => {
      const realFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.endsWith("/api/plan")) return realFetch(input, init);
        const enc = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            // Like a real fetch, the stream dies when the page aborts it.
            let aborted = false;
            init?.signal?.addEventListener("abort", () => {
              aborted = true;
              controller.error(new DOMException("Aborted", "AbortError"));
            });
            for (const line of lines) controller.enqueue(enc.encode(line));
            // Well past the hold before the deck appears, as the model's answer is in production.
            await new Promise((r) => setTimeout(r, 3_000));
            if (aborted) return;
            controller.enqueue(enc.encode(late));
            controller.close();
          },
        });
        return Promise.resolve(new Response(stream, { status: 200, headers: { "Content-Type": "application/x-ndjson" } }));
      };
    },
    { lines, late },
  );

  await page.goto("/");
  await page.getByTestId("preset-frank").click();
  await expect(page.getByTestId("memory-card")).toBeVisible({ timeout: 45_000 });
  // The deck is up on templates first.
  await expect(page.getByTestId("card-prompt")).not.toContainText("Model prompt");
  await page.getByTestId("why-qloo-toggle").click();
  await expect(page.getByTestId("trace-policy")).toContainText("prompts from templates");
  await expect(page.getByTestId("trace-prompt-source")).toHaveText("Prompt written from a template, not by a model");

  await expect(page.getByTestId("card-prompt")).toHaveText(`Model prompt 1 for ${plan.cards[0]!.title}`, { timeout: 10_000 });
  await expect(page.getByTestId("trace-policy")).toContainText("prompts written by a model");
  await expect(page.getByTestId("trace-prompt-source")).toHaveCount(0);
  await page.getByTestId("next-card").click();
  await expect(page.getByTestId("card-prompt")).toHaveText(`Model prompt 2 for ${plan.cards[1]!.title}`);
});
