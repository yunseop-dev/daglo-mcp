import { resolve } from "node:path";
import {
  buildPlainTextFromTokens,
  extractKaraokeTokens,
} from "./karaoke.js";

export const sanitizeFilename = (value: string) => {
  if (!value) return "";
  return value
    .trim()
    .replace(/[\/]/g, "-")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120);
};

export const buildDefaultOutputPath = (baseName: string, extension: string) => {
  const normalizedBase = sanitizeFilename(baseName) || "board-detail";
  return resolve(process.cwd(), `${normalizedBase}.${extension}`);
};

export const buildPlainTextFromScriptPayload = (
  script: unknown,
  fallbackContent?: string | null
) => {
  let sourceText = "";
  if (script) {
    try {
      sourceText = JSON.stringify(script);
    } catch {
      sourceText = "";
    }
  }

  if (!sourceText && fallbackContent) {
    sourceText = fallbackContent;
  }

  if (!sourceText) return "";
  const tokens = extractKaraokeTokens(sourceText);
  let plainText = buildPlainTextFromTokens(tokens);
  if (!plainText && fallbackContent) {
    plainText = fallbackContent;
  }
  return plainText;
};
