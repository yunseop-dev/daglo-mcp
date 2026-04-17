import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DagloApiClient } from "../api/client.js";
import { exportToObsidian, batchExportFolder } from "../handlers/obsidian.js";
import {
  exportToObsidianSchema,
  batchExportFolderSchema,
} from "../schemas/obsidian.js";

export const registerObsidianTools = (
  server: McpServer,
  client: DagloApiClient
) => {
  server.registerTool(
    "export-to-obsidian",
    {
      title: "Export Board to Obsidian",
      description: "Export a single board to Obsidian-compatible markdown",
      inputSchema: exportToObsidianSchema.shape,
    },
    async (args) => {
      const data = await exportToObsidian(client, args);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "batch-export-folder",
    {
      title: "Batch Export Folder to Obsidian",
      description: "Export all boards in a folder to Obsidian markdown",
      inputSchema: batchExportFolderSchema.shape,
    },
    async (args) => {
      const data = await batchExportFolder(client, args);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
};
