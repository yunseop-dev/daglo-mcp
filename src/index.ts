import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import * as z from "zod";
import {
  type DagloBoard,
  type DagloBoardDetail,
  type DagloFolder,
  type DagloQuota,
  type DagloPlan,
} from "./types.js";
import { logger, redactSensitiveData } from "./logger.js";

const DAGLO_API_BASE = "https://backend.daglo.ai";
const DAGLO_AI_CHAT_BASE_ENV = "DAGLO_AI_CHAT_BASE_URL";
const DAGLO_EMAIL_ENV = "DAGLO_EMAIL";
const DAGLO_PASSWORD_ENV = "DAGLO_PASSWORD";
const DAGLO_REFRESH_TOKEN_ENV = "DAGLO_REFRESH_TOKEN";

const decodeZlibBase64Content = (value: string) => {
  if (!value) return value;

  try {
    const buffer = Buffer.from(value, "base64");
    const inflated = inflateSync(buffer);
    return inflated.toString("utf-8");
  } catch {
    return value;
  }
};

const normalizePath = (path: string) => {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
};

const appendQueryParams = (
  url: URL,
  query?: Record<string, unknown> | null
) => {
  if (!query) return;

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) return;

    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry === undefined || entry === null) return;
        url.searchParams.append(key, String(entry));
      });
      return;
    }

    url.searchParams.append(key, String(value));
  });
};

const buildUrl = (
  baseUrl: string,
  path: string,
  query?: Record<string, unknown>
) => {
  const normalizedPath = normalizePath(path);
  const url = new URL(normalizedPath, baseUrl);
  appendQueryParams(url, query);
  return url.toString();
};

const parseResponseBody = async (response: Response) => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

type KaraokeToken = {
  text: string;
  startTime: number;
  endTime: number;
};

const collectKaraokeTokens = (node: unknown, tokens: KaraokeToken[]) => {
  if (!node) return;

  if (Array.isArray(node)) {
    node.forEach((child) => collectKaraokeTokens(child, tokens));
    return;
  }

  if (typeof node !== "object") return;

  const typedNode = node as Record<string, unknown>;
  if (
    typedNode.type === "karaoke" &&
    typeof typedNode.text === "string" &&
    typeof typedNode.s === "number" &&
    typeof typedNode.e === "number"
  ) {
    tokens.push({
      text: typedNode.text,
      startTime: typedNode.s,
      endTime: typedNode.e,
    });
  }

  if (typedNode.children) {
    collectKaraokeTokens(typedNode.children, tokens);
  }
};

const extractKaraokeTokens = (content: string) => {
  const tokens: KaraokeToken[] = [];
  if (!content) return tokens;

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.text === "string") {
        return extractKaraokeTokens(parsed.text);
      }
      if (parsed.item && typeof parsed.item === "string") {
        return extractKaraokeTokens(parsed.item);
      }
      if (parsed.content && typeof parsed.content === "string") {
        return extractKaraokeTokens(parsed.content);
      }
    }
    if (parsed?.editorState) {
      const editorState = parsed.editorState as Record<string, unknown>;
      if (editorState?.root) {
        collectKaraokeTokens(editorState.root, tokens);
      } else {
        collectKaraokeTokens(editorState, tokens);
      }
    } else {
      collectKaraokeTokens(parsed, tokens);
    }
  } catch {
    return tokens;
  }

  return tokens;
};

const splitTokensByPunctuation = (tokens: KaraokeToken[]) => {
  const segments: Array<{ text: string; startTime: number; endTime: number }> =
    [];
  let currentText = "";
  let startTime: number | null = null;
  let endTime: number | null = null;

  tokens.forEach((token) => {
    if (startTime === null) {
      startTime = token.startTime;
    }
    endTime = token.endTime;
    currentText += token.text;

    if (/[?.!]/.test(token.text)) {
      segments.push({
        text: currentText.trim(),
        startTime,
        endTime: endTime ?? token.endTime,
      });
      currentText = "";
      startTime = null;
      endTime = null;
    }
  });

  if (currentText.trim().length > 0 && startTime !== null && endTime !== null) {
    segments.push({
      text: currentText.trim(),
      startTime,
      endTime,
    });
  }

  return segments;
};

const buildPlainTextFromTokens = (tokens: KaraokeToken[]) => {
  return tokens.map((token) => token.text).join("").trim();
};

const decodeScriptItem = (value: unknown) => {
  if (!value || typeof value !== "string") return null;
  const inflated = decodeZlibBase64Content(value);
  if (!inflated) return null;
  try {
    return JSON.parse(inflated) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const buildScriptPages = (
  script: Record<string, unknown>,
  totalPages: number,
  minutesPerPage: number
) => {
  const editorState = script.editorState as
    | { root?: { children?: Array<Record<string, unknown>> } }
    | undefined;
  const paragraphs = editorState?.root?.children;
  if (!Array.isArray(paragraphs) || totalPages < 1) return [];

  const pages: Array<Record<string, unknown>> = [];

  for (let page = 1; page <= totalPages; page += 1) {
    const min = (page - 1) * minutesPerPage * 60;
    const max = page * minutesPerPage * 60;
    const slicedParagraphs = paragraphs.filter((value) => {
      const children = value.children as Array<Record<string, unknown>> | undefined;
      const time = typeof children?.[0]?.time === "number" ? children?.[0]?.time : 0;
      if (page === 1) {
        return min <= time && time <= max;
      }
      return min < time && time <= max;
    });

    pages.push({
      ...script,
      editorState: {
        root: {
          children: slicedParagraphs,
          format: "",
          type: "root",
          version: 1,
        },
      },
    });
  }

  return pages;
};

const normalizeBoardList = (data: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(data)) {
    return data as Array<Record<string, unknown>>;
  }

  if (data && typeof data === "object") {
    const items = (data as { items?: unknown }).items;
    if (Array.isArray(items)) {
      return items as Array<Record<string, unknown>>;
    }
  }

  return [];
};

const pickLatestBoard = (boards: Array<Record<string, unknown>>) => {
  if (!boards.length) return null;

  return boards.reduce((latest, current) => {
    const latestTime = Date.parse(
      (latest.createdAt as string | undefined) ??
        (latest.updatedAt as string | undefined) ??
        (latest.createTime as string | undefined) ??
        (latest.updateTime as string | undefined) ??
        ""
    );
    const currentTime = Date.parse(
      (current.createdAt as string | undefined) ??
        (current.updatedAt as string | undefined) ??
        (current.createTime as string | undefined) ??
        (current.updateTime as string | undefined) ??
        ""
    );

    if (Number.isNaN(latestTime)) return current;
    if (Number.isNaN(currentTime)) return latest;

    return currentTime > latestTime ? current : latest;
  }, boards[0]);
};

const getLoginPayload = (args: { email?: string; password?: string }) => {
  const email = args.email ?? process.env[DAGLO_EMAIL_ENV];
  const password = args.password ?? process.env[DAGLO_PASSWORD_ENV];

  logger.debug({ email }, "Attempting to get login payload");

  if (!email || !password) {
    const missing = [
      email ? null : DAGLO_EMAIL_ENV,
      password ? null : DAGLO_PASSWORD_ENV,
    ]
      .filter(Boolean)
      .join(", ");

    logger.error({ missing }, "Login failed: missing credentials");
    throw new Error(
      `Login failed: missing credentials. Provide email/password or set ${missing}.`
    );
  }

  const payload = { email, password };
  logger.debug({ email, hasPassword: !!password }, "Login payload created");

  return payload;
};

const getJsonFromResponse = async (response: Response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as { token?: string; refreshToken?: string } | null;
  } catch {
    return null;
  }
};

const getAccessTokenFromResponse = (
  response: Response,
  data: { token?: string } | null
) => {
  const headerToken = response.headers.get("accesstoken");
  const bodyToken = data?.token;
  const token = headerToken ?? bodyToken;

  logger.debug(
    {
      hasHeaderToken: !!headerToken,
      hasBodyToken: !!bodyToken,
      tokenSource: headerToken ? "header" : bodyToken ? "body" : "none",
    },
    "Extracting access token from response"
  );

  if (!token) {
    logger.warn(
      {
        responseStatus: response.status,
        responseHeaders: Array.from(response.headers.entries()),
      },
      "No access token found in response"
    );
  }

  return token;
};

const getRefreshTokenFromResponse = (
  response: Response,
  data: { refreshToken?: string } | null
) => {
  const headerToken = response.headers.get("refreshtoken");
  const bodyToken = data?.refreshToken;
  const token = headerToken ?? bodyToken;

  logger.debug(
    {
      hasHeaderToken: !!headerToken,
      hasBodyToken: !!bodyToken,
      tokenSource: headerToken ? "header" : bodyToken ? "body" : "none",
    },
    "Extracting refresh token from response"
  );

  return token;
};

class DagloMcpServer {
  private server: McpServer;
  private accessToken?: string;
  private refreshToken?: string;

  constructor() {
    this.server = new McpServer({
      name: "daglo-mcp-server",
      version: "1.0.0",
    });
  }

  async start() {
    this.registerTools();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  private registerTools() {
    this.server.registerTool(
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
          page: z
            .number()
            .optional()
            .describe("Page index for script API (default: 0)"),
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

        const url = buildUrl(DAGLO_API_BASE, path, {
          limit,
          page,
        });

        const response = await fetch(url, this.getAuthHeaders());
        if (!response.ok) {
          throw new Error(`Failed to fetch script: ${response.statusText}`);
        }

        const data = (await response.json()) as {
          item?: string;
          meta?: { totalPages?: number };
        };
        const script = decodeScriptItem(data?.item);
        const totalPages = data?.meta?.totalPages ?? 1;
        const pages = script && buildPages
          ? buildScriptPages(script, totalPages, limit)
          : [];

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

    this.server.registerTool(
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
          status: z
            .enum(["COMPLETE", "PROCESSING", "FAILED"])
            .optional()
            .describe("Filter by board status"),
          isStarred: z
            .boolean()
            .optional()
            .describe("Filter by starred boards"),
          search: z.string().optional().describe("Filter by board name"),
          uploadTypes: z
            .array(z.string())
            .optional()
            .describe("Filter by upload types"),
          folderIds: z
            .array(z.string())
            .optional()
            .describe("Filter by folder IDs"),
          withDeleted: z
            .boolean()
            .optional()
            .describe("Include deleted boards"),
          startDate: z
            .string()
            .optional()
            .describe("Filter start date (ISO string)"),
          endDate: z
            .string()
            .optional()
            .describe("Filter end date (ISO string)"),
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
          args.uploadTypes.forEach((type) =>
            params.append("filter.uploadTypes", type)
          );
        }
        if (args.folderIds?.length) {
          args.folderIds.forEach((id) =>
            params.append("filter.folderIds", id)
          );
        }
        if (args.startDate) params.append("filter.startDate", args.startDate);
        if (args.endDate) params.append("filter.endDate", args.endDate);
        if (args.withDeleted !== undefined) {
          params.append("filter.withDeleted", String(args.withDeleted));
        }

        const response = await fetch(
          `${DAGLO_API_BASE}/v2/boards?${params.toString()}`,
          this.getAuthHeaders()
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

    this.server.registerTool(
      "get-board-detail",
      {
        title: "Get Board Detail",
        description:
          "Retrieve detailed information including content, summary, keywords, AI summary, and segments for a specific board. Supports filtering which data to include.",
        inputSchema: {
          boardId: z.string().describe("Board ID to fetch details for"),
          fileMetaId: z
            .string()
            .optional()
            .describe("File metadata ID (optional)"),
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
        },
      },
      async (args) => {
        const params = new URLSearchParams();
        if (args.includeContent !== false) params.append("includeContent", "true");
        if (args.includeSummary !== false) params.append("includeSummary", "true");
        if (args.includeKeywords !== false) params.append("includeKeywords", "true");
        if (args.includeAiSummary !== false) params.append("includeAiSummary", "true");
        if (args.includeSegments !== false) params.append("includeSegments", "true");

        // Try file-meta API first (for script content)
        if (args.fileMetaId) {
          const scriptResponse = await fetch(
            `${DAGLO_API_BASE}/file-meta/${args.fileMetaId}/script?${params.toString()}`,
            this.getAuthHeaders()
          );

          if (scriptResponse.ok) {
            const scriptData = await scriptResponse.json();
            return {
              content: [
                { type: "text", text: JSON.stringify(scriptData, null, 2) },
              ],
            };
          }
        }

        // Fall back to boards API
        const response = await fetch(
          `${DAGLO_API_BASE}/boards/${args.boardId}`,
          this.getAuthHeaders()
        );

        if (!response.ok) {
          throw new Error(
            `Failed to fetch board detail: ${response.statusText}`
          );
        }

        const fullData = (await response.json()) as DagloBoardDetail;

        const filteredData: Partial<DagloBoardDetail> = {
          id: fullData.id,
          name: fullData.name,
          status: fullData.status,
          type: fullData.type,
          createdAt: fullData.createdAt,
          updatedAt: fullData.updatedAt,
          isStarred: fullData.isStarred,
          folderId: fullData.folderId,
        };

        if (args.includeContent !== false && fullData.content) {
          filteredData.content = fullData.content;
        }

        if (args.includeSummary !== false && fullData.summary) {
          filteredData.summary = fullData.summary;
        }

        if (args.includeKeywords !== false && fullData.keywords) {
          filteredData.keywords = fullData.keywords;
        }

        if (args.includeAiSummary !== false && fullData.aiSummary) {
          filteredData.aiSummary = fullData.aiSummary;
        }

        if (args.includeSegments !== false && fullData.segments) {
          filteredData.segments = fullData.segments;
        }

        return {
          content: [
            { type: "text", text: JSON.stringify(filteredData, null, 2) },
          ],
        };
      }
    );

    this.server.registerTool(
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

        const listResponse = await fetch(
          `${DAGLO_API_BASE}/v2/boards?${params.toString()}`,
          this.getAuthHeaders()
        );

        if (!listResponse.ok) {
          throw new Error(
            `Failed to fetch boards: ${listResponse.statusText}`
          );
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

        const latestBoardFileMetaId = latestBoard.fileMetaId as
          | string
          | undefined;
        if (latestBoardFileMetaId) {
          const scriptResponse = await fetch(
            `${DAGLO_API_BASE}/file-meta/${latestBoardFileMetaId}/script?${detailParams.toString()}`,
            this.getAuthHeaders()
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
            `${DAGLO_API_BASE}/v2/boards/${latestBoardId}?${detailParams.toString()}`,
            this.getAuthHeaders()
          );

          if (!detailResponse.ok) {
            detailResponse = await fetch(
              `${DAGLO_API_BASE}/boards/${latestBoardId}?${detailParams.toString()}`,
              this.getAuthHeaders()
            );
          }

          if (!detailResponse.ok) {
            throw new Error(
              `Failed to fetch board detail: ${detailResponse.statusText}`
            );
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
          content: [
            { type: "text", text: JSON.stringify(responsePayload, null, 2) },
          ],
        };
      }
    );

    this.server.registerTool(
      "export-board-content",
      {
        title: "Export Board Content",
        description:
          "Export board content as punctuation-split JSON or plain text.",
        inputSchema: {
          format: z
            .enum(["punctuation-json", "text"])
            .describe("Output format (punctuation-json or text)"),
          outputPath: z
            .string()
            .optional()
            .describe("Optional output file path"),
          boardId: z
            .string()
            .optional()
            .describe("Board ID to export (default: latest board)"),
          fileMetaId: z
            .string()
            .optional()
            .describe("File metadata ID (optional)"),
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

          const listResponse = await fetch(
            `${DAGLO_API_BASE}/v2/boards?${params.toString()}`,
            this.getAuthHeaders()
          );

          if (!listResponse.ok) {
            throw new Error(
              `Failed to fetch boards: ${listResponse.statusText}`
            );
          }

          const listData = (await listResponse.json()) as unknown;
          const boards = normalizeBoardList(listData);
          const latestBoard = pickLatestBoard(boards);

          if (!latestBoard) {
            throw new Error("No boards found to determine latest board.");
          }

          targetBoardId = latestBoard.id as string | undefined;
          targetFileMetaId =
            targetFileMetaId ??
            (latestBoard.fileMetaId as string | undefined);
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
            `${DAGLO_API_BASE}/file-meta/${targetFileMetaId}/script?${detailParams.toString()}`,
            this.getAuthHeaders()
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
            `${DAGLO_API_BASE}/v2/boards/${targetBoardId}?${detailParams.toString()}`,
            this.getAuthHeaders()
          );

          if (!detailResponse.ok) {
            detailResponse = await fetch(
              `${DAGLO_API_BASE}/boards/${targetBoardId}?${detailParams.toString()}`,
              this.getAuthHeaders()
            );
          }

          if (!detailResponse.ok) {
            throw new Error(
              `Failed to fetch board detail: ${detailResponse.statusText}`
            );
          }

          const detailData = (await detailResponse.json()) as DagloBoardDetail;
          rawContent = detailData.content;
        }

        const decodedContent = rawContent
          ? decodeZlibBase64Content(rawContent)
          : "";
        const normalizedContent =
          decodedContent && decodedContent.trim().startsWith("{")
            ? decodeZlibBase64Content(decodedContent)
            : decodedContent;
        const tokens = extractKaraokeTokens(normalizedContent);

        if (args.format === "punctuation-json") {
          const segments = splitTokensByPunctuation(tokens);
          const outputPath =
            args.outputPath ??
            "/Users/bez/development/daglo-mcp/.code/latest-board-segments.json";
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
          args.outputPath ??
          "/Users/bez/development/daglo-mcp/.code/latest-board-content.txt";
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

    this.server.registerTool(
      "get-folders",
      {
        title: "Get Folders",
        description: "Retrieve all folders from Daglo",
        inputSchema: {
          includeRoot: z
            .boolean()
            .optional()
            .describe("Include root folder (default: true)"),
        },
      },
      async (args) => {
        const params = new URLSearchParams();
        if (args.includeRoot !== undefined) {
          params.append("includeRoot", args.includeRoot.toString());
        }

        const response = await fetch(
          `${DAGLO_API_BASE}/folders?${params.toString()}`,
          this.getAuthHeaders()
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch folders: ${response.statusText}`);
        }

        const data = (await response.json()) as unknown;
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "get-quotas",
      {
        title: "Get Transcription Quota",
        description: "Retrieve transcription quota information",
        inputSchema: {},
      },
      async () => {
        const response = await fetch(
          `${DAGLO_API_BASE}/transcript-request/quota`,
          this.getAuthHeaders()
        );

        if (!response.ok) {
          throw new Error(
            `Failed to fetch transcription quota: ${response.statusText}`
          );
        }

        const data = (await response.json()) as unknown;
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "get-quota-v2",
      {
        title: "Get Quota (v2)",
        description: "Retrieve usage quota by type (e.g. pdf)",
        inputSchema: {
          type: z
            .string()
            .describe("Quota type (e.g. pdf, transcription)"),
        },
      },
      async (args) => {
        const params = new URLSearchParams();
        params.append("type", args.type);

        const response = await fetch(
          `${DAGLO_API_BASE}/quota?${params.toString()}`,
          this.getAuthHeaders()
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch quota v2: ${response.statusText}`);
        }

        const data = (await response.json()) as unknown;
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "get-plans",
      {
        title: "Get Plans",
        description: "Retrieve available subscription plans from Daglo",
        inputSchema: {
          publicOnly: z
            .boolean()
            .optional()
            .describe("Use public plan list endpoint (default: false)"),
        },
      },
      async (args) => {
        const path = args.publicOnly
          ? "/store/products/public"
          : "/store/products";
        const response = await fetch(
          `${DAGLO_API_BASE}${path}`,
          this.getAuthHeaders()
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch plans: ${response.statusText}`);
        }

        const data = (await response.json()) as unknown;
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "login",
      {
        title: "Login to Daglo",
        description: "Authenticate with Daglo using email and password",
        inputSchema: {
          email: z
            .string()
            .email()
            .optional()
            .describe("Daglo account email (default: env DAGLO_EMAIL)"),
          password: z
            .string()
            .min(1)
            .optional()
            .describe("Daglo account password (default: env DAGLO_PASSWORD)"),
        },
      },
      async (args) => {
        const loginId = Math.random().toString(36).substring(7);
        logger.info(
          { loginId, email: args.email || "from-env" },
          "Login request started"
        );

        try {
          const payload = getLoginPayload(args);

          logger.debug(
            { loginId, url: `${DAGLO_API_BASE}/user/login` },
            "Sending login request"
          );

          const response = await fetch(`${DAGLO_API_BASE}/user/login`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "daglo-platform": "web",
            },
            body: JSON.stringify(payload),
          });

          logger.debug(
            {
              loginId,
              status: response.status,
              statusText: response.statusText,
            },
            "Login request completed"
          );

          if (!response.ok) {
            const errorText = await response.text();
            logger.error(
              {
                loginId,
                status: response.status,
                statusText: response.statusText,
                responseBody: errorText,
                responseHeaders: Array.from(response.headers.entries()),
              },
              "Login request failed"
            );
            throw new Error(`Login failed: ${response.statusText}`);
          }

          const data = await getJsonFromResponse(response);
          logger.debug({ loginId, hasData: !!data }, "Response data parsed");

          this.accessToken = getAccessTokenFromResponse(response, data);
          this.refreshToken = getRefreshTokenFromResponse(response, data);

          if (!this.accessToken) {
            logger.error(
              { loginId, data },
              "Login failed: access token not found"
            );
            throw new Error(
              "Login failed: access token not found in response headers."
            );
          }

          logger.info({ loginId }, "Login successful, access token stored");

          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          logger.error({ loginId, error }, "Login request threw an error");
          throw error;
        }
      }
    );

    // Register Bookmarks tools
    this.server.registerTool(
      "get-bookmarks",
      {
        title: "Get Bookmarks",
        description:
          "Retrieve all bookmarks from a specific board with optional pagination",
        inputSchema: {
          boardId: z
            .string()
            .min(1)
            .describe("Board ID to fetch bookmarks for"),
          page: z
            .number()
            .optional()
            .describe("Page number (default: 1)"),
          limit: z
            .number()
            .optional()
            .describe("Number of bookmarks per page (default: 50)"),
        },
      },
      async (args) => {
        const { boardId, page = 1, limit = 50 } = args as {
          boardId: string;
          page?: number;
          limit?: number;
        };

        try {
          const params = new URLSearchParams();
          params.set("page", String(page));
          params.set("limit", String(limit));

          const response = await fetch(
            `${DAGLO_API_BASE}/v2/boards/${boardId}/bookmarks?${params.toString()}`,
            this.getAuthHeaders()
          );

          if (!response.ok) {
            throw new Error(
              `Failed to fetch bookmarks: ${response.statusText}`
            );
          }

          const data = (await response.json()) as unknown;
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          logger.error({ boardId, error }, "Get bookmarks failed");
          throw error;
        }
      }
    );

    this.server.registerTool(
      "create-bookmark",
      {
        title: "Create Bookmark",
        description: "Create a new bookmark in a board at a specific timestamp",
        inputSchema: {
          boardId: z
            .string()
            .min(1)
            .describe("Board ID to create bookmark in"),
          title: z.string().min(1).describe("Bookmark title"),
          timestamp: z
            .number()
            .optional()
            .describe("Timestamp in seconds"),
          description: z
            .string()
            .optional()
            .describe("Bookmark description"),
        },
      },
      async (args) => {
        const { boardId, title, timestamp, description } = args as {
          boardId: string;
          title: string;
          timestamp?: number;
          description?: string;
        };

        try {
          const payload = { title, timestamp, description };

          const response = await fetch(
            `${DAGLO_API_BASE}/v2/boards/${boardId}/bookmarks`,
            {
              method: "POST",
              ...this.getAuthHeaders(),
              body: JSON.stringify(payload),
            }
          );

          if (!response.ok) {
            throw new Error(
              `Failed to create bookmark: ${response.statusText}`
            );
          }

          const data = (await response.json()) as unknown;
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          logger.error({ boardId, title, error }, "Create bookmark failed");
          throw error;
        }
      }
    );

    // Register Notifications tools
    this.server.registerTool(
      "get-notifications",
      {
        title: "Get Notifications",
        description:
          "Retrieve user notifications with optional filtering by read status",
        inputSchema: {
          isRead: z
            .boolean()
            .optional()
            .describe("Filter by read status (true/false)"),
          page: z
            .number()
            .optional()
            .describe("Page number (default: 1)"),
          limit: z
            .number()
            .optional()
            .describe("Number of notifications per page (default: 20)"),
        },
      },
      async (args) => {
        const { isRead, page = 1, limit = 20 } = args as {
          isRead?: boolean;
          page?: number;
          limit?: number;
        };

        try {
          const params = new URLSearchParams();
          params.set("page", String(page));
          params.set("limit", String(limit));
          if (isRead !== undefined) {
            params.set("isRead", String(isRead));
          }

          const response = await fetch(
            `${DAGLO_API_BASE}/notifications?${params.toString()}`,
            this.getAuthHeaders()
          );

          if (!response.ok) {
            throw new Error(
              `Failed to fetch notifications: ${response.statusText}`
            );
          }

          const data = (await response.json()) as unknown;
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          logger.error({ error }, "Get notifications failed");
          throw error;
        }
      }
    );

    this.server.registerTool(
      "mark-notification-read",
      {
        title: "Mark Notification Read",
        description: "Mark a notification as read",
        inputSchema: {
          notificationId: z
            .string()
            .min(1)
            .describe("Notification ID to mark as read"),
        },
      },
      async (args) => {
        const { notificationId } = args as { notificationId: string };

        try {
          const response = await fetch(
            `${DAGLO_API_BASE}/notifications/${notificationId}/read`,
            {
              method: "PUT",
              ...this.getAuthHeaders(),
            }
          );

          if (!response.ok) {
            throw new Error(
              `Failed to mark notification as read: ${response.statusText}`
            );
          }

          const data = (await response.json()) as unknown;
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          logger.error(
            { notificationId, error },
            "Mark notification read failed"
          );
          throw error;
        }
      }
    );

    // Register User Dictionary tools
    this.server.registerTool(
      "get-user-dictionary",
      {
        title: "Get User Dictionary",
        description: "Retrieve user's custom dictionary with optional filtering",
        inputSchema: {
          category: z
            .string()
            .optional()
            .describe("Filter by category"),
          page: z
            .number()
            .optional()
            .describe("Page number (default: 1)"),
          limit: z
            .number()
            .optional()
            .describe("Number of words per page (default: 50)"),
        },
      },
      async (args) => {
        const { category, page = 1, limit = 50 } = args as {
          category?: string;
          page?: number;
          limit?: number;
        };

        try {
          const params = new URLSearchParams();
          params.set("page", String(page));
          params.set("limit", String(limit));
          if (category) {
            params.set("category", category);
          }

          const response = await fetch(
            `${DAGLO_API_BASE}/user/dictionary?${params.toString()}`,
            this.getAuthHeaders()
          );

          if (!response.ok) {
            throw new Error(
              `Failed to fetch user dictionary: ${response.statusText}`
            );
          }

          const data = (await response.json()) as unknown;
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          logger.error({ error }, "Get user dictionary failed");
          throw error;
        }
      }
    );

    this.server.registerTool(
      "add-dictionary-word",
      {
        title: "Add Dictionary Word",
        description: "Add a word to the user's custom dictionary",
        inputSchema: {
          word: z.string().min(1).describe("Word to add"),
          pronunciation: z
            .string()
            .optional()
            .describe("Pronunciation guide"),
          definition: z.string().optional().describe("Word definition"),
          category: z
            .string()
            .optional()
            .describe("Dictionary category"),
        },
      },
      async (args) => {
        const { word, pronunciation, definition, category } = args as {
          word: string;
          pronunciation?: string;
          definition?: string;
          category?: string;
        };

        try {
          const payload = { word, pronunciation, definition, category };

          const response = await fetch(
            `${DAGLO_API_BASE}/user/dictionary`,
            {
              method: "POST",
              ...this.getAuthHeaders(),
              body: JSON.stringify(payload),
            }
          );

          if (!response.ok) {
            throw new Error(
              `Failed to add dictionary word: ${response.statusText}`
            );
          }

          const data = (await response.json()) as unknown;
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          logger.error({ word, error }, "Add dictionary word failed");
          throw error;
        }
      }
    );

    this.server.registerTool(
      "delete-dictionary-word",
      {
        title: "Delete Dictionary Word",
        description: "Delete a word from the user's custom dictionary",
        inputSchema: {
          wordId: z
            .string()
            .min(1)
            .describe("Word ID to delete"),
        },
      },
      async (args) => {
        const { wordId } = args as { wordId: string };

        try {
          const response = await fetch(
            `${DAGLO_API_BASE}/user/dictionary/${wordId}`,
            {
              method: "DELETE",
              ...this.getAuthHeaders(),
            }
          );

          if (!response.ok) {
            throw new Error(
              `Failed to delete dictionary word: ${response.statusText}`
            );
          }

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: true, message: "Word deleted" }),
              },
            ],
          };
        } catch (error) {
          logger.error({ wordId, error }, "Delete dictionary word failed");
          throw error;
        }
      }
    );

    // USER SETTINGS & PROFILE TOOLS

    this.server.registerTool(
      "get-user-profile",
      {
        title: "Get User Profile",
        description: "Retrieve the current user's profile information",
        inputSchema: {},
      },
      async () => {
        try {
          const response = await fetch(`${DAGLO_API_BASE}/user`, this.getAuthHeaders());

          if (!response.ok) {
            throw new Error(`Failed to fetch user profile: ${response.statusText}`);
          }

          const profile = (await response.json()) as Record<string, unknown>;
          
          logger.debug({ userId: profile.id }, "User profile retrieved");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(profile, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error({ error }, "Get user profile failed");
          throw error;
        }
      }
    );

    this.server.registerTool(
      "update-user-profile",
      {
        title: "Update User Profile",
        description: "Update the current user's profile information",
        inputSchema: {
          name: z.string().optional().describe("User's full name"),
          marketingAgreement: z
            .boolean()
            .optional()
            .describe("Marketing consent"),
          dataAgreement: z
            .boolean()
            .optional()
            .describe("Data usage consent"),
          profileBackground: z
            .enum(["SECONDARY_ROSE", "WARNING", "SUCCESS", "PRIMARY", "SECONDARY_VIOLET"])
            .optional()
            .describe("Profile background color theme"),
        },
      },
      async (args) => {
        const requestBody: Record<string, unknown> = {};
        if (args.name) requestBody.name = args.name;
        if (args.marketingAgreement !== undefined) requestBody.marketingAgreement = args.marketingAgreement;
        if (args.dataAgreement !== undefined) requestBody.dataAgreement = args.dataAgreement;
        if (args.profileBackground) requestBody.profileBackground = args.profileBackground;

        try {
          const response = await fetch(`${DAGLO_API_BASE}/user`, {
            method: "PATCH",
            ...this.getAuthHeaders(),
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            throw new Error(
              `Failed to update user profile: ${response.statusText}`
            );
          }

          const updated = (await response.json()) as Record<string, unknown>;

          logger.debug({ userId: updated.id }, "User profile updated");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(updated, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error({ error }, "Update user profile failed");
          throw error;
        }
      }
    );

    this.server.registerTool(
      "get-user-email",
      {
        title: "Get User Email",
        description: "Retrieve the current user's email address",
        inputSchema: {},
      },
      async () => {
        try {
          const response = await fetch(
            `${DAGLO_API_BASE}/user/email`,
            this.getAuthHeaders()
          );

          if (!response.ok) {
            throw new Error(`Failed to fetch user email: ${response.statusText}`);
          }

          const data = (await response.json()) as { email?: string };

          logger.debug("User email retrieved");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(data, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error({ error }, "Get user email failed");
          throw error;
        }
      }
    );

    // NOTIFICATION SETTINGS TOOLS

    this.server.registerTool(
      "get-notification-options",
      {
        title: "Get Notification Options",
        description: "Retrieve the user's notification preferences",
        inputSchema: {},
      },
      async () => {
        try {
          const response = await fetch(
            `${DAGLO_API_BASE}/user-option/notification`,
            this.getAuthHeaders()
          );

          if (!response.ok) {
            throw new Error(
              `Failed to fetch notification options: ${response.statusText}`
            );
          }

          const options = (await response.json()) as Array<Record<string, unknown>>;

          logger.debug({ count: options.length }, "Notification options retrieved");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(options, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error({ error }, "Get notification options failed");
          throw error;
        }
      }
    );

    this.server.registerTool(
      "update-notification-option",
      {
        title: "Update Notification Option",
        description: "Update a specific notification preference",
        inputSchema: {
          type: z
            .enum(["EMAIL", "MOBILE"])
            .describe("Notification delivery method"),
          category: z
            .enum(["MARKETING", "TRANSCRIPT", "LONG_SUMMARY"])
            .describe("Notification category"),
          value: z.boolean().describe("Enable or disable this notification"),
        },
      },
      async (args) => {
        const requestBody = {
          type: args.type,
          category: args.category,
          value: args.value,
        };

        try {
          const response = await fetch(
            `${DAGLO_API_BASE}/v2/user-option/notification`,
            {
              method: "PATCH",
              ...this.getAuthHeaders(),
              body: JSON.stringify(requestBody),
            }
          );

          if (!response.ok) {
            throw new Error(
              `Failed to update notification option: ${response.statusText}`
            );
          }

          const updated = (await response.json()) as Record<string, unknown>;

          logger.debug(
            { type: args.type, category: args.category },
            "Notification option updated"
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(updated, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error({ error }, "Update notification option failed");
          throw error;
        }
      }
    );

    // SUMMARY LANGUAGE TOOLS

    this.server.registerTool(
      "get-summary-language",
      {
        title: "Get Summary Language Settings",
        description: "Retrieve the user's summary language preferences",
        inputSchema: {
          transcriptionLanguage: z
            .enum(["ko-KR", "en-US"])
            .optional()
            .describe("Transcription language"),
        },
      },
      async (args) => {
        const params = new URLSearchParams();
        if (args.transcriptionLanguage) {
          params.append("transcriptionLanguage", args.transcriptionLanguage);
        }

        try {
          const url = `${DAGLO_API_BASE}/user-option/summary/language${params.toString() ? "?" + params.toString() : ""}`;
          const response = await fetch(url, this.getAuthHeaders());

          if (!response.ok) {
            throw new Error(
              `Failed to fetch summary language: ${response.statusText}`
            );
          }

          const settings = (await response.json()) as Record<string, unknown>;

          logger.debug("Summary language settings retrieved");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(settings, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error({ error }, "Get summary language failed");
          throw error;
        }
      }
    );

    this.server.registerTool(
      "update-summary-language",
      {
        title: "Update Summary Language Settings",
        description: "Update the user's summary language preferences",
        inputSchema: {
          transcriptionLanguage: z
            .enum(["ko-KR", "en-US"])
            .describe("Transcription language"),
          summaryLanguage: z
            .enum(["ko-KR", "en-US"])
            .describe("Summary language"),
        },
      },
      async (args) => {
        const requestBody = {
          transcriptionLanguage: args.transcriptionLanguage,
          summaryLanguage: args.summaryLanguage,
        };

        try {
          const response = await fetch(
            `${DAGLO_API_BASE}/user-option/summary/language`,
            {
              method: "PATCH",
              ...this.getAuthHeaders(),
              body: JSON.stringify(requestBody),
            }
          );

          if (!response.ok) {
            throw new Error(
              `Failed to update summary language: ${response.statusText}`
            );
          }

          const updated = (await response.json()) as Record<string, unknown>;

          logger.debug("Summary language settings updated");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(updated, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error({ error }, "Update summary language failed");
          throw error;
        }
      }
    );

    // BOARD SHARING TOOLS

    this.server.registerTool(
      "create-share-link",
      {
        title: "Create/Update Board Share Link",
        description:
          "Create or update a shareable link for a board. Set isShared to false to revoke sharing.",
        inputSchema: {
          boardId: z.string().describe("The board ID to share"),
          isShared: z
            .boolean()
            .optional()
            .describe("Enable sharing (true) or disable (false) - defaults to true"),
          expiredAt: z
            .string()
            .optional()
            .describe("Share expiration date (ISO string)"),
          permission: z
            .number()
            .optional()
            .describe("Permission level (default: 1)"),
          isBookmarkSharable: z
            .boolean()
            .optional()
            .describe("Allow sharing of bookmarks (default: false)"),
        },
      },
      async (args) => {
        const requestBody: Record<string, unknown> = {
          boardId: args.boardId,
        };

        if (args.isShared !== undefined) requestBody.isShared = args.isShared;
        if (args.expiredAt) requestBody.expiredAt = args.expiredAt;
        if (args.permission !== undefined) requestBody.permission = args.permission;
        if (args.isBookmarkSharable !== undefined)
          requestBody.isBookmarkSharable = args.isBookmarkSharable;

        try {
          const response = await fetch(`${DAGLO_API_BASE}/boards/share`, {
            method: "POST",
            ...this.getAuthHeaders(),
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            throw new Error(
              `Failed to create share link: ${response.statusText}`
            );
          }

          const shareData = (await response.json()) as Record<string, unknown>;

          logger.debug({ boardId: args.boardId }, "Share link created/updated");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(shareData, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error({ boardId: args.boardId, error }, "Create share link failed");
          throw error;
        }
      }
    );

    this.server.registerTool(
      "get-shared-board-info",
      {
        title: "Get Shared Board Information",
        description:
          "Retrieve information about a shared board (public access, no authentication required)",
        inputSchema: {
          shareId: z.string().describe("The share ID from the share URL"),
          includeDetails: z
            .boolean()
            .optional()
            .describe("Include full board details"),
        },
      },
      async (args) => {
        const params = new URLSearchParams();
        if (args.includeDetails) {
          params.append("includeDetails", "true");
        }

        try {
          const url = `${DAGLO_API_BASE}/shared-board/${args.shareId}${params.toString() ? "?" + params.toString() : ""}`;
          const response = await fetch(url, {
            headers: {
              "daglo-platform": "web",
            },
          });

          if (!response.ok) {
            throw new Error(
              `Failed to fetch shared board info: ${response.statusText}`
            );
          }

          const boardInfo = (await response.json()) as Record<string, unknown>;

          logger.debug({ shareId: args.shareId }, "Shared board info retrieved");

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(boardInfo, null, 2),
              },
            ],
          };
        } catch (error) {
          logger.error({ shareId: args.shareId, error }, "Get shared board info failed");
          throw error;
        }
      }
    );
  }

  private getAuthHeaders(
    authType: "accessToken" | "refreshToken" | "none" = "accessToken"
  ) {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      "daglo-platform": "web",
    };

    if (authType === "accessToken" && this.accessToken) {
      const headersObj = headers as Record<string, string>;
      headersObj["Authorization"] = `bearer ${this.accessToken}`;
      headersObj["accesstoken"] = this.accessToken;

      logger.debug(
        { hasAccessToken: true, tokenLength: this.accessToken.length },
        "Auth headers generated"
      );
    } else if (authType === "refreshToken") {
      if (!this.refreshToken) {
        this.refreshToken = process.env[DAGLO_REFRESH_TOKEN_ENV];
      }
      if (!this.refreshToken) {
        logger.warn("Refresh auth headers requested without refresh token");
        return { headers };
      }
      const headersObj = headers as Record<string, string>;
      headersObj["Authorization"] = `bearer ${this.refreshToken}`;
      headersObj["refreshtoken"] = this.refreshToken;
      logger.debug(
        { hasRefreshToken: true, tokenLength: this.refreshToken.length },
        "Refresh auth headers generated"
      );
    } else if (authType !== "none") {
      logger.warn("Auth headers generated without access token");
    }

    return { headers };
  }
}

const server = new DagloMcpServer();
server.start().catch(console.error);
