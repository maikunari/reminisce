export function Footer() {
  return (
    <footer className="print-hide mt-16 border-t border-paper-300 pt-6 pb-12 text-sm leading-relaxed text-ink-500 sm:mt-24">
      <p>
        <strong className="text-ink-700">Reminisce is a conversation aid, not medical advice or treatment.</strong> Reminiscence and music
        activities are widely used in dementia care; the evidence for specific benefits is mixed and modest. Follow the person&apos;s lead, and stop
        if anything upsets them.
      </p>
      <p className="mt-3">
        Sessions stay in this browser. No personal details are stored on a server. Recommendations come from the{" "}
        <a className="font-semibold text-ember-700 underline decoration-paper-300 underline-offset-4" href="https://docs.qloo.com/" rel="noreferrer">
          Qloo Insights API
        </a>
        . Built for the Qloo Agentic Hackathon ·{" "}
        <a className="font-semibold text-ember-700 underline decoration-paper-300 underline-offset-4" href="https://github.com/maikunari/reminisce" rel="noreferrer">
          source on GitHub
        </a>{" "}
        (MIT).
      </p>
    </footer>
  );
}
