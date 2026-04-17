import { DagloApiClient } from "../api/client.js";
import {
  GetFileMetaArgs,
  GetKeywordsArgs,
} from "../schemas/file-meta.js";
import { parseResponseBody } from "../utils/http.js";

export const getFileMeta = async (
  client: DagloApiClient,
  args: GetFileMetaArgs
): Promise<unknown> => {
  const response = await client.request(`/file-meta/${args.fileMetaId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch file meta: ${response.statusText}`);
  }
  return (await response.json()) as unknown;
};

export const getKeywords = async (
  client: DagloApiClient,
  args: GetKeywordsArgs
): Promise<unknown> => {
  if (!args.fileMetaId && !args.sharedBoardId) {
    throw new Error("Provide fileMetaId or sharedBoardId.");
  }

  const path = args.sharedBoardId
    ? `/shared-board/${args.sharedBoardId}/keyword`
    : `/file-meta/${args.fileMetaId}/keyword`;
  const init = args.sharedBoardId
    ? { headers: { "daglo-platform": "web" } }
    : { headers: client.getAuthHeaders() };

  const response = await client.request(path, init);
  if (!response.ok) {
    throw new Error(`Failed to fetch keywords: ${response.statusText}`);
  }
  return await parseResponseBody(response);
};
