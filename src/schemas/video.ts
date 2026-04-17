import * as z from "zod";

export const createYoutubeHighlightClipSchema = z.object({
  youtubeUrl: z.string().describe("YouTube video URL to download"),
  boardId: z.string().optional().describe("Board ID to fetch transcript from"),
  fileMetaId: z
    .string()
    .optional()
    .describe("File metadata ID to fetch script from (takes precedence over boardId)"),
  outputDir: z
    .string()
    .optional()
    .describe("Output directory for generated files (default: ./docs/clips)"),
  clipLengthMinutes: z
    .number()
    .optional()
    .describe("Target clip length in minutes (default: 3.5)"),
  subtitleMaxLineLength: z
    .number()
    .optional()
    .describe("Max characters per subtitle segment (default: 42)"),
  shortsMode: z
    .boolean()
    .optional()
    .describe("Generate vertical 9:16 clip for shorts (default: false)"),
  highlightKeywords: z
    .array(z.string())
    .optional()
    .describe("Keywords to identify highlight segments (default: from board keywords)"),
});

export type CreateYoutubeHighlightClipArgs = z.infer<typeof createYoutubeHighlightClipSchema>;

export const createYoutubeFullSubtitledVideoSchema = z.object({
  youtubeUrl: z.string().describe("YouTube video URL to download"),
  boardId: z.string().optional().describe("Board ID to fetch transcript from"),
  fileMetaId: z
    .string()
    .optional()
    .describe("File metadata ID to fetch script from (takes precedence over boardId)"),
  outputDir: z
    .string()
    .optional()
    .describe("Output directory for generated files (default: ./docs/full-subtitles)"),
  subtitleMaxLineLength: z
    .number()
    .optional()
    .describe("Max characters per subtitle segment (default: 42)"),
});

export type CreateYoutubeFullSubtitledVideoArgs = z.infer<
  typeof createYoutubeFullSubtitledVideoSchema
>;
