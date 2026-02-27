#!/usr/bin/env node

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_CONFIG = {
  workDir: "./.work/youtube-pipeline",
  nasOutputDir: "/Volumes/iptime-nas/daglo-youtube",
  maxNewPerRun: 3,
  ytdlpPath: "yt-dlp",
  ffmpegPath: "ffmpeg",
  daglo: {
    language: "ko-KR",
    topic: "IT",
    useSpeakerDiarization: true,
    useDictionary: false,
    pollIntervalSec: 60,
    pollTimeoutMin: 30,
  },
  channels: [],
};

function parseArgs(argv) {
  const options = {
    out: "./scripts/youtube-pipeline.config.json",
    nas: null,
    force: false,
    channels: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      options.out = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--nas") {
      options.nas = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    options.channels.push(arg);
  }

  return options;
}

function isChannelId(value) {
  return /^UC[0-9A-Za-z_-]{22}$/.test(value);
}

function channelIdFromInput(raw) {
  const value = raw.trim();
  if (!value) return null;
  if (isChannelId(value)) return value;

  const channelPathMatch = value.match(/youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})/i);
  if (channelPathMatch?.[1]) return channelPathMatch[1];

  const rssMatch = value.match(/[?&]channel_id=(UC[0-9A-Za-z_-]{22})/i);
  if (rssMatch?.[1]) return rssMatch[1];

  return null;
}

async function resolveChannelIdFromHandleUrl(raw) {
  if (!/youtube\.com\/@/i.test(raw)) return null;

  const response = await fetch(raw, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch handle url: ${raw} (${response.status})`);
  }

  const html = await response.text();
  const channelIdMatch = html.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/);
  if (channelIdMatch?.[1]) return channelIdMatch[1];

  const canonicalMatch = html.match(/https:\/\/www\.youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})/);
  if (canonicalMatch?.[1]) return canonicalMatch[1];

  return null;
}

function toRssUrl(channelId) {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

async function resolveChannel(rawInput) {
  if (/feeds\/videos\.xml/i.test(rawInput)) {
    return {
      name: rawInput,
      rssUrl: rawInput,
    };
  }

  const direct = channelIdFromInput(rawInput);
  if (direct) {
    return {
      name: direct,
      rssUrl: toRssUrl(direct),
    };
  }

  const viaHandle = await resolveChannelIdFromHandleUrl(rawInput);
  if (viaHandle) {
    return {
      name: rawInput,
      rssUrl: toRssUrl(viaHandle),
    };
  }

  throw new Error(
    `Cannot resolve channel input: ${rawInput}\nSupported: UC... channelId, /channel/UC... URL, /@handle URL, RSS URL`
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputPath = resolve(options.out);

  if (existsSync(outputPath) && !options.force) {
    throw new Error(`Config already exists: ${outputPath}. Use --force to overwrite.`);
  }

  if (!options.nas) {
    throw new Error("Missing required option: --nas <NAS output directory>");
  }

  if (options.channels.length === 0) {
    throw new Error(
      "At least one channel is required. Example: npm run pipeline:youtube:bootstrap -- --nas /Volumes/iptime-nas/daglo-youtube https://www.youtube.com/@GoogleDevelopers"
    );
  }

  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  config.nasOutputDir = options.nas;

  const resolvedChannels = [];
  for (const channelInput of options.channels) {
    const resolved = await resolveChannel(channelInput);
    resolvedChannels.push(resolved);
  }
  config.channels = resolvedChannels;

  writeFileSync(outputPath, JSON.stringify(config, null, 2) + "\n", "utf8");

  console.log(`Created config: ${outputPath}`);
  console.log(`- nasOutputDir: ${config.nasOutputDir}`);
  console.log(`- channels: ${config.channels.length}`);
  for (const channel of config.channels) {
    console.log(`  - ${channel.rssUrl}`);
  }
}

main().catch((error) => {
  console.error(`Bootstrap failed: ${error.message}`);
  process.exit(1);
});
