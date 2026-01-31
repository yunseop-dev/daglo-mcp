import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as z from "zod";
import { DagloApiClient } from "../api/client.js";
import { logger } from "../logger.js";
import {
  decodeZlibBase64Content,
  normalizeScriptContent,
} from "../utils/content.js";
import { sanitizeFilename } from "../utils/file.js";
import {
  buildPlainTextFromTokens,
  extractKaraokeTokens,
} from "../utils/karaoke.js";
import {
  formatDateForFilename,
  formatOriginalContent,
  formatSummaryContent,
  generateFrontmatter,
} from "../utils/obsidian.js";
import { buildUrl, parseResponseBody } from "../utils/http.js";

export const registerObsidianTools = (
  server: McpServer,
  client: DagloApiClient
) => {
  server.registerTool(
    "export-to-obsidian",
    {
      title: "Export Board to Obsidian",
      description: "Export a single board to Obsidian-compatible markdown",
      inputSchema: {
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
      },
    },
    async (args) => {
      try {
        const outputDir = args.outputDir || "./docs";
        const outputType = args.outputType || "both";

        const url = buildUrl(client.baseUrl, `/v2/boards/${args.boardId}`);
        const response = await fetch(url, { headers: client.getAuthHeaders() });

        if (!response.ok) {
          throw new Error(`Failed to fetch board: ${response.statusText}`);
        }

        const boardData = (await parseResponseBody(response)) as {
          id: string;
          name: string;
          createdAt: string;
          content?: string;
          summary?: string;
          keywords?: string[];
          aiSummary?: string;
          fileMetaId?: string;
        };

        if (!boardData) {
          throw new Error("Failed to parse board data");
        }

        const fileMetaId = args.fileMetaId || boardData.fileMetaId;
        let content: string | undefined;

        if (fileMetaId) {
          const scriptUrl = buildUrl(
            client.baseUrl,
            `/file-meta/${fileMetaId}/script`,
            { includeContent: "true" }
          );
          const scriptResponse = await fetch(scriptUrl, {
            headers: client.getAuthHeaders(),
          });

          if (scriptResponse.ok) {
            const scriptData = (await parseResponseBody(scriptResponse)) as
              | { content?: string; script?: string; text?: string; item?: string }
              | string;

            let rawContent: string | undefined;
            if (typeof scriptData === "string") {
              rawContent = scriptData;
            } else {
              rawContent =
                scriptData.content ??
                scriptData.script ??
                scriptData.text ??
                scriptData.item;
            }

            if (rawContent) {
              const normalizedContent = normalizeScriptContent(rawContent);
              const tokens = extractKaraokeTokens(normalizedContent);
              content = buildPlainTextFromTokens(tokens);

              if (!content && normalizedContent) {
                content = normalizedContent;
              }
            }
          }
        }

        if (!content && boardData.content) {
          content = decodeZlibBase64Content(boardData.content);
        }

        let summary = boardData.summary;
        let keywords = boardData.keywords || [];
        let aiSummary = boardData.aiSummary;
        let segments: Array<{
          startTime: number;
          endTime: number;
          text: string;
          speaker?: string;
        }> = [];

        if (fileMetaId) {
          if (args.includeSummary) {
            const summaryUrl = buildUrl(
              client.baseUrl,
              `/file-meta/${fileMetaId}/summary`
            );
            const summaryResponse = await fetch(summaryUrl, {
              headers: client.getAuthHeaders(),
            });
            if (summaryResponse.ok) {
              const summaryData = (await parseResponseBody(summaryResponse)) as {
                summary?: string;
              };
              summary = summaryData?.summary || summary;
            }
          }

          if (args.includeKeywords) {
            const keywordsUrl = buildUrl(
              client.baseUrl,
              `/file-meta/${fileMetaId}/keywords`
            );
            const keywordsResponse = await fetch(keywordsUrl, {
              headers: client.getAuthHeaders(),
            });
            if (keywordsResponse.ok) {
              const keywordsData = (await parseResponseBody(keywordsResponse)) as {
                keywords?: string[];
              };
              keywords = keywordsData?.keywords || keywords;
            }
          }

          if (args.includeAiSummary) {
            const aiSummaryUrl = buildUrl(
              client.baseUrl,
              `/file-meta/${fileMetaId}/long-summary`
            );
            const aiSummaryResponse = await fetch(aiSummaryUrl, {
              headers: client.getAuthHeaders(),
            });
            if (aiSummaryResponse.ok) {
              const aiSummaryData = (await parseResponseBody(
                aiSummaryResponse
              )) as { longSummary?: string };
              aiSummary = aiSummaryData?.longSummary || aiSummary;
            }
          }

          const segmentsUrl = buildUrl(
            client.baseUrl,
            `/file-meta/${fileMetaId}/segment-summary`
          );
          const segmentsResponse = await fetch(segmentsUrl, {
            headers: client.getAuthHeaders(),
          });
          if (segmentsResponse.ok) {
            const segmentsData = (await parseResponseBody(segmentsResponse)) as {
              segments?: Array<{
                startTime: number;
                endTime: number;
                text: string;
                speaker?: string;
              }>;
            };
            segments = segmentsData?.segments || [];
          }
        }

        const dateForFilename = formatDateForFilename(boardData.createdAt);
        const sanitizedName = sanitizeFilename(boardData.name);
        const baseFilename = `${dateForFilename} ${sanitizedName}`;

        const tags = ["journal", "daglo"];
        const frontmatter = generateFrontmatter({
          title: boardData.name,
          date: boardData.createdAt,
          tags,
          keywords,
          boardId: boardData.id,
          created: boardData.createdAt,
        });

        const generatedFiles: string[] = [];

        if ((outputType === "original" || outputType === "both") && content) {
          const originalDir = resolve(outputDir, "original");
          mkdirSync(originalDir, { recursive: true });

          const originalFilePath = resolve(originalDir, `${baseFilename}.md`);
          const formattedContent = formatOriginalContent(content);
          const fullContent = `${frontmatter}\n\n${formattedContent}`;

          writeFileSync(originalFilePath, fullContent, "utf-8");
          generatedFiles.push(originalFilePath);
        }

        if (outputType === "summary" || outputType === "both") {
          const summaryDir = resolve(outputDir, "summary");
          mkdirSync(summaryDir, { recursive: true });

          const summaryFilePath = resolve(summaryDir, `${baseFilename}.md`);
          const summaryContentBody = formatSummaryContent({
            title: boardData.name,
            originalFilename: `${baseFilename}.md`,
            summary,
            aiSummary,
            keywords,
            segments,
          });
          const fullSummaryContent = `${frontmatter}\n\n${summaryContentBody}`;

          writeFileSync(summaryFilePath, fullSummaryContent, "utf-8");
          generatedFiles.push(summaryFilePath);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  boardId: boardData.id,
                  boardName: boardData.name,
                  generatedFiles,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage }, "Failed to export to Obsidian");
        throw error;
      }
    }
  );

  server.registerTool(
    "batch-export-folder",
    {
      title: "Batch Export Folder to Obsidian",
      description: "Export all boards in a folder to Obsidian markdown",
      inputSchema: {
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
      },
    },
    async (args) => {
      try {
        const outputDir = args.outputDir || "./docs";
        const outputType = args.outputType || "both";
        const limit = args.limit || 50;

        const url = buildUrl(client.baseUrl, "/v2/boards", {
          folderId: args.folderId,
          limit,
          page: 1,
        });
        const response = await fetch(url, { headers: client.getAuthHeaders() });

        if (!response.ok) {
          throw new Error(`Failed to fetch boards: ${response.statusText}`);
        }

        const data = (await parseResponseBody(response)) as {
          boards?: Array<{
            id: string;
            name: string;
            createdAt: string;
          }>;
        };

        const boards = data?.boards || [];

        if (boards.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    exportedCount: 0,
                    message: "No boards found in folder",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const exportedFiles: string[] = [];
        let successCount = 0;
        let errorCount = 0;

        for (const board of boards) {
          try {
            const boardUrl = buildUrl(client.baseUrl, `/v2/boards/${board.id}`);
            const boardResponse = await fetch(boardUrl, {
              headers: client.getAuthHeaders(),
            });

            if (!boardResponse.ok) {
              logger.error(
                { boardId: board.id, status: boardResponse.status },
                "Failed to fetch board detail"
              );
              errorCount++;
              continue;
            }

            const boardData = (await parseResponseBody(boardResponse)) as {
              id: string;
              name: string;
              createdAt: string;
              content?: string;
              summary?: string;
              keywords?: string[];
              aiSummary?: string;
              fileMetaId?: string;
            };

            const fileMetaId = boardData.fileMetaId;
            let content: string | undefined;

            if (fileMetaId) {
              const scriptUrl = buildUrl(
                client.baseUrl,
                `/file-meta/${fileMetaId}/script`,
                { includeContent: "true" }
              );
              const scriptResponse = await fetch(scriptUrl, {
                headers: client.getAuthHeaders(),
              });

              if (scriptResponse.ok) {
                const scriptData = (await parseResponseBody(scriptResponse)) as
                  | { content?: string; script?: string; text?: string; item?: string }
                  | string;

                let rawContent: string | undefined;
                if (typeof scriptData === "string") {
                  rawContent = scriptData;
                } else {
                  rawContent =
                    scriptData.content ??
                    scriptData.script ??
                    scriptData.text ??
                    scriptData.item;
                }

                if (rawContent) {
                  const normalizedContent = normalizeScriptContent(rawContent);
                  const tokens = extractKaraokeTokens(normalizedContent);
                  content = buildPlainTextFromTokens(tokens);

                  if (!content && normalizedContent) {
                    content = normalizedContent;
                  }
                }
              }
            }

            if (!content && boardData.content) {
              content = decodeZlibBase64Content(boardData.content);
            }

            const dateForFilename = formatDateForFilename(boardData.createdAt);
            const sanitizedName = sanitizeFilename(boardData.name);
            const baseFilename = `${dateForFilename} ${sanitizedName}`;

            const tags = ["journal", "daglo"];
            const frontmatter = generateFrontmatter({
              title: boardData.name,
              date: boardData.createdAt,
              tags,
              keywords: boardData.keywords || [],
              boardId: boardData.id,
              created: boardData.createdAt,
            });

            if ((outputType === "original" || outputType === "both") && content) {
              const originalDir = resolve(outputDir, "original");
              mkdirSync(originalDir, { recursive: true });

              const originalFilePath = resolve(originalDir, `${baseFilename}.md`);
              const formattedContent = formatOriginalContent(content);
              const fullContent = `${frontmatter}\n\n${formattedContent}`;

              writeFileSync(originalFilePath, fullContent, "utf-8");
              exportedFiles.push(originalFilePath);
            }

            if (outputType === "summary" || outputType === "both") {
              const summaryDir = resolve(outputDir, "summary");
              mkdirSync(summaryDir, { recursive: true });

              const summaryFilePath = resolve(summaryDir, `${baseFilename}.md`);
              const summaryContentBody = formatSummaryContent({
                title: boardData.name,
                originalFilename: `${baseFilename}.md`,
                summary: boardData.summary,
                aiSummary: boardData.aiSummary,
                keywords: boardData.keywords,
                segments: [],
              });
              const fullSummaryContent = `${frontmatter}\n\n${summaryContentBody}`;

              writeFileSync(summaryFilePath, fullSummaryContent, "utf-8");
              exportedFiles.push(summaryFilePath);
            }

            successCount++;
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            logger.error(
              { boardId: board.id, error: errorMessage },
              "Failed to export board"
            );
            errorCount++;
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  totalBoards: boards.length,
                  exportedCount: successCount,
                  errorCount,
                  generatedFiles: exportedFiles,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage }, "Failed to batch export folder");
        throw error;
      }
    }
  );
};
