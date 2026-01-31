import { DAGLO_API_BASE } from "../config.js";

export const normalizePath = (path: string) => {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
};

export const appendQueryParams = (
  url: URL,
  query?: Record<string, unknown> | null
) => {
  if (!query) return;

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) return;

    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry === undefined || entry === null) return;
        url.searchParams.append(key, String(entry));
      });
      return;
    }

    url.searchParams.append(key, String(value));
  });
};

export const buildUrl = (
  baseUrl: string = DAGLO_API_BASE,
  path: string,
  query?: Record<string, unknown>
) => {
  const normalizedPath = normalizePath(path);
  const url = new URL(normalizedPath, baseUrl);
  appendQueryParams(url, query);
  return url.toString();
};

export const parseResponseBody = async (response: Response) => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};
