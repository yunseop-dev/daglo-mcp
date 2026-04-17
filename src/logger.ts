import pino from "pino";

const isDevelopment = process.env.NODE_ENV !== "production";

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || (isDevelopment ? "info" : "info"),
    serializers: {
      error: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  },
  pino.destination(2)
);

export function redactSensitiveData(
  data: Record<string, unknown>
): Record<string, unknown> {
  const sensitiveFields = [
    "password",
    "token",
    "accessToken",
    "refreshToken",
    "secret",
    "apiKey",
  ];
  const redacted = { ...data };
  for (const field of sensitiveFields) {
    if (field in redacted) {
      redacted[field] = "[REDACTED]";
    }
  }
  return redacted;
}

export default logger;
