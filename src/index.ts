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
const DAGLO_EMAIL_ENV = "DAGLO_EMAIL";
const DAGLO_PASSWORD_ENV = "DAGLO_PASSWORD";

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
    return JSON.parse(text) as { token?: string } | null;
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

class DagloMcpServer {
  private server: McpServer;
  private accessToken?: string;

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
      "get-boards",
      {
        title: "Get Boards",
        description: "Retrieve all boards from Daglo with optional filters",
        inputSchema: {
          page: z.number().optional().describe("Page number (default: 1)"),
          limit: z.number().optional().describe("Number of boards per page"),
          status: z
            .enum(["COMPLETE", "PROCESSING", "FAILED"])
            .optional()
            .describe("Filter by board status"),
          isStarred: z
            .boolean()
            .optional()
            .describe("Filter by starred boards"),
          checkedFilter: z
            .enum(["incompleteRecording", "isPdf"])
            .optional()
            .describe("Filter by incomplete recordings or PDFs"),
          folderId: z.string().optional().describe("Filter by folder ID"),
        },
      },
      async (args) => {
        const params = new URLSearchParams();
        if (args.page) params.append("page", args.page.toString());
        if (args.limit) params.append("limit", args.limit.toString());
        if (args.status) params.append("filter.status", args.status);
        if (args.isStarred) params.append("isStarred", "true");
        if (args.checkedFilter)
          params.append(`checkedFilter=${args.checkedFilter}`, "true");
        if (args.folderId) params.append("folderIds", args.folderId);

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
        title: "Get Quotas",
        description: "Retrieve usage quotas and limits for Daglo services",
        inputSchema: {},
      },
      async () => {
        const response = await fetch(
          `${DAGLO_API_BASE}/store/capa`,
          this.getAuthHeaders()
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch quotas: ${response.statusText}`);
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
        inputSchema: {},
      },
      async () => {
        const response = await fetch(
          `${DAGLO_API_BASE}/v2/store/plan`,
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
  }

  private getAuthHeaders() {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };

    if (this.accessToken) {
      const headersObj = headers as Record<string, string>;
      headersObj["Authorization"] = `Bearer ${this.accessToken}`;
      headersObj["accesstoken"] = this.accessToken;

      logger.debug(
        { hasAccessToken: true, tokenLength: this.accessToken.length },
        "Auth headers generated"
      );
    } else {
      logger.warn("Auth headers generated without access token");
    }

    return { headers };
  }
}

const server = new DagloMcpServer();
server.start().catch(console.error);
