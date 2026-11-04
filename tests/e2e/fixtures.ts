import { test as base } from "@playwright/test";

export { expect, type Page } from "@playwright/test";

/** The only hosts a test page may reach: the app under test, served locally. */
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Every spec imports `test` from here so the browser never opens an outside
 * page: any request or navigation to another host is aborted before it leaves
 * the machine. Page-level routes in a spec still run first and fall back here.
 */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === "data:" || url.protocol === "blob:" || ALLOWED_HOSTS.has(url.hostname)) return route.fallback();
      return route.abort("blockedbyclient");
    });
    await provide(context);
  },
});
