import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DagloApiClient } from "../api/client.js";
import {
  batchExportFolder,
  exportToObsidian,
} from "./obsidian.js";

global.fetch = vi.fn() as any;
let tmp: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmp = mkdtempSync(join(tmpdir(), "obs-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("exportToObsidian", () => {
  it("exports a board to markdown files and returns file paths", async () => {
    const boardPayload = {
      id: "board-1",
      name: "Test Board",
      createdAt: "2024-03-15T10:00:00Z",
      summary: "A test summary",
      keywords: ["test", "board"],
      aiSummary: "AI generated summary",
      content: null,
    };

    // Board fetch: ok; all subsequent file-meta calls: ok but empty (no fileMetaId on board)
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => boardPayload,
      text: async () => JSON.stringify(boardPayload),
    } as any);

    const client = new DagloApiClient();
    const result = await exportToObsidian(client, {
      boardId: "board-1",
      outputDir: tmp,
      outputType: "summary",
      includeContent: true,
      includeSummary: true,
      includeKeywords: true,
      includeAiSummary: true,
    });

    const r = result as {
      success: boolean;
      boardId: string;
      boardName: string;
      generatedFiles: string[];
    };

    expect(r.success).toBe(true);
    expect(r.boardId).toBe("board-1");
    expect(r.boardName).toBe("Test Board");
    expect(r.generatedFiles.length).toBeGreaterThan(0);

    // Verify files actually exist on disk
    for (const filePath of r.generatedFiles) {
      expect(existsSync(filePath)).toBe(true);
    }
  });

  it("exports both original and summary when outputType is both and content is present", async () => {
    const boardPayload = {
      id: "board-2",
      name: "Board With Content",
      createdAt: "2024-04-01T08:00:00Z",
      summary: "Summary here",
      keywords: ["keyword"],
      aiSummary: null,
      // A minimal zlib base64 content-like string that decodeZlibBase64Content can handle
      content: "plain text content",
    };

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => boardPayload,
      text: async () => JSON.stringify(boardPayload),
    } as any);

    const client = new DagloApiClient();
    const result = await exportToObsidian(client, {
      boardId: "board-2",
      outputDir: tmp,
      outputType: "both",
      includeContent: true,
      includeSummary: true,
      includeKeywords: true,
      includeAiSummary: true,
    });

    const r = result as { success: boolean; generatedFiles: string[] };
    expect(r.success).toBe(true);
    // summary dir should exist since outputType is "both"
    expect(existsSync(join(tmp, "summary"))).toBe(true);
  });

  it("throws when the board fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      statusText: "Not Found",
    } as any);

    const client = new DagloApiClient();
    await expect(
      exportToObsidian(client, {
        boardId: "bad-board",
        outputDir: tmp,
        outputType: "both",
        includeContent: true,
        includeSummary: true,
        includeKeywords: true,
        includeAiSummary: true,
      })
    ).rejects.toThrow("Failed to fetch board: Not Found");
  });
});

describe("batchExportFolder", () => {
  it("exports all boards in a folder and returns summary with file paths", async () => {
    const listPayload = {
      boards: [
        { id: "b1", name: "Board Alpha", createdAt: "2024-05-01T12:00:00Z" },
        { id: "b2", name: "Board Beta", createdAt: "2024-05-02T12:00:00Z" },
      ],
    };

    const boardDetail = (id: string, name: string) => ({
      id,
      name,
      createdAt: "2024-05-01T12:00:00Z",
      summary: "Summary",
      keywords: ["k1"],
      aiSummary: "AI summary",
      content: null,
    });

    // Dispatch by URL fragment
    vi.mocked(fetch).mockImplementation((url: any) => {
      const urlStr = String(url);
      if (urlStr.includes("/v2/boards")) {
        return Promise.resolve({
          ok: true,
          json: async () => listPayload,
          text: async () => JSON.stringify(listPayload),
        } as any);
      }
      if (urlStr.includes("/boards/b1")) {
        const d = boardDetail("b1", "Board Alpha");
        return Promise.resolve({
          ok: true,
          json: async () => d,
          text: async () => JSON.stringify(d),
        } as any);
      }
      if (urlStr.includes("/boards/b2")) {
        const d = boardDetail("b2", "Board Beta");
        return Promise.resolve({
          ok: true,
          json: async () => d,
          text: async () => JSON.stringify(d),
        } as any);
      }
      return Promise.resolve({ ok: false, statusText: "Not Found" } as any);
    });

    const client = new DagloApiClient();
    const result = await batchExportFolder(client, {
      folderId: "folder-1",
      outputDir: tmp,
      outputType: "summary",
      limit: 50,
    });

    const r = result as {
      success: boolean;
      totalBoards: number;
      exportedCount: number;
      errorCount: number;
      generatedFiles: string[];
    };

    expect(r.success).toBe(true);
    expect(r.totalBoards).toBe(2);
    expect(r.exportedCount).toBe(2);
    expect(r.errorCount).toBe(0);
    expect(r.generatedFiles.length).toBe(2);

    // Verify each exported file exists on disk
    for (const filePath of r.generatedFiles) {
      expect(existsSync(filePath)).toBe(true);
    }
  });

  it("returns empty result when no boards in folder", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ boards: [] }),
      text: async () => JSON.stringify({ boards: [] }),
    } as any);

    const client = new DagloApiClient();
    const result = await batchExportFolder(client, {
      folderId: "empty-folder",
      outputDir: tmp,
      outputType: "both",
      limit: 50,
    });

    expect(result).toMatchObject({
      success: true,
      exportedCount: 0,
      message: "No boards found in folder",
    });
  });

  it("throws when the board list fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      statusText: "Unauthorized",
    } as any);

    const client = new DagloApiClient();
    await expect(
      batchExportFolder(client, {
        folderId: "folder-x",
        outputDir: tmp,
        outputType: "both",
        limit: 50,
      })
    ).rejects.toThrow("Failed to fetch boards: Unauthorized");
  });
});
