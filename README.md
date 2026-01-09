# Daglo MCP Server

MCP (Model Context Protocol) server for Daglo AI platform - speech-to-text transcription and AI-powered document management.

## Features

- **Authentication**: Login to Daglo with email and password
- **Board Management**: List and retrieve transcription boards
- **Folder Organization**: Access folder structure
- **Quota Tracking**: Check usage limits and quotas
- **Plan Management**: View available subscription plans

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
- `status` (string, optional): Filter by board status (COMPLETE, PROCESSING, FAILED)
- `isStarred` (boolean, optional): Filter by starred boards
- `checkedFilter` (string, optional): Filter by incomplete recordings or PDFs (incompleteRecording, isPdf)
- `folderId` (string, optional): Filter by folder ID

#### `get-board-detail`
Retrieve detailed information including content, summary, keywords, AI summary, and segments for a specific board. Supports filtering which data to include.

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

#### `get-folders`
Retrieve all folders from Daglo.

**Parameters:**
- `includeRoot` (boolean, optional): Include root folder (default: true)

#### `get-quotas`
Retrieve usage quotas and limits for Daglo services.

#### `get-plans`
Retrieve available subscription plans from Daglo.

## API Endpoints

The server interacts with the following Daglo API endpoints:

- `POST https://backend.daglo.ai/user/login` - Authentication
- `GET https://backend.daglo.ai/v2/boards` - List boards
- `GET https://backend.daglo.ai/v2/boards/{id}` - Board details
- `GET https://backend.daglo.ai/folders` - List folders
- `GET https://backend.daglo.ai/store/capa` - Quotas
- `GET https://backend.daglo.ai/v2/store/plan` - Plans

## Development

### TypeScript

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Testing

```bash
# Run all tests
npm test

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage
```

## Test Coverage

The project includes comprehensive tests for all MCP tools:

- **Login Tests**: Authentication success and failure scenarios
- **Board Tests**: Board listing, filtering, and detail retrieval
- **Folder Tests**: Folder listing with and without root
- **Quota Tests**: Usage quota retrieval
- **Plan Tests**: Subscription plan information
- **URL Construction**: URL building and parameter handling
- **Type Validation**: Board status and type validation
- **Error Handling**: Various HTTP error scenarios

All tests use mock data to avoid external API calls and ensure fast, reliable testing.

## License

MIT
