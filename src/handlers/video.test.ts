import { describe, it, expect } from "vitest";
import { DagloApiClient } from "../api/client.js";
import { createYoutubeHighlightClip, createYoutubeFullSubtitledVideo } from "./video.js";

describe("createYoutubeHighlightClip", () => {
  it("is a function", () => {
    expect(typeof createYoutubeHighlightClip).toBe("function");
  });

  it("throws when neither boardId nor fileMetaId is provided", async () => {
    const client = new DagloApiClient();
    await expect(
      createYoutubeHighlightClip(client, {
        youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      })
    ).rejects.toThrow("Provide boardId or fileMetaId to fetch transcript.");
  });
});

describe("createYoutubeFullSubtitledVideo", () => {
  it("is a function", () => {
    expect(typeof createYoutubeFullSubtitledVideo).toBe("function");
  });

  it("throws when neither boardId nor fileMetaId is provided", async () => {
    const client = new DagloApiClient();
    await expect(
      createYoutubeFullSubtitledVideo(client, {
        youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      })
    ).rejects.toThrow("Provide boardId or fileMetaId to fetch transcript.");
  });
});
