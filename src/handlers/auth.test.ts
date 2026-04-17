import { describe, it, expect, beforeEach, vi } from "vitest";
import { DagloApiClient } from "../api/client.js";
import { loginUser } from "./auth.js";

global.fetch = vi.fn() as any;

describe("loginUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts credentials and stores tokens on success", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      headers: new Headers({ accesstoken: "AT", refreshtoken: "RT" }),
      text: async () => JSON.stringify({ user: { email: "u@x" } }),
    });

    const client = new DagloApiClient();
    const result = await loginUser(client, {
      email: "u@x",
      password: "pw",
    });

    expect(client.isAuthenticated()).toBe(true);
    expect(result).toEqual({ user: { email: "u@x" } });
  });

  it("throws when credentials missing", async () => {
    delete process.env.DAGLO_EMAIL;
    delete process.env.DAGLO_PASSWORD;

    const client = new DagloApiClient();
    await expect(loginUser(client, {})).rejects.toThrow(/missing credentials/i);
  });

  it("throws when access token absent from response", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      headers: new Headers({}),
      text: async () => "{}",
    });

    const client = new DagloApiClient();
    await expect(
      loginUser(client, { email: "u@x", password: "pw" })
    ).rejects.toThrow(/access token not found/i);
  });
});
