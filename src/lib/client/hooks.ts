"use client";

import { useSyncExternalStore } from "react";

const subscribeToNothing = () => () => {};

/**
 * True once the component is running in the browser after hydration, false
 * during prerendering and the hydration pass. Lets components that depend on
 * localStorage mount only on the client without a setState-in-effect dance.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
}

/**
 * The current calendar year in the browser, or null while prerendering.
 * Next.js refuses to bake `new Date()` into a static prerender (it would be
 * frozen at build time), so the year is read only on the client.
 */
export function useCurrentYear(): number | null {
  return useSyncExternalStore(
    subscribeToNothing,
    () => new Date().getUTCFullYear(),
    () => null,
  );
}
