import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DagloApiClient } from "../api/client.js";
import { getFileMeta, getKeywords } from "../handlers/file-meta.js";
import {
  getFileMetaSchema,
  getKeywordsSchema,
} from "../schemas/file-meta.js";

export const registerFileMetaTools = (
  server: McpServer,
  client: DagloApiClient
) => {
  server.registerTool(
    "get-file-meta",
    {
      title: "Get File Meta",
      description: "Retrieve file metadata for a file",
      inputSchema: getFileMetaSchema.shape,
    },
    async (args) => {
      const data = await getFileMeta(client, args);
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
      inputSchema: getKeywordsSchema.shape,
    },
    async (args) => {
      const data = await getKeywords(client, args);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
};
