#!/usr/bin/env node

/**
 * Specific test for get-board-detail tool
 * Tests the board detail retrieval with various options
 */

require('dotenv').config();

const DAGLO_API_BASE = 'https://backend.daglo.ai';
const DAGLO_EMAIL = process.env.DAGLO_EMAIL;
const DAGLO_PASSWORD = process.env.DAGLO_PASSWORD;

async function apiCall(method, path, body = null, authToken = null) {
  const url = `${DAGLO_API_BASE}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'daglo-platform': 'web',
  };

  if (authToken) {
    headers['Authorization'] = `bearer ${authToken}`;
  }

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    data,
    responseTime: Date.now(),
  };
}

async function main() {
  console.log('\n📊 Get Board Detail - Comprehensive Test\n');

  if (!DAGLO_EMAIL || !DAGLO_PASSWORD) {
    console.error('❌ Error: Set DAGLO_EMAIL and DAGLO_PASSWORD environment variables');
    process.exit(1);
  }

  // Step 1: Login
  console.log('🔐 Step 1: Authenticating...\n');
  const loginRes = await apiCall('POST', '/user/login', {
    email: DAGLO_EMAIL,
    password: DAGLO_PASSWORD,
  });

  if (!loginRes.ok || !loginRes.data?.token) {
    console.error('❌ Login failed:', loginRes.statusText);
    process.exit(1);
  }

  const accessToken = loginRes.data.token;
  console.log(`✅ Authenticated as: ${loginRes.data.user?.email}\n`);

  // Step 2: Get list of boards
  console.log('📋 Step 2: Fetching boards list...\n');
  const boardsRes = await apiCall('GET', '/boards?page=1&limit=10', null, accessToken);

  if (!boardsRes.ok || !boardsRes.data?.items?.length) {
    console.error('❌ Failed to fetch boards:', boardsRes.statusText);
    process.exit(1);
  }

  console.log(`✅ Found ${boardsRes.data.items.length} boards\n`);

  // Step 3: Test each board's detail endpoint
  console.log('🔍 Step 3: Testing board detail endpoints...\n');

  for (let i = 0; i < Math.min(3, boardsRes.data.items.length); i++) {
    const board = boardsRes.data.items[i];
    const boardId = board.id;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Board ${i + 1}/${Math.min(3, boardsRes.data.items.length)}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    console.log(`📌 Board Info:`);
    console.log(`   ID: ${boardId}`);
    console.log(`   Name: ${board.name}`);
    console.log(`   Status: ${board.status}`);
    console.log(`   Type: ${board.type}`);
    console.log(`   Created: ${board.createTime}`);

    // Test: Get full board detail
    console.log(`\n🔍 Fetching full board detail...`);
    const startTime = Date.now();
    const detailRes = await apiCall('GET', `/boards/${boardId}`, null, accessToken);
    const duration = Date.now() - startTime;

    if (detailRes.ok) {
      const detail = detailRes.data;
      console.log(`✅ SUCCESS (${duration}ms)`);
      console.log(`\n   Response fields:`);
      console.log(`   - ID: ${detail.id}`);
      console.log(`   - Name: ${detail.name}`);
      console.log(`   - Status: ${detail.status}`);
      console.log(`   - Type: ${detail.type}`);

      // Check for optional fields
      if (detail.summary) console.log(`   - Summary: ${detail.summary.substring(0, 100)}...`);
      if (detail.content) console.log(`   - Content: ${detail.content.substring(0, 100)}...`);
      if (detail.keywords) console.log(`   - Keywords: ${detail.keywords.slice(0, 3).join(', ')}`);
      if (detail.segments) console.log(`   - Segments: ${detail.segments.length} items`);
      if (detail.aiSummary) console.log(`   - AI Summary: ${detail.aiSummary.substring(0, 100)}...`);

      // Data structure validation
      console.log(`\n   Data structure validation:`);
      const hasId = !!detail.id;
      const hasName = !!detail.name;
      const hasStatus = !!detail.status;
      const hasType = !!detail.type;

      console.log(`   - Has ID: ${hasId ? '✅' : '❌'}`);
      console.log(`   - Has Name: ${hasName ? '✅' : '❌'}`);
      console.log(`   - Has Status: ${hasStatus ? '✅' : '❌'}`);
      console.log(`   - Has Type: ${hasType ? '✅' : '❌'}`);

      if (hasId && hasName && hasStatus && hasType) {
        console.log(`\n   ✅ Board detail structure is valid!`);
      } else {
        console.log(`\n   ⚠️  Some fields are missing!`);
      }
    } else {
      console.log(`❌ FAILED (${duration}ms)`);
      console.log(`   Status: ${detailRes.status} ${detailRes.statusText}`);
      console.log(`   Error: ${JSON.stringify(detailRes.data, null, 2)}`);
    }

    // Test: Get board with fileMetaId
    if (board.fileMetaId) {
      console.log(`\n🔍 Fetching board detail with fileMetaId...`);
      const startTime2 = Date.now();
      const detailRes2 = await apiCall(
        'GET',
        `/boards/${boardId}?fileMetaId=${board.fileMetaId}`,
        null,
        accessToken
      );
      const duration2 = Date.now() - startTime2;

      if (detailRes2.ok) {
        console.log(`✅ SUCCESS (${duration2}ms)`);
      } else {
        console.log(`❌ FAILED (${duration2}ms)`);
        console.log(`   Status: ${detailRes2.status} ${detailRes2.statusText}`);
      }
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log('✅ Test completed!');
  console.log(`${'═'.repeat(50)}\n`);
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
