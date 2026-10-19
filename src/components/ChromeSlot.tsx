"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

type Part = "masthead" | "footer";
type Fills = Partial<Record<Part, ReactNode>>;

let fills: Fills = {};
const listeners = new Set<() => void>();

function setFills(next: Fills) {
  fills = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A place in the root layout, outside the main landmark, that a client page fills with its masthead or footer. */
export function ChromeSlot({ part }: { part: Part }) {
  return useSyncExternalStore(subscribe, () => fills[part], () => undefined);
}

/** Fills the layout's masthead and footer slots from a page whose chrome depends on its own client state. */
export function ChromeFill({ masthead, footer }: Fills) {
  useEffect(() => {
    setFills({ masthead, footer });
    return () => setFills({});
  });
  return null;
}
