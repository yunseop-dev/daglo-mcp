import { logger } from "../logger.js";
import { DAGLO_EMAIL_ENV, DAGLO_PASSWORD_ENV } from "../config.js";

export const getLoginPayload = (args: { email?: string; password?: string }) => {
  const email = args.email ?? process.env[DAGLO_EMAIL_ENV];
  const password = args.password ?? process.env[DAGLO_PASSWORD_ENV];

  logger.debug({ email }, "Attempting to get login payload");

  if (!email || !password) {
    const missing = [
      email ? null : DAGLO_EMAIL_ENV,
      password ? null : DAGLO_PASSWORD_ENV,
    ]
      .filter(Boolean)
      .join(", ");

    logger.error({ missing }, "Login failed: missing credentials");
    throw new Error(
      `Login failed: missing credentials. Provide email/password or set ${missing}.`
    );
  }

  const payload = { email, password };
  logger.debug({ email, hasPassword: !!password }, "Login payload created");

  return payload;
};

export const getJsonFromResponse = async (response: Response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as { token?: string; refreshToken?: string } | null;
  } catch {
    return null;
  }
};

export const getAccessTokenFromResponse = (
  response: Response,
  data: { token?: string } | null
) => {
  const headerToken = response.headers.get("accesstoken");
  const bodyToken = data?.token;
  const token = headerToken ?? bodyToken;

  logger.debug(
    {
      hasHeaderToken: !!headerToken,
      hasBodyToken: !!bodyToken,
      tokenSource: headerToken ? "header" : bodyToken ? "body" : "none",
    },
    "Extracting access token from response"
  );

  if (!token) {
    logger.warn(
      {
        responseStatus: response.status,
        responseHeaders: Array.from(response.headers.entries()),
      },
      "No access token found in response"
    );
  }

  return token;
};

export const getRefreshTokenFromResponse = (
  response: Response,
  data: { refreshToken?: string } | null
) => {
  const headerToken = response.headers.get("refreshtoken");
  const bodyToken = data?.refreshToken;
  const token = headerToken ?? bodyToken;

  logger.debug(
    {
      hasHeaderToken: !!headerToken,
      hasBodyToken: !!bodyToken,
      tokenSource: headerToken ? "header" : bodyToken ? "body" : "none",
    },
    "Extracting refresh token from response"
  );

  return token;
};
