import { Command } from "commander";
import { DagloApiClient } from "../api/client.js";
import { exportToObsidian } from "../handlers/obsidian.js";
import { writeJson, writeFilesWritten } from "./render/format.js";

export const registerObsidianCommand = (
  program: Command,
  client: DagloApiClient
) => {
  const obs = program.command("obsidian").description("Obsidian export commands");

  obs
    .command("export <boardId>")
    .description("Export a board to Obsidian markdown")
    .option("--file-meta <id>", "file metadata ID")
    .option("--type <type>", "output type (original|summary|both)", "both")
    .option("--out <dir>", "output directory", "./docs")
    .option("--no-content", "omit content")
    .option("--no-summary", "omit summary")
    .option("--no-keywords", "omit keywords")
    .option("--no-ai-summary", "omit AI summary")
    .option("--json", "output JSON")
    .action(async (boardId, opts) => {
      const data = (await exportToObsidian(client, {
        boardId,
        fileMetaId: opts.fileMeta,
        outputType: opts.type,
        outputDir: opts.out,
        includeContent: opts.content !== false,
        includeSummary: opts.summary !== false,
        includeKeywords: opts.keywords !== false,
        includeAiSummary: opts.aiSummary !== false,
      })) as Record<string, unknown>;

      if (opts.json) return writeJson(data);
      const files =
        Array.isArray(data.generatedFiles)
          ? (data.generatedFiles as string[])
          : Array.isArray(data.files)
            ? (data.files as string[])
            : [];
      writeFilesWritten(files);
    });
};
