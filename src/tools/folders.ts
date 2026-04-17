import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DagloApiClient } from "../api/client.js";
import { getFolders } from "../handlers/folders.js";
import { getFoldersSchema } from "../schemas/folders.js";

export const registerFolderTools = (
  server: McpServer,
  client: DagloApiClient
) => {
  server.registerTool(
    "get-folders",
    {
      title: "Get Folders",
      description: "Retrieve all folders from Daglo",
      inputSchema: getFoldersSchema.shape,
    },
    async (args) => {
      const data = await getFolders(client, args);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
};
