import * as z from "zod";

export const exportToObsidianSchema = z.object({
  boardId: z.string().describe("Board ID to export"),
  fileMetaId: z.string().optional().describe("File metadata ID"),
  outputType: z
    .enum(["original", "summary", "both"])
    .optional()
    .default("both")
    .describe("Output type"),
  outputDir: z
    .string()
    .optional()
    .describe("Output directory (default: ./docs)"),
  includeContent: z.boolean().optional().default(true),
  includeSummary: z.boolean().optional().default(true),
  includeKeywords: z.boolean().optional().default(true),
  includeAiSummary: z.boolean().optional().default(true),
});

export type ExportToObsidianArgs = z.infer<typeof exportToObsidianSchema>;

export const batchExportFolderSchema = z.object({
  folderId: z.string().describe("Folder ID to export"),
  outputDir: z
    .string()
    .optional()
    .describe("Output directory (default: ./docs)"),
  outputType: z
    .enum(["original", "summary", "both"])
    .optional()
    .default("both")
    .describe("Output type"),
  limit: z
    .number()
    .optional()
    .default(50)
    .describe("Max boards to export"),
});

export type BatchExportFolderArgs = z.infer<typeof batchExportFolderSchema>;
