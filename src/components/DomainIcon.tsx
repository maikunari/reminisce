import type { Domain } from "@/lib/session/types";

const PATHS: Record<Domain, string> = {
  music: "M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  film: "M4 5h16v14H4zM4 9h16M4 15h16M8 5v14M16 5v14",
  tv: "M4 7h16v11H4zM8 21h8M9 3l3 4 3-4",
  dining: "M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 2-3 5v3h3v10",
  place: "M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  destination: "M3 8h18v12H3zM9 8V5a3 3 0 0 1 6 0v3M3 13h18",
};

export function DomainIcon({ domain, className = "h-5 w-5" }: { domain: Domain; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={PATHS[domain]} />
    </svg>
  );
}
