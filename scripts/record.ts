/**
 * Record real Qloo responses into fixtures/recorded/ so fixture mode can
 * replay them. Requires QLOO_API_KEY (read from the environment or .env.local).
 *
 *   npm run record                      # both presets + their autocomplete searches
 *   npm run record -- --preset frank    # one preset
 *   npm run record -- --search "Hibari Misora" --search "Osaka"
 *
 * The recorded files contain Qloo data and are git-ignored on purpose: the
 * hackathon guide asks that Qloo responses not be published in public repos.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { adaptSession, planSession } from "../src/lib/agent";
import { readServerEnv } from "../src/lib/env";
import { QlooClient } from "../src/lib/qloo/client";
import { DEFAULT_RECORDED_ROOT } from "../src/lib/qloo/fixtures";
import { PRESETS } from "../src/lib/session/presets";

const FAVORITE_TYPES = [
  "urn:entity:artist",
  "urn:entity:movie",
  "urn:entity:tv_show",
  "urn:entity:book",
  "urn:entity:person",
  "urn:entity:brand",
  "urn:entity:place",
];

async function loadDotEnv(): Promise<void> {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = await fs.readFile(path.join(process.cwd(), file), "utf8");
      for (const line of text.split("\n")) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        const key = m[1]!;
        let value = m[2] ?? "";
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (!(key in process.env)) process.env[key] = value;
      }
    } catch {
      // file absent
    }
  }
}

function parseArgs(argv: string[]) {
  const presets: string[] = [];
  const searches: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--preset") presets.push(argv[++i] ?? "");
    else if (a === "--search") searches.push(argv[++i] ?? "");
    else if (a === "--help" || a === "-h") {
      console.log("usage: npm run record -- [--preset <id>]... [--search <text>]...");
      process.exit(0);
    }
  }
  return { presets, searches };
}

async function main(): Promise<void> {
  await loadDotEnv();
  const env = readServerEnv({ ...process.env, QLOO_MODE: "live", LLM_MODE: "fixture" });
  if (!env.qlooApiKey) {
    console.error("QLOO_API_KEY is not set. Add it to .env.local or the environment, then re-run.");
    process.exit(1);
  }
  const { presets: presetIds, searches } = parseArgs(process.argv.slice(2));
  const qloo = new QlooClient({ mode: "live", apiKey: env.qlooApiKey, baseUrl: env.qlooBaseUrl, record: true });
  const targets = presetIds.length > 0 ? PRESETS.filter((p) => presetIds.includes(p.id)) : searches.length > 0 ? [] : PRESETS;
  if (presetIds.length > 0 && targets.length === 0) {
    console.error(`No preset matches ${presetIds.join(", ")}. Known: ${PRESETS.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }

  let calls = 0;
  const count = (label: string) => {
    calls += 1;
    console.log(`  recorded ${label}`);
  };

  for (const preset of targets) {
    console.log(`\nPreset ${preset.id}: planning with the deterministic agent against ${env.qlooBaseUrl}`);
    const plan = await planSession(preset.person, {
      env,
      qloo,
      emit: (e) => {
        if (e.qloo) count(`${e.qloo.path} (${e.qloo.resultCount} results, ${e.qloo.durationMs} ms)`);
      },
    });
    console.log(`  ${plan.cards.length} cards: ${plan.cards.map((c) => `${c.title} [${c.domain}]`).join(", ")}`);
    const person = { ...preset.person, favorites: plan.favorites };
    for (const [index, reaction] of [[0, "lit_up"], [1, "not_this"]] as const) {
      const card = plan.cards[index];
      if (!card) continue;
      const result = await adaptSession(
        { person, cards: plan.cards, feedback: { cardId: card.id, reaction }, currentIndex: index },
        {
          env,
          qloo,
          emit: (e) => {
            if (e.qloo) count(`${e.qloo.path} (${e.qloo.resultCount} results) [adapt ${reaction}]`);
          },
        },
      );
      console.log(`  adapt ${reaction} on "${card.title}": ${result.replacements.length} replacements`);
    }
    // Autocomplete searches a judge is likely to type.
    for (const fav of preset.person.favorites) {
      for (let len = 2; len <= Math.min(fav.name.length, 6); len++) {
        await qloo.search(fav.name.slice(0, len), { types: FAVORITE_TYPES, take: 8 });
        count(`/search "${fav.name.slice(0, len)}"`);
      }
    }
    for (let len = 2; len <= Math.min(preset.person.hometown.length, 6); len++) {
      await qloo.search(preset.person.hometown.slice(0, len), { types: ["urn:entity:locality"], take: 8 });
      count(`/search locality "${preset.person.hometown.slice(0, len)}"`);
    }
  }

  for (const term of searches) {
    await qloo.search(term, { types: FAVORITE_TYPES, take: 8 });
    count(`/search "${term}"`);
    await qloo.search(term, { types: ["urn:entity:locality"], take: 8 });
    count(`/search locality "${term}"`);
  }

  const files = (await fs.readdir(DEFAULT_RECORDED_ROOT)).filter((f) => f.endsWith(".json"));
  console.log(`\nDone. ${calls} live calls this run; ${files.length} recorded fixture file(s) in ${DEFAULT_RECORDED_ROOT}.`);
  console.log("These files are git-ignored (Qloo data must not be published). Set QLOO_MODE=fixture to replay them.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
