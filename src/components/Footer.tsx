import { dictionary } from "@/lib/i18n";
import type { Language } from "@/lib/session/types";

export function Footer({ language }: { language?: Language }) {
  const t = dictionary(language).footer;
  return (
    <footer className="print-hide mt-16 border-t border-paper-300 pt-6 pb-12 text-sm leading-relaxed text-ink-500 sm:mt-24">
      <p>
        <strong className="text-ink-700">{t.strong}</strong> {t.disclaimer}
      </p>
      <p className="mt-3">
        {t.privacy}{" "}
        <a className="font-semibold text-ember-700 underline decoration-paper-300 underline-offset-4" href="https://docs.qloo.com/" rel="noreferrer">
          {t.api}
        </a>
        {t.builtFor}{" "}
        <a className="font-semibold text-ember-700 underline decoration-paper-300 underline-offset-4" href="https://github.com/maikunari/reminisce" rel="noreferrer">
          {t.source}
        </a>{" "}
        {t.licence}
      </p>
    </footer>
  );
}
