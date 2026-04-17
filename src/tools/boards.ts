import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DagloApiClient } from "../api/client.js";
import {
  getBoardsSchema,
  getBoardInfoSchema,
  getBoardDetailSchema,
  getBoardScriptSchema,
  updateBoardNameSchema,
  getLatestBoardContentSchema,
  exportBoardContentSchema,
} from "../schemas/boards.js";
import {
  listBoards,
  getBoardInfo,
  getBoardDetail,
  getBoardScript,
  updateBoardName,
  getLatestBoardContent,
  exportBoardContent,
} from "../handlers/boards.js";

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
      inputSchema: getBoardScriptSchema.shape,
    },
    async (args) => {
      const data = await getBoardScript(client, args);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get-boards",
    {
      title: "Get Boards",
      description: "Retrieve all boards from Daglo with optional filters",
      inputSchema: getBoardsSchema.shape,
    },
    async (args) => {
      const data = await listBoards(client, args);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get-board-info",
    {
      title: "Get Board Info",
      description: "Retrieve board info for private or shared boards",
      inputSchema: getBoardInfoSchema.shape,
    },
    async (args) => {
      const data = await getBoardInfo(client, args);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "update-board-name",
    {
      title: "Update Board Name",
      description: "Update a board name",
      inputSchema: updateBoardNameSchema.shape,
    },
    async (args) => {
      const data = await updateBoardName(client, args);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get-board-detail",
    {
      title: "Get Board Detail",
      description:
        "Retrieve detailed information including content, summary, keywords, AI summary, and segments for a specific board. Supports filtering which data to include.",
      inputSchema: getBoardDetailSchema.shape,
    },
    async (args) => {
      const data = await getBoardDetail(client, args);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get-latest-board-content",
    {
      title: "Get Latest Board Content",
      description:
        "Retrieve the content of the most recently created board. Optionally decodes zlib+base64 content.",
      inputSchema: getLatestBoardContentSchema.shape,
    },
    async (args) => {
      const data = await getLatestBoardContent(client, args);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "export-board-content",
    {
      title: "Export Board Content",
      description: "Export board content as punctuation-split JSON or plain text.",
      inputSchema: exportBoardContentSchema.shape,
    },
    async (args) => {
      const data = await exportBoardContent(client, args);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
};
