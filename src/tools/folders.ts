import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { DagloApiClient } from "../api/client.js";

export const registerFolderTools = (
  server: McpServer,
  client: DagloApiClient
) => {
  server.registerTool(
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
        `${client.baseUrl}/folders?${params.toString()}`,
        { headers: client.getAuthHeaders() }
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
};
