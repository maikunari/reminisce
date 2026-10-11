"use client";

import { useState } from "react";

import type { Domain } from "@/lib/session/types";

import { Sleeve } from "./Sleeve";

interface Props {
  title: string;
  domain: Domain;
  imageUrl?: string;
  year?: number;
  subtitle?: string;
  /** Large art for the main card, or a small thumbnail for the programme strip. */
  variant?: "hero" | "thumb";
  className?: string;
}

/** The small uppercase line on each sleeve, specific where the data allows (year, label). */
function sleeveLabel(domain: Domain, year?: number): string | undefined {
  switch (domain) {
    case "music":
      return "45 rpm";
    case "film":
      return year ? String(year) : "Feature";
    case "tv":
      return year ? String(year) : "Television";
    case "dining":
      return "Menu";
    case "destination":
      return year ? String(year) : "Bon voyage";
    case "place":
      return undefined;
  }
}

/**
 * A Qloo image when there is one, pasted into the album in a white matte with
 * an italic caption; otherwise printed ephemera for the domain. Never a broken
 * image, never a blank grey box.
 */
export function CardArt({ title, domain, imageUrl, year, subtitle, variant = "hero", className = "" }: Props) {
  const [failed, setFailed] = useState(false);
  const hero = variant === "hero";

  if (imageUrl && !failed) {
    const caption = [title, year ? String(year) : null].filter(Boolean).join(", ");
    return (
      <figure className={`photo ${className}`.trim()}>
        {/* Qloo serves images from its own CDN hosts; a plain <img> with a fallback is more robust than next/image here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="" loading={hero ? "eager" : "lazy"} decoding="async" onError={() => setFailed(true)} />
        {hero ? <figcaption>{caption}</figcaption> : null}
      </figure>
    );
  }

  return <Sleeve domain={domain} title={title} label={sleeveLabel(domain, year)} line={hero ? subtitle : undefined} mini={!hero} className={className} />;
}
