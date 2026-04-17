import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DagloApiClient } from "../api/client.js";
import { loginUser } from "../handlers/auth.js";
import { loginSchema } from "../schemas/auth.js";

export const registerAuthTools = (
  server: McpServer,
  client: DagloApiClient
) => {
  server.registerTool(
    "login",
    {
      title: "Login to Daglo",
      description: "Authenticate with Daglo using email and password",
      inputSchema: loginSchema.shape,
    },
    async (args) => {
      const data = await loginUser(client, args);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
};
