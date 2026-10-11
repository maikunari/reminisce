"use client";

import { useState } from "react";

import { DOMAIN_STYLE } from "@/lib/session/domain-style";
import type { Domain } from "@/lib/session/types";

import { DomainIcon } from "./DomainIcon";

interface Props {
  title: string;
  domain: Domain;
  imageUrl?: string;
  year?: number;
  className?: string;
  /** Large art for the main card, or a small thumbnail for the deck strip. */
  variant?: "hero" | "thumb";
}

/**
 * Poster or album art from the Qloo image URL when present, otherwise a warm
 * typographic placeholder in the domain's colour. Never a broken image.
 */
export function CardArt({ title, domain, imageUrl, year, className = "", variant = "hero" }: Props) {
  const [failed, setFailed] = useState(false);
  const style = DOMAIN_STYLE[domain];
  const initial = [...title.trim()][0]?.toUpperCase() ?? "?";
  const showImage = imageUrl && !failed;
  const hero = variant === "hero";

  return (
    <div className={`relative overflow-hidden bg-gradient-to-br ${style.gradient} ${className}`}>
      {showImage ? (
        // Qloo serves images from its own CDN hosts; a plain <img> with a
        // graceful fallback is more robust than next/image here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          loading={hero ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <DomainIcon domain={domain} className={`absolute ${hero ? "h-72 w-72 -right-10 -bottom-12" : "h-20 w-20 -right-3 -bottom-3"} text-white/15`} />
          <span className={`font-display italic text-white drop-shadow-sm ${hero ? "text-[9rem] leading-none" : "text-4xl"}`}>{initial}</span>
        </div>
      )}
      {hero && year ? (
        <span className="absolute top-4 left-4 rounded-full bg-ink-900/80 px-3.5 py-1.5 text-base font-bold text-white backdrop-blur">
          {year}
        </span>
      ) : null}
    </div>
  );
}
