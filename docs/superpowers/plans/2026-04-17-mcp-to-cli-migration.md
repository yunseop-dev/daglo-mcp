# MCP → CLI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the daglo-mcp MCP server with a `daglo` CLI that exposes the same 15 tools as hierarchical commands, removing all MCP-specific code.

**Architecture:** Extract pure handler functions from current MCP `tools/` files first (MCP keeps working), build a commander-based CLI on top of those handlers, then delete the MCP entry and SDK dependency.

**Tech Stack:** Node.js + TypeScript, `commander`, `cli-table3`, `chalk`, `zod`, `pino`, `vitest` (existing).

**Spec:** `docs/superpowers/specs/2026-04-17-mcp-to-cli-migration-design.md`

---

## File Structure (target state)

```
src/
├── cli.ts                      # NEW: shebang entry, commander root
├── config.ts                   # KEEP
├── types.ts                    # KEEP
├── logger.ts                   # MODIFY: pino → stderr only
├── api/client.ts               # MODIFY: load credentials, refresh fallback
├── auth/
│   └── credentials.ts          # NEW: ~/.config/daglo/credentials.json
├── handlers/                   # NEW: pure (args) => Promise<data>
│   ├── auth.ts
│   ├── boards.ts
│   ├── folders.ts
│   ├── file-meta.ts
│   ├── obsidian.ts
│   └── video.ts
├── schemas/                    # NEW: zod schemas, shared by handlers + CLI
│   ├── auth.ts
│   ├── boards.ts
│   ├── folders.ts
│   ├── file-meta.ts
│   ├── obsidian.ts
│   └── video.ts
├── cli/                        # NEW: commander commands
│   ├── auth.ts
│   ├── board.ts
│   ├── folder.ts
│   ├── file-meta.ts
│   ├── obsidian.ts
│   ├── video.ts
│   └── render/
│       ├── format.ts
│       └── table.ts
└── utils/                      # KEEP
```

**Deleted at end:** `src/index.ts`, `src/tools/`, `@modelcontextprotocol/sdk` dep.

---

## Phase 0: Working Branch

### Task 0.1: Create branch

- [ ] **Step 1: Create migration branch**

```bash
git checkout -b mcp-to-cli-migration
```

- [ ] **Step 2: Verify clean baseline**

Run: `npm install && npm run build && npm test`
Expected: build succeeds, all existing tests pass.

If anything fails at baseline, STOP and report. Do not start migration on a broken baseline.

---

## Phase 1: Handler & Schema Extraction (MCP keeps working)

**Refactoring rule for every tool:**
1. Move the zod input schema fields into a `z.object({...})` exported from `src/schemas/<group>.ts` (named `<toolName>Schema`).
2. Move the `async (args) => { ... }` body — minus the final `return { content: [...] }` wrapping — into a function exported from `src/handlers/<group>.ts` named `<verbObject>` (e.g. `getFolders`, `loginUser`). Return the raw data object instead of the MCP wrapper.
3. The handler signature is `async (client: DagloApiClient, args: z.infer<typeof <toolName>Schema>) => Promise<unknown>`.
4. Update `src/tools/<group>.ts` to: import schema + handler, keep `server.registerTool(name, { inputSchema: <schema>.shape, ... }, async (args) => ({ content: [{ type: "text", text: JSON.stringify(await handler(client, args), null, 2) }] }))`.

This keeps MCP working unchanged (output bytes identical) while letting the CLI consume `handler(client, args)` directly.

### Task 1.1: Create empty schemas/ and handlers/ directories with index files

**Files:**
- Create: `src/schemas/.gitkeep` (or first real file)
- Create: `src/handlers/.gitkeep`

- [ ] **Step 1: Create directories**

```bash
mkdir -p src/schemas src/handlers
```

- [ ] **Step 2: Commit empty scaffolding**

```bash
git add src/schemas src/handlers
git commit -m "chore: scaffold handlers/ and schemas/ directories"
```

(`.gitkeep` files are fine; they'll disappear as real files land.)

### Task 1.2: Extract folders tool (pattern reference)

This is the simplest tool (1 tool, ~40 lines). Use it as the pattern reference for every other extraction.

**Files:**
- Create: `src/schemas/folders.ts`
- Create: `src/handlers/folders.ts`
- Create: `src/handlers/folders.test.ts`
- Modify: `src/tools/folders.ts`

- [ ] **Step 1: Write the failing handler test**

`src/handlers/folders.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DagloApiClient } from "../api/client.js";
import { getFolders } from "./folders.js";

global.fetch = vi.fn() as any;

describe("getFolders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parsed JSON from /folders endpoint", async () => {
    const mockData = [{ id: "f1", name: "Folder 1", isRoot: true }];
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const client = new DagloApiClient();
    const result = await getFolders(client, { includeRoot: true });

    expect(result).toEqual(mockData);
    expect((global.fetch as any).mock.calls[0][0]).toContain("includeRoot=true");
  });

  it("omits includeRoot query when undefined", async () => {
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => [] });

    const client = new DagloApiClient();
    await getFolders(client, {});

    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).not.toContain("includeRoot");
  });

  it("throws on non-ok response", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      statusText: "Internal Server Error",
    });

    const client = new DagloApiClient();
    await expect(getFolders(client, {})).rejects.toThrow(
      "Failed to fetch folders: Internal Server Error"
    );
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx vitest run src/handlers/folders.test.ts`
Expected: FAIL — `Cannot find module './folders.js'`.

- [ ] **Step 3: Write the schema**

`src/schemas/folders.ts`:

```typescript
import * as z from "zod";

export const getFoldersSchema = z.object({
  includeRoot: z
    .boolean()
    .optional()
    .describe("Include root folder (default: true)"),
});

export type GetFoldersArgs = z.infer<typeof getFoldersSchema>;
```

- [ ] **Step 4: Write the handler**

`src/handlers/folders.ts`:

```typescript
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
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `npx vitest run src/handlers/folders.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Refactor `src/tools/folders.ts` to use the handler**

Replace the entire body with:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DagloApiClient } from "../api/client.js";
import { getFolders } from "../handlers/folders.js";
import { getFoldersSchema } from "../schemas/folders.js";

export const registerFolderTools = (
  server: McpServer,
  client: DagloApiClient
) => {
  server.registerTool(
    "get-folders",
    {
      title: "Get Folders",
      description: "Retrieve all folders from Daglo",
      inputSchema: getFoldersSchema.shape,
    },
    async (args) => {
      const data = await getFolders(client, args);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
};
```

- [ ] **Step 7: Build and confirm full test suite**

Run: `npm run build && npm test`
Expected: Build OK, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/schemas/folders.ts src/handlers/folders.ts src/handlers/folders.test.ts src/tools/folders.ts
git commit -m "refactor(folders): extract pure handler and schema"
```

### Task 1.3: Extract auth (login) tool

**Files:**
- Create: `src/schemas/auth.ts`
- Create: `src/handlers/auth.ts`
- Create: `src/handlers/auth.test.ts`
- Modify: `src/tools/auth.ts`

- [ ] **Step 1: Write the failing test**

`src/handlers/auth.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DagloApiClient } from "../api/client.js";
import { loginUser } from "./auth.js";

global.fetch = vi.fn() as any;

describe("loginUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts credentials and stores tokens on success", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      headers: new Headers({ accesstoken: "AT", refreshtoken: "RT" }),
      text: async () => JSON.stringify({ user: { email: "u@x" } }),
    });

    const client = new DagloApiClient();
    const result = await loginUser(client, {
      email: "u@x",
      password: "pw",
    });

    expect(client.isAuthenticated()).toBe(true);
    expect(result).toEqual({ user: { email: "u@x" } });
  });

  it("throws when credentials missing", async () => {
    delete process.env.DAGLO_EMAIL;
    delete process.env.DAGLO_PASSWORD;

    const client = new DagloApiClient();
    await expect(loginUser(client, {})).rejects.toThrow(/missing credentials/i);
  });

  it("throws when access token absent from response", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      headers: new Headers({}),
      text: async () => "{}",
    });

    const client = new DagloApiClient();
    await expect(
      loginUser(client, { email: "u@x", password: "pw" })
    ).rejects.toThrow(/access token not found/i);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx vitest run src/handlers/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the schema**

`src/schemas/auth.ts`:

```typescript
import * as z from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .email()
    .optional()
    .describe("Daglo account email (default: env DAGLO_EMAIL)"),
  password: z
    .string()
    .min(1)
    .optional()
    .describe("Daglo account password (default: env DAGLO_PASSWORD)"),
});

export type LoginArgs = z.infer<typeof loginSchema>;
```

- [ ] **Step 4: Write the handler**

`src/handlers/auth.ts`:

```typescript
import { DagloApiClient } from "../api/client.js";
import { logger } from "../logger.js";
import { LoginArgs } from "../schemas/auth.js";
import {
  getAccessTokenFromResponse,
  getJsonFromResponse,
  getLoginPayload,
  getRefreshTokenFromResponse,
} from "../utils/auth.js";

export const loginUser = async (
  client: DagloApiClient,
  args: LoginArgs
): Promise<unknown> => {
  const payload = getLoginPayload(args);

  const response = await fetch(`${client.baseUrl}/user/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "daglo-platform": "web",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(
      { status: response.status, body: errorText },
      "Login request failed"
    );
    throw new Error(`Login failed: ${response.statusText}`);
  }

  const data = await getJsonFromResponse(response);
  const accessToken = getAccessTokenFromResponse(response, data);
  const refreshToken = getRefreshTokenFromResponse(response, data);

  if (!accessToken) {
    throw new Error("Login failed: access token not found in response.");
  }

  client.setTokens(accessToken, refreshToken ?? undefined);
  return data;
};
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `npx vitest run src/handlers/auth.test.ts`
Expected: PASS.

- [ ] **Step 6: Refactor `src/tools/auth.ts`**

Replace whole file with:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DagloApiClient } from "../api/client.js";
import { loginUser } from "../handlers/auth.js";
import { loginSchema } from "../schemas/auth.js";

export const registerAuthTools = (
  server: McpServer,
  client: DagloApiClient
) => {
  server.registerTool(
    "login",
    {
      title: "Login to Daglo",
      description: "Authenticate with Daglo using email and password",
      inputSchema: loginSchema.shape,
    },
    async (args) => {
      const data = await loginUser(client, args);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
};
```

- [ ] **Step 7: Build and run all tests**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/schemas/auth.ts src/handlers/auth.ts src/handlers/auth.test.ts src/tools/auth.ts
git commit -m "refactor(auth): extract pure handler and schema"
```

### Task 1.4: Extract file-meta tools (2 tools)

**Files:**
- Create: `src/schemas/file-meta.ts`, `src/handlers/file-meta.ts`, `src/handlers/file-meta.test.ts`
- Modify: `src/tools/file-meta.ts`

Tools to extract: `get-file-meta` → `getFileMeta`, `get-keywords` → `getKeywords`.

- [ ] **Step 1: Write the failing test**

`src/handlers/file-meta.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DagloApiClient } from "../api/client.js";
import { getFileMeta, getKeywords } from "./file-meta.js";

global.fetch = vi.fn() as any;

describe("getFileMeta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches /file-meta/<id>", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "f1" }),
    });

    const client = new DagloApiClient();
    const result = await getFileMeta(client, { fileMetaId: "f1" });

    expect(result).toEqual({ id: "f1" });
    expect((global.fetch as any).mock.calls[0][0]).toContain("/file-meta/f1");
  });

  it("throws on non-ok", async () => {
    (global.fetch as any).mockResolvedValue({ ok: false, statusText: "Bad" });
    const client = new DagloApiClient();
    await expect(getFileMeta(client, { fileMetaId: "f1" })).rejects.toThrow(
      /Failed to fetch file meta: Bad/
    );
  });
});

describe("getKeywords", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses /file-meta/<id>/keyword path with auth headers", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify(["k1"]),
    });

    const client = new DagloApiClient();
    await getKeywords(client, { fileMetaId: "f1" });
    expect((global.fetch as any).mock.calls[0][0]).toContain(
      "/file-meta/f1/keyword"
    );
  });

  it("uses /shared-board/<id>/keyword path for shared", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => "[]",
    });

    const client = new DagloApiClient();
    await getKeywords(client, { sharedBoardId: "s1" });
    expect((global.fetch as any).mock.calls[0][0]).toContain(
      "/shared-board/s1/keyword"
    );
  });

  it("throws when neither id provided", async () => {
    const client = new DagloApiClient();
    await expect(getKeywords(client, {})).rejects.toThrow(
      /fileMetaId or sharedBoardId/
    );
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `npx vitest run src/handlers/file-meta.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the schema**

`src/schemas/file-meta.ts`:

```typescript
import * as z from "zod";

export const getFileMetaSchema = z.object({
  fileMetaId: z.string().describe("File metadata ID"),
});

export const getKeywordsSchema = z.object({
  fileMetaId: z.string().optional().describe("File metadata ID"),
  sharedBoardId: z.string().optional().describe("Shared board ID"),
});

export type GetFileMetaArgs = z.infer<typeof getFileMetaSchema>;
export type GetKeywordsArgs = z.infer<typeof getKeywordsSchema>;
```

- [ ] **Step 4: Write the handlers**

`src/handlers/file-meta.ts`:

```typescript
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
  const response = await fetch(
    `${client.baseUrl}/file-meta/${args.fileMetaId}`,
    { headers: client.getAuthHeaders() }
  );
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

  const response = await fetch(`${client.baseUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`Failed to fetch keywords: ${response.statusText}`);
  }
  return await parseResponseBody(response);
};
```

- [ ] **Step 5: Run the test, confirm it passes**

Run: `npx vitest run src/handlers/file-meta.test.ts`
Expected: PASS.

- [ ] **Step 6: Refactor `src/tools/file-meta.ts`**

Replace with:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DagloApiClient } from "../api/client.js";
import { getFileMeta, getKeywords } from "../handlers/file-meta.js";
import {
  getFileMetaSchema,
  getKeywordsSchema,
} from "../schemas/file-meta.js";

export const registerFileMetaTools = (
  server: McpServer,
  client: DagloApiClient
) => {
  server.registerTool(
    "get-file-meta",
    {
      title: "Get File Meta",
      description: "Retrieve file metadata for a file",
      inputSchema: getFileMetaSchema.shape,
    },
    async (args) => {
      const data = await getFileMeta(client, args);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  server.registerTool(
    "get-keywords",
    {
      title: "Get Keywords",
      description: "Retrieve keywords for a board",
      inputSchema: getKeywordsSchema.shape,
    },
    async (args) => {
      const data = await getKeywords(client, args);
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );
};
```

- [ ] **Step 7: Build and run tests**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/schemas/file-meta.ts src/handlers/file-meta.ts src/handlers/file-meta.test.ts src/tools/file-meta.ts
git commit -m "refactor(file-meta): extract pure handlers and schemas"
```

### Task 1.5: Extract boards tools (7 tools)

This is the largest file (`src/tools/boards.ts`, 27 KB). It contains 7 tools:

| MCP tool | Handler name |
|---|---|
| `get-boards` | `listBoards` |
| `get-board-info` | `getBoardInfo` |
| `get-board-detail` | `getBoardDetail` |
| `get-board-script` | `getBoardScript` |
| `update-board-name` | `updateBoardName` |
| `get-latest-board-content` | `getLatestBoardContent` |
| `export-board-content` | `exportBoardContent` |

**Files:**
- Create: `src/schemas/boards.ts`, `src/handlers/boards.ts`, `src/handlers/boards.test.ts`
- Modify: `src/tools/boards.ts`

- [ ] **Step 1: Read current `src/tools/boards.ts` end-to-end**

Run: `cat src/tools/boards.ts | head -300`
Then `cat src/tools/boards.ts | sed -n '300,600p'` (etc.) until you've read all 7 `server.registerTool(...)` blocks.

You need each tool's exact input schema and async body before you can extract them faithfully.

- [ ] **Step 2: Write `src/schemas/boards.ts` with one z.object per tool**

For each `server.registerTool(name, { inputSchema: { ... } }, ...)`, copy the inner `{ ... }` shape into a `z.object({ ... })`. Names: `getBoardsSchema`, `getBoardInfoSchema`, `getBoardDetailSchema`, `getBoardScriptSchema`, `updateBoardNameSchema`, `getLatestBoardContentSchema`, `exportBoardContentSchema`. Export an inferred `<Name>Args` for each.

Pattern:

```typescript
import * as z from "zod";

export const getBoardsSchema = z.object({
  page: z.number().optional().describe("Page number (default: 1)"),
  limit: z.number().optional().describe("Number of boards per page"),
  // ...copy every field exactly from src/tools/boards.ts
});
export type GetBoardsArgs = z.infer<typeof getBoardsSchema>;

// repeat for the other 6 tools
```

- [ ] **Step 3: Write `src/handlers/boards.ts` with one async function per tool**

For each tool, copy the body of `async (args) => { ... }` from `src/tools/boards.ts` into a function with this signature:

```typescript
export const <handlerName> = async (
  client: DagloApiClient,
  args: <SchemaName>Args
): Promise<unknown> => {
  // exact body from tools/boards.ts, BUT replace
  //   return { content: [{ type: "text", text: JSON.stringify(<x>, null, 2) }] };
  // with
  //   return <x>;
};
```

Imports needed at top of file (combine all that the original tools/boards.ts uses):

```typescript
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DagloApiClient } from "../api/client.js";
import { DagloBoardDetail } from "../types.js";
import { normalizeBoardList, pickLatestBoard } from "../utils/board.js";
import {
  buildScriptPages,
  decodeScriptItem,
  decodeZlibBase64Content,
  normalizeScriptContent,
} from "../utils/content.js";
import {
  buildDefaultOutputPath,
  buildPlainTextFromScriptPayload,
} from "../utils/file.js";
import {
  buildPlainTextFromTokens,
  extractKaraokeTokens,
  splitTokensByPunctuation,
} from "../utils/karaoke.js";
import { buildUrl, parseResponseBody } from "../utils/http.js";
import {
  GetBoardsArgs,
  GetBoardInfoArgs,
  GetBoardDetailArgs,
  GetBoardScriptArgs,
  UpdateBoardNameArgs,
  GetLatestBoardContentArgs,
  ExportBoardContentArgs,
} from "../schemas/boards.js";
```

- [ ] **Step 4: Write smoke tests for each handler**

`src/handlers/boards.test.ts`. Minimum: one test per handler that mocks `fetch` to return a happy path payload, calls the handler, asserts it returns the parsed payload (not wrapped in `{ content: [...] }`).

Pattern (one example, repeat for the other 6 with adjusted URL fragment + payload):

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { DagloApiClient } from "../api/client.js";
import { listBoards } from "./boards.js";

global.fetch = vi.fn() as any;

describe("listBoards", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hits /v2/boards and returns parsed payload", async () => {
    const payload = { items: [{ id: "b1" }] };
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => payload,
    });

    const client = new DagloApiClient();
    const result = await listBoards(client, { page: 1, limit: 10 });
    expect(result).toEqual(payload);
    expect((global.fetch as any).mock.calls[0][0]).toContain("/v2/boards");
  });
});
```

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run src/handlers/boards.test.ts`
Expected: All PASS.

- [ ] **Step 6: Refactor `src/tools/boards.ts` to call handlers**

Replace each `server.registerTool(name, ..., async (args) => { /* old body */ })` with:

```typescript
async (args) => {
  const data = await <handlerName>(client, args);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
```

Use `inputSchema: <schemaName>.shape` for each registration. Remove all helper imports that are now used only by handlers; keep only `McpServer`, `DagloApiClient`, the handler imports, and the schema imports.

- [ ] **Step 7: Build and run all tests**

Run: `npm run build && npm test`
Expected: Build OK, all existing + new tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/schemas/boards.ts src/handlers/boards.ts src/handlers/boards.test.ts src/tools/boards.ts
git commit -m "refactor(boards): extract 7 pure handlers and schemas"
```

### Task 1.6: Extract obsidian tools (2 tools)

Tools: `export-to-obsidian` → `exportToObsidian`, `batch-export-folder` → `batchExportFolder`.

**Files:**
- Create: `src/schemas/obsidian.ts`, `src/handlers/obsidian.ts`, `src/handlers/obsidian.test.ts`
- Modify: `src/tools/obsidian.ts`

- [ ] **Step 1: Read `src/tools/obsidian.ts` end-to-end**

Run: `cat src/tools/obsidian.ts`

- [ ] **Step 2: Write `src/schemas/obsidian.ts`**

Copy each tool's `inputSchema: { ... }` into `z.object({ ... })` exported as `exportToObsidianSchema` and `batchExportFolderSchema`. Export `ExportToObsidianArgs` and `BatchExportFolderArgs` types.

- [ ] **Step 3: Write `src/handlers/obsidian.ts`**

Two async functions following the same signature pattern as Task 1.5 step 3. Body identical to current tool body, minus the MCP wrapper. Imports: pull whatever `src/tools/obsidian.ts` currently imports, plus `DagloApiClient` and the new schemas.

- [ ] **Step 4: Write smoke tests in `src/handlers/obsidian.test.ts`**

For each handler, one test with mocked `fetch` and a temp output dir (`os.tmpdir()` + a uuid) — assert the returned object lists the expected file paths and the files actually exist on disk.

Example skeleton:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DagloApiClient } from "../api/client.js";
import { exportToObsidian } from "./obsidian.js";

global.fetch = vi.fn() as any;
let tmp: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmp = mkdtempSync(join(tmpdir(), "obs-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("exportToObsidian", () => {
  it("writes original and summary markdown files", async () => {
    // mock the chained fetches the handler makes; minimum: board detail
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "b1", name: "Test", content: "Hi" }),
    });

    const client = new DagloApiClient();
    const result = await exportToObsidian(client, {
      boardId: "b1",
      outputDir: tmp,
      outputType: "both",
    });

    expect(result).toBeDefined();
    // assert returned shape includes file paths and they exist
  });
});
```

If the handler makes multiple distinct `fetch` calls, use `mockImplementation` to dispatch by URL.

- [ ] **Step 5: Run tests, confirm pass**

Run: `npx vitest run src/handlers/obsidian.test.ts`
Expected: PASS.

- [ ] **Step 6: Refactor `src/tools/obsidian.ts`**

Same wrapper pattern as Task 1.5 step 6.

- [ ] **Step 7: Build and run all tests**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/schemas/obsidian.ts src/handlers/obsidian.ts src/handlers/obsidian.test.ts src/tools/obsidian.ts
git commit -m "refactor(obsidian): extract pure handlers and schemas"
```

### Task 1.7: Extract video tools (2 tools)

Tools: `create-youtube-highlight-clip` → `createYoutubeHighlightClip`, `create-youtube-full-subtitled-video` → `createYoutubeFullSubtitledVideo`.

**Files:**
- Create: `src/schemas/video.ts`, `src/handlers/video.ts`, `src/handlers/video.test.ts`
- Modify: `src/tools/video.ts`

- [ ] **Step 1: Read `src/tools/video.ts` end-to-end**

Run: `cat src/tools/video.ts | head -400` then `sed -n '400,800p'`.

- [ ] **Step 2: Write `src/schemas/video.ts`** following the pattern from Task 1.5 step 2.

- [ ] **Step 3: Write `src/handlers/video.ts`** following the pattern from Task 1.5 step 3.

The video handlers spawn `yt-dlp` and `ffmpeg`. For tests, do NOT execute these binaries — only test argument validation paths.

- [ ] **Step 4: Write minimal validation tests in `src/handlers/video.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { DagloApiClient } from "../api/client.js";
import { createYoutubeHighlightClip } from "./video.js";

describe("createYoutubeHighlightClip", () => {
  it("rejects invalid YouTube URL", async () => {
    const client = new DagloApiClient();
    await expect(
      createYoutubeHighlightClip(client, {
        youtubeUrl: "not-a-url",
        boardId: "b1",
      })
    ).rejects.toThrow();
  });
});
```

(Full pipeline tests are out of scope; the smoke test is `daglo video clip` against a real URL after Phase 3.)

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/handlers/video.test.ts`
Expected: PASS.

- [ ] **Step 6: Refactor `src/tools/video.ts`** with the wrapper pattern.

- [ ] **Step 7: Build and run all tests**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/schemas/video.ts src/handlers/video.ts src/handlers/video.test.ts src/tools/video.ts
git commit -m "refactor(video): extract pure handlers and schemas"
```

### Task 1.8: Phase 1 verification — MCP still works

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 2: Run MCP server briefly to confirm it starts**

Run: `timeout 3 node dist/index.js < /dev/null` (3-second timeout — server reads stdin so it'll exit when stdin closes via `< /dev/null`)
Expected: no crash, exit code 0 or 124 (timeout).

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: all tests green, including new handler tests.

---

## Phase 2: Credentials Storage Layer

### Task 2.1: Create `auth/credentials.ts` with read/write/delete

**Files:**
- Create: `src/auth/credentials.ts`
- Create: `src/auth/credentials.test.ts`

- [ ] **Step 1: Write the failing test**

`src/auth/credentials.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadCredentials,
  saveCredentials,
  deleteCredentials,
  getCredentialsPath,
  Credentials,
} from "./credentials.js";

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "daglo-cred-"));
  process.env.XDG_CONFIG_HOME = tmpHome;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("credentials", () => {
  it("returns null when no file exists", () => {
    expect(loadCredentials()).toBeNull();
  });

  it("saves credentials with 0600 permissions", () => {
    const creds: Credentials = {
      email: "u@x",
      accessToken: "AT",
      refreshToken: "RT",
      expiresAt: "2026-04-18T03:00:00.000Z",
    };
    saveCredentials(creds);

    const path = getCredentialsPath();
    expect(existsSync(path)).toBe(true);

    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);

    const dirMode = statSync(join(tmpHome, "daglo")).mode & 0o777;
    expect(dirMode).toBe(0o700);
  });

  it("round-trips data through save/load", () => {
    const creds: Credentials = {
      email: "u@x",
      accessToken: "AT",
      expiresAt: "2026-04-18T03:00:00.000Z",
    };
    saveCredentials(creds);
    expect(loadCredentials()).toEqual(creds);
  });

  it("delete removes the file", () => {
    saveCredentials({ email: "u@x", accessToken: "AT" });
    deleteCredentials();
    expect(loadCredentials()).toBeNull();
  });

  it("delete is a no-op when no file exists", () => {
    expect(() => deleteCredentials()).not.toThrow();
  });

  it("save is atomic (uses tmp + rename)", () => {
    saveCredentials({ email: "u@x", accessToken: "AT" });
    const before = readFileSync(getCredentialsPath(), "utf-8");
    saveCredentials({ email: "u@y", accessToken: "AT2" });
    const after = readFileSync(getCredentialsPath(), "utf-8");
    expect(before).not.toEqual(after);
  });
});
```

- [ ] **Step 2: Run the test, confirm failure**

Run: `npx vitest run src/auth/credentials.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `credentials.ts`**

`src/auth/credentials.ts`:

```typescript
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Credentials {
  email: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

const CONFIG_DIR_NAME = "daglo";
const FILE_NAME = "credentials.json";

const getConfigDir = (): string => {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, CONFIG_DIR_NAME);
};

export const getCredentialsPath = (): string =>
  join(getConfigDir(), FILE_NAME);

export const loadCredentials = (): Credentials | null => {
  const path = getCredentialsPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
};

export const saveCredentials = (creds: Credentials): void => {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Tighten if mkdirSync ignored mode (e.g., directory already existed).
  try {
    // chmod for the directory in case it already existed with wider perms.
    require("node:fs").chmodSync(dir, 0o700);
  } catch {
    // ignore
  }

  const path = getCredentialsPath();
  const tmpPath = `${path}.tmp.${process.pid}`;
  writeFileSync(tmpPath, JSON.stringify(creds, null, 2), {
    mode: 0o600,
    encoding: "utf-8",
  });
  renameSync(tmpPath, path);
};

export const deleteCredentials = (): void => {
  const path = getCredentialsPath();
  if (!existsSync(path)) return;
  rmSync(path, { force: true });
};
```

- [ ] **Step 4: Run the test, confirm pass**

Run: `npx vitest run src/auth/credentials.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/credentials.ts src/auth/credentials.test.ts
git commit -m "feat(auth): credentials storage at ~/.config/daglo (0600)"
```

### Task 2.2: Wire `DagloApiClient` to load + persist credentials

**Files:**
- Modify: `src/api/client.ts`
- Modify: `src/handlers/auth.ts` (persist on login)
- Create: `src/api/client.test.ts`

- [ ] **Step 1: Write the failing test**

`src/api/client.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DagloApiClient } from "./client.js";
import { saveCredentials } from "../auth/credentials.js";

let tmpHome: string;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "daglo-client-"));
  process.env.XDG_CONFIG_HOME = tmpHome;
});

afterEach(() => {
  delete process.env.XDG_CONFIG_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("DagloApiClient credential loading", () => {
  it("starts unauthenticated when no credentials file exists", () => {
    const client = new DagloApiClient();
    expect(client.isAuthenticated()).toBe(false);
  });

  it("loads access token from credentials file on construction", () => {
    saveCredentials({ email: "u@x", accessToken: "AT" });
    const client = new DagloApiClient();
    expect(client.isAuthenticated()).toBe(true);
    const headers = client.getAuthHeaders() as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer AT");
  });

  it("persists tokens via setTokens", () => {
    const client = new DagloApiClient();
    client.setTokens("AT2", "RT2");

    const fresh = new DagloApiClient();
    expect(fresh.isAuthenticated()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, confirm failure**

Run: `npx vitest run src/api/client.test.ts`
Expected: FAIL — at minimum the "loads from file" test fails because constructor doesn't load.

- [ ] **Step 3: Modify `src/api/client.ts`**

```typescript
import { DAGLO_API_BASE } from "../config.js";
import { loadCredentials, saveCredentials } from "../auth/credentials.js";

export class DagloApiClient {
  private accessToken?: string;
  private refreshToken?: string;
  private email?: string;
  private expiresAt?: string;

  constructor() {
    const creds = loadCredentials();
    if (creds) {
      this.accessToken = creds.accessToken;
      this.refreshToken = creds.refreshToken;
      this.email = creds.email;
      this.expiresAt = creds.expiresAt;
    }
  }

  setTokens(access: string, refresh?: string, email?: string, expiresAt?: string) {
    this.accessToken = access;
    this.refreshToken = refresh;
    if (email) this.email = email;
    if (expiresAt) this.expiresAt = expiresAt;

    if (this.email) {
      saveCredentials({
        email: this.email,
        accessToken: access,
        refreshToken: refresh,
        expiresAt: this.expiresAt,
      });
    }
  }

  getAuthHeaders(): HeadersInit {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`;
    }
    return headers;
  }

  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  getEmail(): string | undefined {
    return this.email;
  }

  getExpiresAt(): string | undefined {
    return this.expiresAt;
  }

  get baseUrl(): string {
    return DAGLO_API_BASE;
  }
}
```

- [ ] **Step 4: Update `src/handlers/auth.ts` to pass email when storing tokens**

In `loginUser`, after extracting tokens, change the storage call:

```typescript
client.setTokens(accessToken, refreshToken ?? undefined, payload.email);
```

- [ ] **Step 5: Run the failing tests**

Run: `npx vitest run src/api/client.test.ts src/handlers/auth.test.ts`
Expected: All PASS. (The auth handler test from Task 1.3 still works because email is passed through.)

- [ ] **Step 6: Run full test suite + build**

Run: `npm run build && npm test`
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add src/api/client.ts src/api/client.test.ts src/handlers/auth.ts
git commit -m "feat(api): load and persist credentials on the client"
```

### Task 2.3: Add re-login fallback on 401 / expired token

**Files:**
- Modify: `src/api/client.ts`
- Modify: `src/api/client.test.ts`

The fallback policy: if a request fails with 401 OR `expiresAt` is within 5 minutes of now, attempt re-login using `DAGLO_EMAIL`/`DAGLO_PASSWORD` env vars. On success, retry the request once. On failure, throw `Not authenticated. Run 'daglo auth login'.`

For this CLI-friendly behavior we add a `request(input, init)` method on `DagloApiClient` that all handlers should eventually use. Handlers will be migrated to use it in Task 2.4.

- [ ] **Step 1: Write the failing test**

Append to `src/api/client.test.ts`:

```typescript
import { vi } from "vitest";
import { loginUser } from "../handlers/auth.js";

vi.mock("../handlers/auth.js", () => ({
  loginUser: vi.fn(),
}));

global.fetch = vi.fn() as any;

describe("DagloApiClient.request re-auth fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DAGLO_EMAIL = "u@x";
    process.env.DAGLO_PASSWORD = "pw";
  });

  it("retries once after re-login on 401", async () => {
    saveCredentials({ email: "u@x", accessToken: "OLD" });
    const client = new DagloApiClient();

    (global.fetch as any)
      .mockResolvedValueOnce({ ok: false, status: 401, statusText: "Unauthorized" })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });

    (loginUser as any).mockImplementation(async () => {
      client.setTokens("NEW", undefined, "u@x");
      return { ok: true };
    });

    const response = await client.request("/v2/boards");
    expect(response.ok).toBe(true);
    expect((global.fetch as any).mock.calls.length).toBe(2);
    expect(loginUser).toHaveBeenCalledTimes(1);
  });

  it("throws helpful error when re-login impossible", async () => {
    delete process.env.DAGLO_EMAIL;
    delete process.env.DAGLO_PASSWORD;

    saveCredentials({ email: "u@x", accessToken: "OLD" });
    const client = new DagloApiClient();

    (global.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    await expect(client.request("/v2/boards")).rejects.toThrow(
      /Not authenticated.*daglo auth login/i
    );
  });
});
```

- [ ] **Step 2: Run the test, confirm failure**

Run: `npx vitest run src/api/client.test.ts`
Expected: FAIL — `client.request` does not exist.

- [ ] **Step 3: Add `request` method to `DagloApiClient`**

Append to the class in `src/api/client.ts`:

```typescript
async request(path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
  const merged: RequestInit = {
    ...init,
    headers: {
      ...this.getAuthHeaders(),
      ...(init.headers as Record<string, string> | undefined),
    },
  };

  const response = await fetch(url, merged);
  if (response.status !== 401) return response;

  // Try re-login via env vars.
  const email = process.env.DAGLO_EMAIL;
  const password = process.env.DAGLO_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Not authenticated. Run 'daglo auth login' or set DAGLO_EMAIL and DAGLO_PASSWORD."
    );
  }

  // Lazy import to avoid circular module load at startup.
  const { loginUser } = await import("../handlers/auth.js");
  await loginUser(this, { email, password });

  // Retry once with the new token.
  const retryHeaders: HeadersInit = {
    ...this.getAuthHeaders(),
    ...(init.headers as Record<string, string> | undefined),
  };
  return await fetch(url, { ...init, headers: retryHeaders });
}
```

- [ ] **Step 4: Run the test, confirm pass**

Run: `npx vitest run src/api/client.test.ts`
Expected: all PASS.

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/client.ts src/api/client.test.ts
git commit -m "feat(api): re-login fallback on 401 using env credentials"
```

### Task 2.4: Migrate handlers to use `client.request`

Replace bare `fetch(...)` calls inside handlers with `client.request(...)` so 401 fallback works for every command. Handlers stop building the absolute URL themselves; they pass the path.

**Files:**
- Modify: `src/handlers/folders.ts`
- Modify: `src/handlers/file-meta.ts`
- Modify: `src/handlers/boards.ts`
- Modify: `src/handlers/obsidian.ts`
- Modify: `src/handlers/video.ts`
- Tests: existing handler tests already mock `global.fetch`, which `client.request` calls under the hood, so they keep passing.

DO NOT migrate `src/handlers/auth.ts` — login itself must not trigger re-login fallback (would loop).

- [ ] **Step 1: Migrate `folders.ts`**

Replace the `fetch(url, { headers: client.getAuthHeaders() })` call with `client.request(\`/folders\${qs ? \`?\${qs}\` : ""}\`)`. Drop the manual `client.baseUrl` concatenation.

- [ ] **Step 2: Run folder test**

Run: `npx vitest run src/handlers/folders.test.ts`
Expected: PASS.

- [ ] **Step 3: Migrate `file-meta.ts`**

`getFileMeta`: `client.request(\`/file-meta/\${args.fileMetaId}\`)`.
`getKeywords`: `client.request(path, init)` (path stays as-is, drop `${client.baseUrl}`).

- [ ] **Step 4: Run file-meta test**

Run: `npx vitest run src/handlers/file-meta.test.ts`
Expected: PASS.

- [ ] **Step 5: Migrate `boards.ts` (7 handlers)**

For each handler, replace `fetch(url, { headers: client.getAuthHeaders() })` with `client.request(url)` where `url` is the path (use `buildUrl(client.baseUrl, path, query)` only if you need the absolute URL; otherwise pass the path string directly to `client.request`). Where `buildUrl` is used to assemble query strings, you may switch to building the path with `URLSearchParams` and pass it to `client.request`.

- [ ] **Step 6: Run boards test**

Run: `npx vitest run src/handlers/boards.test.ts`
Expected: PASS.

- [ ] **Step 7: Migrate `obsidian.ts` and `video.ts`** (same pattern).

- [ ] **Step 8: Run full test suite + build**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/handlers/folders.ts src/handlers/file-meta.ts src/handlers/boards.ts src/handlers/obsidian.ts src/handlers/video.ts
git commit -m "refactor(handlers): use client.request for auto re-auth"
```

---

## Phase 3: CLI Skeleton & Commands

### Task 3.1: Add CLI dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime deps**

Run: `npm install commander cli-table3 chalk`
Expected: lockfile updates, no warnings.

- [ ] **Step 2: Verify versions**

Run: `npm list commander cli-table3 chalk`
Expected: latest stable versions installed.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add commander, cli-table3, chalk for CLI"
```

### Task 3.2: Create render helpers

**Files:**
- Create: `src/cli/render/format.ts`
- Create: `src/cli/render/table.ts`
- Create: `src/cli/render/format.test.ts`

- [ ] **Step 1: Write failing test**

`src/cli/render/format.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeJson, writeKeyValue, writeFilesWritten } from "./format.js";

let stdout: string;
let stderr: string;

beforeEach(() => {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((c: any) => {
    stdout += String(c);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((c: any) => {
    stderr += String(c);
    return true;
  });
});

describe("writeJson", () => {
  it("writes formatted JSON to stdout with newline", () => {
    writeJson({ a: 1 });
    expect(stdout).toBe('{\n  "a": 1\n}\n');
  });
});

describe("writeKeyValue", () => {
  it("writes key: value lines to stdout", () => {
    writeKeyValue([
      ["ID", "abc"],
      ["Name", "Test"],
    ]);
    expect(stdout).toContain("ID");
    expect(stdout).toContain("abc");
    expect(stdout).toContain("Name");
    expect(stdout).toContain("Test");
  });
});

describe("writeFilesWritten", () => {
  it("writes file paths to stderr with check marks and stdout summary", () => {
    writeFilesWritten(["/tmp/a", "/tmp/b"]);
    expect(stderr).toContain("/tmp/a");
    expect(stderr).toContain("/tmp/b");
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

Run: `npx vitest run src/cli/render/format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `format.ts`**

`src/cli/render/format.ts`:

```typescript
import chalk from "chalk";

const useColor = (): boolean => {
  if (process.env.NO_COLOR) return false;
  return process.stdout.isTTY ?? false;
};

if (!useColor()) {
  chalk.level = 0;
}

export const writeJson = (data: unknown): void => {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
};

export const writeKeyValue = (rows: Array<[string, string]>): void => {
  const labelWidth = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) {
    const padded = k.padEnd(labelWidth);
    process.stdout.write(`${chalk.bold(padded)}  ${v}\n`);
  }
};

export const writeFilesWritten = (paths: string[]): void => {
  for (const p of paths) {
    process.stderr.write(`${chalk.green("✓")} Wrote: ${p}\n`);
  }
};

export const writeSuccess = (msg: string): void => {
  process.stderr.write(`${chalk.green("✓")} ${msg}\n`);
};

export const writeError = (msg: string): void => {
  process.stderr.write(`${chalk.red("✗")} ${msg}\n`);
};
```

`src/cli/render/table.ts`:

```typescript
import Table from "cli-table3";

export interface Column<T> {
  header: string;
  get: (row: T) => string;
}

export const writeTable = <T>(
  rows: T[],
  columns: Column<T>[]
): void => {
  const table = new Table({
    head: columns.map((c) => c.header),
    style: { head: [], border: [] },
  });
  for (const row of rows) {
    table.push(columns.map((c) => c.get(row)));
  }
  process.stdout.write(`${table.toString()}\n`);
};
```

- [ ] **Step 4: Run test, confirm pass**

Run: `npx vitest run src/cli/render/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/render/format.ts src/cli/render/table.ts src/cli/render/format.test.ts
git commit -m "feat(cli): render helpers (format, table)"
```

### Task 3.3: Create CLI entry point with global options

**Files:**
- Create: `src/cli.ts`
- Modify: `src/logger.ts` (force stderr destination)

- [ ] **Step 1: Update logger to write to stderr only**

Replace `src/logger.ts`:

```typescript
import pino from "pino";

const isDevelopment = process.env.NODE_ENV !== "production";

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || (isDevelopment ? "info" : "info"),
    serializers: {
      error: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
  },
  pino.destination(2) // stderr fd
);

export function redactSensitiveData(
  data: Record<string, unknown>
): Record<string, unknown> {
  const sensitiveFields = [
    "password",
    "token",
    "accessToken",
    "refreshToken",
    "secret",
    "apiKey",
  ];
  const redacted = { ...data };
  for (const field of sensitiveFields) {
    if (field in redacted) {
      redacted[field] = "[REDACTED]";
    }
  }
  return redacted;
}

export default logger;
```

- [ ] **Step 2: Create `src/cli.ts`**

```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { DagloApiClient } from "./api/client.js";
import { registerAuthCommand } from "./cli/auth.js";
import { registerBoardCommand } from "./cli/board.js";
import { registerFolderCommand } from "./cli/folder.js";
import { registerFileMetaCommand } from "./cli/file-meta.js";
import { registerObsidianCommand } from "./cli/obsidian.js";
import { registerVideoCommand } from "./cli/video.js";
import { logger } from "./logger.js";
import { writeError } from "./cli/render/format.js";

const program = new Command();
const client = new DagloApiClient();

program
  .name("daglo")
  .description("Daglo CLI — speech-to-text and document management")
  .version("1.0.0")
  .option("-v, --verbose", "enable debug logging")
  .option("--quiet", "suppress info logs")
  .option("--no-color", "disable color output")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.verbose) (logger as any).level = "debug";
    if (opts.quiet) (logger as any).level = "warn";
  });

registerAuthCommand(program, client);
registerBoardCommand(program, client);
registerFolderCommand(program, client);
registerFileMetaCommand(program, client);
registerObsidianCommand(program, client);
registerVideoCommand(program, client);

program.parseAsync(process.argv).catch((err: Error) => {
  writeError(err.message);
  process.exit(1);
});
```

- [ ] **Step 3: Build (will fail — child registers don't exist yet)**

Run: `npm run build`
Expected: FAIL with "Cannot find module './cli/auth.js'" etc. — that's expected; we'll add them in 3.4–3.9.

- [ ] **Step 4: Commit (skeleton only)**

```bash
git add src/cli.ts src/logger.ts
git commit -m "feat(cli): entry point + logger to stderr"
```

### Task 3.4: Implement `daglo auth` commands

**Files:**
- Create: `src/cli/auth.ts`
- Create: `src/handlers/auth.ts` additions: `getAuthStatus`, `logoutUser`

- [ ] **Step 1: Add status + logout helpers to `src/handlers/auth.ts`**

Append:

```typescript
import { deleteCredentials, loadCredentials } from "../auth/credentials.js";

export interface AuthStatus {
  loggedIn: boolean;
  email?: string;
  expiresAt?: string;
}

export const getAuthStatus = (): AuthStatus => {
  const creds = loadCredentials();
  if (!creds) return { loggedIn: false };
  return {
    loggedIn: true,
    email: creds.email,
    expiresAt: creds.expiresAt,
  };
};

export const logoutUser = (): void => {
  deleteCredentials();
};
```

- [ ] **Step 2: Create `src/cli/auth.ts`**

```typescript
import { Command } from "commander";
import { DagloApiClient } from "../api/client.js";
import {
  getAuthStatus,
  loginUser,
  logoutUser,
} from "../handlers/auth.js";
import {
  writeJson,
  writeKeyValue,
  writeSuccess,
} from "./render/format.js";
import { promptCredentials } from "./prompt.js";

export const registerAuthCommand = (program: Command, client: DagloApiClient) => {
  const auth = program.command("auth").description("Authentication commands");

  auth
    .command("login")
    .description("Log in to Daglo and cache tokens")
    .option("--email <email>", "Daglo account email")
    .option("--password <password>", "Daglo account password")
    .option("--json", "output JSON")
    .action(async (opts) => {
      let { email, password } = opts;
      email = email ?? process.env.DAGLO_EMAIL;
      password = password ?? process.env.DAGLO_PASSWORD;

      if (!email || !password) {
        const prompted = await promptCredentials({ email });
        email = email ?? prompted.email;
        password = prompted.password;
      }

      await loginUser(client, { email, password });
      if (opts.json) {
        writeJson({ loggedIn: true, email });
      } else {
        writeSuccess(`Logged in as ${email}`);
      }
    });

  auth
    .command("logout")
    .description("Delete cached credentials")
    .option("--json", "output JSON")
    .action((opts) => {
      logoutUser();
      if (opts.json) writeJson({ loggedOut: true });
      else writeSuccess("Logged out");
    });

  auth
    .command("status")
    .description("Show current login status")
    .option("--json", "output JSON")
    .action((opts) => {
      const status = getAuthStatus();
      if (opts.json) {
        writeJson(status);
        if (!status.loggedIn) process.exit(1);
        return;
      }
      if (!status.loggedIn) {
        process.stderr.write("Not logged in\n");
        process.exit(1);
      }
      writeKeyValue([
        ["Email", status.email ?? "(unknown)"],
        ["Expires", status.expiresAt ?? "(no expiry recorded)"],
      ]);
    });
};
```

- [ ] **Step 3: Create `src/cli/prompt.ts`** for hidden-password prompt

```typescript
import { createInterface } from "node:readline/promises";

export const promptCredentials = async (defaults: {
  email?: string;
}): Promise<{ email: string; password: string }> => {
  if (!process.stdin.isTTY) {
    throw new Error(
      "No TTY available; supply --email and --password or set DAGLO_EMAIL/DAGLO_PASSWORD."
    );
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });

  const email =
    defaults.email ?? (await rl.question("Daglo email: ")).trim();

  // Hide password input.
  process.stderr.write("Daglo password: ");
  const password = await new Promise<string>((resolve) => {
    let buf = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write("\n");
        resolve(buf);
      } else if (ch === "\u0003") {
        process.exit(130);
      } else if (ch === "\u007f") {
        buf = buf.slice(0, -1);
      } else {
        buf += ch;
      }
    };
    process.stdin.on("data", onData);
  });

  rl.close();
  return { email, password };
};
```

- [ ] **Step 4: Build to confirm compilation**

Run: `npm run build` (will still fail because other cli files don't exist; that's OK at this point)

If you want to compile only this slice for now, temporarily comment the missing imports in `src/cli.ts`. Re-enable as later tasks add them.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/auth.ts src/cli/auth.ts src/cli/prompt.ts
git commit -m "feat(cli): auth login/logout/status commands"
```

### Task 3.5: Implement `daglo folder` commands

**Files:**
- Create: `src/cli/folder.ts`
- Create: `src/handlers/folders.ts` addition: `batchExportFolder` already exists in obsidian handlers; reuse it.

- [ ] **Step 1: Create `src/cli/folder.ts`**

```typescript
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
      writeTable(arr as any[], [
        { header: "ID", get: (r) => String(r.id ?? "") },
        { header: "NAME", get: (r) => String(r.name ?? "") },
        { header: "ROOT", get: (r) => (r.isRoot ? "✓" : "") },
      ]);
    });

  folder
    .command("export <folderId>")
    .description("Export all boards in a folder to Obsidian markdown")
    .option("--out <dir>", "output directory", "./docs")
    .option(
      "--type <type>",
      "output type (original|summary|both)",
      "both"
    )
    .option("--limit <n>", "max boards to export", (v) => parseInt(v, 10), 50)
    .option("--json", "output JSON")
    .action(async (folderId, opts) => {
      const result = (await batchExportFolder(client, {
        folderId,
        outputDir: opts.out,
        outputType: opts.type,
        limit: opts.limit,
      })) as { files?: string[] } | unknown;

      const files =
        result && typeof result === "object" && "files" in (result as any)
          ? ((result as any).files as string[])
          : [];

      if (opts.json) return writeJson(result);
      writeFilesWritten(files);
    });
};
```

(If `batchExportFolder`'s actual return shape differs, adjust the destructuring after Task 1.6 is completed.)

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success once cli/file-meta.ts, cli/board.ts, cli/obsidian.ts, cli/video.ts also exist as stubs. Stub them with empty `register*Command = () => {}` exports if you need the build to pass before later tasks.

- [ ] **Step 3: Commit**

```bash
git add src/cli/folder.ts
git commit -m "feat(cli): folder list and export commands"
```

### Task 3.6: Implement `daglo file-meta` commands

**Files:**
- Create: `src/cli/file-meta.ts`

- [ ] **Step 1: Create `src/cli/file-meta.ts`**

```typescript
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
```

- [ ] **Step 2: Build & commit**

Run: `npm run build`
Expected: success.

```bash
git add src/cli/file-meta.ts
git commit -m "feat(cli): file-meta get and keywords commands"
```

### Task 3.7: Implement `daglo board` commands

**Files:**
- Create: `src/cli/board.ts`

This is the largest CLI file (7 subcommands). Every subcommand follows the same shape: parse options → call handler → render.

- [ ] **Step 1: Create `src/cli/board.ts` skeleton**

```typescript
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

      const items =
        Array.isArray(data) ? data
        : (data as any)?.items && Array.isArray((data as any).items)
          ? (data as any).items
          : [];

      writeTable(items as any[], [
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
      const data = await getBoardDetail(client, {
        boardId,
        fileMetaId: opts.fileMeta,
        includeContent: opts.content !== false,
        includeSummary: opts.summary !== false,
        includeKeywords: opts.keywords !== false,
        includeAiSummary: opts.aiSummary !== false,
        includeSegments: opts.segments !== false,
      });
      if (opts.json) return writeJson(data);
      // Print content + summary as human-readable, fall back to JSON for the rest.
      const d = data as Record<string, unknown>;
      if (typeof d.name === "string") writeKeyValue([["Name", d.name]]);
      if (typeof d.summary === "string") {
        process.stdout.write("\n--- Summary ---\n");
        process.stdout.write(`${d.summary}\n`);
      }
      if (typeof d.content === "string") {
        process.stdout.write("\n--- Content ---\n");
        process.stdout.write(`${d.content}\n`);
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
      // Plain dump — script payloads vary.
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
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add src/cli/board.ts
git commit -m "feat(cli): board commands (list/info/detail/script/rename/latest/export)"
```

### Task 3.8: Implement `daglo obsidian` command

**Files:**
- Create: `src/cli/obsidian.ts`

- [ ] **Step 1: Create `src/cli/obsidian.ts`**

```typescript
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
    .option(
      "--type <type>",
      "output type (original|summary|both)",
      "both"
    )
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
      })) as { files?: string[] } & Record<string, unknown>;

      if (opts.json) return writeJson(data);
      const files = Array.isArray(data.files) ? data.files : [];
      writeFilesWritten(files);
    });
};
```

(If `exportToObsidian`'s return shape doesn't include `files`, adjust to whatever Task 1.6 produces.)

- [ ] **Step 2: Build & commit**

Run: `npm run build`
Expected: success.

```bash
git add src/cli/obsidian.ts
git commit -m "feat(cli): obsidian export command"
```

### Task 3.9: Implement `daglo video` commands

**Files:**
- Create: `src/cli/video.ts`

- [ ] **Step 1: Create `src/cli/video.ts`**

```typescript
import { Command } from "commander";
import { DagloApiClient } from "../api/client.js";
import {
  createYoutubeFullSubtitledVideo,
  createYoutubeHighlightClip,
} from "../handlers/video.js";
import { writeJson, writeFilesWritten } from "./render/format.js";

const splitCsv = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const registerVideoCommand = (
  program: Command,
  client: DagloApiClient
) => {
  const video = program.command("video").description("Video commands");

  video
    .command("clip <youtubeUrl>")
    .description("Generate a YouTube highlight clip with burned-in subtitles")
    .option("--board-id <id>", "board ID")
    .option("--file-meta <id>", "file metadata ID")
    .option("--out <dir>", "output directory", "./docs/clips")
    .option(
      "--length <minutes>",
      "target clip length in minutes",
      (v) => parseFloat(v),
      3.5
    )
    .option(
      "--max-line <chars>",
      "max characters per subtitle segment",
      (v) => parseInt(v, 10),
      42
    )
    .option("--shorts", "vertical 9:16 output")
    .option("--keywords <list>", "comma-separated keywords", splitCsv)
    .option("--json", "output JSON")
    .action(async (youtubeUrl, opts) => {
      const data = (await createYoutubeHighlightClip(client, {
        youtubeUrl,
        boardId: opts.boardId,
        fileMetaId: opts.fileMeta,
        outputDir: opts.out,
        clipLengthMinutes: opts.length,
        subtitleMaxLineLength: opts.maxLine,
        shortsMode: !!opts.shorts,
        highlightKeywords: opts.keywords,
      })) as { files?: string[] } & Record<string, unknown>;

      if (opts.json) return writeJson(data);
      const files = Array.isArray(data.files) ? data.files : [];
      writeFilesWritten(files);
    });

  video
    .command("subtitle <youtubeUrl>")
    .description("Burn full transcript subtitles into a YouTube video")
    .option("--board-id <id>", "board ID")
    .option("--file-meta <id>", "file metadata ID")
    .option("--out <dir>", "output directory", "./docs/full-subtitles")
    .option(
      "--max-line <chars>",
      "max characters per subtitle segment",
      (v) => parseInt(v, 10),
      42
    )
    .option("--json", "output JSON")
    .action(async (youtubeUrl, opts) => {
      const data = (await createYoutubeFullSubtitledVideo(client, {
        youtubeUrl,
        boardId: opts.boardId,
        fileMetaId: opts.fileMeta,
        outputDir: opts.out,
        subtitleMaxLineLength: opts.maxLine,
      })) as { files?: string[] } & Record<string, unknown>;

      if (opts.json) return writeJson(data);
      const files = Array.isArray(data.files) ? data.files : [];
      writeFilesWritten(files);
    });
};
```

- [ ] **Step 2: Build & commit**

Run: `npm run build`
Expected: success.

```bash
git add src/cli/video.ts
git commit -m "feat(cli): video clip and subtitle commands"
```

### Task 3.10: Wire `bin` and verify with `npm link`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `bin` field**

In `package.json`, after `"main": "dist/index.js"`, add:

```json
  "bin": {
    "daglo": "dist/cli.js"
  },
```

- [ ] **Step 2: Add shebang preservation**

Verify `src/cli.ts` starts with `#!/usr/bin/env node`. After `tsc`, the shebang must survive in `dist/cli.js`. TypeScript preserves the first line if it's a comment-like shebang. Confirm:

Run: `npm run build && head -1 dist/cli.js`
Expected: `#!/usr/bin/env node`

- [ ] **Step 3: Make built CLI executable**

In `package.json` scripts, replace `build` with:

```json
"build": "tsc && chmod +x dist/cli.js"
```

Run: `npm run build && ls -l dist/cli.js`
Expected: `-rwxr-xr-x` (executable bit set).

- [ ] **Step 4: `npm link`**

Run: `npm link`
Expected: creates global symlink `daglo` → `dist/cli.js`. May require permissions.

- [ ] **Step 5: Smoke test**

```bash
daglo --version       # → 1.0.0
daglo --help          # → command list
daglo auth status     # → "Not logged in" (exit 1) or current login
```

Expected: each command runs without crashing.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "chore: wire dist/cli.js as 'daglo' bin"
```

---

## Phase 4: Remove MCP, Clean Up, Document

### Task 4.1: Delete MCP entry and tools/ directory

**Files:**
- Delete: `src/index.ts`, `src/tools/`

- [ ] **Step 1: Delete files**

```bash
rm src/index.ts
rm -r src/tools
```

- [ ] **Step 2: Build to confirm nothing else references them**

Run: `npm run build`
Expected: success. If failures appear, identify any stray import and fix.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS (handler tests don't depend on tools/).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove MCP entry and tools registration"
```

### Task 4.2: Remove MCP SDK dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Uninstall**

Run: `npm uninstall @modelcontextprotocol/sdk`
Expected: removes from dependencies + lockfile.

- [ ] **Step 2: Confirm no stray import**

Run: `grep -r "@modelcontextprotocol" src/` (use Grep tool in agent flow)
Expected: no matches.

- [ ] **Step 3: Build & test**

Run: `npm run build && npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: drop @modelcontextprotocol/sdk dependency"
```

### Task 4.3: Update package.json scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace `start` and `dev` scripts**

Change:

```json
"start": "node dist/index.js",
"dev": "tsc && node dist/index.js",
```

to:

```json
"start": "node dist/cli.js",
"dev": "tsc && node dist/cli.js",
```

Also remove `"main": "dist/index.js"` and replace with `"main": "dist/cli.js"` (or remove entirely since `bin` is the user-facing entry).

- [ ] **Step 2: Update description and keywords**

Change description:

```json
"description": "CLI for Daglo AI platform — speech-to-text and document management",
```

Add `cli` to `keywords`:

```json
"keywords": ["daglo", "cli", "ai", "speech-to-text"],
```

(Drop `mcp` from keywords.)

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: update package.json for CLI usage"
```

### Task 4.4: Rewrite README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README contents** with CLI-focused docs:

```markdown
# Daglo CLI

Command-line interface for the Daglo AI platform — speech-to-text transcription, board management, Obsidian export, and YouTube subtitle/clip generation.

## Installation

```bash
npm install
npm run build
npm link    # registers `daglo` globally
```

## Authentication

```bash
daglo auth login                  # interactive prompt
daglo auth login --email u@x.com --password ...
DAGLO_EMAIL=... DAGLO_PASSWORD=... daglo auth login   # env vars
daglo auth status
daglo auth logout
```

Tokens cache to `~/.config/daglo/credentials.json` (file mode `0600`). On expiry or 401 responses, the CLI re-logs in automatically using `DAGLO_EMAIL`/`DAGLO_PASSWORD` if set.

## Commands

| Group | Command | Description |
|---|---|---|
| auth | `daglo auth login\|logout\|status` | Authentication |
| board | `daglo board list` | List boards (`--page`, `--limit`, `--sort`, `--status`, `--starred`, `--folder`) |
| board | `daglo board info <id>` | Basic info (`--shared <id>` for shared boards) |
| board | `daglo board detail <id>` | Full detail with content/summary/segments |
| board | `daglo board script` | Decoded script (`--file-meta`, `--shared`, etc.) |
| board | `daglo board rename <id> <name>` | Rename a board |
| board | `daglo board latest` | Latest board's content |
| board | `daglo board export <format>` | Export to text or punctuation-json (`--out`) |
| folder | `daglo folder list` | List folders |
| folder | `daglo folder export <folderId>` | Bulk export to Obsidian |
| file-meta | `daglo file-meta get <id>` | Fetch file metadata |
| file-meta | `daglo file-meta keywords` | Keywords for a file or shared board |
| obsidian | `daglo obsidian export <boardId>` | Single-board Obsidian export |
| video | `daglo video clip <url>` | YouTube highlight clip with burned subtitles |
| video | `daglo video subtitle <url>` | Full subtitled video |

## Global Options

- `--json` — machine-readable JSON output
- `--no-color` — disable color
- `-v, --verbose` — debug logging (stderr)
- `--quiet` — suppress info logs (stderr)

## Output

- **stdout**: command results (tables / JSON / file paths)
- **stderr**: progress markers, logs, errors

This makes `daglo board list --json | jq` pipe cleanly.

## External Tools

`daglo video clip` and `daglo video subtitle` shell out to:

- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) — YouTube download
- [`ffmpeg`](https://ffmpeg.org/) — clipping and subtitle burning

Install both and ensure they're on `PATH` before using video commands.

## Configuration

- `DAGLO_EMAIL` / `DAGLO_PASSWORD` — fallback credentials for re-auth
- `LOG_LEVEL` — pino log level (`debug` | `info` | `warn` | `error`)
- `XDG_CONFIG_HOME` — overrides `~/.config` for credential storage

## Development

```bash
npm test            # vitest
npm run test:ui
npm run build       # tsc + chmod +x dist/cli.js
npm link            # register `daglo` for local testing
```

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for CLI usage"
```

### Task 4.5: Drop or update SKILLS.md and ENHANCEMENT_SUMMARY.md

**Files:**
- Modify or delete: `SKILLS.md`, `ENHANCEMENT_SUMMARY.md`

- [ ] **Step 1: Inspect both**

Run: `cat SKILLS.md ENHANCEMENT_SUMMARY.md`

- [ ] **Step 2: Decide per file**

If MCP-specific (e.g. references `server.registerTool`, MCP clients), delete:

```bash
rm SKILLS.md ENHANCEMENT_SUMMARY.md
```

If they describe domain knowledge that's still useful, edit to reference `daglo <group> <cmd>` syntax. Use judgment.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: align supplemental docs with CLI"
```

### Task 4.6: Final smoke test of all 15 commands

- [ ] **Step 1: Build fresh**

```bash
npm run build && npm link
```

- [ ] **Step 2: Run each group help**

```bash
daglo --help
daglo auth --help
daglo board --help
daglo folder --help
daglo file-meta --help
daglo obsidian --help
daglo video --help
```

Expected: each prints commands without errors.

- [ ] **Step 3: Live smoke (requires DAGLO_EMAIL/DAGLO_PASSWORD set)**

For each command, run a representative invocation. Examples (replace IDs with real ones from your account):

```bash
daglo auth login
daglo auth status
daglo folder list
daglo folder list --json | head
daglo board list --limit 3
daglo board list --limit 3 --json | jq '.items[0].id'
daglo board info <boardId>
daglo board detail <boardId>
daglo board script --file-meta <fileMetaId> --limit 5
daglo board rename <boardId> "Test rename $(date +%s)"   # then rename back
daglo board latest --limit 5
daglo board export text --board-id <boardId> --out /tmp/board.txt
daglo file-meta get <fileMetaId>
daglo file-meta keywords --file-meta <fileMetaId>
daglo obsidian export <boardId> --out /tmp/obs --type both
daglo folder export <folderId> --out /tmp/folder-export --limit 2
daglo video clip "<youtubeUrl>" --board-id <boardId> --out /tmp/clip --length 1
daglo video subtitle "<youtubeUrl>" --board-id <boardId> --out /tmp/subs
daglo auth logout
```

Mark any that fail as separate follow-up bugs.

- [ ] **Step 4: Final test suite + build**

```bash
npm run build && npm test
```

Expected: PASS.

- [ ] **Step 5: Final commit if any cleanup**

```bash
git add -A
git diff --cached --stat
git commit -m "chore: final smoke + cleanup" || echo "nothing to commit"
```

---

## Done

The repository now exposes only the `daglo` CLI. MCP entry, `tools/`, and the MCP SDK dependency are gone. All 15 original tools are reachable as `daglo <group> <command>`. Credentials cache to `~/.config/daglo/credentials.json` with auto re-auth on 401.
