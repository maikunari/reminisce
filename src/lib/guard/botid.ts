/**
 * Vercel BotID (Basic, free on every plan) on the two expensive routes. The
 * check only runs on Vercel: elsewhere the package needs an OIDC token it
 * cannot have. It also fails open, because a human must never see an error
 * page over a classifier hiccup; the daily budget bounds whatever gets by.
 * NEXT_PUBLIC_BOTID=off disables it on both sides (see instrumentation-client.ts).
 */
import { checkBotId } from "botid/server";

export function botIdEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL === "1" && (env.NEXT_PUBLIC_BOTID ?? "").trim().toLowerCase() !== "off";
}

export async function looksLikeBot(): Promise<boolean> {
  if (!botIdEnabled()) return false;
  try {
    const verdict = await checkBotId();
    return verdict.isBot;
  } catch (error) {
    console.error("[botid] check failed; allowing the request", error);
    return false;
  }
}
