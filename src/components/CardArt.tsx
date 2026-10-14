"use client";

import { useEffect, useState } from "react";

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

/** Matches the photo's duration-500 fade. */
const PHOTO_FADE_MS = 500;

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
  // The photo fades in once it has loaded; until then the sleeve beneath it shows, never a blank box.
  const [loaded, setLoaded] = useState(false);
  const [settled, setSettled] = useState(false);
  // Once the photo has faded in, the sleeve beneath it goes, so a transparent image never shows it through.
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(() => setSettled(true), PHOTO_FADE_MS + 100);
    return () => window.clearTimeout(timer);
  }, [loaded]);
  const hero = variant === "hero";

  if (imageUrl && !failed) {
    const caption = [title, year ? String(year) : null].filter(Boolean).join(", ");
    return (
      <figure className={`photo ${className}`.trim()}>
        <div className="photo-well">
          {/* The domain's printed sleeve holds the frame until the photo arrives, then the photo fades in over it. */}
          {settled ? null : <Sleeve domain={domain} title={title} label={sleeveLabel(domain, year)} mini className="photo-wait" />}
          {/* Qloo serves images from its own CDN hosts; a plain <img> with a fallback is more robust than next/image here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            loading={hero ? "eager" : "lazy"}
            decoding="async"
            ref={(img) => {
              if (img?.complete && img.naturalWidth > 0) setLoaded(true);
            }}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
          />
        </div>
        {hero ? <figcaption>{caption}</figcaption> : null}
      </figure>
    );
  }

  return <Sleeve domain={domain} title={title} label={sleeveLabel(domain, year)} line={hero ? subtitle : undefined} mini={!hero} className={className} />;
}
