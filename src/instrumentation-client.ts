/**
 * Vercel BotID (Basic): attaches an invisible classification to the browser's
 * own calls to the two expensive routes. The wrapper waits for the challenge
 * before sending a protected request, so a build that cannot reach the
 * challenge script could not plan at all; development builds therefore skip
 * it and keep working offline, and NEXT_PUBLIC_BOTID=off turns it off in any
 * build. The server side (src/lib/guard/botid.ts) honours the same switch
 * and checks the classification only on Vercel.
 */
import { initBotId } from "botid/client/core";

if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_BOTID !== "off") {
  initBotId({
    protect: [
      { path: "/api/plan", method: "POST" },
      { path: "/api/adapt", method: "POST" },
    ],
  });
}
