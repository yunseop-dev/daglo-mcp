import * as z from "zod";

export const loginSchema = z.object({
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
});

export type LoginArgs = z.infer<typeof loginSchema>;
