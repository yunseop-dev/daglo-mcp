import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DagloApiClient } from "./client.js";
import { saveCredentials } from "../auth/credentials.js";
import { loginUser } from "../handlers/auth.js";

vi.mock("../handlers/auth.js", () => ({
  loginUser: vi.fn(),
}));

global.fetch = vi.fn() as any;

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

describe("DagloApiClient.request re-auth fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DAGLO_EMAIL = "u@x";
    process.env.DAGLO_PASSWORD = "pw";
  });

  it("retries once after re-login on 401", async () => {
    saveCredentials({ email: "u@x", accessToken: "OLD" });
    const client = new DagloApiClient();

    (global.fetch as any)
      .mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    (loginUser as any).mockImplementation(async () => {
      client.setTokens("NEW", undefined, "u@x");
      return { ok: true };
    });

    const response = await client.request("/v2/boards");
    expect(response.ok).toBe(true);
    expect((global.fetch as any).mock.calls.length).toBe(2);
    expect(loginUser).toHaveBeenCalledTimes(1);
  });

  it("throws helpful error when re-login impossible", async () => {
    delete process.env.DAGLO_EMAIL;
    delete process.env.DAGLO_PASSWORD;

    saveCredentials({ email: "u@x", accessToken: "OLD" });
    const client = new DagloApiClient();

    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    await expect(client.request("/v2/boards")).rejects.toThrow(
      /Not authenticated.*daglo auth login/i
    );
  });
});
