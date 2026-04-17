import { DagloApiClient } from "../api/client.js";
import { GetFoldersArgs } from "../schemas/folders.js";

export const getFolders = async (
  client: DagloApiClient,
  args: GetFoldersArgs
): Promise<unknown> => {
  const params = new URLSearchParams();
  if (args.includeRoot !== undefined) {
    params.append("includeRoot", args.includeRoot.toString());
  }

  const qs = params.toString();
  const url = `${client.baseUrl}/folders${qs ? `?${qs}` : ""}`;

  const response = await fetch(url, { headers: client.getAuthHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to fetch folders: ${response.statusText}`);
  }

  return (await response.json()) as unknown;
};
