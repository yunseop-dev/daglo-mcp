import { DagloApiClient } from "../api/client.js";
import { logger } from "../logger.js";
import { LoginArgs } from "../schemas/auth.js";
import {
  getAccessTokenFromResponse,
  getJsonFromResponse,
  getLoginPayload,
  getRefreshTokenFromResponse,
} from "../utils/auth.js";

export const loginUser = async (
  client: DagloApiClient,
  args: LoginArgs
): Promise<unknown> => {
  const payload = getLoginPayload(args);

  const response = await fetch(`${client.baseUrl}/user/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "daglo-platform": "web",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(
      { status: response.status, body: errorText },
      "Login request failed"
    );
    throw new Error(`Login failed: ${response.statusText}`);
  }

  const data = await getJsonFromResponse(response);
  const accessToken = getAccessTokenFromResponse(response, data);
  const refreshToken = getRefreshTokenFromResponse(response, data);

  if (!accessToken) {
    throw new Error("Login failed: access token not found in response.");
  }

  client.setTokens(accessToken, refreshToken ?? undefined);
  return data;
};
