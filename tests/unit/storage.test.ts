import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRESETS } from "@/lib/session/presets";
import { createSessionShell, loadSession, saveSession } from "@/lib/session/storage";

class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

describe("session storage", () => {
  let localStorage: MemoryStorage;
  beforeEach(() => {
    localStorage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reloads a session saved mid re-tune as ready, so feedback still works", () => {
    const shell = createSessionShell(PRESETS[0]!.person);
    saveSession({ ...shell, status: "retuning" });
    expect(loadSession(shell.id)?.status).toBe("ready");
  });

  it("treats a re-tune persisted by an older build as ready", () => {
    const shell = createSessionShell(PRESETS[0]!.person);
    localStorage.setItem(`reminisce:session:${shell.id}`, JSON.stringify({ ...shell, status: "retuning" }));
    expect(loadSession(shell.id)?.status).toBe("ready");
  });
});
