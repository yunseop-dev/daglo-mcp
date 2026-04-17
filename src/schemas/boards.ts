import * as z from "zod";

export const getBoardsSchema = z.object({
  page: z.number().optional().describe("Page number (default: 1)"),
  limit: z.number().optional().describe("Number of boards per page"),
  sort: z
    .string()
    .optional()
    .describe(
      "Sort expression (default: createTime.desc, examples: createTime.desc, name.asc, name.desc)"
    ),
  orderedBy: z
    .enum(["name", "createTime", "updateTime", "deleteTime"])
    .optional()
    .describe("Sort field (used with timeOrder when sort not provided)"),
  timeOrder: z
    .enum(["asc", "desc"])
    .optional()
    .describe("Sort order (used with orderedBy when sort not provided)"),
  status: z.enum(["COMPLETE", "PROCESSING", "FAILED"]).optional().describe("Filter by board status"),
  isStarred: z.boolean().optional().describe("Filter by starred boards"),
  search: z.string().optional().describe("Filter by board name"),
  uploadTypes: z.array(z.string()).optional().describe("Filter by upload types"),
  folderIds: z.array(z.string()).optional().describe("Filter by folder IDs"),
  withDeleted: z.boolean().optional().describe("Include deleted boards"),
  startDate: z.string().optional().describe("Filter start date (ISO string)"),
  endDate: z.string().optional().describe("Filter end date (ISO string)"),
  folderId: z.string().optional().describe("Filter by a single folder ID"),
  keyword: z.string().optional().describe("Filter by keyword"),
  checkedFilter: z
    .enum(["incompleteRecording", "isPdf"])
    .optional()
    .describe("Filter by incomplete recordings or PDFs"),
});

export type GetBoardsArgs = z.infer<typeof getBoardsSchema>;

export const getBoardInfoSchema = z.object({
  boardId: z.string().optional().describe("Board ID to fetch (private board)"),
  sharedBoardId: z.string().optional().describe("Shared board ID to fetch (public)"),
});

export type GetBoardInfoArgs = z.infer<typeof getBoardInfoSchema>;

export const getBoardDetailSchema = z.object({
  boardId: z.string().describe("Board ID to fetch details for"),
  fileMetaId: z.string().optional().describe("File metadata ID (optional)"),
  decodeContent: z
    .boolean()
    .optional()
    .describe("Decode content if zlib+base64 (default: true)"),
  includeScript: z
    .boolean()
    .optional()
    .describe("Include decoded script data when fileMetaId is set"),
  includeScriptPages: z
    .boolean()
    .optional()
    .describe("Include script pages when fileMetaId is set"),
  scriptLimit: z
    .number()
    .optional()
    .describe("Minutes per script page (default: 60)"),
  scriptPage: z
    .number()
    .optional()
    .describe("Script page index for API (default: 0)"),
  includeContent: z
    .boolean()
    .optional()
    .describe("Include full transcription content (default: true)"),
  includeSummary: z
    .boolean()
    .optional()
    .describe("Include summary (default: true)"),
  includeKeywords: z
    .boolean()
    .optional()
    .describe("Include keywords (default: true)"),
  includeAiSummary: z
    .boolean()
    .optional()
    .describe("Include AI summary (default: true)"),
  includeSegments: z
    .boolean()
    .optional()
    .describe("Include timestamped segments (default: true)"),
  outputFormat: z
    .enum(["json", "text"])
    .optional()
    .describe("Output format (json or text, default: json)"),
  outputPath: z
    .string()
    .optional()
    .describe("Optional output file path when outputFormat is text/json"),
});

export type GetBoardDetailArgs = z.infer<typeof getBoardDetailSchema>;

export const getBoardScriptSchema = z.object({
  fileMetaId: z.string().optional().describe("File metadata ID"),
  sharedBoardId: z.string().optional().describe("Shared board ID"),
  historyId: z
    .string()
    .optional()
    .describe("Script history ID (requires fileMetaId)"),
  isOriginal: z
    .boolean()
    .optional()
    .describe("Fetch original script (requires fileMetaId)"),
  limit: z
    .number()
    .optional()
    .describe("Minutes per page (default: 60)"),
  page: z.number().optional().describe("Page index for script API (default: 0)"),
  buildPages: z
    .boolean()
    .optional()
    .describe("Split script into pages (default: true)"),
});

export type GetBoardScriptArgs = z.infer<typeof getBoardScriptSchema>;

export const updateBoardNameSchema = z.object({
  boardId: z.string().describe("Board ID to update"),
  name: z.string().min(1).describe("New board name"),
});

export type UpdateBoardNameArgs = z.infer<typeof updateBoardNameSchema>;

export const getLatestBoardContentSchema = z.object({
  limit: z
    .number()
    .optional()
    .describe("Number of boards to inspect (default: 50)"),
  decodeContent: z
    .boolean()
    .optional()
    .describe("Decode zlib+base64 content (default: true)"),
});

export type GetLatestBoardContentArgs = z.infer<typeof getLatestBoardContentSchema>;

export const exportBoardContentSchema = z.object({
  format: z
    .enum(["punctuation-json", "text"])
    .describe("Output format (punctuation-json or text)"),
  outputPath: z.string().optional().describe("Optional output file path"),
  boardId: z.string().optional().describe("Board ID to export (default: latest board)"),
  fileMetaId: z.string().optional().describe("File metadata ID (optional)"),
  limit: z
    .number()
    .optional()
    .describe("Number of boards to inspect (default: 50)"),
});

export type ExportBoardContentArgs = z.infer<typeof exportBoardContentSchema>;
