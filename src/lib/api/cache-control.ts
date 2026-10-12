import type { QlooResult } from "@/lib/qloo/client";

/**
 * Cache-Control for an autocomplete answer. A fixture answer or a cached
 * live answer is the same tomorrow, so the CDN may keep it for a day and
 * serve it for a week while refreshing. An answer the synthetic catalog gave
 * in place of a failed or over-budget live call is not kept, so the next
 * visitor after midnight gets Qloo back.
 */
export function searchCacheControl(res: Pick<QlooResult<unknown>, "fallback">): string {
  if (res.fallback) return "private, max-age=60";
  return "public, max-age=120, s-maxage=86400, stale-while-revalidate=604800";
}
