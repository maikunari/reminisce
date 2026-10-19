import type { Metadata, Viewport } from "next";
import { Fraunces, Libre_Franklin } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

/* Display and reading text: Fraunces, used quietly (weight 500, SOFT 40, optical sizing on). */
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz", "SOFT", "WONK"],
  display: "swap",
});

/* Everything functional: labels, buttons, inputs, hints, the panel. Lining numerals via CSS. */
const franklin = Libre_Franklin({
  variable: "--font-franklin",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

/**
 * Absolute base for Open Graph URLs. Vercel exposes the production hostname
 * at build time; NEXT_PUBLIC_SITE_URL overrides it; local builds fall back to
 * localhost. No deploy is created or assumed here.
 */
function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return new URL(explicit);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return new URL(`https://${vercel}`);
  return new URL("http://localhost:3000");
}

/** The home page's hero at 1200x630, from public/. metadataBase makes the URL absolute. */
const OG_IMAGE = "/og.png";
const OG_ALT = "Reminisce: Music and memories from when they were twenty, beside a record sleeve, a film ticket and a postcard.";

export const metadata: Metadata = {
  title: {
    default: "Reminisce",
    template: "%s · Reminisce",
  },
  description:
    "Music and memories from when they were twenty. A cultural memory session builder for dementia caregivers, powered by the Qloo taste graph.",
  applicationName: "Reminisce",
  metadataBase: siteUrl(),
  openGraph: {
    title: "Reminisce",
    description: "Music and memories from when they were twenty.",
    type: "website",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: OG_ALT }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Reminisce",
    description: "Music and memories from when they were twenty.",
    images: [{ url: OG_IMAGE, alt: OG_ALT }],
  },
};

export const viewport: Viewport = {
  themeColor: "#fbf7ef",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children, masthead, footer }: { children: ReactNode; masthead: ReactNode; footer: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${franklin.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-ember-600 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        {masthead}
        {/* The one main landmark: pages render inside it, because Next keeps the previous page mounted (hidden) after a client-side navigation and a main per page would leave two ids behind. Each page's masthead and footer come through the @masthead and @footer slots, outside it. */}
        <main id="main" tabIndex={-1} className="flex flex-1 flex-col outline-none">
          {children}
        </main>
        {footer}
      </body>
    </html>
  );
}
