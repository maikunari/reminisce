import Link from "next/link";

/** The wordmark: Fraunces with a 10px ember dot. No disc, no note. */
export function Logo() {
  return (
    <Link href="/" className="wordmark">
      <i aria-hidden="true" />
      Reminisce
    </Link>
  );
}
