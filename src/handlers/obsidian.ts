import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
import {
  ExportToObsidianArgs,
  BatchExportFolderArgs,
} from "../schemas/obsidian.js";

export const exportToObsidian = async (
  client: DagloApiClient,
  args: ExportToObsidianArgs
): Promise<unknown> => {
  try {
    const outputDir = args.outputDir || "./docs";
    const outputType = args.outputType || "both";

    const url = buildUrl(client.baseUrl, `/boards/${args.boardId}`);
    const response = await fetch(url, { headers: client.getAuthHeaders() });

    if (!response.ok) {
      throw new Error(`Failed to fetch board: ${response.statusText}`);
    }

    const rawBoardData = (await parseResponseBody(response)) as {
      id: string;
      name: string;
      createTime?: string;
      createdAt?: string;
      content?: string;
      summary?: string;
      keywords?: string[];
      aiSummary?: string;
      fileMetaId?: string;
      fileMeta?: Array<{ id: string }>;
    };

    if (!rawBoardData) {
      throw new Error("Failed to parse board data");
    }

    const boardData = {
      ...rawBoardData,
      createdAt: rawBoardData.createdAt || rawBoardData.createTime || new Date().toISOString(),
    };

    const fileMetaId = args.fileMetaId ||
      rawBoardData.fileMetaId ||
      rawBoardData.fileMeta?.[0]?.id;
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
      success: true,
      boardId: boardData.id,
      boardName: boardData.name,
      generatedFiles,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, "Failed to export to Obsidian");
    throw error;
  }
};

export const batchExportFolder = async (
  client: DagloApiClient,
  args: BatchExportFolderArgs
): Promise<unknown> => {
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
        success: true,
        exportedCount: 0,
        message: "No boards found in folder",
      };
    }

    const exportedFiles: string[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const board of boards) {
      try {
        const boardUrl = buildUrl(client.baseUrl, `/boards/${board.id}`);
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
      success: true,
      totalBoards: boards.length,
      exportedCount: successCount,
      errorCount,
      generatedFiles: exportedFiles,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMessage }, "Failed to batch export folder");
    throw error;
  }
};
