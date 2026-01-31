import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod";
import { DagloApiClient } from "../api/client.js";
import { logger } from "../logger.js";
import {
  getAccessTokenFromResponse,
  getJsonFromResponse,
  getLoginPayload,
  getRefreshTokenFromResponse,
} from "../utils/auth.js";

export const registerAuthTools = (
  server: McpServer,
  client: DagloApiClient
) => {
  server.registerTool(
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
      logger.info({ loginId, email: args.email || "from-env" }, "Login request started");

      try {
        const payload = getLoginPayload(args);

        logger.debug(
          { loginId, url: `${client.baseUrl}/user/login` },
          "Sending login request"
        );

        const response = await fetch(`${client.baseUrl}/user/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "daglo-platform": "web",
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

        const accessToken = getAccessTokenFromResponse(response, data);
        const refreshToken = getRefreshTokenFromResponse(response, data);

        if (!accessToken) {
          logger.error({ loginId, data }, "Login failed: access token not found");
          throw new Error(
            "Login failed: access token not found in response headers."
          );
        }

        client.setTokens(accessToken, refreshToken ?? undefined);
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
};
