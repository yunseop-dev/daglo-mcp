import { Command } from "commander";
import { DagloApiClient } from "../api/client.js";
import { getFileMeta, getKeywords } from "../handlers/file-meta.js";
import { writeJson, writeKeyValue } from "./render/format.js";

export const registerFileMetaCommand = (
  program: Command,
  client: DagloApiClient
) => {
  const fm = program.command("file-meta").description("File metadata commands");

  fm.command("get <fileMetaId>")
    .description("Retrieve file metadata")
    .option("--json", "output JSON")
    .action(async (fileMetaId, opts) => {
      const data = (await getFileMeta(client, { fileMetaId })) as Record<
        string,
        unknown
      >;
      if (opts.json) return writeJson(data);
      const rows: Array<[string, string]> = Object.entries(data).map(
        ([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]
      );
      writeKeyValue(rows);
    });

  fm.command("keywords")
    .description("Retrieve keywords for a file or shared board")
    .option("--file-meta <id>", "file metadata ID")
    .option("--shared <id>", "shared board ID")
    .option("--json", "output JSON")
    .action(async (opts) => {
      const data = await getKeywords(client, {
        fileMetaId: opts.fileMeta,
        sharedBoardId: opts.shared,
      });
      if (opts.json) return writeJson(data);
      const arr = Array.isArray(data) ? data : [];
      for (const k of arr) process.stdout.write(`${String(k)}\n`);
    });
};
