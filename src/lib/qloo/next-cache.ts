/**
 * Response cache for the live Qloo client, backed by Next.js's persistent
 * fetch cache: on Vercel that is the Data Cache (shared by every instance of
 * the function, kept across deployments, free on all plans). The hackathon
 * guide allows private server-side caching with no time limit, so entries
 * live for 30 days and can be dropped at once with `revalidateTag("qloo")`.
 *
 * Only route handlers call this; the client itself never imports Next.
 */
import { unstable_cache } from "next/cache";

import type { QlooResponseCache } from "./client";

export const QLOO_CACHE_TAG = "qloo";
export const QLOO_CACHE_REVALIDATE_SECONDS = 30 * 24 * 60 * 60;

export function createNextQlooCache(): QlooResponseCache {
  return {
    async wrap<T>(key: string, produce: () => Promise<T>): Promise<T> {
      // The argument is what keys the entry, so it stays even though the body never reads it.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const read = unstable_cache(async (requestKey: string) => produce(), ["qloo-response"], {
        revalidate: QLOO_CACHE_REVALIDATE_SECONDS,
        tags: [QLOO_CACHE_TAG],
      });
      try {
        return await read(key);
      } catch (error) {
        // Outside the Next runtime (a script, a test) there is no cache to read; answer uncached.
        if (error instanceof Error && /incrementalCache missing/.test(error.message)) return produce();
        throw error;
      }
    },
  };
}
