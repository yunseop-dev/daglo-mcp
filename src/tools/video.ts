import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DagloApiClient } from "../api/client.js";
import {
  createYoutubeFullSubtitledVideo,
  createYoutubeHighlightClip,
} from "../handlers/video.js";
import {
  createYoutubeFullSubtitledVideoSchema,
  createYoutubeHighlightClipSchema,
} from "../schemas/video.js";

export const registerVideoTools = (server: McpServer, client: DagloApiClient) => {
  server.registerTool(
    "create-youtube-highlight-clip",
    {
      title: "Create YouTube Highlight Clip",
      description:
        "Download a YouTube video with yt-dlp, pick a highlight segment based on board transcript JSON, and output a burned-in subtitle clip via ffmpeg.",
      inputSchema: createYoutubeHighlightClipSchema.shape,
    },
    async (args) => {
      const data = await createYoutubeHighlightClip(client, args);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "create-youtube-full-subtitled-video",
    {
      title: "Create YouTube Full Subtitled Video",
      description:
        "Download a YouTube video with yt-dlp, build subtitles from board transcript JSON, and burn them into the full video via ffmpeg.",
      inputSchema: createYoutubeFullSubtitledVideoSchema.shape,
    },
    async (args) => {
      const data = await createYoutubeFullSubtitledVideo(client, args);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
};
