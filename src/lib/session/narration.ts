/**
 * The agent's narration is shown as written, so anything that is not a plain
 * sentence never reaches the screen: a model's tool-call markup
 * (`<｜DSML｜invoke name="plan_session">…`), JSON, raw entity ids, or a
 * runaway paragraph. Used on the server before a line is emitted or kept in a
 * snapshot, and in the browser before a line is shown (an old snapshot or a
 * stored session may still carry one).
 */
export const NARRATION_MAX_CHARS = 280;

const MARKUP = [
  /<[|｜/!a-z]/i, // tags and tool-call markup such as <｜DSML｜…> or <tool_call>
  /[{}[\]]/, // JSON
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // entity ids
  /urn:entity:|urn:tag:/,
  /```/,
];

/** Whether text carries markup, JSON or ids rather than words alone. */
export function hasMarkup(text: string): boolean {
  return MARKUP.some((re) => re.test(text));
}

/** The line, trimmed, if it is fit to show; otherwise undefined. */
export function cleanNarration(text: string | null | undefined): string | undefined {
  const line = text?.replace(/\s+/g, " ").trim();
  if (!line || line.length > NARRATION_MAX_CHARS) return undefined;
  return hasMarkup(line) ? undefined : line;
}

/** A trace with narration that is not fit to show taken out (other events are kept as they are). */
export function withCleanNarration<T extends { kind: string; summary: string }>(events: T[]): T[] {
  return events.flatMap((e) => {
    if (e.kind !== "narration") return [e];
    const line = cleanNarration(e.summary);
    return line ? [{ ...e, summary: line }] : [];
  });
}
