import { describe, it, expect, beforeEach, vi } from "vitest";
import { DagloApiClient } from "../api/client.js";
import { getFileMeta, getKeywords } from "./file-meta.js";

global.fetch = vi.fn() as any;

describe("getFileMeta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches /file-meta/<id>", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "f1" }),
    });

    const client = new DagloApiClient();
    const result = await getFileMeta(client, { fileMetaId: "f1" });

    expect(result).toEqual({ id: "f1" });
    expect((global.fetch as any).mock.calls[0][0]).toContain("/file-meta/f1");
  });

  it("throws on non-ok", async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, statusText: "Bad" });
    const client = new DagloApiClient();
    await expect(getFileMeta(client, { fileMetaId: "f1" })).rejects.toThrow(
      /Failed to fetch file meta: Bad/
    );
  });
});

describe("getKeywords", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses /file-meta/<id>/keyword path with auth headers", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(["k1"]),
    });

    const client = new DagloApiClient();
    await getKeywords(client, { fileMetaId: "f1" });
    expect((global.fetch as any).mock.calls[0][0]).toContain(
      "/file-meta/f1/keyword"
    );
  });

  it("uses /shared-board/<id>/keyword path for shared", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => "[]",
    });

    const client = new DagloApiClient();
    await getKeywords(client, { sharedBoardId: "s1" });
    expect((global.fetch as any).mock.calls[0][0]).toContain(
      "/shared-board/s1/keyword"
    );
  });

  it("throws when neither id provided", async () => {
    const client = new DagloApiClient();
    await expect(getKeywords(client, {})).rejects.toThrow(
      /fileMetaId or sharedBoardId/
    );
  });
});
