import { Command } from "commander";
import { DagloApiClient } from "../api/client.js";
import { getFolders } from "../handlers/folders.js";
import { batchExportFolder } from "../handlers/obsidian.js";
import { writeJson, writeFilesWritten } from "./render/format.js";
import { writeTable } from "./render/table.js";

export const registerFolderCommand = (
  program: Command,
  client: DagloApiClient
) => {
  const folder = program.command("folder").description("Folder commands");

  folder
    .command("list")
    .description("List all folders")
    .option("--no-root", "exclude the root folder")
    .option("--json", "output JSON")
    .action(async (opts) => {
      const data = await getFolders(client, { includeRoot: opts.root !== false });
      if (opts.json) return writeJson(data);

      const arr = Array.isArray(data) ? data : [];
      writeTable(arr as Array<Record<string, unknown>>, [
        { header: "ID", get: (r) => String(r.id ?? "") },
        { header: "NAME", get: (r) => String(r.name ?? "") },
        { header: "ROOT", get: (r) => (r.isRoot ? "✓" : "") },
      ]);
    });

  folder
    .command("export <folderId>")
    .description("Export all boards in a folder to Obsidian markdown")
    .option("--out <dir>", "output directory", "./docs")
    .option("--type <type>", "output type (original|summary|both)", "both")
    .option("--limit <n>", "max boards to export", (v) => parseInt(v, 10), 50)
    .option("--json", "output JSON")
    .action(async (folderId, opts) => {
      const result = (await batchExportFolder(client, {
        folderId,
        outputDir: opts.out,
        outputType: opts.type,
        limit: opts.limit,
      })) as Record<string, unknown>;

      if (opts.json) return writeJson(result);

      const files =
        Array.isArray(result.generatedFiles)
          ? (result.generatedFiles as string[])
          : Array.isArray(result.files)
            ? (result.files as string[])
            : [];
      writeFilesWritten(files);
    });
};
