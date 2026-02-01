# Daglo MCP Server

MCP (Model Context Protocol) server for Daglo AI platform - speech-to-text transcription and AI-powered document management.

## Features

- **Authentication**: Login to Daglo with email and password
- **Board Management**: List and retrieve transcription boards
- **Folder Organization**: Access folder structure
- **Content Export**: Export board content to various formats
- **Obsidian Export**: Export boards to Obsidian-compatible markdown with YAML frontmatter
- **Video Highlights**: Generate YouTube highlight clips with burned-in subtitles

## Installation

```bash
npm install
```

## Building

```bash
npm run build
```

## Usage

### Start the server

```bash
npm start
```

### Available Tools

#### `login`
Authenticate with Daglo using email and password.

**Parameters:**
- `email` (string, optional): Daglo account email (default: `DAGLO_EMAIL` env)
- `password` (string, optional): Daglo account password (default: `DAGLO_PASSWORD` env)

**Environment Variables:**
- `DAGLO_EMAIL`: Daglo account email
- `DAGLO_PASSWORD`: Daglo account password

**Example:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

#### `get-boards`
Retrieve all boards from Daglo with optional filters.

**Parameters:**
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Number of boards per page
- `sort` (string, optional): Sort expression (default: createTime.desc, examples: createTime.desc, name.asc, name.desc)
- `status` (string, optional): Filter by board status (COMPLETE, PROCESSING, FAILED)
- `isStarred` (boolean, optional): Filter by starred boards
- `checkedFilter` (string, optional): Filter by incomplete recordings or PDFs (incompleteRecording, isPdf)
- `folderId` (string, optional): Filter by folder ID

#### `get-board-info`
Retrieve basic information about a board.

**Parameters:**
- `boardId` (string, optional): Board ID to fetch (private board)
- `sharedBoardId` (string, optional): Shared board ID to fetch (public)

#### `get-board-detail`
Retrieve detailed information including content, summary, keywords, AI summary, and segments for a specific board.

**Parameters:**
- `boardId` (string, required): Board ID to fetch details for
- `fileMetaId` (string, optional): File metadata ID
- `includeContent` (boolean, optional): Include full transcription content (default: true)
- `includeSummary` (boolean, optional): Include summary (default: true)
- `includeKeywords` (boolean, optional): Include keywords (default: true)
- `includeAiSummary` (boolean, optional): Include AI summary (default: true)
- `includeSegments` (boolean, optional): Include timestamped segments (default: true)

**Example:**
```json
{
  "boardId": "abc123",
  "includeContent": true,
  "includeSegments": true,
  "includeAiSummary": true
}
```

#### `get-board-script`
Retrieve and decode a board script (supports shared, original, and history scripts).

**Parameters:**
- `fileMetaId` (string, optional): File metadata ID
- `sharedBoardId` (string, optional): Shared board ID
- `historyId` (string, optional): Script history ID (requires fileMetaId)
- `isOriginal` (boolean, optional): Fetch original script (requires fileMetaId)
- `limit` (number, optional): Minutes per page (default: 60)
- `page` (number, optional): Page index for script API (default: 0)
- `buildPages` (boolean, optional): Split script into pages (default: true)

#### `update-board-name`
Update a board name.

**Parameters:**
- `boardId` (string, required): Board ID to update
- `name` (string, required): New board name

**Example:**
```json
{
  "boardId": "abc123",
  "name": "2026. 1. 25. 11:22 녹음"
}
```

#### `get-latest-board-content`
Retrieve the content of the most recently created board.

**Parameters:**
- `limit` (number, optional): Number of boards to inspect (default: 50)
- `decodeContent` (boolean, optional): Decode zlib+base64 content (default: true)

**Example:**
```json
{
  "limit": 20,
  "decodeContent": true
}
```

#### `export-board-content`
Export board content as punctuation-split JSON or plain text.

**Parameters:**
- `format` (string, required): Output format (punctuation-json or text)
- `outputPath` (string, optional): Output file path
- `boardId` (string, optional): Board ID to export (default: latest board)
- `fileMetaId` (string, optional): File metadata ID (optional)
- `limit` (number, optional): Number of boards to inspect (default: 50)

**Example:**
```json
{
  "format": "text",
  "boardId": "abc123",
  "outputPath": "/tmp/board-abc123.txt"
}
```

#### `get-folders`
Retrieve all folders from Daglo.

**Parameters:**
- `includeRoot` (boolean, optional): Include root folder (default: true)

#### `get-file-meta`
Retrieve file metadata for a file.

**Parameters:**
- `fileMetaId` (string, required): File metadata ID

#### `get-keywords`
Retrieve keywords for a board.

**Parameters:**
- `fileMetaId` (string, optional): File metadata ID
- `sharedBoardId` (string, optional): Shared board ID

#### `export-to-obsidian`
Export a single board to Obsidian-compatible markdown with YAML frontmatter.

**Parameters:**
- `boardId` (string, required): Board ID to export
- `fileMetaId` (string, optional): File metadata ID for additional data
- `outputType` (enum, optional): "original", "summary", or "both" (default: "both")
- `outputDir` (string, optional): Output directory (default: "./docs")
- `includeContent` (boolean, optional): Include full transcription content (default: true)
- `includeSummary` (boolean, optional): Include summary (default: true)
- `includeKeywords` (boolean, optional): Include keywords (default: true)
- `includeAiSummary` (boolean, optional): Include AI summary (default: true)

**Example:**
```json
{
  "boardId": "qpQ4grmCEgCpfxyZ",
  "outputType": "both",
  "outputDir": "./docs"
}
```

**Output:**
- Creates `{outputDir}/original/{YYYY-MM-DD} {board name}.md` with transcription
- Creates `{outputDir}/summary/{YYYY-MM-DD} {board name}.md` with structured summary
- Both files include YAML frontmatter (title, date, tags, keywords, source, board_id, created)
- Summary includes Obsidian callouts, wikilinks to original, and inline tags

#### `batch-export-folder`
Export all boards in a folder to Obsidian markdown.

**Parameters:**
- `folderId` (string, required): Folder ID to export
- `outputDir` (string, optional): Output directory (default: "./docs")
- `outputType` (enum, optional): "original", "summary", or "both" (default: "both")
- `limit` (number, optional): Max boards to export (default: 50)

**Example:**
```json
{
  "folderId": "folder123",
  "outputDir": "./docs/diary",
  "outputType": "both",
  "limit": 10
}
```

#### `create-youtube-highlight-clip`
Download a YouTube video, select a highlight segment based on board transcript keywords, and output a burned-in subtitle clip.

**Parameters:**
- `youtubeUrl` (string, required): YouTube video URL to download
- `boardId` (string, optional): Board ID to fetch transcript from
- `fileMetaId` (string, optional): File metadata ID (takes precedence over boardId)
- `outputDir` (string, optional): Output directory (default: "./docs/clips")
- `clipLengthMinutes` (number, optional): Target clip length in minutes (default: 3.5)
- `subtitleMaxLineLength` (number, optional): Max characters per subtitle segment (default: 42)
- `shortsMode` (boolean, optional): Generate vertical 9:16 clip for shorts (default: false)
- `highlightKeywords` (string[], optional): Override keywords for highlight selection

**Example:**
```json
{
  "youtubeUrl": "https://youtu.be/vMmEF5OYZds",
  "boardId": "KXl_F8J7oTS1FURF",
  "outputDir": "./docs/clips",
  "clipLengthMinutes": 3.5,
  "shortsMode": true
}
```

**Output:**
- `{outputDir}/video_<youtubeId>.mp4` (downloaded source video, cached by YouTube ID)
- `{outputDir}/clip_no_subs.mp4` (highlight clip without subtitles)
- `{outputDir}/subtitles.srt` (generated subtitles)
- `{outputDir}/clip_with_subs.mp4` (final clip with burned-in subtitles)

## API Endpoints

The server interacts with the following Daglo API endpoints:

- `POST https://backend.daglo.ai/user/login` - Authentication
- `GET https://backend.daglo.ai/v2/boards` - List boards
- `GET https://backend.daglo.ai/v2/boards/{id}` - Board details
- `GET https://backend.daglo.ai/boards/{id}` - Board info
- `GET https://backend.daglo.ai/folders` - List folders
- `GET https://backend.daglo.ai/file-meta/{id}` - File metadata
- `GET https://backend.daglo.ai/file-meta/{id}/script` - Board script
- `GET https://backend.daglo.ai/file-meta/{id}/keywords` - Keywords

## Project Structure

```
src/
├── index.ts           # Entry point
├── config.ts          # Constants and environment variables
├── types.ts           # TypeScript type definitions
├── logger.ts          # Pino logger configuration
├── api/
│   └── client.ts      # DagloApiClient with auth handling
├── utils/
│   ├── http.ts        # URL building and response parsing
│   ├── content.ts     # Content decoding (zlib, base64)
│   ├── karaoke.ts     # Karaoke token extraction
│   ├── file.ts        # File path utilities
│   ├── board.ts       # Board list normalization
│   ├── auth.ts        # Login payload helpers
│   └── obsidian.ts    # Obsidian markdown formatters
└── tools/
    ├── boards.ts      # Board-related tools (7 tools)
    ├── folders.ts     # Folder tools (1 tool)
    ├── auth.ts        # Authentication tools (1 tool)
    ├── file-meta.ts   # File metadata tools (2 tools)
    ├── obsidian.ts    # Obsidian export tools (2 tools)
    └── video.ts       # Video highlight tools (1 tool)
```

## Development

### Logging

The server uses Pino for structured logging.

**Environment Variables:**
- `LOG_LEVEL`: Set logging level (`debug`, `info`, `warn`, `error`, `fatal`)
- `NODE_ENV`: Set to `production` for production logging

```bash
LOG_LEVEL=debug npm start
```

### Build

```bash
npm run build
```

### Testing

```bash
npm test
npm run test:ui
npm run test:coverage
```

## License

MIT
