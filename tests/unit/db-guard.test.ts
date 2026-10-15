import { afterEach, describe, expect, it, vi } from "vitest";
import { assertDisposableDatabase } from "../db-guard";

describe("test database guard", () => {
  afterEach(() => vi.unstubAllEnvs());
  const check = (url: string | undefined) => () => assertDisposableDatabase(url, ["_test"], "Integration tests");

  it("accepts only a local database whose name marks it as disposable", () => {
    expect(check("postgresql://realy:realy@localhost:5432/realy_test")).not.toThrow();
    expect(check("postgresql://realy:realy@127.0.0.1:5432/realy_test?schema=public")).not.toThrow();
    expect(check(undefined)).toThrow(/not set/);
    expect(check("postgresql://realy:realy@localhost:5432/realy")).toThrow(/refusing database "realy"/);
    expect(check("postgresql://owner:hunter2@db.prod.example.com:5432/neondb")).toThrow(/refusing database "neondb"/);
    expect(check("postgresql://owner:hunter2@db.prod.example.com:5432/app_test")).toThrow(/non-local database host "db.prod.example.com"/);
  });

  it("never echoes credentials", () => {
    for (const url of ["postgresql://owner:hunter2@db.prod.example.com:5432/neondb", "postgresql://owner:hunter2@db.prod.example.com:5432/app_test"]) {
      expect(check(url)).toThrow(expect.objectContaining({ message: expect.not.stringContaining("hunter2") }));
    }
  });

  it("a remote disposable server needs an explicit opt-in", () => {
    vi.stubEnv("ALLOW_REMOTE_TEST_DATABASE", "1");
    expect(check("postgresql://ci:ci@ci-db.internal:5432/realy_test")).not.toThrow();
    expect(check("postgresql://ci:ci@ci-db.internal:5432/realy")).toThrow(); // the name rule still applies
  });
});
