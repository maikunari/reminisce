import type { Domain } from "@/lib/session/types";

/**
 * Placeholder art as printed ephemera from the person's youth: an album sleeve,
 * a ticket stub, a menu card, a postcard, a luggage label, a television screen.
 * Paper plus one ink per domain, drawn in CSS; no image assets. The title and a
 * small line are set in Fraunces on the object. Sizes scale with the container's
 * font-size, so one markup serves a 100px thumbnail and the card's hero.
 * Decorative: the accessible name lives on the card title.
 */
interface Props {
  domain: Domain;
  title: string;
  /** The small uppercase line (a year, a label, a city). */
  label?: string;
  /** The italic line (a subtitle, a song, a date). */
  line?: string;
  /** Mini sleeves drop the fine details. */
  mini?: boolean;
  className?: string;
}

const KIND: Record<Domain, "music" | "film" | "dining" | "place" | "trip" | "tv"> = {
  music: "music",
  film: "film",
  tv: "tv",
  dining: "dining",
  place: "place",
  destination: "trip",
};

export function Sleeve({ domain, title, label, line, mini = false, className = "" }: Props) {
  const kind = KIND[domain];
  const classes = `sleeve sleeve-${kind} ${mini ? "sleeve-mini" : ""} ${className}`.trim();
  const text = (
    <div className="sleeve-t">
      {label ? <span className="sleeve-k">{label}</span> : null}
      <span className="sleeve-n">{title}</span>
      {line ? <span className="sleeve-y">{line}</span> : null}
    </div>
  );

  switch (kind) {
    case "music":
      return (
        <div className={classes} aria-hidden="true">
          {text}
          <div className="sleeve-disc" />
        </div>
      );
    case "film":
      return (
        <div className={classes} aria-hidden="true">
          <div className="sleeve-stub" />
          <div className="sleeve-perf" />
          {text}
          <span className="sleeve-admit">Admit one</span>
        </div>
      );
    case "dining":
      return (
        <div className={classes} aria-hidden="true">
          <div className="sleeve-menu">
            <span className="sleeve-k">{label ?? "Menu"}</span>
            <span className="sleeve-n">{title}</span>
            <span className="sleeve-fleur">❦</span>
            {line ? <span className="sleeve-y">{line}</span> : null}
          </div>
        </div>
      );
    case "place":
      return (
        <div className={classes} aria-hidden="true">
          <div className="sleeve-stamp">{label ?? ""}</div>
          <div className="sleeve-postmark">{line ?? ""}</div>
          <div className="sleeve-t">
            <span className="sleeve-k">Greetings from</span>
            <span className="sleeve-n">{title}</span>
          </div>
          <div className="sleeve-lines" />
        </div>
      );
    case "trip":
      return (
        <div className={classes} aria-hidden="true">
          <div className="sleeve-tagshape" />
          <div className="sleeve-eye" />
          {text}
        </div>
      );
    case "tv":
      return (
        <div className={classes} aria-hidden="true">
          <div className="sleeve-screen">
            {label ? <span className="sleeve-k">{label}</span> : null}
            <span className="sleeve-n">{title}</span>
          </div>
        </div>
      );
  }
}
