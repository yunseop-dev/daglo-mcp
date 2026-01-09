import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
        if (args.fileMetaId) params.append("fileMetaId", args.fileMetaId);

        const response = await fetch(
          `${DAGLO_API_BASE}/v2/boards/${args.boardId}?${params.toString()}`,
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
