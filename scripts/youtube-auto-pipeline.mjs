#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DAGLO_API_BASE = "https://backend.daglo.ai";

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function assertEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function runCommand(command, args, description) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `${description} failed\ncommand: ${command} ${args.join(" ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );
  }
  return result.stdout.trim();
}

async function apiCall(path, options = {}, token) {
  const headers = {
    "Content-Type": "application/json",
    platform: "web",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${DAGLO_API_BASE}${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`API ${options.method || "GET"} ${path} failed: ${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function apiCallWithRetry(path, options = {}, token, retries = 3, retryDelayMs = 1500) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await apiCall(path, options, token);
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs * attempt));
    }
  }

  throw lastError;
}

function validateConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("Config is missing or invalid JSON");
  }

  if (!config.nasOutputDir || typeof config.nasOutputDir !== "string") {
    throw new Error("Config nasOutputDir is required");
  }

  if (!Array.isArray(config.channels) || config.channels.length === 0) {
    throw new Error("Config channels must be a non-empty array");
  }

  for (const channel of config.channels) {
    if (!channel?.rssUrl || typeof channel.rssUrl !== "string") {
      throw new Error("Every channel must include rssUrl");
    }
  }
}

function ensureBinaryAvailable(binary) {
  const check = spawnSync(binary, ["--version"], { encoding: "utf8" });
  if (check.status !== 0) {
    throw new Error(`${binary} is not available in PATH`);
  }
}

function parseRssEntries(xml) {
  const entries = [];
  const entryPattern = /<entry>([\s\S]*?)<\/entry>/g;
  let entryMatch;

  while ((entryMatch = entryPattern.exec(xml)) !== null) {
    const block = entryMatch[1];
    const videoId = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || "Untitled";
    const published = block.match(/<published>([^<]+)<\/published>/)?.[1];

    if (!videoId) continue;

    entries.push({
      videoId,
      title,
      published,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }

  return entries;
}

function sanitizeName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, " ").trim();
}

function findDownloadedFile(workDir, videoId) {
  const files = readdirSync(workDir);
  const matched = files.find((name) => name.startsWith(`${videoId}.`) && !name.endsWith(".mp3"));
  if (!matched) {
    throw new Error(`Cannot find downloaded source for ${videoId} in ${workDir}`);
  }
  return join(workDir, matched);
}

function extractTranscriptText(scriptPayload) {
  if (!scriptPayload) return "";

  const maybeArray = Array.isArray(scriptPayload)
    ? scriptPayload
    : Array.isArray(scriptPayload?.items)
      ? scriptPayload.items
      : Array.isArray(scriptPayload?.data)
        ? scriptPayload.data
        : null;

  if (maybeArray) {
    const lines = [];
    for (const item of maybeArray) {
      if (typeof item?.text === "string") lines.push(item.text);
      if (typeof item?.content === "string") lines.push(item.content);
      if (Array.isArray(item?.tokens)) {
        for (const token of item.tokens) {
          if (typeof token?.word === "string") lines.push(token.word);
          if (typeof token?.text === "string") lines.push(token.text);
        }
      }
    }
    if (lines.length > 0) {
      return lines.join(" ").replace(/\s+/g, " ").trim();
    }
  }

  const raw = JSON.stringify(scriptPayload);
  const texts = [];
  const pattern = /"text":"(.*?)"/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    texts.push(match[1]);
  }
  return texts.join(" ").replace(/\\n/g, " ").replace(/\\u003C/g, "<").replace(/\\u003E/g, ">");
}

function buildSummary(transcriptText) {
  if (!transcriptText) return "요약 생성에 충분한 텍스트를 찾지 못했습니다.";

  const sentences = transcriptText
    .split(/(?<=[.!?。！？]|다\.)\s+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return sentences.slice(0, 8).map((line) => `- ${line}`).join("\n");
}

async function pollBoardByFileMetaId(token, fileMetaId, pollIntervalSec, timeoutMin) {
  const maxAttempts = Math.ceil((timeoutMin * 60) / pollIntervalSec);

  for (let i = 0; i < maxAttempts; i += 1) {
    const boards = await apiCall("/v2/boards?page=1&limit=50&sort=createTime.desc", {}, token);
    const items = Array.isArray(boards?.items) ? boards.items : [];
    const matchedBoard = items.find((item) => {
      if (item.fileMetaId === fileMetaId) return true;
      if (Array.isArray(item.fileMeta)) {
        return item.fileMeta.some((meta) => meta?.id === fileMetaId);
      }
      return false;
    });

    if (matchedBoard) {
      const matchedMeta = Array.isArray(matchedBoard.fileMeta)
        ? matchedBoard.fileMeta.find((meta) => meta?.id === fileMetaId)
        : null;
      const status = matchedMeta?.transcriptStatus || matchedBoard.status;
      if (status === "COMPLETE") {
        return matchedBoard;
      }
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalSec * 1000));
  }

  throw new Error(`Timed out waiting transcript completion for fileMetaId=${fileMetaId}`);
}

async function run() {
  const configPath = resolve(process.argv[2] || "./scripts/youtube-pipeline.config.json");
  const config = readJson(configPath, null);
  if (!config) {
    throw new Error(`Config not found: ${configPath}`);
  }
  validateConfig(config);

  const email = assertEnv("DAGLO_EMAIL");
  const password = assertEnv("DAGLO_PASSWORD");

  const workDir = resolve(config.workDir || "./.work/youtube-pipeline");
  const nasOutputDir = resolve(config.nasOutputDir);
  const statePath = join(workDir, "state.json");
  const logsDir = join(workDir, "runs");

  mkdirSync(workDir, { recursive: true });
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(nasOutputDir, { recursive: true });

  ensureBinaryAvailable(config.ytdlpPath || "yt-dlp");
  ensureBinaryAvailable(config.ffmpegPath || "ffmpeg");

  const state = readJson(statePath, { processedVideoIds: [] });
  const processedVideoIds = new Set(state.processedVideoIds || []);

  console.log(`[1/7] Logging in to Daglo API: ${email}`);
  const login = await apiCallWithRetry(
    "/user/login",
    {
      method: "POST",
      body: JSON.stringify({ email, password }),
    },
    null
  );
  const token = login?.token;
  if (!token) {
    throw new Error("Daglo login did not return token");
  }

  const channels = Array.isArray(config.channels) ? config.channels : [];
  if (channels.length === 0) {
    throw new Error("Config channels is empty");
  }

  console.log(`[2/7] Loading RSS from ${channels.length} channels`);
  const allEntries = [];

  for (const channel of channels) {
    const rssUrl = channel.rssUrl;
    const response = await fetch(rssUrl);
    if (!response.ok) {
      console.warn(`Skipping channel ${channel.name || rssUrl}: ${response.status}`);
      continue;
    }

    const xml = await response.text();
    const entries = parseRssEntries(xml).map((entry) => ({ ...entry, channelName: channel.name || "Unknown" }));
    allEntries.push(...entries);
  }

  allEntries.sort((a, b) => new Date(b.published || 0).getTime() - new Date(a.published || 0).getTime());

  const maxNewPerRun = Number(config.maxNewPerRun || 3);
  const newEntries = allEntries.filter((entry) => !processedVideoIds.has(entry.videoId)).slice(0, maxNewPerRun);

  if (newEntries.length === 0) {
    console.log("No new videos. Done.");
    return;
  }

  console.log(`[3/7] New videos found: ${newEntries.length}`);

  for (const entry of newEntries) {
    const safeTitle = sanitizeName(entry.title);
    const itemDir = join(logsDir, `${entry.videoId}-${Date.now()}`);
    mkdirSync(itemDir, { recursive: true });

    console.log(`\nProcessing: ${entry.title}`);
    console.log(`[4/7] Download source audio with yt-dlp: ${entry.url}`);

    runCommand(
      config.ytdlpPath || "yt-dlp",
      ["-f", "bestaudio", "--no-playlist", "-o", join(itemDir, `${entry.videoId}.%(ext)s`), entry.url],
      "yt-dlp download"
    );

    const sourceAudioPath = findDownloadedFile(itemDir, entry.videoId);
    const mp3Path = join(itemDir, `${entry.videoId}.mp3`);

    console.log("[5/7] Convert source audio to mp3 with ffmpeg");
    runCommand(
      config.ffmpegPath || "ffmpeg",
      ["-y", "-i", sourceAudioPath, "-vn", "-ar", "44100", "-ac", "2", "-b:a", "192k", mp3Path],
      "ffmpeg convert"
    );

    console.log("[6/7] Submit YouTube URL to Daglo transcription API");
    await apiCallWithRetry(
      "/file/online-media/metadata?url=" + encodeURIComponent(entry.url),
      {},
      token
    );

    const transcriptOption = {
      language: config.daglo?.language || "ko-KR",
      useSpeakerDiarization: Boolean(config.daglo?.useSpeakerDiarization ?? true),
      topic: config.daglo?.topic || "IT",
      useDictionary: Boolean(config.daglo?.useDictionary ?? false),
    };

    await apiCallWithRetry(
      "/user-option/transcription",
      {
        method: "PATCH",
        body: JSON.stringify(transcriptOption),
      },
      token
    );

    const createTranscript = await apiCallWithRetry(
      "/transcript-request/online-media",
      {
        method: "POST",
        body: JSON.stringify({ transcriptOption, onlineMedia: { url: entry.url } }),
      },
      token
    );

    const fileMetaId = createTranscript?.fileMetaIds?.[0];
    if (!fileMetaId) {
      throw new Error(`transcript-request/online-media returned no fileMetaIds: ${JSON.stringify(createTranscript)}`);
    }

    const matchedBoard = await pollBoardByFileMetaId(
      token,
      fileMetaId,
      Number(config.daglo?.pollIntervalSec || 60),
      Number(config.daglo?.pollTimeoutMin || 30)
    );

    const boardId = matchedBoard.id;
    const scriptPayload = await apiCallWithRetry(`/file-meta/${fileMetaId}/script?limit=60&page=0`, {}, token);
    const summaryPayload = await apiCallWithRetry(`/file-meta/${fileMetaId}/summary`, {}, token, 2).catch(() => null);

    const transcriptText = extractTranscriptText(scriptPayload);
    const summaryText = typeof summaryPayload?.summary === "string" ? summaryPayload.summary : buildSummary(transcriptText);

    const reportPath = join(itemDir, `${entry.videoId}.md`);
    const reportLines = [
      `# ${safeTitle}`,
      "",
      `- Channel: ${entry.channelName}`,
      `- YouTube: ${entry.url}`,
      `- Board ID: ${boardId}`,
      `- File Meta ID: ${fileMetaId}`,
      `- Published: ${entry.published || "unknown"}`,
      "",
      "## Summary",
      "",
      summaryText,
      "",
      "## Transcript (extracted)",
      "",
      transcriptText || "(no extracted transcript text)",
      "",
    ];

    writeFileSync(reportPath, reportLines.join("\n"));
    writeJson(join(itemDir, `${entry.videoId}.script.json`), scriptPayload);

    console.log(`[7/7] Copy artifacts to NAS path: ${nasOutputDir}`);
    const targetDir = join(nasOutputDir, `${entry.videoId}-${safeTitle.slice(0, 60)}`);
    mkdirSync(targetDir, { recursive: true });
    copyFileSync(mp3Path, join(targetDir, `${entry.videoId}.mp3`));
    copyFileSync(reportPath, join(targetDir, `${entry.videoId}.md`));
    copyFileSync(join(itemDir, `${entry.videoId}.script.json`), join(targetDir, `${entry.videoId}.script.json`));

    processedVideoIds.add(entry.videoId);
    state.processedVideoIds = Array.from(processedVideoIds);
    writeJson(statePath, state);

    console.log(`Completed: ${entry.title}`);
  }

  console.log("\nPipeline run finished successfully.");
}

run().catch((error) => {
  console.error("Pipeline failed:", error.message);
  process.exit(1);
});
