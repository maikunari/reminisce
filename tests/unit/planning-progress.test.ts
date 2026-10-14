import { describe, expect, it } from "vitest";

import { planningProgress } from "@/lib/session/planning-progress";
import type { TraceEvent, TraceQloo } from "@/lib/session/types";

let n = 0;
function ev(partial: Partial<TraceEvent> & Pick<TraceEvent, "kind">): TraceEvent {
  n += 1;
  return { id: `e${n}`, at: n, phase: "plan", summary: "", ...partial };
}

function qloo(type: string, resultCount: number, extra: Record<string, string> = {}): TraceQloo {
  return { path: "/v2/insights", params: { "filter.type": type, ...extra }, source: "live", status: 200, durationMs: 300, resultCount, warnings: [] };
}

describe("planningProgress", () => {
  it("moves each domain forward in place: waiting, asking, then found or empty", () => {
    const events = [
      ev({ kind: "narration", summary: "Asking Qloo for television shows of the era." }),
      ev({ kind: "tool_call", tool: "qloo_insights", domain: "tv" }),
      ev({ kind: "tool_result", tool: "qloo_insights", domain: "tv", summary: "0 TV shows; asking again without the hometown signal", qloo: qloo("urn:entity:tv_show", 0) }),
    ];
    let p = planningProgress(events);
    expect(p.domains.find((d) => d.domain === "tv")?.status).toBe("asking");
    expect(p.domains.find((d) => d.domain === "music")?.status).toBe("waiting");
    expect(p.narration).toBe("Asking Qloo for television shows of the era.");

    events.push(
      ev({
        kind: "tool_result",
        tool: "qloo_insights",
        domain: "tv",
        qloo: qloo("urn:entity:tv_show", 8),
        preview: [{ name: "All in the Family", year: 1971 }, { name: "Peyton Place", year: 1964 }],
      }),
      ev({ kind: "tool_call", tool: "qloo_insights", domain: "place" }),
      ev({ kind: "tool_result", tool: "qloo_insights", domain: "place", qloo: qloo("urn:entity:place", 0), preview: [] }),
    );
    p = planningProgress(events);
    const tv = p.domains.find((d) => d.domain === "tv")!;
    expect(tv).toMatchObject({ status: "found", count: 8 });
    expect(tv.items[0]?.name).toBe("All in the Family");
    expect(p.domains.find((d) => d.domain === "place")?.status).toBe("empty");
    expect(p.settled).toBe(2);
    expect(p.qlooCalls).toBe(3);
  });

  it("keeps the first answer that filled a sleeve when the same domain is asked again", () => {
    const p = planningProgress([
      ev({ kind: "tool_result", domain: "music", qloo: qloo("urn:entity:artist", 10), preview: [{ name: "Tony Bennett" }] }),
      ev({ kind: "tool_result", domain: "music", qloo: qloo("urn:entity:artist", 0), preview: [] }),
    ]);
    expect(p.domains.find((d) => d.domain === "music")).toMatchObject({ status: "found", count: 10, items: [{ name: "Tony Bennett" }] });
  });

  it("reads a replayed trace from before previews by its request alone", () => {
    const p = planningProgress([
      ev({ kind: "tool_result", qloo: qloo("urn:entity:place", 8, { "filter.tags": "urn:tag:genre:place:restaurant" }) }),
      ev({ kind: "tool_result", qloo: qloo("urn:entity:place", 6, { "filter.tags": "urn:tag:category:place:landmark" }) }),
    ]);
    expect(p.domains.find((d) => d.domain === "dining")).toMatchObject({ status: "found", count: 8, items: [] });
    expect(p.domains.find((d) => d.domain === "place")).toMatchObject({ status: "found", count: 6 });
  });
});
