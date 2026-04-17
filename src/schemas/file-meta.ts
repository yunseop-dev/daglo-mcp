import * as z from "zod";

export const getFileMetaSchema = z.object({
  fileMetaId: z.string().describe("File metadata ID"),
});

export const getKeywordsSchema = z.object({
  fileMetaId: z.string().optional().describe("File metadata ID"),
  sharedBoardId: z.string().optional().describe("Shared board ID"),
});

export type GetFileMetaArgs = z.infer<typeof getFileMetaSchema>;
export type GetKeywordsArgs = z.infer<typeof getKeywordsSchema>;
