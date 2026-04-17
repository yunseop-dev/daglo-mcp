import { describe, it, expect, beforeEach, vi } from "vitest";
import { DagloApiClient } from "../api/client.js";
import { getFolders } from "./folders.js";

global.fetch = vi.fn() as any;

describe("getFolders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed JSON from /folders endpoint", async () => {
    const mockData = [{ id: "f1", name: "Folder 1", isRoot: true }];
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const client = new DagloApiClient();
    const result = await getFolders(client, { includeRoot: true });

    expect(result).toEqual(mockData);
    expect((global.fetch as any).mock.calls[0][0]).toContain("includeRoot=true");
  });

  it("omits includeRoot query when undefined", async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => [] });

    const client = new DagloApiClient();
    await getFolders(client, {});

    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).not.toContain("includeRoot");
  });

  it("throws on non-ok response", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      statusText: "Internal Server Error",
    });

    const client = new DagloApiClient();
    await expect(getFolders(client, {})).rejects.toThrow(
      "Failed to fetch folders: Internal Server Error"
    );
  });
});
