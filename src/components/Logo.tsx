import Link from "next/link";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-3 rounded-xl text-ink-900 no-underline">
      <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-ember-600 text-white shadow-card" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V6l11-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
      </span>
      <span className={`font-display font-semibold tracking-tight ${compact ? "text-2xl" : "text-3xl"}`}>Reminisce</span>
    </Link>
  );
}
