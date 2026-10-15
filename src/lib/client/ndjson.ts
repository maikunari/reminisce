/** Reads a newline-delimited JSON stream from a fetch Response. */
export async function readNdjson<T>(response: Response, onEvent: (event: T) => void): Promise<void> {
  if (!response.body) {
    const text = await response.text();
    for (const line of text.split("\n")) if (line.trim()) onEvent(JSON.parse(line) as T);
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line) as T);
      newline = buffer.indexOf("\n");
    }
  }
  const rest = buffer.trim();
  if (rest) onEvent(JSON.parse(rest) as T);
}

/** A non-2xx answer from the API. The status lets the UI word it kindly instead of showing the server's text. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** The status BotID's check answers with when it cannot confirm a browser. */
export const BLOCKED_STATUS = 403;

export function isBlocked(error: unknown): boolean {
  return error instanceof HttpError && error.status === BLOCKED_STATUS;
}

export async function postNdjson<T>(url: string, body: unknown, onEvent: (event: T) => void, signal?: AbortSignal): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // keep default
    }
    throw new HttpError(message, response.status);
  }
  await readNdjson<T>(response, onEvent);
}
