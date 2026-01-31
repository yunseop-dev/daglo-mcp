import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DagloApiClient } from "./api/client.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerBoardTools } from "./tools/boards.js";
import { registerFileMetaTools } from "./tools/file-meta.js";
import { registerFolderTools } from "./tools/folders.js";
import { registerObsidianTools } from "./tools/obsidian.js";

const server = new McpServer({
  name: "daglo-mcp-server",
  version: "1.0.0",
});

const client = new DagloApiClient();

registerBoardTools(server, client);
registerFolderTools(server, client);
registerAuthTools(server, client);
registerFileMetaTools(server, client);
registerObsidianTools(server, client);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
