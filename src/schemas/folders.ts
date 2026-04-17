import * as z from "zod";

export const getFoldersSchema = z.object({
  includeRoot: z
    .boolean()
    .optional()
    .describe("Include root folder (default: true)"),
});

export type GetFoldersArgs = z.infer<typeof getFoldersSchema>;
