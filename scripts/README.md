# Daglo MCP - Testing & Debugging Scripts

This directory contains comprehensive testing and debugging scripts for the daglo-mcp server. These scripts help verify that all tools are working correctly with the actual Daglo API.

## Prerequisites

Before running any tests, set up environment variables:

```bash
export DAGLO_EMAIL="your-email@example.com"
export DAGLO_PASSWORD="your-password"
```

Or create a `.env` file in the daglo-mcp root directory:

```
DAGLO_EMAIL=your-email@example.com
DAGLO_PASSWORD=your-password
```

## Available Test Scripts

### 1. `test-all-tools.js` - Comprehensive Test Suite

Tests all 26 tools in sequence and provides a summary report.

**Usage:**
```bash
npm run test:all-tools
```

**What it tests:**
- ✅ Authentication (Login)
- ✅ Board management (Get boards, Get board detail)
- ✅ Folder management (Get folders)
- ✅ Quota tracking (Get quotas)
- ✅ Plan management (Get plans)
- ✅ User profile (Phase 2)
- ✅ Notifications (Phase 1)
- ✅ Notification options (Phase 2)
- ✅ Summary language settings (Phase 2)
- ✅ Bookmarks (Phase 1)
- ✅ Board sharing (Phase 2)

**Output:**
- Real-time status for each test
- Success/failure summary
- Test results with duration
- Success rate percentage

**Example Output:**
```
🧪 Daglo MCP Tools - Comprehensive Test Suite

📍 API Base: https://backend.daglo.ai
👤 User: user@example.com

═══════════════════════════════════════
TEST 1: Authentication (Login)
═══════════════════════════════════════

✅ [PASSED] Login: User: user123

═══════════════════════════════════════
TEST 2: Board Management
═══════════════════════════════════════

✅ [PASSED] Get Boards: Found 5 boards

...

📊 TEST SUMMARY
═══════════════════════════════════════

✅ Passed: 12
❌ Failed: 0
⏭️  Skipped: 0
📈 Total: 12

📈 Success Rate: 100%
```

### 2. `debug-script.js` - Interactive Tool Debugger

Interactive menu-driven tool to test individual API endpoints and debug specific issues.

**Usage:**
```bash
npm run test:debug
```

**Features:**
- Interactive menu for testing individual tools
- Real-time API response display
- Ability to modify parameters and re-test
- Support for all 26 MCP tools

**Available Options:**
```
1. Get User Profile
2. Update User Profile
3. Get User Email
4. Get Notification Options
5. Update Notification Option
6. Get Summary Language
7. Update Summary Language
8. Get Bookmarks
9. Create Bookmark
10. Get Notifications
11. Get Board Detail
12. Create Share Link
13. Get Shared Board Info
0. Exit
```

**Example Session:**
```bash
$ npm run test:debug

🔍 Daglo MCP Debug Script - Interactive Tool Testing

🔐 Logging in...
✅ Logged in as: user123

📋 Fetching sample board...
✅ Found board: "My Board" (ID: V3K8cTczuRrvLl2v)

═══════════════════════════════════════
🧪 Select a tool to test:
═══════════════════════════════════════

1. Get User Profile
...
0. Exit

Enter choice (0-13): 1

🔍 Testing: Get User Profile

Status: 200 OK
Response: {
  "id": "user123",
  "name": "John Doe",
  "email": "user@example.com",
  ...
}

Enter choice (0-13): 0

👋 Goodbye!
```

### 3. `test-board-detail.js` - Detailed Board Testing

Comprehensive test specifically for the `get-board-detail` tool to verify data structure and response completeness.

**Usage:**
```bash
npm run test:board-detail
```

**What it tests:**
- Board detail retrieval
- Response time measurement
- Data structure validation
- Optional field presence checking
- FileMetaId parameter handling

**Output:**
- Detailed board information
- Response time metrics
- Data structure validation results
- Field presence indicators

**Example Output:**
```
📊 Get Board Detail - Comprehensive Test

🔐 Step 1: Authenticating...

✅ Authenticated as: user@example.com

📋 Step 2: Fetching boards list...

✅ Found 10 boards

🔍 Step 3: Testing board detail endpoints...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Board 1/3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 Board Info:
   ID: V3K8cTczuRrvLl2v
   Name: "2026. 1. 30. 12:18 녹음"
   Status: COMPLETE
   Type: TRANSCRIPTION
   Created: 2026-01-30T12:18:00Z

🔍 Fetching full board detail...
✅ SUCCESS (245ms)

   Response fields:
   - ID: V3K8cTczuRrvLl2v
   - Name: "2026. 1. 30. 12:18 녹음"
   - Status: COMPLETE
   - Type: TRANSCRIPTION
   - Summary: "This is an AI-generated summary..."
   - Content: "Transcribed content from the recording..."
   - Keywords: AI, Technology, Discussion
   - Segments: 26 items
   - AI Summary: "Key points discussed..."

   Data structure validation:
   - Has ID: ✅
   - Has Name: ✅
   - Has Status: ✅
   - Has Type: ✅

   ✅ Board detail structure is valid!

...

==================================================
✅ Test completed!
==================================================
```

## Running Multiple Tests

To run all testing scripts:

```bash
# Test everything
npm run test:all-tools
npm run test:board-detail
npm run test:debug  # Then interact with the menu
```

## Troubleshooting

### Authentication Failures
- Verify `DAGLO_EMAIL` and `DAGLO_PASSWORD` are correct
- Check that your Daglo account is active
- Ensure you have network access to `https://backend.daglo.ai`

### API Errors
Each test provides the HTTP status code and error message:
- `401 Unauthorized`: Check authentication token
- `404 Not Found`: Check resource ID is correct
- `500 Server Error`: Daglo API issue - try again later

### Script Not Running
- Ensure Node.js 16+ is installed: `node --version`
- Install dependencies: `npm install`
- Check script file permissions: `ls -la scripts/`

## Test Coverage

These scripts cover:

| Feature | Phase | Tools Tested |
|---------|-------|--------------|
| Authentication | Core | login |
| Board Management | Core | get-boards, get-board-detail |
| Folder Management | Core | get-folders |
| Quota Tracking | Core | get-quotas |
| Plan Management | Core | get-plans |
| Bookmarks | Phase 1 | get-bookmarks, create-bookmark |
| Notifications | Phase 1 | get-notifications, mark-notification-read |
| User Dictionary | Phase 1 | get-user-dictionary, add-dictionary-word, delete-dictionary-word |
| User Profile | Phase 2 | get-user-profile, update-user-profile, get-user-email |
| Notification Options | Phase 2 | get-notification-options, update-notification-option |
| Summary Language | Phase 2 | get-summary-language, update-summary-language |
| Board Sharing | Phase 2 | create-share-link, get-shared-board-info |

**Total:** 26 tools tested

## Tips

1. **Start with `test-all-tools`** for a quick overall health check
2. **Use `test:debug`** to interactively test specific tools
3. **Use `test:board-detail`** for detailed board data validation
4. **Check response times** to identify performance issues
5. **Validate data structures** match TypeScript types defined in `src/types.ts`

## Adding New Tests

To add a new test script:

1. Create a new file in the `scripts/` directory
2. Add npm script to `package.json`
3. Follow the same pattern as existing scripts
4. Use the `apiCall()` helper function for API requests
5. Include proper error handling and logging

## Performance Benchmarks

Expected response times for healthy API:
- Login: 200-500ms
- Get Boards: 100-300ms
- Get Board Detail: 100-300ms
- User Profile: 50-150ms
- Share Board: 200-500ms

If response times are significantly higher, there may be network or API issues.
