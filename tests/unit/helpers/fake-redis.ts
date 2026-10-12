import type { RedisCommand, RedisLike, RedisReply } from "@/lib/guard/redis";

/** Enough of Redis for the budget and the snapshots: INCR, EXPIRE, GET, SET ... EX. */
export class FakeRedis implements RedisLike {
  readonly store = new Map<string, string>();
  readonly ttls = new Map<string, number>();
  readonly calls: RedisCommand[] = [];
  failWith: Error | null = null;

  async pipeline(commands: RedisCommand[]): Promise<RedisReply[]> {
    this.calls.push(...commands);
    if (this.failWith) throw this.failWith;
    return commands.map((c) => this.run(c));
  }

  private run([cmd, ...args]: RedisCommand): RedisReply {
    const key = String(args[0]);
    switch (String(cmd).toUpperCase()) {
      case "INCR": {
        const next = Number(this.store.get(key) ?? 0) + 1;
        this.store.set(key, String(next));
        return next;
      }
      case "EXPIRE":
        this.ttls.set(key, Number(args[1]));
        return 1;
      case "GET":
        return this.store.get(key) ?? null;
      case "SET": {
        this.store.set(key, String(args[1]));
        if (String(args[2]).toUpperCase() === "EX") this.ttls.set(key, Number(args[3]));
        return "OK";
      }
      default:
        throw new Error(`FakeRedis: unsupported ${String(cmd)}`);
    }
  }
}
