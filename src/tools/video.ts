import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as z from "zod";
import { DagloApiClient } from "../api/client.js";
import { logger } from "../logger.js";
import { decodeScriptItem } from "../utils/content.js";
import { buildUrl, parseResponseBody } from "../utils/http.js";
import { KaraokeToken } from "../utils/karaoke.js";

type ScriptSegment = {
  text: string;
  startTime: number;
  endTime: number;
  tokens: KaraokeToken[];
};

const extractSegmentsFromScript = (script: Record<string, unknown>): ScriptSegment[] => {
  const segments: ScriptSegment[] = [];
  const editorState = script.editorState as
    | { root?: { children?: Array<Record<string, unknown>> } }
    | undefined;
  const paragraphs = editorState?.root?.children;
  if (!Array.isArray(paragraphs)) return segments;

  const tokens: KaraokeToken[] = [];
  for (const paragraph of paragraphs) {
    const children = paragraph.children as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(children)) continue;

    for (const child of children) {
      if (child.type === "karaoke" && typeof child.text === "string") {
        const startTime = typeof child.s === "number" ? child.s : 0;
        const endTime = typeof child.e === "number" ? child.e : 0;
        tokens.push({ text: child.text, startTime, endTime });
      }
    }
  }

  const segmentsByPunctuation: ScriptSegment[] = [];
  let currentTokens: KaraokeToken[] = [];
  let currentText = "";
  let startTime: number | null = null;
  let endTime: number | null = null;

  for (const token of tokens) {
    if (startTime === null) {
      startTime = token.startTime;
    }
    endTime = token.endTime;
    currentTokens.push(token);
    currentText += token.text;

    if (/[?.!。！？]/.test(token.text)) {
      if (startTime !== null && endTime !== null) {
        segmentsByPunctuation.push({
          text: currentText.trim(),
          startTime,
          endTime,
          tokens: currentTokens,
        });
      }
      currentTokens = [];
      currentText = "";
      startTime = null;
      endTime = null;
    }
  }

  if (currentText.trim().length > 0 && startTime !== null && endTime !== null) {
    segmentsByPunctuation.push({
      text: currentText.trim(),
      startTime,
      endTime,
      tokens: currentTokens,
    });
  }

  return segmentsByPunctuation;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeKeywords = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      result.push(entry);
    } else if (entry && typeof entry === "object" && "keyword" in entry) {
      const keywordValue = (entry as { keyword?: unknown }).keyword;
      if (typeof keywordValue === "string") {
        result.push(keywordValue);
      }
    }
  }
  return result;
};

const extractYouTubeId = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    if (hostname === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] ?? null;
    }
    if (hostname.endsWith("youtube.com")) {
      const videoId = parsed.searchParams.get("v");
      if (videoId) return videoId;
      if (parsed.pathname.startsWith("/shorts/")) {
        return parsed.pathname.split("/")[2] ?? null;
      }
      if (parsed.pathname.startsWith("/live/")) {
        return parsed.pathname.split("/")[2] ?? null;
      }
    }
  } catch {
    return null;
  }

  return null;
};

const applyTimeScale = (segments: ScriptSegment[], scale: number): ScriptSegment[] => {
  if (scale === 1) return segments;
  return segments.map((segment) => ({
    ...segment,
    startTime: segment.startTime * scale,
    endTime: segment.endTime * scale,
    tokens: segment.tokens.map((token) => ({
      ...token,
      startTime: token.startTime * scale,
      endTime: token.endTime * scale,
    })),
  }));
};

const selectHighlightSegments = (
  segments: ScriptSegment[],
  targetDurationMinutes: number,
  keywords: string[]
): { segments: ScriptSegment[]; startTime: number; endTime: number } => {
  if (segments.length === 0) {
    return { segments: [], startTime: 0, endTime: 0 };
  }

  const targetDurationSeconds = targetDurationMinutes * 60;
  const normalizedKeywords = keywords.map((k) => k.toLowerCase());

  const scoredSegments = segments.map((segment, index) => {
    let score = 0;
    for (const keyword of normalizedKeywords) {
      const matches = (segment.text.match(new RegExp(escapeRegExp(keyword), "gi")) || []).length;
      score += matches;
    }
    const duration = segment.endTime - segment.startTime;
    const density = duration > 0 ? score / duration : 0;
    return { segment, index, score, density };
  });

  scoredSegments.sort((a, b) => {
    if (b.density !== a.density) return b.density - a.density;
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index;
  });

  if (scoredSegments.length === 0 || scoredSegments[0].score === 0) {
    const midpoint = Math.floor(segments.length / 2);
    const fallbackMatch = { segment: segments[midpoint], index: midpoint };
    const { segment, index: centerIndex } = fallbackMatch;
    let selectedSegments: ScriptSegment[] = [segment];
    let totalDuration = segment.endTime - segment.startTime;

    let leftIndex = centerIndex - 1;
    let rightIndex = centerIndex + 1;

    while (
      totalDuration < targetDurationSeconds &&
      (leftIndex >= 0 || rightIndex < segments.length)
    ) {
      let addedLeft = false;
      let addedRight = false;

      if (leftIndex >= 0) {
        const leftSeg = segments[leftIndex];
        const leftDuration = leftSeg.endTime - leftSeg.startTime;
        if (totalDuration + leftDuration <= targetDurationSeconds) {
          selectedSegments.unshift(leftSeg);
          totalDuration += leftDuration;
          leftIndex -= 1;
          addedLeft = true;
        }
      }

      if (rightIndex < segments.length && totalDuration < targetDurationSeconds) {
        const rightSeg = segments[rightIndex];
        const rightDuration = rightSeg.endTime - rightSeg.startTime;
        if (totalDuration + rightDuration <= targetDurationSeconds) {
          selectedSegments.push(rightSeg);
          totalDuration += rightDuration;
          rightIndex += 1;
          addedRight = true;
        }
      }

      if (!addedLeft && !addedRight) break;
    }

    const startTime = selectedSegments.length > 0 ? selectedSegments[0].startTime : 0;
    const endTime =
      selectedSegments.length > 0
        ? selectedSegments[selectedSegments.length - 1].endTime
        : startTime;
    return { segments: selectedSegments, startTime, endTime };
  }

  const bestMatch = scoredSegments[0];
  const centerIndex = bestMatch.index;
  let selectedSegments: ScriptSegment[] = [bestMatch.segment];
  let totalDuration = bestMatch.segment.endTime - bestMatch.segment.startTime;

  let leftIndex = centerIndex - 1;
  let rightIndex = centerIndex + 1;

  while (
    totalDuration < targetDurationSeconds &&
    (leftIndex >= 0 || rightIndex < segments.length)
  ) {
    let addedLeft = false;
    let addedRight = false;

    if (leftIndex >= 0) {
      const leftSeg = segments[leftIndex];
      const leftDuration = leftSeg.endTime - leftSeg.startTime;
      if (totalDuration + leftDuration <= targetDurationSeconds) {
        selectedSegments.unshift(leftSeg);
        totalDuration += leftDuration;
        leftIndex -= 1;
        addedLeft = true;
      }
    }

    if (rightIndex < segments.length && totalDuration < targetDurationSeconds) {
      const rightSeg = segments[rightIndex];
      const rightDuration = rightSeg.endTime - rightSeg.startTime;
      if (totalDuration + rightDuration <= targetDurationSeconds) {
        selectedSegments.push(rightSeg);
        totalDuration += rightDuration;
        rightIndex += 1;
        addedRight = true;
      }
    }

    if (!addedLeft && !addedRight) break;
  }

  const startTime = selectedSegments.length > 0 ? selectedSegments[0].startTime : 0;
  const endTime =
    selectedSegments.length > 0
      ? selectedSegments[selectedSegments.length - 1].endTime
      : startTime;
  return { segments: selectedSegments, startTime, endTime };
};

const formatTimestamp = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
};

const splitLongWord = (word: string, maxLength: number): string[] => {
  const parts: string[] = [];
  let remaining = word;
  while (remaining.length > maxLength) {
    parts.push(remaining.slice(0, maxLength));
    remaining = remaining.slice(maxLength);
  }
  if (remaining.length > 0) {
    parts.push(remaining);
  }
  return parts;
};

const wrapSubtitleText = (text: string, maxLineLength: number): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  if (!/\s/.test(normalized)) {
    return splitLongWord(normalized, maxLineLength).join("\n");
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  const flushLine = () => {
    if (currentLine) {
      lines.push(currentLine);
      currentLine = "";
    }
  };

  for (const word of words) {
    if (!currentLine) {
      if (word.length > maxLineLength) {
        lines.push(...splitLongWord(word, maxLineLength));
        continue;
      }
      currentLine = word;
      continue;
    }

    if (currentLine.length + 1 + word.length <= maxLineLength) {
      currentLine = `${currentLine} ${word}`;
      continue;
    }

    flushLine();
    if (word.length > maxLineLength) {
      lines.push(...splitLongWord(word, maxLineLength));
      continue;
    }
    currentLine = word;
  }

  flushLine();
  return lines.join("\n");
};

const splitTokenByMaxChars = (token: KaraokeToken, maxChars: number): KaraokeToken[] => {
  if (token.text.length <= maxChars) return [token];
  const totalChars = token.text.length;
  const duration = token.endTime - token.startTime;
  const perChar = totalChars > 0 ? duration / totalChars : 0;
  const parts: KaraokeToken[] = [];

  let offset = 0;
  while (offset < totalChars) {
    const chunk = token.text.slice(offset, offset + maxChars);
    const chunkStart = token.startTime + perChar * offset;
    const chunkEnd = token.startTime + perChar * (offset + chunk.length);
    parts.push({ text: chunk, startTime: chunkStart, endTime: chunkEnd });
    offset += chunk.length;
  }

  return parts;
};

const splitSegmentsByMaxChars = (
  segments: ScriptSegment[],
  maxChars: number
): ScriptSegment[] => {
  if (maxChars <= 0) return segments;
  const results: ScriptSegment[] = [];

  for (const segment of segments) {
    if (segment.text.length <= maxChars) {
      results.push(segment);
      continue;
    }

    const tokens = segment.tokens.length
      ? segment.tokens
      : [{ text: segment.text, startTime: segment.startTime, endTime: segment.endTime }];

    let currentTokens: KaraokeToken[] = [];
    let currentText = "";
    let startTime: number | null = null;
    let endTime: number | null = null;

    const flush = () => {
      if (!currentText.trim() || startTime === null || endTime === null) return;
      results.push({
        text: currentText.trim(),
        startTime,
        endTime,
        tokens: currentTokens,
      });
      currentTokens = [];
      currentText = "";
      startTime = null;
      endTime = null;
    };

    for (const token of tokens) {
      const parts = splitTokenByMaxChars(token, maxChars);
      for (const part of parts) {
        if (!currentText) {
          startTime = part.startTime;
        }
        if (currentText.length + part.text.length > maxChars && currentText) {
          flush();
          startTime = part.startTime;
        }
        currentText += part.text;
        endTime = part.endTime;
        currentTokens.push(part);
        if (currentText.length >= maxChars) {
          flush();
        }
      }
    }

    flush();
  }

  return results;
};

const generateSrt = (
  segments: ScriptSegment[],
  clipStartTime: number,
  maxSegmentChars: number
): string => {
  let srtContent = "";
  let subtitleIndex = 1;

  const constrainedSegments = splitSegmentsByMaxChars(segments, maxSegmentChars);

  for (const segment of constrainedSegments) {
    const adjustedStart = Math.max(0, segment.startTime - clipStartTime);
    const adjustedEnd = Math.max(0, segment.endTime - clipStartTime);
    if (adjustedEnd <= adjustedStart) continue;

    srtContent += `${subtitleIndex}\n`;
    srtContent += `${formatTimestamp(adjustedStart)} --> ${formatTimestamp(adjustedEnd)}\n`;
    srtContent += `${wrapSubtitleText(segment.text, maxSegmentChars)}\n\n`;
    subtitleIndex += 1;
  }

  return srtContent;
};

export const registerVideoTools = (server: McpServer, client: DagloApiClient) => {
  server.registerTool(
    "create-youtube-highlight-clip",
    {
      title: "Create YouTube Highlight Clip",
      description:
        "Download a YouTube video with yt-dlp, pick a highlight segment based on board transcript JSON, and output a burned-in subtitle clip via ffmpeg.",
      inputSchema: {
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
      },
    },
    async (args) => {
      try {
        if (!args.boardId && !args.fileMetaId) {
          throw new Error("Provide boardId or fileMetaId to fetch transcript.");
        }

        const outputDir = args.outputDir || "./docs/clips";
        const clipLengthMinutes = args.clipLengthMinutes ?? 3.5;
        const subtitleMaxLineLength = args.subtitleMaxLineLength ?? 42;
        const shortsMode = args.shortsMode ?? false;

        mkdirSync(outputDir, { recursive: true });

        let fileMetaId = args.fileMetaId;
        let keywords = args.highlightKeywords || [];

        if (!fileMetaId && args.boardId) {
          const boardUrl = buildUrl(client.baseUrl, `/boards/${args.boardId}`);
          const boardResponse = await fetch(boardUrl, {
            headers: client.getAuthHeaders(),
          });
          if (!boardResponse.ok) {
            throw new Error(`Failed to fetch board: ${boardResponse.statusText}`);
          }
          const boardData = (await parseResponseBody(boardResponse)) as {
            fileMetaId?: string;
            keywords?: string[];
            fileMeta?: Array<{ id?: string }>;
          };
          fileMetaId =
            boardData.fileMetaId ||
            (Array.isArray(boardData.fileMeta) ? boardData.fileMeta[0]?.id : undefined);
          if (!keywords.length && boardData.keywords) {
            keywords = normalizeKeywords(boardData.keywords);
          }
        }

        if (!fileMetaId) {
          throw new Error("Could not determine fileMetaId from boardId.");
        }

        if (!keywords.length) {
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
            keywords = normalizeKeywords(keywordsData?.keywords);
          }
        }

        if (!keywords.length) {
          keywords = ["AI", "엔비디아", "오라클", "결론", "미국장", "시장", "금리"];
        }

        const scripts: Record<string, unknown>[] = [];
        const scriptUrl = buildUrl(client.baseUrl, `/file-meta/${fileMetaId}/script`, {
          limit: 60,
          page: 0,
        });
        const scriptResponse = await fetch(scriptUrl, {
          headers: client.getAuthHeaders(),
        });
        if (!scriptResponse.ok) {
          throw new Error(`Failed to fetch script: ${scriptResponse.statusText}`);
        }

        const scriptPayload = (await parseResponseBody(scriptResponse)) as {
          item?: string;
          meta?: { totalPages?: number };
        };
        const firstScript = decodeScriptItem(scriptPayload?.item);
        if (firstScript) {
          scripts.push(firstScript);
        }

        const totalPages = scriptPayload?.meta?.totalPages ?? 1;
        for (let page = 1; page < totalPages; page += 1) {
          const pageUrl = buildUrl(client.baseUrl, `/file-meta/${fileMetaId}/script`, {
            limit: 60,
            page,
          });
          const pageResponse = await fetch(pageUrl, {
            headers: client.getAuthHeaders(),
          });
          if (!pageResponse.ok) {
            throw new Error(`Failed to fetch script page ${page}: ${pageResponse.statusText}`);
          }
          const pagePayload = (await parseResponseBody(pageResponse)) as { item?: string };
          const pageScript = decodeScriptItem(pagePayload?.item);
          if (pageScript) {
            scripts.push(pageScript);
          }
        }

        const segments = scripts.flatMap((script) => extractSegmentsFromScript(script));
        if (segments.length === 0) {
          throw new Error("No segments found in script.");
        }

        const videoId = extractYouTubeId(args.youtubeUrl);
        const videoFilename = videoId ? `video_${videoId}.mp4` : "video_full.mp4";
        const videoPath = resolve(outputDir, videoFilename);
        if (existsSync(videoPath)) {
          logger.info({ path: videoPath }, "Video already exists, skipping download");
        } else {
          logger.info({ url: args.youtubeUrl, path: videoPath }, "Downloading video");
          execSync(
            `python -m yt_dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "${videoPath}" "${args.youtubeUrl}"`,
            { stdio: "inherit" }
          );
        }

        if (!existsSync(videoPath)) {
          throw new Error(`Video download failed: ${videoPath} does not exist`);
        }

        const durationOutput = execSync(
          `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${videoPath}"`
        )
          .toString()
          .trim();
        const videoDuration = Number.parseFloat(durationOutput);
        const maxSegmentEnd = segments.reduce(
          (max, segment) => Math.max(max, segment.endTime),
          0
        );
        const scaleNeeded =
          Number.isFinite(videoDuration) &&
          maxSegmentEnd > Math.max(videoDuration * 10, 10000)
            ? 0.001
            : 1;
        const scaledSegmentsAll = applyTimeScale(segments, scaleNeeded);

        const { segments: selectedSegments, startTime, endTime } = selectHighlightSegments(
          scaledSegmentsAll,
          clipLengthMinutes,
          keywords
        );
        if (selectedSegments.length === 0) {
          throw new Error("No highlight segments selected.");
        }

        const scaledStartTime = startTime;
        const scaledEndTime = endTime;

        const clipDuration = scaledEndTime - scaledStartTime;
        const clipFilename = "clip_no_subs.mp4";
        const clipPath = resolve(outputDir, clipFilename);
        logger.info(
          { start: scaledStartTime, end: scaledEndTime, duration: clipDuration },
          "Cutting clip"
        );
        execSync(
          `ffmpeg -y -ss ${scaledStartTime} -i "${videoPath}" -t ${clipDuration} -c copy "${clipPath}"`,
          { stdio: "inherit" }
        );

        if (!existsSync(clipPath)) {
          throw new Error(`Clip generation failed: ${clipPath} does not exist`);
        }

        const srtContent = generateSrt(
          selectedSegments,
          scaledStartTime,
          subtitleMaxLineLength
        );
        const srtFilename = "subtitles.srt";
        const srtPath = resolve(outputDir, srtFilename);
        writeFileSync(srtPath, srtContent, "utf-8");
        logger.info({ path: srtPath, segments: selectedSegments.length }, "Generated SRT");

        const finalFilename = "clip_with_subs.mp4";
        const finalPath = resolve(outputDir, finalFilename);
        logger.info({ path: finalPath }, "Burning subtitles into clip");
        const normalizedSrtPath = srtPath
          .replace(/\\/g, "/")
          .replace(/:/g, "\\:")
          .replace(/'/g, "\\'");
        const subtitlesFilter = `subtitles='${normalizedSrtPath}'`;
        const shortsFilter =
          "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920";
        const videoFilter = shortsMode
          ? `${shortsFilter},${subtitlesFilter}`
          : subtitlesFilter;
        execSync(
          `ffmpeg -y -i "${clipPath}" -vf "${videoFilter}" -c:a copy "${finalPath}"`,
          { stdio: "inherit" }
        );

        if (!existsSync(finalPath)) {
          throw new Error(`Final clip generation failed: ${finalPath} does not exist`);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  outputDir,
                  videoPath,
                  clipPath,
                  srtPath,
                  finalPath,
                  clipStartTime: scaledStartTime,
                  clipEndTime: scaledEndTime,
                  clipDuration,
                  segmentCount: selectedSegments.length,
                  keywords,
                  timeScale: scaleNeeded,
                  shortsMode,
                  subtitleMaxLineLength,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage }, "Failed to create YouTube highlight clip");
        throw error;
      }
    }
  );
};
