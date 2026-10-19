import type { NextRequest } from "next/server";

import { searchCacheControl } from "@/lib/api/cache-control";
import { jsonError } from "@/lib/api/stream";
import { openGuard } from "@/lib/guard/runtime";
import { QlooError } from "@/lib/qloo/client";
import { QLOO_SEARCH_TYPES, entityImageUrl, entityYear, genreTagIdsOf, type QlooSearchType } from "@/lib/qloo/types";

export const maxDuration = 30;

function isSearchType(value: string): value is QlooSearchType {
  return (QLOO_SEARCH_TYPES as readonly string[]).includes(value);
}

/** Entity autocomplete for the intake form: proxies Qloo `GET /search`. */
export async function GET(request: NextRequest): Promise<Response> {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  const types = (request.nextUrl.searchParams.get("types") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(isSearchType);
  if (q.length < 2) return Response.json({ results: [], source: null });
  try {
    const guard = await openGuard("search");
    const res = await guard.qloo.search(q.slice(0, 120), { types: types.length > 0 ? types : undefined, take: 8 });
    const results = res.body.results.map((r) => ({
      entityId: r.entity_id,
      name: r.name,
      type: r.types[0] ?? "",
      year: entityYear(r),
      imageUrl: entityImageUrl(r),
      genres: genreTagIdsOf(r.tags),
      disambiguation: r.disambiguation,
      description: r.properties?.short_description ?? r.properties?.description,
    }));
    return Response.json(
      { results, source: res.source, cached: res.cached === true },
      { headers: { "Cache-Control": searchCacheControl(res), "X-Qloo-Cache": res.source === "live" ? (res.cached ? "hit" : "miss") : "none" } },
    );
  } catch (error) {
    if (error instanceof QlooError) return jsonError(502, `Qloo search failed (${error.status})`);
    return jsonError(500, error instanceof Error ? error.message : "search failed");
  }
}
