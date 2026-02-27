const { execSync } = require("node:child_process");
const fs = require("node:fs");

const fetchFn = global.fetch;

const readEnvFile = () => {
  const text = fs.readFileSync(".env", "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
};

const decodeZlibBase64Content = (value) => {
  if (!value) return value;
  try {
    const buffer = Buffer.from(value, "base64");
    const zlib = require("zlib");
    const inflated = zlib.inflateSync(buffer);
    return inflated.toString("utf-8");
  } catch {
    return value;
  }
};

const decodeScriptItem = (value) => {
  if (!value || typeof value !== "string") return null;
  const inflated = decodeZlibBase64Content(value);
  if (!inflated) return null;
  try {
    return JSON.parse(inflated);
  } catch {
    return null;
  }
};

const extractSegmentsFromScript = (script) => {
  const segments = [];
  const editorState = script?.editorState;
  const paragraphs = editorState?.root?.children;
  if (!Array.isArray(paragraphs)) return segments;

  const tokens = [];
  for (const paragraph of paragraphs) {
    const children = paragraph.children;
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      if (child.type === "karaoke" && typeof child.text === "string") {
        const startTime = typeof child.s === "number" ? child.s : 0;
        const endTime = typeof child.e === "number" ? child.e : 0;
        tokens.push({ text: child.text, startTime, endTime });
      }
    }
  }

  const segmentsByPunctuation = [];
  let currentTokens = [];
  let currentText = "";
  let startTime = null;
  let endTime = null;

  for (const token of tokens) {
    if (startTime === null) startTime = token.startTime;
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

const formatTimestamp = (seconds) => {
  const ms = Math.floor((seconds % 1) * 1000);
  const total = Math.floor(seconds);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
};

const wrapSubtitleText = (text, maxChars) => {
  if (text.length <= maxChars) return text;
  const words = text.split(" ");
  const lines = [""];
  for (const word of words) {
    const last = lines[lines.length - 1];
    const next = last ? `${last} ${word}` : word;
    if (next.length <= maxChars) {
      lines[lines.length - 1] = next;
    } else {
      lines.push(word);
    }
  }
  return lines.join("\n");
};

const splitSegmentsByMaxChars = (segments, maxChars) => {
  const results = [];
  const splitTokenByMaxChars = (token, maxLen) => {
    const parts = [];
    let remaining = token.text;
    let start = token.startTime;
    const duration = Math.max(0.001, token.endTime - token.startTime);
    while (remaining.length > 0) {
      const chunk = remaining.slice(0, maxLen);
      const ratio = chunk.length / remaining.length;
      const end = start + duration * ratio;
      parts.push({ text: chunk, startTime: start, endTime: end });
      remaining = remaining.slice(maxLen);
      start = end;
    }
    return parts;
  };

  for (const segment of segments) {
    if (segment.text.length <= maxChars) {
      results.push(segment);
      continue;
    }

    const tokens = segment.tokens;
    let currentTokens = [];
    let currentText = "";
    let startTime = null;
    let endTime = null;

    const flush = () => {
      if (!currentText || startTime === null || endTime === null) return;
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
        if (!currentText) startTime = part.startTime;
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

const generateSrt = (segments, clipStartTime, maxSegmentChars) => {
  let srt = "";
  let index = 1;
  const constrained = splitSegmentsByMaxChars(segments, maxSegmentChars);
  for (const segment of constrained) {
    const adjustedStart = Math.max(0, segment.startTime - clipStartTime);
    const adjustedEnd = Math.max(0, segment.endTime - clipStartTime);
    if (adjustedEnd <= adjustedStart) continue;
    srt += `${index}\n`;
    srt += `${formatTimestamp(adjustedStart)} --> ${formatTimestamp(adjustedEnd)}\n`;
    srt += `${wrapSubtitleText(segment.text, maxSegmentChars)}\n\n`;
    index += 1;
  }
  return srt;
};

const applyTimeScale = (segments, scale) =>
  segments.map((seg) => ({
    ...seg,
    startTime: seg.startTime * scale,
    endTime: seg.endTime * scale,
    tokens: seg.tokens.map((t) => ({
      ...t,
      startTime: t.startTime * scale,
      endTime: t.endTime * scale,
    })),
  }));

const main = async () => {
  const env = readEnvFile();
  const base = "https://backend.daglo.ai";
  const email = env.DAGLO_EMAIL;
  const password = env.DAGLO_PASSWORD;
  if (!email || !password) {
    console.error("Missing DAGLO_EMAIL or DAGLO_PASSWORD");
    process.exit(1);
  }

  const loginRes = await fetchFn(`${base}/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "daglo-platform": "web" },
    body: JSON.stringify({ email, password }),
  });
  const loginText = await loginRes.text();
  let loginData = null;
  try {
    loginData = loginText ? JSON.parse(loginText) : null;
  } catch {
    loginData = null;
  }
  if (!loginRes.ok) {
    console.error("Login failed", loginRes.status, loginRes.statusText);
    process.exit(1);
  }

  const token = loginRes.headers.get("accesstoken") || loginData?.token;
  if (!token) {
    console.error("Login succeeded but token missing");
    process.exit(1);
  }

  const detail = JSON.parse(fs.readFileSync("latest-board-detail.json", "utf8"));
  const fileMetaId = detail?.fileMeta?.[0]?.id || detail?.fileMetaId;
  if (!fileMetaId) {
    console.error("Missing fileMetaId");
    process.exit(1);
  }

  const scripts = [];
  const firstRes = await fetchFn(
    `${base}/file-meta/${fileMetaId}/script?limit=60&page=0`,
    {
      headers: {
        "Content-Type": "application/json",
        "daglo-platform": "web",
        Authorization: `bearer ${token}`,
      },
    }
  );
  const firstText = await firstRes.text();
  let firstData = null;
  try {
    firstData = firstText ? JSON.parse(firstText) : null;
  } catch {
    firstData = null;
  }
  if (!firstRes.ok) {
    console.error("Script fetch failed", firstRes.status, firstRes.statusText);
    process.exit(1);
  }

  const firstScript = decodeScriptItem(firstData?.item);
  if (firstScript) scripts.push(firstScript);
  const totalPages = firstData?.meta?.totalPages ?? 1;

  for (let page = 1; page < totalPages; page += 1) {
    const pageRes = await fetchFn(
      `${base}/file-meta/${fileMetaId}/script?limit=60&page=${page}`,
      {
        headers: {
          "Content-Type": "application/json",
          "daglo-platform": "web",
          Authorization: `bearer ${token}`,
        },
      }
    );
    const pageText = await pageRes.text();
    let pageData = null;
    try {
      pageData = pageText ? JSON.parse(pageText) : null;
    } catch {
      pageData = null;
    }
    if (!pageRes.ok) {
      console.error("Script page failed", pageRes.status, pageRes.statusText);
      process.exit(1);
    }
    const pageScript = decodeScriptItem(pageData?.item);
    if (pageScript) scripts.push(pageScript);
  }

  const segments = scripts.flatMap((script) => extractSegmentsFromScript(script));
  if (segments.length === 0) {
    console.error("No segments found");
    process.exit(1);
  }

  const durationOutput = execSync(
    "ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 \"latest-board-video.mp4\""
  )
    .toString()
    .trim();
  const videoDuration = Number.parseFloat(durationOutput);
  const maxEnd = segments.reduce((max, segment) => Math.max(max, segment.endTime), 0);
  const scaleNeeded =
    Number.isFinite(videoDuration) && maxEnd > Math.max(videoDuration * 10, 10000)
      ? 0.001
      : 1;
  const scaledSegments = applyTimeScale(segments, scaleNeeded);

  const srt = generateSrt(scaledSegments, 0, 42);
  fs.writeFileSync("latest-board-subtitles.srt", srt, "utf8");
  console.log(JSON.stringify({ segments: scaledSegments.length, timeScale: scaleNeeded }));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
