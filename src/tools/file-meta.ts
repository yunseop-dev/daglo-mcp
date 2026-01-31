import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { DagloApiClient } from "../api/client.js";
import { parseResponseBody } from "../utils/http.js";

export const registerFileMetaTools = (
  server: McpServer,
  client: DagloApiClient
) => {
  server.registerTool(
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
        `${client.baseUrl}/file-meta/${args.fileMetaId}`,
        { headers: client.getAuthHeaders() }
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

  server.registerTool(
    "get-keywords",
    {
      title: "Get Keywords",
      description: "Retrieve keywords for a board",
      inputSchema: {
        fileMetaId: z.string().optional().describe("File metadata ID"),
        sharedBoardId: z.string().optional().describe("Shared board ID"),
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
        : { headers: client.getAuthHeaders() };

      const response = await fetch(`${client.baseUrl}${path}`, headers);
      if (!response.ok) {
        throw new Error(`Failed to fetch keywords: ${response.statusText}`);
      }

      const data = await parseResponseBody(response);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
};
