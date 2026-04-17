import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DagloApiClient } from "./client.js";
import { saveCredentials } from "../auth/credentials.js";

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "daglo-client-"));
  process.env.XDG_CONFIG_HOME = tmpHome;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("DagloApiClient credential loading", () => {
  it("starts unauthenticated when no credentials file exists", () => {
    const client = new DagloApiClient();
    expect(client.isAuthenticated()).toBe(false);
  });

  it("loads access token from credentials file on construction", () => {
    saveCredentials({ email: "u@x", accessToken: "AT" });
    const client = new DagloApiClient();
    expect(client.isAuthenticated()).toBe(true);
    const headers = client.getAuthHeaders() as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer AT");
  });

  it("persists tokens via setTokens", () => {
    const client = new DagloApiClient();
    client.setTokens("AT2", "RT2", "u@x");

    const fresh = new DagloApiClient();
    expect(fresh.isAuthenticated()).toBe(true);
  });
});
