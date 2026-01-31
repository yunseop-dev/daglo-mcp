import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
const DAGLO_AI_BEARER_TOKEN_ENV = "DAGLO_AI_BEARER_TOKEN";
const DAGLO_AI_TOKEN_ENV = "DAGLO_AI_TOKEN";
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

const normalizeScriptContent = (value: string) => {
  if (!value) return value;
  const decoded = decodeZlibBase64Content(value);
  if (!decoded) return decoded;
  if (decoded.trim().startsWith("{")) {
    return decodeZlibBase64Content(decoded);
  }
  return decoded;
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

const sanitizeFilename = (value: string) => {
  if (!value) return "";
  return value
    .trim()
    .replace(/[\/]/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120);
};

const buildDefaultOutputPath = (baseName: string, extension: string) => {
  const normalizedBase = sanitizeFilename(baseName) || "board-detail";
  return resolve(process.cwd(), `${normalizedBase}.${extension}`);
};

const buildPlainTextFromScriptPayload = (
  script: unknown,
  fallbackContent?: string | null
) => {
  let sourceText = "";
  if (script) {
    try {
      sourceText = JSON.stringify(script);
    } catch {
      sourceText = "";
    }
  }

  if (!sourceText && fallbackContent) {
    sourceText = fallbackContent;
  }

  if (!sourceText) return "";
  const tokens = extractKaraokeTokens(sourceText);
  let plainText = buildPlainTextFromTokens(tokens);
  if (!plainText && fallbackContent) {
    plainText = fallbackContent;
  }
  return plainText;
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
  private aiBearerToken?: string;
  private aiToken?: string;

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
        if (args.folderId) params.append("folderId", args.folderId);
        if (args.keyword) params.append("keyword", args.keyword);
        if (args.checkedFilter) params.append("checkedFilter", args.checkedFilter);

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
      "get-board-info",
      {
        title: "Get Board Info",
        description: "Retrieve board info for private or shared boards",
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe("Board ID to fetch (private board)"),
          sharedBoardId: z
            .string()
            .optional()
            .describe("Shared board ID to fetch (public)")
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
          : this.getAuthHeaders();

        const response = await fetch(`${DAGLO_API_BASE}${path}`, headers);
        if (!response.ok) {
          throw new Error(`Failed to fetch board info: ${response.statusText}`);
        }

        const data = await parseResponseBody(response);
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

        // Try file-meta API first (for script content)
        if (args.fileMetaId) {
          const scriptQuery = new URLSearchParams();
          scriptQuery.append("limit", scriptLimit.toString());
          scriptQuery.append("page", scriptPage.toString());
          const scriptResponse = await fetch(
            `${DAGLO_API_BASE}/file-meta/${args.fileMetaId}/script?${scriptQuery.toString()}`,
            this.getAuthHeaders()
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
              `${DAGLO_API_BASE}/file-meta/${args.fileMetaId}/summary`,
              this.getAuthHeaders()
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
              `${DAGLO_API_BASE}/file-meta/${args.fileMetaId}/keyword`,
              this.getAuthHeaders()
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
              `${DAGLO_API_BASE}/file-meta/${args.fileMetaId}/long-summary`,
              this.getAuthHeaders()
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
              `${DAGLO_API_BASE}/file-meta/${args.fileMetaId}/segment-summary`,
              this.getAuthHeaders()
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

        const normalizedContent = rawContent
          ? normalizeScriptContent(rawContent)
          : "";
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
      "get-transcription-options",
      {
        title: "Get Transcription Options",
        description: "Retrieve transcription options",
        inputSchema: {},
      },
      async () => {
        const response = await fetch(
          `${DAGLO_API_BASE}/user-option/transcription`,
          this.getAuthHeaders()
        );

        if (!response.ok) {
          throw new Error(
            `Failed to fetch transcription options: ${response.statusText}`
          );
        }

        const data = (await response.json()) as unknown;
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "update-transcription-options",
      {
        title: "Update Transcription Options",
        description: "Update transcription options",
        inputSchema: {
          speaker: z.boolean().optional().describe("Use speaker diarization"),
          timestamp: z.boolean().optional().describe("Include timestamps"),
          language: z.string().optional().describe("Transcription language"),
          topic: z.string().optional().describe("Transcription topic"),
          useDictionary: z.boolean().optional().describe("Use custom dictionary"),
        },
      },
      async (args) => {
        const requestBody: Record<string, unknown> = {};
        if (args.speaker !== undefined)
          requestBody.useSpeakerDiarization = args.speaker;
        if (args.timestamp !== undefined) requestBody.timestamp = args.timestamp;
        if (args.language) requestBody.language = args.language;
        if (args.topic) requestBody.topic = args.topic;
        if (args.useDictionary !== undefined)
          requestBody.useDictionary = args.useDictionary;

        const response = await fetch(
          `${DAGLO_API_BASE}/user-option/transcription`,
          {
            method: "PATCH",
            ...this.getAuthHeaders(),
            body: JSON.stringify(requestBody),
          }
        );

        if (!response.ok) {
          throw new Error(
            `Failed to update transcription options: ${response.statusText}`
          );
        }

        const data = await parseResponseBody(response);
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
        },
      },
      async (args) => {
        const { boardId } = args as {
          boardId: string;
        };

        try {
          const response = await fetch(
            `${DAGLO_API_BASE}/boards/${boardId}`,
            this.getAuthHeaders()
          );

          if (!response.ok) {
            throw new Error(
              `Failed to fetch bookmarks: ${response.statusText}`
            );
          }

          const data = (await response.json()) as { bookmarks?: unknown };
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(data.bookmarks ?? [], null, 2),
              },
            ],
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
          starts: z
            .number()
            .optional()
            .describe("Start time in seconds"),
          timestamp: z
            .number()
            .optional()
            .describe("Timestamp in seconds (alias for starts)"),
        },
      },
      async (args) => {
        const { boardId, starts, timestamp } = args as {
          boardId: string;
          starts?: number;
          timestamp?: number;
        };

        const bookmarkStarts = starts ?? timestamp;
        if (bookmarkStarts === undefined) {
          throw new Error("Provide starts or timestamp.");
        }

        try {
          const payload = { boardId, starts: bookmarkStarts };

          const response = await fetch(
            `${DAGLO_API_BASE}/bookmark`,
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
          logger.error({ boardId, error }, "Create bookmark failed");
          throw error;
        }
      }
    );

    this.server.registerTool(
      "delete-bookmark",
      {
        title: "Delete Bookmark",
        description: "Delete a bookmark from a board",
        inputSchema: {
          boardId: z.string().min(1).describe("Board ID"),
          starts: z.number().describe("Bookmark start time in seconds"),
          ends: z.number().describe("Bookmark end time in seconds"),
        },
      },
      async (args) => {
        try {
          const response = await fetch(`${DAGLO_API_BASE}/bookmark`, {
            method: "DELETE",
            ...this.getAuthHeaders(),
            body: JSON.stringify({
              boardId: args.boardId,
              starts: args.starts,
              ends: args.ends,
            }),
          });

          if (!response.ok) {
            throw new Error(
              `Failed to delete bookmark: ${response.statusText}`
            );
          }

          const data = await parseResponseBody(response);
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          logger.error(
            { boardId: args.boardId, error },
            "Delete bookmark failed"
          );
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
      "mark-all-notifications-read",
      {
        title: "Mark All Notifications Read",
        description: "Mark all notifications as read",
        inputSchema: {},
      },
      async () => {
        try {
          const response = await fetch(
            `${DAGLO_API_BASE}/notifications/mark-as-all-read`,
            {
              method: "PATCH",
              ...this.getAuthHeaders(),
            }
          );

          if (!response.ok) {
            throw new Error(
              `Failed to mark all notifications as read: ${response.statusText}`
            );
          }

          const data = (await response.json()) as unknown;
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          logger.error({ error }, "Mark all notifications read failed");
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
            `${DAGLO_API_BASE}/notifications/${notificationId}/mark-as-read`,
            {
              method: "PATCH",
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
            `${DAGLO_API_BASE}/user-word?${params.toString()}`,
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
        const { word } = args as {
          word: string;
          pronunciation?: string;
          definition?: string;
          category?: string;
        };

        try {
          const payload = { words: [word] };

          const response = await fetch(
            `${DAGLO_API_BASE}/user-word`,
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
            .optional()
            .describe("Word ID to delete (legacy)"),
          word: z
            .string()
            .optional()
            .describe("Word to delete (recommended)"),
        },
      },
      async (args) => {
        const { wordId, word } = args as { wordId?: string; word?: string };

        try {
          if (!word && !wordId) {
            throw new Error("Provide word or wordId.");
          }

          if (word) {
            const response = await fetch(`${DAGLO_API_BASE}/user-word`, {
              method: "DELETE",
              ...this.getAuthHeaders(),
              body: JSON.stringify({ words: [word] }),
            });

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
          }

          const response = await fetch(
            `${DAGLO_API_BASE}/user-word`,
            {
              method: "DELETE",
              ...this.getAuthHeaders(),
              body: JSON.stringify({ words: [wordId] }),
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
      "check-user-password",
      {
        title: "Check User Password",
        description: "Verify user password",
        inputSchema: {
          password: z.string().min(1).describe("Password to verify"),
        },
      },
      async (args) => {
        try {
          const response = await fetch(
            `${DAGLO_API_BASE}/user/password-check`,
            {
              method: "POST",
              ...this.getAuthHeaders(),
              body: JSON.stringify({ password: args.password }),
            }
          );

          if (!response.ok) {
            throw new Error(`Failed to verify password: ${response.statusText}`);
          }

          const data = await parseResponseBody(response);
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          logger.error({ error }, "Check user password failed");
          throw error;
        }
      }
    );

    this.server.registerTool(
      "change-user-password",
      {
        title: "Change User Password",
        description: "Change user password",
        inputSchema: {
          currentPassword: z.string().min(1).describe("Current password"),
          newPassword: z.string().min(1).describe("New password"),
        },
      },
      async (args) => {
        try {
          const response = await fetch(
            `${DAGLO_API_BASE}/v2/user/mypage/password`,
            {
              method: "PATCH",
              ...this.getAuthHeaders(),
              body: JSON.stringify({
                currentPassword: args.currentPassword,
                newPassword: args.newPassword,
              }),
            }
          );

          if (!response.ok) {
            throw new Error(`Failed to change password: ${response.statusText}`);
          }

          const data = await parseResponseBody(response);
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          logger.error({ error }, "Change user password failed");
          throw error;
        }
      }
    );

    this.server.registerTool(
      "withdraw-user",
      {
        title: "Withdraw User",
        description: "Withdraw user account",
        inputSchema: {
          deletionReasons: z
            .array(
              z.object({
                reason: z.string().min(1),
                description: z.string().min(1),
              })
            )
            .describe("Withdrawal reasons"),
        },
      },
      async (args) => {
        try {
          const response = await fetch(`${DAGLO_API_BASE}/user/delete`, {
            method: "PATCH",
            ...this.getAuthHeaders(),
            body: JSON.stringify({ deletionReasons: args.deletionReasons }),
          });

          if (!response.ok) {
            throw new Error(`Failed to withdraw user: ${response.statusText}`);
          }

          const data = await parseResponseBody(response);
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          logger.error({ error }, "Withdraw user failed");
          throw error;
        }
      }
    );

    this.server.registerTool(
      "unlink-user-provider",
      {
        title: "Unlink User Provider",
        description: "Unlink social provider from user account",
        inputSchema: {
          provider: z
            .enum(["google", "apple", "facebook", "kakao", "naver"])
            .describe("Provider to unlink"),
        },
      },
      async (args) => {
        const params = new URLSearchParams();
        params.append("provider", args.provider);

        try {
          const response = await fetch(
            `${DAGLO_API_BASE}/user/unlink?${params.toString()}`,
            {
              method: "PATCH",
              ...this.getAuthHeaders(),
            }
          );

          if (!response.ok) {
            throw new Error(`Failed to unlink provider: ${response.statusText}`);
          }

          const data = await parseResponseBody(response);
          return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          };
        } catch (error) {
          logger.error({ error }, "Unlink user provider failed");
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

    this.server.registerTool(
      "get-file-meta",
      {
        title: "Get File Meta",
        description: "Retrieve file metadata for a file",
        inputSchema: {
          fileMetaId: z.string().describe("File metadata ID"),
        },
      },
      async (args) => {
        const response = await fetch(
          `${DAGLO_API_BASE}/file-meta/${args.fileMetaId}`,
          this.getAuthHeaders()
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch file meta: ${response.statusText}`);
        }

        const data = (await response.json()) as unknown;
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "get-summary",
      {
        title: "Get Summary",
        description: "Retrieve summary for a board",
        inputSchema: {
          fileMetaId: z.string().optional().describe("File metadata ID"),
          sharedBoardId: z
            .string()
            .optional()
            .describe("Shared board ID"),
        },
      },
      async (args) => {
        if (!args.fileMetaId && !args.sharedBoardId) {
          throw new Error("Provide fileMetaId or sharedBoardId.");
        }

        const path = args.sharedBoardId
          ? `/shared-board/${args.sharedBoardId}/summary`
          : `/file-meta/${args.fileMetaId}/summary`;
        const headers = args.sharedBoardId
          ? { headers: { "daglo-platform": "web" } }
          : this.getAuthHeaders();

        const response = await fetch(`${DAGLO_API_BASE}${path}`, headers);
        if (!response.ok) {
          throw new Error(`Failed to fetch summary: ${response.statusText}`);
        }

        const data = await parseResponseBody(response);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "get-segment-summary",
      {
        title: "Get Segment Summary",
        description: "Retrieve segment summary for a board",
        inputSchema: {
          fileMetaId: z.string().optional().describe("File metadata ID"),
          sharedBoardId: z
            .string()
            .optional()
            .describe("Shared board ID"),
        },
      },
      async (args) => {
        if (!args.fileMetaId && !args.sharedBoardId) {
          throw new Error("Provide fileMetaId or sharedBoardId.");
        }

        const path = args.sharedBoardId
          ? `/shared-board/${args.sharedBoardId}/segment-summary`
          : `/file-meta/${args.fileMetaId}/segment-summary`;
        const headers = args.sharedBoardId
          ? { headers: { "daglo-platform": "web" } }
          : this.getAuthHeaders();

        const response = await fetch(`${DAGLO_API_BASE}${path}`, headers);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch segment summary: ${response.statusText}`
          );
        }

        const data = await parseResponseBody(response);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "get-keywords",
      {
        title: "Get Keywords",
        description: "Retrieve keywords for a board",
        inputSchema: {
          fileMetaId: z.string().optional().describe("File metadata ID"),
          sharedBoardId: z
            .string()
            .optional()
            .describe("Shared board ID"),
        },
      },
      async (args) => {
        if (!args.fileMetaId && !args.sharedBoardId) {
          throw new Error("Provide fileMetaId or sharedBoardId.");
        }

        const path = args.sharedBoardId
          ? `/shared-board/${args.sharedBoardId}/keyword`
          : `/file-meta/${args.fileMetaId}/keyword`;
        const headers = args.sharedBoardId
          ? { headers: { "daglo-platform": "web" } }
          : this.getAuthHeaders();

        const response = await fetch(`${DAGLO_API_BASE}${path}`, headers);
        if (!response.ok) {
          throw new Error(`Failed to fetch keywords: ${response.statusText}`);
        }

        const data = await parseResponseBody(response);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "get-long-summary",
      {
        title: "Get Long Summary",
        description: "Retrieve long summary for a board",
        inputSchema: {
          fileMetaId: z.string().optional().describe("File metadata ID"),
          sharedBoardId: z
            .string()
            .optional()
            .describe("Shared board ID"),
        },
      },
      async (args) => {
        if (!args.fileMetaId && !args.sharedBoardId) {
          throw new Error("Provide fileMetaId or sharedBoardId.");
        }

        const path = args.sharedBoardId
          ? `/shared-board/${args.sharedBoardId}/long-summary`
          : `/file-meta/${args.fileMetaId}/long-summary`;
        const headers = args.sharedBoardId
          ? { headers: { "daglo-platform": "web" } }
          : this.getAuthHeaders();

        const response = await fetch(`${DAGLO_API_BASE}${path}`, headers);
        if (!response.ok) {
          throw new Error(`Failed to fetch long summary: ${response.statusText}`);
        }

        const data = await parseResponseBody(response);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
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

    this.server.registerTool(
      "get-shared-board-thumbnail",
      {
        title: "Get Shared Board Thumbnail",
        description: "Retrieve shared board thumbnail",
        inputSchema: {
          shareId: z.string().describe("Shared board ID"),
        },
      },
      async (args) => {
        const response = await fetch(
          `${DAGLO_API_BASE}/shared-board/${args.shareId}/thumbnail`,
          {
            headers: { "daglo-platform": "web" },
          }
        );

        if (!response.ok) {
          throw new Error(
            `Failed to fetch shared board thumbnail: ${response.statusText}`
          );
        }

        const contentType = response.headers.get("content-type");
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  contentType,
                  base64,
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
      "get-shared-segment-summary",
      {
        title: "Get Shared Segment Summary",
        description: "Retrieve shared segment summary",
        inputSchema: {
          sharedId: z.string().describe("Shared board ID"),
        },
      },
      async (args) => {
        const response = await fetch(
          `${DAGLO_API_BASE}/shared-board/${args.sharedId}/segment-summary`,
          {
            headers: { "daglo-platform": "web" },
          }
        );

        if (!response.ok) {
          throw new Error(
            `Failed to fetch shared segment summary: ${response.statusText}`
          );
        }

        const data = await parseResponseBody(response);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
    );

    // AI Chat tools
    this.server.registerTool(
      "get-ai-chat-board",
      {
        title: "Get AI Chat Board Conversation",
        description: "Fetch board conversation (AI chat)",
        inputSchema: {
          id: z.string().min(1).describe("Board ID or transcript request ID"),
        },
      },
      async (args) => {
        const baseUrl = process.env[DAGLO_AI_CHAT_BASE_ENV];
        if (!baseUrl) {
          throw new Error(
            `Missing AI chat base URL. Set ${DAGLO_AI_CHAT_BASE_ENV}.`
          );
        }

        const url = buildUrl(baseUrl, "/conversation/board", { id: args.id });
        const response = await fetch(url, this.getAiHeaders("aiBearerToken"));

        if (!response.ok) {
          throw new Error(
            `Failed to fetch AI board conversation: ${response.statusText}`
          );
        }

        const data = await parseResponseBody(response);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "get-ai-chat-pdf",
      {
        title: "Get AI Chat PDF Conversation",
        description: "Fetch PDF conversation (AI chat)",
        inputSchema: {
          id: z.string().min(1).describe("PDF board ID or file ID"),
        },
      },
      async (args) => {
        const baseUrl = process.env[DAGLO_AI_CHAT_BASE_ENV];
        if (!baseUrl) {
          throw new Error(
            `Missing AI chat base URL. Set ${DAGLO_AI_CHAT_BASE_ENV}.`
          );
        }

        const url = buildUrl(baseUrl, "/conversation/pdf-board", { id: args.id });
        const response = await fetch(url, this.getAiHeaders("aiBearerToken"));

        if (!response.ok) {
          throw new Error(
            `Failed to fetch AI PDF conversation: ${response.statusText}`
          );
        }

        const data = await parseResponseBody(response);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "create-ai-chat-board",
      {
        title: "Create AI Chat Board Message",
        description: "Create board chat (AI chat)",
        inputSchema: {
          content: z.string().min(1).describe("Message content"),
          boardId: z.string().min(1).describe("Board ID"),
          transcriptRequestId: z
            .string()
            .optional()
            .describe("Transcript request ID"),
          fileId: z.string().optional().describe("File ID"),
        },
      },
      async (args) => {
        const baseUrl = process.env[DAGLO_AI_CHAT_BASE_ENV];
        if (!baseUrl) {
          throw new Error(
            `Missing AI chat base URL. Set ${DAGLO_AI_CHAT_BASE_ENV}.`
          );
        }

        const url = buildUrl(baseUrl, "/conversation/board");
        const response = await fetch(url, {
          method: "POST",
          ...this.getAiHeaders("aiToken"),
          body: JSON.stringify({
            content: args.content,
            boardId: args.boardId,
            transcriptRequestId: args.transcriptRequestId,
            fileId: args.fileId,
          }),
        });

        if (!response.ok) {
          throw new Error(
            `Failed to create AI board chat: ${response.statusText}`
          );
        }

        const data = await parseResponseBody(response);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }
    );

    this.server.registerTool(
      "create-ai-chat-pdf",
      {
        title: "Create AI Chat PDF Message",
        description: "Create PDF chat (AI chat)",
        inputSchema: {
          content: z.string().min(1).describe("Message content"),
          boardId: z.string().min(1).describe("PDF board ID"),
          transcriptRequestId: z
            .string()
            .optional()
            .describe("Transcript request ID"),
          fileId: z.string().optional().describe("File ID"),
        },
      },
      async (args) => {
        const baseUrl = process.env[DAGLO_AI_CHAT_BASE_ENV];
        if (!baseUrl) {
          throw new Error(
            `Missing AI chat base URL. Set ${DAGLO_AI_CHAT_BASE_ENV}.`
          );
        }

        const url = buildUrl(baseUrl, "/conversation/pdf-board");
        const response = await fetch(url, {
          method: "POST",
          ...this.getAiHeaders("aiToken"),
          body: JSON.stringify({
            content: args.content,
            boardId: args.boardId,
            transcriptRequestId: args.transcriptRequestId,
            fileId: args.fileId,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to create AI PDF chat: ${response.statusText}`);
        }

        const data = await parseResponseBody(response);
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
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

  private getAiHeaders(
    authType: "aiBearerToken" | "aiToken" = "aiBearerToken"
  ) {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      "daglo-platform": "web",
    };

    const headersObj = headers as Record<string, string>;

    if (authType === "aiBearerToken") {
      if (!this.aiBearerToken) {
        this.aiBearerToken = process.env[DAGLO_AI_BEARER_TOKEN_ENV];
      }
      if (this.aiBearerToken) {
        headersObj["Authorization"] = `bearer ${this.aiBearerToken}`;
        logger.debug(
          { hasAiBearerToken: true, tokenLength: this.aiBearerToken.length },
          "AI bearer auth headers generated"
        );
      } else {
        logger.warn("AI bearer auth headers requested without token");
      }
    }

    if (authType === "aiToken") {
      if (!this.aiToken) {
        this.aiToken = process.env[DAGLO_AI_TOKEN_ENV];
      }
      if (this.aiToken) {
        headersObj["Authorization"] = `Token ${this.aiToken}`;
        logger.debug(
          { hasAiToken: true, tokenLength: this.aiToken.length },
          "AI token auth headers generated"
        );
      } else {
        logger.warn("AI token auth headers requested without token");
      }
    }

    return { headers };
  }
}

const server = new DagloMcpServer();
server.start().catch(console.error);
