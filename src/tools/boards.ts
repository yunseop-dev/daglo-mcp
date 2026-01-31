import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as z from "zod";
import { DagloApiClient } from "../api/client.js";
import { DagloBoardDetail } from "../types.js";
import { normalizeBoardList, pickLatestBoard } from "../utils/board.js";
import {
  buildScriptPages,
  decodeScriptItem,
  decodeZlibBase64Content,
  normalizeScriptContent,
} from "../utils/content.js";
import {
  buildDefaultOutputPath,
  buildPlainTextFromScriptPayload,
} from "../utils/file.js";
import {
  buildPlainTextFromTokens,
  extractKaraokeTokens,
  splitTokensByPunctuation,
} from "../utils/karaoke.js";
import { buildUrl, parseResponseBody } from "../utils/http.js";

export const registerBoardTools = (
  server: McpServer,
  client: DagloApiClient
) => {
  server.registerTool(
    "get-board-script",
    {
      title: "Get Board Script",
      description:
        "Retrieve and decode a board script (supports shared, original, and history scripts).",
      inputSchema: {
        fileMetaId: z.string().optional().describe("File metadata ID"),
        sharedBoardId: z.string().optional().describe("Shared board ID"),
        historyId: z
          .string()
          .optional()
          .describe("Script history ID (requires fileMetaId)"),
        isOriginal: z
          .boolean()
          .optional()
          .describe("Fetch original script (requires fileMetaId)"),
        limit: z
          .number()
          .optional()
          .describe("Minutes per page (default: 60)"),
        page: z.number().optional().describe("Page index for script API (default: 0)"),
        buildPages: z
          .boolean()
          .optional()
          .describe("Split script into pages (default: true)"),
      },
    },
    async (args) => {
      const limit = args.limit ?? 60;
      const page = args.page ?? 0;
      const buildPages = args.buildPages !== false;

      let path = "";
      if (args.sharedBoardId) {
        path = `/shared-board/${args.sharedBoardId}/script`;
      } else if (args.fileMetaId && args.historyId) {
        path = `/file-meta/${args.fileMetaId}/script-history/${args.historyId}`;
      } else if (args.fileMetaId && args.isOriginal) {
        path = `/file-meta/${args.fileMetaId}/original/script`;
      } else if (args.fileMetaId) {
        path = `/file-meta/${args.fileMetaId}/script`;
      } else {
        throw new Error("Provide fileMetaId or sharedBoardId.");
      }

      const url = buildUrl(client.baseUrl, path, {
        limit,
        page,
      });

      const response = await fetch(url, { headers: client.getAuthHeaders() });
      if (!response.ok) {
        throw new Error(`Failed to fetch script: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        item?: string;
        meta?: { totalPages?: number };
      };
      const script = decodeScriptItem(data?.item);
      const totalPages = data?.meta?.totalPages ?? 1;
      const pages = script && buildPages ? buildScriptPages(script, totalPages, limit) : [];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                meta: data?.meta ?? null,
                script,
                pages: buildPages ? pages : undefined,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get-boards",
    {
      title: "Get Boards",
      description: "Retrieve all boards from Daglo with optional filters",
      inputSchema: {
        page: z.number().optional().describe("Page number (default: 1)"),
        limit: z.number().optional().describe("Number of boards per page"),
        sort: z
          .string()
          .optional()
          .describe(
            "Sort expression (default: createTime.desc, examples: createTime.desc, name.asc, name.desc)"
          ),
        orderedBy: z
          .enum(["name", "createTime", "updateTime", "deleteTime"])
          .optional()
          .describe("Sort field (used with timeOrder when sort not provided)"),
        timeOrder: z
          .enum(["asc", "desc"])
          .optional()
          .describe("Sort order (used with orderedBy when sort not provided)"),
        status: z.enum(["COMPLETE", "PROCESSING", "FAILED"]).optional().describe("Filter by board status"),
        isStarred: z.boolean().optional().describe("Filter by starred boards"),
        search: z.string().optional().describe("Filter by board name"),
        uploadTypes: z.array(z.string()).optional().describe("Filter by upload types"),
        folderIds: z.array(z.string()).optional().describe("Filter by folder IDs"),
        withDeleted: z.boolean().optional().describe("Include deleted boards"),
        startDate: z.string().optional().describe("Filter start date (ISO string)"),
        endDate: z.string().optional().describe("Filter end date (ISO string)"),
        folderId: z.string().optional().describe("Filter by a single folder ID"),
        keyword: z.string().optional().describe("Filter by keyword"),
        checkedFilter: z
          .enum(["incompleteRecording", "isPdf"])
          .optional()
          .describe("Filter by incomplete recordings or PDFs"),
      },
    },
    async (args) => {
      const params = new URLSearchParams();
      if (args.page) params.append("page", args.page.toString());
      if (args.limit) params.append("limit", args.limit.toString());

      const sort =
        args.sort ??
        (args.orderedBy && args.timeOrder
          ? `${args.orderedBy}.${args.timeOrder}`
          : "createTime.desc");
      params.append("sort", sort);

      if (args.status) params.append("filter.status", args.status);
      if (args.isStarred !== undefined) {
        params.append("filter.isStarred", String(args.isStarred));
      }
      if (args.search) params.append("filter.name", args.search);
      if (args.uploadTypes?.length) {
        args.uploadTypes.forEach((type) => params.append("filter.uploadTypes", type));
      }
      if (args.folderIds?.length) {
        args.folderIds.forEach((id) => params.append("filter.folderIds", id));
      }
      if (args.startDate) params.append("filter.startDate", args.startDate);
      if (args.endDate) params.append("filter.endDate", args.endDate);
      if (args.withDeleted !== undefined) {
        params.append("filter.withDeleted", String(args.withDeleted));
      }
      if (args.folderId) params.append("folderId", args.folderId);
      if (args.keyword) params.append("keyword", args.keyword);
      if (args.checkedFilter) params.append("checkedFilter", args.checkedFilter);

      const response = await fetch(
        `${client.baseUrl}/v2/boards?${params.toString()}`,
        { headers: client.getAuthHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch boards: ${response.statusText}`);
      }

      const data = (await response.json()) as unknown;
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "get-board-info",
    {
      title: "Get Board Info",
      description: "Retrieve board info for private or shared boards",
      inputSchema: {
        boardId: z.string().optional().describe("Board ID to fetch (private board)"),
        sharedBoardId: z.string().optional().describe("Shared board ID to fetch (public)"),
      },
    },
    async (args) => {
      if (!args.boardId && !args.sharedBoardId) {
        throw new Error("Provide boardId or sharedBoardId.");
      }

      const path = args.sharedBoardId
        ? `/shared-board/${args.sharedBoardId}`
        : `/boards/${args.boardId}`;
      const headers = args.sharedBoardId
        ? { headers: { "daglo-platform": "web" } }
        : { headers: client.getAuthHeaders() };

      const response = await fetch(`${client.baseUrl}${path}`, headers);
      if (!response.ok) {
        throw new Error(`Failed to fetch board info: ${response.statusText}`);
      }

      const data = await parseResponseBody(response);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "update-board-name",
    {
      title: "Update Board Name",
      description: "Update a board name",
      inputSchema: {
        boardId: z.string().describe("Board ID to update"),
        name: z.string().min(1).describe("New board name"),
      },
    },
    async (args) => {
      const requestBody = { name: args.name };

      const response = await fetch(`${client.baseUrl}/boards/${args.boardId}`, {
        method: "PATCH",
        headers: client.getAuthHeaders(),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(`Failed to update board name: ${response.statusText}`);
      }

      const data = await parseResponseBody(response);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "get-board-detail",
    {
      title: "Get Board Detail",
      description:
        "Retrieve detailed information including content, summary, keywords, AI summary, and segments for a specific board. Supports filtering which data to include.",
      inputSchema: {
        boardId: z.string().describe("Board ID to fetch details for"),
        fileMetaId: z.string().optional().describe("File metadata ID (optional)"),
        decodeContent: z
          .boolean()
          .optional()
          .describe("Decode content if zlib+base64 (default: true)"),
        includeScript: z
          .boolean()
          .optional()
          .describe("Include decoded script data when fileMetaId is set"),
        includeScriptPages: z
          .boolean()
          .optional()
          .describe("Include script pages when fileMetaId is set"),
        scriptLimit: z
          .number()
          .optional()
          .describe("Minutes per script page (default: 60)"),
        scriptPage: z
          .number()
          .optional()
          .describe("Script page index for API (default: 0)"),
        includeContent: z
          .boolean()
          .optional()
          .describe("Include full transcription content (default: true)"),
        includeSummary: z
          .boolean()
          .optional()
          .describe("Include summary (default: true)"),
        includeKeywords: z
          .boolean()
          .optional()
          .describe("Include keywords (default: true)"),
        includeAiSummary: z
          .boolean()
          .optional()
          .describe("Include AI summary (default: true)"),
        includeSegments: z
          .boolean()
          .optional()
          .describe("Include timestamped segments (default: true)"),
        outputFormat: z
          .enum(["json", "text"])
          .optional()
          .describe("Output format (json or text, default: json)"),
        outputPath: z
          .string()
          .optional()
          .describe("Optional output file path when outputFormat is text/json"),
      },
    },
    async (args) => {
      const shouldIncludeContent = args.includeContent !== false;
      const shouldIncludeSummary = args.includeSummary !== false;
      const shouldIncludeKeywords = args.includeKeywords !== false;
      const shouldIncludeSegments = args.includeSegments !== false;
      const shouldIncludeAiSummary = args.includeAiSummary !== false;
      const shouldDecodeContent = args.decodeContent !== false;
      const shouldIncludeScript = args.includeScript === true;
      const shouldIncludeScriptPages = args.includeScriptPages !== false;
      const scriptLimit = args.scriptLimit ?? 60;
      const scriptPage = args.scriptPage ?? 0;
      const outputFormat = args.outputFormat ?? "json";

      let scriptPayload:
        | {
            meta?: { totalPages?: number } | null;
            script?: Record<string, unknown> | null;
            pages?: Array<Record<string, unknown>>;
          }
        | null = null;

      if (args.fileMetaId) {
        const scriptQuery = new URLSearchParams();
        scriptQuery.append("limit", scriptLimit.toString());
        scriptQuery.append("page", scriptPage.toString());
        const scriptResponse = await fetch(
          `${client.baseUrl}/file-meta/${args.fileMetaId}/script?${scriptQuery.toString()}`,
          { headers: client.getAuthHeaders() }
        );

        if (scriptResponse.ok) {
          const scriptData = (await scriptResponse.json()) as {
            item?: string;
            meta?: { totalPages?: number };
          };
          const script = decodeScriptItem(scriptData?.item);
          const totalPages = scriptData?.meta?.totalPages ?? 1;
          const pages =
            script && shouldIncludeScriptPages
              ? buildScriptPages(script, totalPages, scriptLimit)
              : [];

          scriptPayload = {
            meta: scriptData?.meta ?? null,
            script: shouldIncludeScript ? script : null,
            pages: shouldIncludeScriptPages ? pages : undefined,
          };
        }
      }

      const response = await fetch(
        `${client.baseUrl}/boards/${args.boardId}`,
        { headers: client.getAuthHeaders() }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch board detail: ${response.statusText}`);
      }

      const fullData = (await response.json()) as DagloBoardDetail;

      const filteredData: Partial<DagloBoardDetail> & {
        decodedContent?: string | null;
        contentDecoded?: boolean;
      } = {
        id: fullData.id,
        name: fullData.name,
        status: fullData.status,
        type: fullData.type,
        createdAt: fullData.createdAt,
        updatedAt: fullData.updatedAt,
        isStarred: fullData.isStarred,
        folderId: fullData.folderId,
      };

      if (shouldIncludeContent && fullData.content) {
        filteredData.content = fullData.content;
        if (shouldDecodeContent) {
          const decoded = decodeZlibBase64Content(fullData.content);
          filteredData.decodedContent = decoded;
          filteredData.contentDecoded = decoded !== fullData.content;
        }
      }

      if (shouldIncludeSummary) {
        let summaryData: unknown = null;
        if (args.fileMetaId) {
          const summaryResponse = await fetch(
            `${client.baseUrl}/file-meta/${args.fileMetaId}/summary`,
            { headers: client.getAuthHeaders() }
          );
          if (summaryResponse.ok) {
            summaryData = await parseResponseBody(summaryResponse);
          }
        }
        (filteredData as Record<string, unknown>).summary =
          summaryData ?? fullData.summary;
      }

      if (shouldIncludeKeywords) {
        let keywordsData: unknown = null;
        if (args.fileMetaId) {
          const keywordResponse = await fetch(
            `${client.baseUrl}/file-meta/${args.fileMetaId}/keyword`,
            { headers: client.getAuthHeaders() }
          );
          if (keywordResponse.ok) {
            keywordsData = await parseResponseBody(keywordResponse);
          }
        }
        (filteredData as Record<string, unknown>).keywords =
          keywordsData ?? fullData.keywords;
      }

      if (shouldIncludeAiSummary) {
        let aiSummaryData: unknown = null;
        if (args.fileMetaId) {
          const longSummaryResponse = await fetch(
            `${client.baseUrl}/file-meta/${args.fileMetaId}/long-summary`,
            { headers: client.getAuthHeaders() }
          );
          if (longSummaryResponse.ok) {
            aiSummaryData = await parseResponseBody(longSummaryResponse);
          }
        }
        (filteredData as Record<string, unknown>).aiSummary =
          aiSummaryData ?? fullData.aiSummary;
      }

      if (shouldIncludeSegments) {
        let segmentData: unknown = null;
        if (args.fileMetaId) {
          const segmentResponse = await fetch(
            `${client.baseUrl}/file-meta/${args.fileMetaId}/segment-summary`,
            { headers: client.getAuthHeaders() }
          );
          if (segmentResponse.ok) {
            segmentData = await parseResponseBody(segmentResponse);
          }
        }
        (filteredData as Record<string, unknown>).segments =
          segmentData ?? fullData.segments;
      }

      if (scriptPayload && (shouldIncludeScript || shouldIncludeScriptPages)) {
        (filteredData as Record<string, unknown>).script =
          scriptPayload.script ?? undefined;
        (filteredData as Record<string, unknown>).scriptPages =
          scriptPayload.pages ?? undefined;
        (filteredData as Record<string, unknown>).scriptMeta =
          scriptPayload.meta ?? null;
      }

      if (outputFormat === "text") {
        const normalizedContent = fullData.content
          ? normalizeScriptContent(fullData.content)
          : "";
        const plainText = buildPlainTextFromScriptPayload(
          scriptPayload?.script,
          normalizedContent || filteredData.decodedContent || fullData.content
        );
        const outputPath =
          args.outputPath ??
          buildDefaultOutputPath(fullData.name ?? args.boardId, "txt");
        const contentSource = scriptPayload?.script ? "script" : "content";

        writeFileSync(outputPath, plainText, "utf8");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  outputPath,
                  contentLength: plainText.length,
                  contentSource,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const jsonText = JSON.stringify(filteredData, null, 2);
      if (outputFormat === "json") {
        const outputPath =
          args.outputPath ??
          buildDefaultOutputPath(fullData.name ?? args.boardId, "json");
        writeFileSync(outputPath, jsonText, "utf8");
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  outputPath,
                  contentLength: jsonText.length,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [{ type: "text", text: jsonText }],
      };
    }
  );

  server.registerTool(
    "get-latest-board-content",
    {
      title: "Get Latest Board Content",
      description:
        "Retrieve the content of the most recently created board. Optionally decodes zlib+base64 content.",
      inputSchema: {
        limit: z
          .number()
          .optional()
          .describe("Number of boards to inspect (default: 50)"),
        decodeContent: z
          .boolean()
          .optional()
          .describe("Decode zlib+base64 content (default: true)"),
      },
    },
    async (args) => {
      const params = new URLSearchParams();
      const limit = args.limit ?? 50;
      params.append("page", "1");
      params.append("limit", limit.toString());
      params.append("sort", "createTime.desc");

      const listResponse = await fetch(
        `${client.baseUrl}/v2/boards?${params.toString()}`,
        { headers: client.getAuthHeaders() }
      );

      if (!listResponse.ok) {
        throw new Error(`Failed to fetch boards: ${listResponse.statusText}`);
      }

      const listData = (await listResponse.json()) as unknown;
      const boards = normalizeBoardList(listData);
      const latestBoard = pickLatestBoard(boards);

      if (!latestBoard) {
        throw new Error("No boards found to determine latest board.");
      }

      const detailParams = new URLSearchParams();
      detailParams.append("includeContent", "true");

      let rawContent: string | undefined;
      let contentSource = "board";
      const latestBoardId = latestBoard.id as string | undefined;
      const latestBoardName = latestBoard.name as string | undefined;
      const latestBoardCreatedAt =
        (latestBoard.createdAt as string | undefined) ??
        (latestBoard.createTime as string | undefined) ??
        null;
      const latestBoardUpdatedAt =
        (latestBoard.updatedAt as string | undefined) ??
        (latestBoard.updateTime as string | undefined) ??
        null;

      const latestBoardFileMetaId = latestBoard.fileMetaId as string | undefined;
      if (latestBoardFileMetaId) {
        const scriptResponse = await fetch(
          `${client.baseUrl}/file-meta/${latestBoardFileMetaId}/script?${detailParams.toString()}`,
          { headers: client.getAuthHeaders() }
        );

        if (scriptResponse.ok) {
          const scriptData = (await scriptResponse.json()) as
            | { content?: string; script?: string; text?: string }
            | string;
          if (typeof scriptData === "string") {
            rawContent = scriptData;
          } else {
            rawContent =
              scriptData.content ??
              scriptData.script ??
              scriptData.text ??
              (scriptData as { item?: string }).item;
          }
          contentSource = "file-meta";
        }
      }

      if (!rawContent) {
        if (!latestBoardId) {
          throw new Error("Latest board is missing id.");
        }

        let detailResponse = await fetch(
          `${client.baseUrl}/v2/boards/${latestBoardId}?${detailParams.toString()}`,
          { headers: client.getAuthHeaders() }
        );

        if (!detailResponse.ok) {
          detailResponse = await fetch(
            `${client.baseUrl}/boards/${latestBoardId}?${detailParams.toString()}`,
            { headers: client.getAuthHeaders() }
          );
        }

        if (!detailResponse.ok) {
          throw new Error(`Failed to fetch board detail: ${detailResponse.statusText}`);
        }

        const detailData = (await detailResponse.json()) as DagloBoardDetail;
        rawContent = detailData.content;
      }

      const isContentDecoded = args.decodeContent !== false;
      const content = rawContent
        ? isContentDecoded
          ? decodeZlibBase64Content(rawContent)
          : rawContent
        : null;

      const responsePayload = {
        id: latestBoardId,
        name: latestBoardName,
        createdAt: latestBoardCreatedAt,
        updatedAt: latestBoardUpdatedAt,
        content,
        isContentDecoded,
        contentSource,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(responsePayload, null, 2) }],
      };
    }
  );

  server.registerTool(
    "export-board-content",
    {
      title: "Export Board Content",
      description: "Export board content as punctuation-split JSON or plain text.",
      inputSchema: {
        format: z
          .enum(["punctuation-json", "text"])
          .describe("Output format (punctuation-json or text)"),
        outputPath: z.string().optional().describe("Optional output file path"),
        boardId: z.string().optional().describe("Board ID to export (default: latest board)"),
        fileMetaId: z.string().optional().describe("File metadata ID (optional)"),
        limit: z
          .number()
          .optional()
          .describe("Number of boards to inspect (default: 50)"),
      },
    },
    async (args) => {
      let targetBoardId = args.boardId;
      let targetFileMetaId = args.fileMetaId;

      if (!targetBoardId) {
        const params = new URLSearchParams();
        const limit = args.limit ?? 50;
        params.append("page", "1");
        params.append("limit", limit.toString());
        params.append("sort", "createTime.desc");

        const listResponse = await fetch(
          `${client.baseUrl}/v2/boards?${params.toString()}`,
          { headers: client.getAuthHeaders() }
        );

        if (!listResponse.ok) {
          throw new Error(`Failed to fetch boards: ${listResponse.statusText}`);
        }

        const listData = (await listResponse.json()) as unknown;
        const boards = normalizeBoardList(listData);
        const latestBoard = pickLatestBoard(boards);

        if (!latestBoard) {
          throw new Error("No boards found to determine latest board.");
        }

        targetBoardId = latestBoard.id as string | undefined;
        targetFileMetaId =
          targetFileMetaId ?? (latestBoard.fileMetaId as string | undefined);
      }

      if (!targetBoardId && !targetFileMetaId) {
        throw new Error("Provide boardId or fileMetaId.");
      }

      const detailParams = new URLSearchParams();
      detailParams.append("includeContent", "true");

      let rawContent: string | undefined;
      let contentSource = "board";

      if (targetFileMetaId) {
        const scriptResponse = await fetch(
          `${client.baseUrl}/file-meta/${targetFileMetaId}/script?${detailParams.toString()}`,
          { headers: client.getAuthHeaders() }
        );

        if (scriptResponse.ok) {
          const scriptData = (await scriptResponse.json()) as
            | { content?: string; script?: string; text?: string; item?: string }
            | string;
          if (typeof scriptData === "string") {
            rawContent = scriptData;
          } else {
            rawContent =
              scriptData.content ??
              scriptData.script ??
              scriptData.text ??
              scriptData.item;
          }
          contentSource = "file-meta";
        }
      }

      if (!rawContent) {
        if (!targetBoardId) {
          throw new Error("Board detail fetch requires boardId.");
        }

        let detailResponse = await fetch(
          `${client.baseUrl}/v2/boards/${targetBoardId}?${detailParams.toString()}`,
          { headers: client.getAuthHeaders() }
        );

        if (!detailResponse.ok) {
          detailResponse = await fetch(
            `${client.baseUrl}/boards/${targetBoardId}?${detailParams.toString()}`,
            { headers: client.getAuthHeaders() }
          );
        }

        if (!detailResponse.ok) {
          throw new Error(`Failed to fetch board detail: ${detailResponse.statusText}`);
        }

        const detailData = (await detailResponse.json()) as DagloBoardDetail;
        rawContent = detailData.content;
      }

      const normalizedContent = rawContent ? normalizeScriptContent(rawContent) : "";
      const tokens = extractKaraokeTokens(normalizedContent);

      if (args.format === "punctuation-json") {
        const segments = splitTokensByPunctuation(tokens);
        const outputPath =
          args.outputPath ??
          resolve(process.cwd(), ".code/latest-board-segments.json");
        writeFileSync(outputPath, JSON.stringify(segments, null, 2), "utf8");

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  outputPath,
                  segmentCount: segments.length,
                  contentSource,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      let plainText = buildPlainTextFromTokens(tokens);
      if (!plainText && normalizedContent) {
        plainText = normalizedContent;
      }
      const outputPath =
        args.outputPath ?? resolve(process.cwd(), ".code/latest-board-content.txt");
      writeFileSync(outputPath, plainText, "utf8");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                outputPath,
                contentLength: plainText.length,
                contentSource,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
};
