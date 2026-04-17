import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadCredentials,
  saveCredentials,
  deleteCredentials,
  getCredentialsPath,
  Credentials,
} from "./credentials.js";

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "daglo-cred-"));
  process.env.XDG_CONFIG_HOME = tmpHome;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("credentials", () => {
  it("returns null when no file exists", () => {
    expect(loadCredentials()).toBeNull();
  });

  it("saves credentials with 0600 permissions", () => {
    const creds: Credentials = {
      email: "u@x",
      accessToken: "AT",
      refreshToken: "RT",
      expiresAt: "2026-04-18T03:00:00.000Z",
    };
    saveCredentials(creds);

    const path = getCredentialsPath();
    expect(existsSync(path)).toBe(true);

    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);

    const dirMode = statSync(join(tmpHome, "daglo")).mode & 0o777;
    expect(dirMode).toBe(0o700);
  });

  it("round-trips data through save/load", () => {
    const creds: Credentials = {
      email: "u@x",
      accessToken: "AT",
      expiresAt: "2026-04-18T03:00:00.000Z",
    };
    saveCredentials(creds);
    expect(loadCredentials()).toEqual(creds);
  });

  it("delete removes the file", () => {
    saveCredentials({ email: "u@x", accessToken: "AT" });
    deleteCredentials();
    expect(loadCredentials()).toBeNull();
  });

  it("delete is a no-op when no file exists", () => {
    expect(() => deleteCredentials()).not.toThrow();
  });

  it("save is atomic (uses tmp + rename)", () => {
    saveCredentials({ email: "u@x", accessToken: "AT" });
    const before = readFileSync(getCredentialsPath(), "utf-8");
    saveCredentials({ email: "u@y", accessToken: "AT2" });
    const after = readFileSync(getCredentialsPath(), "utf-8");
    expect(before).not.toEqual(after);
  });
});
