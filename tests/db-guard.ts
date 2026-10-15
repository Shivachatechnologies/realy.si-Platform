/**
 * Tests must only ever touch a disposable local database. Both the database name and the host are checked,
 * and the URL is never printed (it may carry credentials).
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertDisposableDatabase(url: string | undefined, suffixes: string[], purpose: string): void {
  if (!url) throw new Error(`${purpose}: DATABASE_URL is not set; point it at a disposable database (name ending ${suffixes.join(" or ")})`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${purpose}: the database URL is not a valid URL`);
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!suffixes.some((s) => name.endsWith(s))) {
    throw new Error(`${purpose}: refusing database "${name}" — only databases whose name ends with ${suffixes.join(" or ")} may be used`);
  }
  // Remote hosts need an explicit opt-in (e.g. a dedicated CI database server), so a production URL that
  // happens to be in the environment can never be used by accident.
  if (!LOCAL_HOSTS.has(parsed.hostname) && process.env.ALLOW_REMOTE_TEST_DATABASE !== "1") {
    throw new Error(`${purpose}: refusing non-local database host "${parsed.hostname}" (set ALLOW_REMOTE_TEST_DATABASE=1 only for a dedicated disposable server)`);
  }
}
