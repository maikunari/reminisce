import type { ReactNode } from "react";

import { Logo } from "./Logo";

interface Props {
  /** The running head: a small-caps line centred between the wordmark and the links. */
  centre?: ReactNode;
  /** Text links or buttons on the right. */
  actions?: ReactNode;
  className?: string;
}

/** The programme's masthead: wordmark left, running head centred, text links right. */
export function Masthead({ centre, actions, className = "" }: Props) {
  return (
    <header className={`masthead ${className}`.trim()}>
      <Logo />
      <div className="masthead-centre">{centre}</div>
      {actions ? <nav className="flex items-center gap-4">{actions}</nav> : <span />}
    </header>
  );
}
