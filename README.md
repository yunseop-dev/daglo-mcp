# Daglo MCP Server

MCP (Model Context Protocol) server for Daglo AI platform - speech-to-text transcription and AI-powered document management.

## Features

- **Authentication**: Login to Daglo with email and password
- **Board Management**: List and retrieve transcription boards
- **Folder Organization**: Access folder structure
- **Quota Tracking**: Check usage limits and quotas
- **Plan Management**: View available subscription plans
- **Bookmarks** (Phase 1): Create and retrieve bookmarks for specific timestamps in boards
- **Notifications** (Phase 1): Get and manage user notifications
- **User Dictionary** (Phase 1): Manage custom dictionary for specialized terminology
- **User Profile & Settings** (Phase 2): View and update user profile, email, and preferences
- **Notification Options** (Phase 2): Manage notification delivery channels and categories
- **Summary Language Settings** (Phase 2): Configure transcription and summary language preferences
- **Board Sharing** (Phase 2): Create shareable links and view shared board information

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
Retrieve the content of the most recently created board. Optionally decodes zlib+base64 content.

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

**Example (punctuation-json):**
```json
{
  "format": "punctuation-json",
  "outputPath": "/tmp/latest-board-segments.json"
}
```

**Example (text):**
```json
{
  "format": "text",
  "outputPath": "/tmp/latest-board-content.txt"
}
```

**Example (specific board):**
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

### Logging

The server uses Pino for structured logging. Log levels can be controlled via environment variables.

**Environment Variables:**
- `LOG_LEVEL`: Set logging level (`debug`, `info`, `warn`, `error`, `fatal`)
- `NODE_ENV`: Set to `production` for production logging (info level), `development` for detailed logging (debug level)

**Examples:**

```bash
# Debug logging (default in development)
LOG_LEVEL=debug npm start

# Info logging (default in production)
LOG_LEVEL=info npm start

# Production mode
NODE_ENV=production npm start

# Combined
NODE_ENV=production LOG_LEVEL=warn npm start
```

**Login Debugging:**

When login fails, the server logs detailed information:

- Login attempt with unique ID
- Request URL and payload
- HTTP response status and headers
- Response body for debugging
- Token extraction process
- Success or failure with specific error details

**Log Example:**
```json
{
  "level": "error",
  "time": "2026-01-09T06:50:00.000Z",
  "msg": "Login request failed",
  "loginId": "abc123",
  "status": 401,
  "statusText": "Unauthorized",
  "responseBody": "{...}",
  "responseHeaders": [["content-type", "application/json"]]
}
```

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

#### `get-bookmarks` (NEW)
Retrieve all bookmarks from a specific board with optional pagination.

**Parameters:**
- `boardId` (string, required): Board ID to fetch bookmarks for
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Number of bookmarks per page (default: 50)

**Example:**
```json
{
  "boardId": "V3K8cTczuRrvLl2v",
  "page": 1,
  "limit": 50
}
```

#### `create-bookmark` (NEW)
Create a new bookmark in a board at a specific timestamp.

**Parameters:**
- `boardId` (string, required): Board ID to create bookmark in
- `title` (string, required): Bookmark title
- `timestamp` (number, optional): Timestamp in seconds
- `description` (string, optional): Bookmark description

**Example:**
```json
{
  "boardId": "V3K8cTczuRrvLl2v",
  "title": "Important discussion point",
  "timestamp": 123.5,
  "description": "Key moment to review"
}
```

#### `get-notifications` (NEW)
Retrieve user notifications with optional filtering by read status.

**Parameters:**
- `isRead` (boolean, optional): Filter by read status (true/false)
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Number of notifications per page (default: 20)

**Example:**
```json
{
  "isRead": false,
  "page": 1,
  "limit": 20
}
```

#### `mark-notification-read` (NEW)
Mark a notification as read.

**Parameters:**
- `notificationId` (string, required): Notification ID to mark as read

**Example:**
```json
{
  "notificationId": "notif-123"
}
```

#### `get-user-dictionary` (NEW)
Retrieve user's custom dictionary with optional filtering.

**Parameters:**
- `category` (string, optional): Filter by category
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Number of words per page (default: 50)

**Example:**
```json
{
  "category": "IT",
  "page": 1,
  "limit": 50
}
```

#### `add-dictionary-word` (NEW)
Add a word to the user's custom dictionary.

**Parameters:**
- `word` (string, required): Word to add
- `pronunciation` (string, optional): Pronunciation guide
- `definition` (string, optional): Word definition
- `category` (string, optional): Dictionary category

**Example:**
```json
{
  "word": "AI",
  "pronunciation": "ey-ahy",
  "definition": "Artificial Intelligence",
  "category": "IT"
}
```

#### `delete-dictionary-word` (NEW)
Delete a word from the user's custom dictionary.

**Parameters:**
- `wordId` (string, required): Word ID to delete

**Example:**
```json
{
  "wordId": "word-123"
}
```

#### `get-user-profile` (NEW - PHASE 2)
Retrieve the current user's profile information.

**Parameters:** None

**Example:**
```json
{}
```

**Response includes:**
- User ID, name, email
- Account status and settings
- Linked social providers
- Subscription plan
- Profile background color

#### `update-user-profile` (NEW - PHASE 2)
Update the current user's profile information.

**Parameters:**
- `name` (string, optional): User's full name
- `marketingAgreement` (boolean, optional): Marketing consent
- `dataAgreement` (boolean, optional): Data usage consent
- `profileBackground` (enum, optional): Profile color theme (SECONDARY_ROSE, WARNING, SUCCESS, PRIMARY, SECONDARY_VIOLET)

**Example:**
```json
{
  "name": "John Doe",
  "marketingAgreement": true,
  "profileBackground": "PRIMARY"
}
```

#### `get-user-email` (NEW - PHASE 2)
Retrieve the current user's email address.

**Parameters:** None

**Example:**
```json
{}
```

#### `get-notification-options` (NEW - PHASE 2)
Retrieve the user's notification preferences.

**Parameters:** None

**Response includes:**
- Notification delivery methods (EMAIL, MOBILE)
- Categories (MARKETING, TRANSCRIPT, LONG_SUMMARY)
- Enabled/disabled status for each

**Example:**
```json
{}
```

#### `update-notification-option` (NEW - PHASE 2)
Update a specific notification preference.

**Parameters:**
- `type` (enum, required): EMAIL or MOBILE
- `category` (enum, required): MARKETING, TRANSCRIPT, or LONG_SUMMARY
- `value` (boolean, required): Enable or disable

**Example:**
```json
{
  "type": "EMAIL",
  "category": "TRANSCRIPT",
  "value": true
}
```

#### `get-summary-language` (NEW - PHASE 2)
Retrieve the user's summary language preferences.

**Parameters:**
- `transcriptionLanguage` (enum, optional): ko-KR or en-US

**Example:**
```json
{
  "transcriptionLanguage": "en-US"
}
```

#### `update-summary-language` (NEW - PHASE 2)
Update the user's summary language preferences.

**Parameters:**
- `transcriptionLanguage` (enum, required): ko-KR or en-US
- `summaryLanguage` (enum, required): ko-KR or en-US

**Example:**
```json
{
  "transcriptionLanguage": "en-US",
  "summaryLanguage": "ko-KR"
}
```

#### `create-share-link` (NEW - PHASE 2)
Create or update a shareable link for a board.

**Parameters:**
- `boardId` (string, required): The board ID to share
- `isShared` (boolean, optional): Enable sharing (true) or disable (false) - defaults to true
- `expiredAt` (string, optional): Share expiration date (ISO string)
- `permission` (number, optional): Permission level (default: 1)
- `isBookmarkSharable` (boolean, optional): Allow sharing of bookmarks (default: false)

**Example:**
```json
{
  "boardId": "V3K8cTczuRrvLl2v",
  "isShared": true,
  "isBookmarkSharable": true
}
```

**To revoke sharing:**
```json
{
  "boardId": "V3K8cTczuRrvLl2v",
  "isShared": false
}
```

#### `get-shared-board-info` (NEW - PHASE 2)
Retrieve information about a shared board (public access, no authentication required).

**Parameters:**
- `shareId` (string, required): The share ID from the share URL
- `includeDetails` (boolean, optional): Include full board details

**Example:**
```json
{
  "shareId": "share-abc123",
  "includeDetails": true
}
```

**Response includes:**
- Board name and metadata
- Share URL and permissions
- Bookmarks (if shareable)
- Board content and segments

## Test Coverage

The project includes comprehensive tests for all MCP tools:

- **Login Tests**: Authentication success and failure scenarios
- **Board Tests**: Board listing, filtering, and detail retrieval
- **Folder Tests**: Folder listing with and without root
- **Quota Tests**: Usage quota retrieval
- **Plan Tests**: Subscription plan information
- **Bookmark Tests** (Phase 1): Bookmark retrieval and creation
- **Notification Tests** (Phase 1): Notification retrieval and status management
- **Dictionary Tests** (Phase 1): Dictionary word retrieval, addition, and deletion
- **User Profile Tests** (Phase 2): Get and update user profile information
- **Notification Options Tests** (Phase 2): Get and update notification preferences
- **Summary Language Tests** (Phase 2): Get and update summary language settings
- **Board Sharing Tests** (Phase 2): Create share links and retrieve shared board info
- **URL Construction**: URL building and parameter handling
- **Type Validation**: Board status and type validation
- **Error Handling**: Various HTTP error scenarios

All tests use mock data to avoid external API calls and ensure fast, reliable testing.

## License

MIT
