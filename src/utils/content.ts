import { inflateSync } from "node:zlib";

export const decodeZlibBase64Content = (value: string) => {
  if (!value) return value;

  try {
    const buffer = Buffer.from(value, "base64");
    const inflated = inflateSync(buffer);
    return inflated.toString("utf-8");
  } catch {
    return value;
  }
};

export const normalizeScriptContent = (value: string) => {
  if (!value) return value;
  const decoded = decodeZlibBase64Content(value);
  if (!decoded) return decoded;
  if (decoded.trim().startsWith("{")) {
    return decodeZlibBase64Content(decoded);
  }
  return decoded;
};

export const decodeScriptItem = (value: unknown) => {
  if (!value || typeof value !== "string") return null;
  const inflated = decodeZlibBase64Content(value);
  if (!inflated) return null;
  try {
    return JSON.parse(inflated) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const buildScriptPages = (
  script: Record<string, unknown>,
  totalPages: number,
  minutesPerPage: number
) => {
  const editorState = script.editorState as
    | { root?: { children?: Array<Record<string, unknown>> } }
    | undefined;
  const paragraphs = editorState?.root?.children;
  if (!Array.isArray(paragraphs) || totalPages < 1) return [];

  const pages: Array<Record<string, unknown>> = [];

  for (let page = 1; page <= totalPages; page += 1) {
    const min = (page - 1) * minutesPerPage * 60;
    const max = page * minutesPerPage * 60;
    const slicedParagraphs = paragraphs.filter((value) => {
      const children = value.children as Array<Record<string, unknown>> | undefined;
      const time = typeof children?.[0]?.time === "number" ? children?.[0]?.time : 0;
      if (page === 1) {
        return min <= time && time <= max;
      }
      return min < time && time <= max;
    });

    pages.push({
      ...script,
      editorState: {
        root: {
          children: slicedParagraphs,
          format: "",
          type: "root",
          version: 1,
        },
      },
    });
  }

  return pages;
};
