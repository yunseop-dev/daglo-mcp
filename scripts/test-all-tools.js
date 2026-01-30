#!/usr/bin/env node

/**
 * Comprehensive test script for all daglo-mcp tools
 * Tests each tool against the actual Daglo API
 */

const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

const DAGLO_API_BASE = 'https://backend.daglo.ai';
const DAGLO_EMAIL = process.env.DAGLO_EMAIL;
const DAGLO_PASSWORD = process.env.DAGLO_PASSWORD;

if (!DAGLO_EMAIL || !DAGLO_PASSWORD) {
  console.error('❌ Error: DAGLO_EMAIL and DAGLO_PASSWORD environment variables required');
  process.exit(1);
}

// Test results tracking
const results = {
  passed: [],
  failed: [],
  skipped: [],
};

// Helper function to make API calls
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

  try {
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
      headers: response.headers,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: error.message,
      data: null,
      error: error.message,
    };
  }
}

// Test helper
function logTest(name, passed, message = '') {
  const status = passed ? '✅' : '❌';
  const result = passed ? 'PASSED' : 'FAILED';
  console.log(`${status} [${result}] ${name}${message ? ': ' + message : ''}`);

  if (passed) {
    results.passed.push(name);
  } else {
    results.failed.push({ name, message });
  }
}

// Main test suite
async function runTests() {
  console.log('\n🧪 Daglo MCP Tools - Comprehensive Test Suite\n');
  console.log(`📍 API Base: ${DAGLO_API_BASE}`);
  console.log(`👤 User: ${DAGLO_EMAIL}\n`);

  let accessToken = null;
  let refreshToken = null;

  // ============= TEST 1: LOGIN =============
  console.log('═══════════════════════════════════════');
  console.log('TEST 1: Authentication (Login)');
  console.log('═══════════════════════════════════════\n');

  const loginRes = await apiCall('POST', '/user/login', {
    email: DAGLO_EMAIL,
    password: DAGLO_PASSWORD,
  });

  if (loginRes.ok && loginRes.data?.token) {
    accessToken = loginRes.data.token;
    refreshToken = loginRes.data.refreshToken;
    const userId = loginRes.data.user?.id || 'unknown';
    logTest('Login', true, `User: ${userId}`);
  } else {
    logTest('Login', false, `${loginRes.statusText}`);
    console.error('\n❌ Cannot continue without authentication');
    printSummary();
    process.exit(1);
  }

  // ============= TEST 2: GET BOARDS =============
  console.log('\n═══════════════════════════════════════');
  console.log('TEST 2: Board Management');
  console.log('═══════════════════════════════════════\n');

  const boardsRes = await apiCall('GET', '/boards?page=1&limit=5', null, accessToken);
  let boardId = null;
  let fileMetaId = null;

  if (boardsRes.ok && Array.isArray(boardsRes.data?.items)) {
    const boardCount = boardsRes.data.items.length;
    logTest('Get Boards', true, `Found ${boardCount} boards`);

    if (boardCount > 0) {
      boardId = boardsRes.data.items[0].id;
      fileMetaId = boardsRes.data.items[0].fileMetaId;
      console.log(`   📌 Sample Board ID: ${boardId}`);
      if (fileMetaId) console.log(`   📄 File Meta ID: ${fileMetaId}`);
    }
  } else {
    logTest('Get Boards', false, boardsRes.statusText);
  }

  // ============= TEST 3: GET BOARD DETAIL =============
  if (boardId) {
    console.log('\n═══════════════════════════════════════');
    console.log('TEST 3: Board Details');
    console.log('═══════════════════════════════════════\n');

    const detailRes = await apiCall('GET', `/boards/${boardId}`, null, accessToken);

    if (detailRes.ok) {
      const board = detailRes.data;
      logTest(
        'Get Board Detail',
        true,
        `Name: ${board.name || 'N/A'}, Status: ${board.status || 'N/A'}`
      );
    } else {
      logTest('Get Board Detail', false, detailRes.statusText);
    }
  }

  // ============= TEST 4: GET FOLDERS =============
  console.log('\n═══════════════════════════════════════');
  console.log('TEST 4: Folder Management');
  console.log('═══════════════════════════════════════\n');

  const foldersRes = await apiCall('GET', '/folders', null, accessToken);

  if (foldersRes.ok && Array.isArray(foldersRes.data)) {
    logTest('Get Folders', true, `Found ${foldersRes.data.length} folders`);
  } else {
    logTest('Get Folders', false, foldersRes.statusText);
  }

  // ============= TEST 5: GET QUOTAS =============
  console.log('\n═══════════════════════════════════════');
  console.log('TEST 5: Usage Quotas');
  console.log('═══════════════════════════════════════\n');

  const quotasRes = await apiCall('GET', '/quotas', null, accessToken);

  if (quotasRes.ok && Array.isArray(quotasRes.data)) {
    logTest('Get Quotas', true, `Found ${quotasRes.data.length} quota items`);
  } else {
    logTest('Get Quotas', false, quotasRes.statusText);
  }

  // ============= TEST 6: GET PLANS =============
  console.log('\n═══════════════════════════════════════');
  console.log('TEST 6: Subscription Plans');
  console.log('═══════════════════════════════════════\n');

  const plansRes = await apiCall('GET', '/plans', null, accessToken);

  if (plansRes.ok && Array.isArray(plansRes.data)) {
    logTest('Get Plans', true, `Found ${plansRes.data.length} plans`);
  } else {
    logTest('Get Plans', false, plansRes.statusText);
  }

  // ============= TEST 7: USER PROFILE (PHASE 2) =============
  console.log('\n═══════════════════════════════════════');
  console.log('TEST 7: User Profile & Settings (Phase 2)');
  console.log('═══════════════════════════════════════\n');

  const profileRes = await apiCall('GET', '/user', null, accessToken);

  if (profileRes.ok && profileRes.data?.id) {
    const user = profileRes.data;
    logTest(
      'Get User Profile',
      true,
      `Name: ${user.name}, Plan: ${user.plan || 'N/A'}`
    );
  } else {
    logTest('Get User Profile', false, profileRes.statusText);
  }

  // ============= TEST 8: NOTIFICATIONS (PHASE 1) =============
  console.log('\n═══════════════════════════════════════');
  console.log('TEST 8: Notifications (Phase 1)');
  console.log('═══════════════════════════════════════\n');

  const notifRes = await apiCall('GET', '/notifications?page=1&limit=10', null, accessToken);

  if (notifRes.ok && Array.isArray(notifRes.data?.items)) {
    logTest('Get Notifications', true, `Found ${notifRes.data.items.length} notifications`);
  } else {
    logTest('Get Notifications', false, notifRes.statusText);
  }

  // ============= TEST 9: NOTIFICATION OPTIONS (PHASE 2) =============
  console.log('\n═══════════════════════════════════════');
  console.log('TEST 9: Notification Options (Phase 2)');
  console.log('═══════════════════════════════════════\n');

  const notifOptRes = await apiCall('GET', '/user-option/notification', null, accessToken);

  if (notifOptRes.ok && Array.isArray(notifOptRes.data)) {
    logTest('Get Notification Options', true, `Found ${notifOptRes.data.length} options`);
  } else {
    logTest('Get Notification Options', false, notifOptRes.statusText);
  }

  // ============= TEST 10: SUMMARY LANGUAGE (PHASE 2) =============
  console.log('\n═══════════════════════════════════════');
  console.log('TEST 10: Summary Language (Phase 2)');
  console.log('═══════════════════════════════════════\n');

  const summaryRes = await apiCall('GET', '/user-option/summary/language', null, accessToken);

  if (summaryRes.ok && summaryRes.data?.transcriptionLanguage) {
    logTest(
      'Get Summary Language',
      true,
      `Transcription: ${summaryRes.data.transcriptionLanguage}, Summary: ${summaryRes.data.summaryLanguage}`
    );
  } else {
    logTest('Get Summary Language', false, summaryRes.statusText);
  }

  // ============= TEST 11: BOOKMARKS (PHASE 1) =============
  if (boardId) {
    console.log('\n═══════════════════════════════════════');
    console.log('TEST 11: Bookmarks (Phase 1)');
    console.log('═══════════════════════════════════════\n');

    const bookmarkRes = await apiCall(
      'GET',
      `/boards/${boardId}/bookmarks?page=1&limit=10`,
      null,
      accessToken
    );

    if (bookmarkRes.ok && Array.isArray(bookmarkRes.data?.items)) {
      logTest('Get Bookmarks', true, `Found ${bookmarkRes.data.items.length} bookmarks`);
    } else {
      logTest('Get Bookmarks', false, bookmarkRes.statusText);
    }
  }

  // ============= TEST 12: BOARD SHARING (PHASE 2) =============
  if (boardId) {
    console.log('\n═══════════════════════════════════════');
    console.log('TEST 12: Board Sharing (Phase 2)');
    console.log('═══════════════════════════════════════\n');

    const shareRes = await apiCall('POST', '/boards/share', { boardId, isShared: true }, accessToken);

    if (shareRes.ok && shareRes.data?.shareUrl) {
      logTest('Create Share Link', true, `URL: ${shareRes.data.shareUrl.url}`);
    } else {
      logTest('Create Share Link', false, shareRes.statusText);
    }
  }

  // Print Summary
  printSummary();
}

function printSummary() {
  console.log('\n═══════════════════════════════════════');
  console.log('📊 TEST SUMMARY');
  console.log('═══════════════════════════════════════\n');

  console.log(`✅ Passed: ${results.passed.length}`);
  console.log(`❌ Failed: ${results.failed.length}`);
  console.log(`⏭️  Skipped: ${results.skipped.length}`);
  console.log(`📈 Total: ${results.passed.length + results.failed.length + results.skipped.length}\n`);

  if (results.failed.length > 0) {
    console.log('❌ Failed Tests:');
    results.failed.forEach(({ name, message }) => {
      console.log(`   - ${name}: ${message}`);
    });
  }

  const successRate =
    ((results.passed.length / (results.passed.length + results.failed.length)) * 100).toFixed(1);
  console.log(`\n📈 Success Rate: ${successRate}%\n`);

  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run tests
runTests().catch((error) => {
  console.error('\n❌ Test suite error:', error);
  process.exit(1);
});
