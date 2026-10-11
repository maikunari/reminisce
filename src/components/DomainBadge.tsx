import { DOMAIN_STYLE } from "@/lib/session/domain-style";
import { DOMAIN_INFO, type Domain } from "@/lib/session/types";

import { DomainIcon } from "./DomainIcon";

export function DomainBadge({ domain, size = "md" }: { domain: Domain; size?: "sm" | "md" }) {
  const style = DOMAIN_STYLE[domain];
  const pad = size === "sm" ? "px-2.5 py-1 text-sm" : "px-3.5 py-1.5 text-base";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-bold tracking-wide ${pad} ${style.chip}`}>
      <DomainIcon domain={domain} className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
      {DOMAIN_INFO[domain].label}
    </span>
  );
}
