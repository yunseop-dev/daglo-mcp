import { Command } from "commander";
import { DagloApiClient } from "../api/client.js";
import {
  exportBoardContent,
  getBoardDetail,
  getBoardInfo,
  getBoardScript,
  getLatestBoardContent,
  listBoards,
  updateBoardName,
} from "../handlers/boards.js";
import {
  writeJson,
  writeKeyValue,
  writeSuccess,
  writeFilesWritten,
} from "./render/format.js";
import { writeTable } from "./render/table.js";

export const registerBoardCommand = (
  program: Command,
  client: DagloApiClient
) => {
  const board = program.command("board").description("Board commands");

  board
    .command("list")
    .description("List boards with optional filters")
    .option("--page <n>", "page number", (v) => parseInt(v, 10))
    .option("--limit <n>", "boards per page", (v) => parseInt(v, 10))
    .option("--sort <expr>", "sort expression (e.g. createTime.desc)")
    .option("--status <s>", "filter by status (COMPLETE|PROCESSING|FAILED)")
    .option("--starred", "only starred boards")
    .option("--folder <id>", "filter by folder ID")
    .option("--json", "output JSON")
    .action(async (opts) => {
      const data = await listBoards(client, {
        page: opts.page,
        limit: opts.limit,
        sort: opts.sort,
        status: opts.status,
        isStarred: opts.starred,
        folderId: opts.folder,
      });

      if (opts.json) return writeJson(data);

      const items = Array.isArray(data)
        ? data
        : Array.isArray((data as { items?: unknown })?.items)
          ? ((data as { items: unknown[] }).items)
          : [];

      writeTable(items as Array<Record<string, unknown>>, [
        { header: "ID", get: (r) => String(r.id ?? "") },
        { header: "NAME", get: (r) => String(r.name ?? "") },
        { header: "STATUS", get: (r) => String(r.status ?? "") },
        {
          header: "CREATED",
          get: (r) => String(r.createTime ?? r.createdAt ?? ""),
        },
      ]);
    });

  board
    .command("info <boardId>")
    .description("Get basic board info (or use --shared for a shared board)")
    .option("--shared <id>", "shared board ID")
    .option("--json", "output JSON")
    .action(async (boardId, opts) => {
      const data = (await getBoardInfo(client, {
        boardId: opts.shared ? undefined : boardId,
        sharedBoardId: opts.shared,
      })) as Record<string, unknown>;
      if (opts.json) return writeJson(data);
      writeKeyValue(
        Object.entries(data).map(([k, v]) => [
          k,
          typeof v === "string" ? v : JSON.stringify(v),
        ])
      );
    });

  board
    .command("detail <boardId>")
    .description("Get detailed board info")
    .option("--no-content", "omit content")
    .option("--no-summary", "omit summary")
    .option("--no-keywords", "omit keywords")
    .option("--no-ai-summary", "omit AI summary")
    .option("--no-segments", "omit segments")
    .option("--file-meta <id>", "file metadata ID")
    .option("--json", "output JSON")
    .action(async (boardId, opts) => {
      const data = (await getBoardDetail(client, {
        boardId,
        fileMetaId: opts.fileMeta,
        includeContent: opts.content !== false,
        includeSummary: opts.summary !== false,
        includeKeywords: opts.keywords !== false,
        includeAiSummary: opts.aiSummary !== false,
        includeSegments: opts.segments !== false,
      })) as Record<string, unknown>;
      if (opts.json) return writeJson(data);
      if (typeof data.name === "string") writeKeyValue([["Name", data.name]]);
      if (typeof data.summary === "string") {
        process.stdout.write("\n--- Summary ---\n");
        process.stdout.write(`${data.summary}\n`);
      }
      if (typeof data.content === "string") {
        process.stdout.write("\n--- Content ---\n");
        process.stdout.write(`${data.content}\n`);
      }
    });

  board
    .command("script")
    .description("Get and decode a board script")
    .option("--file-meta <id>", "file metadata ID")
    .option("--shared <id>", "shared board ID")
    .option("--history <id>", "script history ID (requires --file-meta)")
    .option("--original", "fetch original script (requires --file-meta)")
    .option("--limit <n>", "minutes per page (default: 60)", (v) =>
      parseInt(v, 10)
    )
    .option("--page <n>", "page index (default: 0)", (v) => parseInt(v, 10))
    .option("--no-pages", "do not split into pages")
    .option("--json", "output JSON")
    .action(async (opts) => {
      const data = await getBoardScript(client, {
        fileMetaId: opts.fileMeta,
        sharedBoardId: opts.shared,
        historyId: opts.history,
        isOriginal: opts.original,
        limit: opts.limit,
        page: opts.page,
        buildPages: opts.pages !== false,
      });
      if (opts.json) return writeJson(data);
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    });

  board
    .command("rename <boardId> <name>")
    .description("Rename a board")
    .option("--json", "output JSON")
    .action(async (boardId, name, opts) => {
      const data = await updateBoardName(client, { boardId, name });
      if (opts.json) return writeJson(data);
      writeSuccess(`Renamed board ${boardId} to "${name}"`);
    });

  board
    .command("latest")
    .description("Get content of the most recently created board")
    .option("--limit <n>", "number of boards to inspect", (v) => parseInt(v, 10))
    .option("--no-decode", "skip zlib+base64 decoding")
    .option("--json", "output JSON")
    .action(async (opts) => {
      const data = await getLatestBoardContent(client, {
        limit: opts.limit,
        decodeContent: opts.decode !== false,
      });
      if (opts.json) return writeJson(data);
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    });

  board
    .command("export <format>")
    .description("Export board content (format: punctuation-json | text)")
    .option("--board-id <id>", "board ID (default: latest)")
    .option("--file-meta <id>", "file metadata ID")
    .option("--out <path>", "output file path")
    .option("--limit <n>", "boards to inspect", (v) => parseInt(v, 10))
    .option("--json", "output JSON")
    .action(async (format, opts) => {
      const data = (await exportBoardContent(client, {
        format,
        boardId: opts.boardId,
        fileMetaId: opts.fileMeta,
        outputPath: opts.out,
        limit: opts.limit,
      })) as Record<string, unknown>;

      if (opts.json) return writeJson(data);
      const path =
        typeof data.outputPath === "string" ? data.outputPath : undefined;
      if (path) writeFilesWritten([path]);
      else process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    });
};
