#!/usr/bin/env node

import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assertEnv(name) {
  if (!process.env[name]) {
    throw new Error(`${name} is missing in current environment`);
  }
}

function checkWritableDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }

  accessSync(dirPath, constants.R_OK | constants.W_OK);
  const marker = join(dirPath, `.nas-preflight-${Date.now()}.tmp`);
  writeFileSync(marker, "ok\n", "utf8");
  unlinkSync(marker);
}

function normalizeChannels(channels) {
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error("channels must be a non-empty array");
  }

  for (const channel of channels) {
    if (!channel?.rssUrl || typeof channel.rssUrl !== "string") {
      throw new Error("every channel must include rssUrl");
    }
  }
}

function run() {
  const configPath = resolve(process.argv[2] || "./scripts/youtube-pipeline.config.json");
  if (!existsSync(configPath)) {
    throw new Error(`config file not found: ${configPath}`);
  }

  const config = readJson(configPath);
  const nasOutputDir = resolve(config.nasOutputDir || "");

  if (!nasOutputDir || nasOutputDir === resolve(".")) {
    throw new Error("nasOutputDir is missing or invalid");
  }

  normalizeChannels(config.channels);

  assertEnv("DAGLO_EMAIL");
  assertEnv("DAGLO_PASSWORD");

  checkWritableDir(nasOutputDir);

  console.log("Preflight OK");
  console.log(`- config: ${configPath}`);
  console.log(`- nasOutputDir writable: ${nasOutputDir}`);
  console.log(`- channels: ${config.channels.length}`);
  console.log("- env: DAGLO_EMAIL, DAGLO_PASSWORD detected");
}

try {
  run();
} catch (error) {
  console.error(`Preflight failed: ${error.message}`);
  process.exit(1);
}
