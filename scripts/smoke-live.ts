/**
 * Live smoke test: three people through planSession against the real Qloo
 * hackathon API, with no model (LLM_MODE=fixture), asserting what a judge
 * would see. Fixtures and live Qloo have diverged before, and nothing in CI
 * can notice that; run this before submitting and weekly while judging.
 *
 *   QLOO_API_KEY=... npm run smoke:live
 *
 * Reads QLOO_API_KEY from the environment (or .env.local). About 15 Qloo
 * calls per person, 45 in all, from the hackathon's 10,000 a month. Exits 1
 * when any check fails. Never part of CI or `npm test`; the responses are
 * not recorded or written anywhere.
 */
import { planSession } from "../src/lib/agent";
import { readServerEnv } from "../src/lib/env";
import { QlooClient, type QlooResult } from "../src/lib/qloo/client";
import type { InsightsRequest } from "../src/lib/qloo/params";
import type { QlooEntity, QlooInsightsResponse } from "../src/lib/qloo/types";
import { PRESETS } from "../src/lib/session/presets";
import type { Person } from "../src/lib/session/types";
import { loadDotEnv } from "./dotenv";
import { checkPlan, type SmokeSpec } from "./smoke-checks";

const DAD: Person = { name: "Dad", birthYear: 1940, hometown: "London", favorites: [{ name: "Lonnie Donegan" }], language: "en", pronoun: "he" };

const HOME_COUNTRY: Record<string, string> = { michiko: "Japan", frank: "United States" };

const SPECS: SmokeSpec[] = [
  ...PRESETS.map((p) => ({ person: p.person, homeCountry: HOME_COUNTRY[p.id] ?? "" })),
  { person: DAD, homeCountry: "United Kingdom", era: { country: "United Kingdom", before: 1965 } },
];

/** A live client that keeps every entity it is handed, so the checks can read properties a card does not carry. */
class WatchingClient extends QlooClient {
  readonly entities = new Map<string, QlooEntity>();
  override async insights(req: InsightsRequest, opts: { deadline?: number } = {}): Promise<QlooResult<QlooInsightsResponse>> {
    const result = await super.insights(req, opts);
    for (const entity of result.body.results.entities) if (!this.entities.has(entity.entity_id)) this.entities.set(entity.entity_id, entity);
    return result;
  }
}

async function main(): Promise<void> {
  await loadDotEnv();
  const env = readServerEnv({ ...process.env, QLOO_MODE: "live", LLM_MODE: "fixture" });
  if (!env.qlooApiKey) {
    console.error("QLOO_API_KEY is not set. Export it (or add it to .env.local), then re-run.");
    process.exit(1);
  }
  let failed = 0;
  for (const spec of SPECS) {
    const { person } = spec;
    const qloo = new WatchingClient({ mode: "live", apiKey: env.qlooApiKey, baseUrl: env.qlooBaseUrl });
    console.log(`\n${person.name} (${person.birthYear}, ${person.hometown}, loved ${person.favorites.map((f) => f.name).join(", ")})`);
    try {
      const plan = await planSession(person, { env, qloo });
      const report = checkPlan(spec, plan, qloo.entities);
      for (const line of report.lines) console.log(`  ${line}`);
      console.log(`  ${plan.cards.length} cards, ${report.liveCalls} live Qloo calls`);
      for (const failure of report.failures) console.log(`  FAIL ${failure}`);
      if (report.failures.length > 0) failed += 1;
      else console.log("  ok");
    } catch (error) {
      console.log(`  FAIL planSession threw: ${error instanceof Error ? error.message : String(error)}`);
      failed += 1;
    }
  }
  console.log(failed === 0 ? `\nSmoke test passed for ${SPECS.length} people.` : `\nSmoke test FAILED for ${failed} of ${SPECS.length} people.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
