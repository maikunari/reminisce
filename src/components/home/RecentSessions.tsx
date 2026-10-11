"use client";

import Link from "next/link";
import { useState } from "react";

import { useIsClient } from "@/lib/client/hooks";
import { listSessions } from "@/lib/session/storage";

/** Sessions live in localStorage, so the list can only be read in the browser. */
export function RecentSessions() {
  const isClient = useIsClient();
  return isClient ? <RecentSessionsList /> : null;
}

function RecentSessionsList() {
  const [sessions] = useState(() => listSessions());
  if (sessions.length === 0) return null;
  return (
    <section aria-labelledby="recent-heading" className="mt-16">
      <h2 id="recent-heading" className="font-display text-3xl font-semibold text-ink-900">
        Recent sessions on this device
      </h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sessions.slice(0, 6).map((s) => (
          <li key={s.id}>
            <Link
              href={`/session/${s.id}`}
              className="flex items-center justify-between rounded-2xl bg-white px-5 py-4 text-lg shadow-card ring-1 ring-cream-300 hover:ring-ember-600"
            >
              <span>
                <span className="block font-bold text-ink-900">{s.name}</span>
                <span className="block text-base text-ink-500">
                  {s.cardCount} cards · {new Date(s.createdAt).toLocaleDateString()}
                </span>
              </span>
              <span aria-hidden="true" className="text-ember-600">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
