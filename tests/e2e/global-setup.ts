import { assertDisposableDatabase } from "../db-guard";

/**
 * E2E specs write to the database directly (e.g. `realy:grant-role`), using DATABASE_URL from this
 * process. Refuse anything but a disposable local E2E/test database. The app under test must be started
 * with the same DATABASE_URL (CI and the README do this).
 */
export default function globalSetup() {
  assertDisposableDatabase(process.env.DATABASE_URL, ["_e2e", "_test"], "E2E tests");
}
