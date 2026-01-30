#!/usr/bin/env node

/**
 * Debug script for specific tool testing
 * Use this to test individual tools and debug issues
 */

const readline = require('readline');

require('dotenv').config();

const DAGLO_API_BASE = 'https://backend.daglo.ai';
const DAGLO_EMAIL = process.env.DAGLO_EMAIL;
const DAGLO_PASSWORD = process.env.DAGLO_PASSWORD;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

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
  };
}

async function main() {
  console.log('\n🔍 Daglo MCP Debug Script - Individual Tool Testing\n');

  if (!DAGLO_EMAIL || !DAGLO_PASSWORD) {
    console.error('❌ Error: Set DAGLO_EMAIL and DAGLO_PASSWORD environment variables');
    rl.close();
    process.exit(1);
  }

  // Login
  console.log('🔐 Logging in...');
  const loginRes = await apiCall('POST', '/user/login', {
    email: DAGLO_EMAIL,
    password: DAGLO_PASSWORD,
  });

  if (!loginRes.ok || !loginRes.data?.token) {
    console.error('❌ Login failed:', loginRes.statusText);
    rl.close();
    process.exit(1);
  }

  const accessToken = loginRes.data.token;
  const userId = loginRes.data.user?.id;
  console.log(`✅ Logged in as: ${userId}\n`);

  // Get sample board
  console.log('📋 Fetching sample board...');
  const boardsRes = await apiCall('GET', '/boards?page=1&limit=1', null, accessToken);

  if (!boardsRes.ok || !boardsRes.data?.items?.length) {
    console.error('❌ No boards found');
    rl.close();
    process.exit(1);
  }

  const sampleBoard = boardsRes.data.items[0];
  const boardId = sampleBoard.id;
  console.log(`✅ Found board: ${sampleBoard.name} (ID: ${boardId})\n`);

  // Interactive menu
  while (true) {
    console.log('\n═══════════════════════════════════════');
    console.log('🧪 Select a tool to test:');
    console.log('═══════════════════════════════════════\n');
    console.log('1. Get User Profile');
    console.log('2. Update User Profile');
    console.log('3. Get User Email');
    console.log('4. Get Notification Options');
    console.log('5. Update Notification Option');
    console.log('6. Get Summary Language');
    console.log('7. Update Summary Language');
    console.log('8. Get Bookmarks');
    console.log('9. Create Bookmark');
    console.log('10. Get Notifications');
    console.log('11. Get Board Detail');
    console.log('12. Create Share Link');
    console.log('13. Get Shared Board Info');
    console.log('0. Exit\n');

    const choice = await prompt('Enter choice (0-13): ');

    switch (choice.trim()) {
      case '1': {
        console.log('\n🔍 Testing: Get User Profile\n');
        const res = await apiCall('GET', '/user', null, accessToken);
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log('Response:', JSON.stringify(res.data, null, 2));
        break;
      }

      case '2': {
        console.log('\n🔍 Testing: Update User Profile\n');
        const name = await prompt('Enter new name (or skip): ');
        const body = {};
        if (name) body.name = name;

        const res = await apiCall('PATCH', '/user', body, accessToken);
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log('Response:', JSON.stringify(res.data, null, 2));
        break;
      }

      case '3': {
        console.log('\n🔍 Testing: Get User Email\n');
        const res = await apiCall('GET', '/user/email', null, accessToken);
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log('Response:', JSON.stringify(res.data, null, 2));
        break;
      }

      case '4': {
        console.log('\n🔍 Testing: Get Notification Options\n');
        const res = await apiCall('GET', '/user-option/notification', null, accessToken);
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log('Response:', JSON.stringify(res.data, null, 2));
        break;
      }

      case '5': {
        console.log('\n🔍 Testing: Update Notification Option\n');
        const type = await prompt('Type (EMAIL/MOBILE): ');
        const category = await prompt('Category (MARKETING/TRANSCRIPT/LONG_SUMMARY): ');
        const value = (await prompt('Enable (true/false): ')).toLowerCase() === 'true';

        const res = await apiCall(
          'PATCH',
          '/v2/user-option/notification',
          { type, category, value },
          accessToken
        );
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log('Response:', JSON.stringify(res.data, null, 2));
        break;
      }

      case '6': {
        console.log('\n🔍 Testing: Get Summary Language\n');
        const res = await apiCall('GET', '/user-option/summary/language', null, accessToken);
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log('Response:', JSON.stringify(res.data, null, 2));
        break;
      }

      case '7': {
        console.log('\n🔍 Testing: Update Summary Language\n');
        const transcriptionLang = await prompt('Transcription Language (ko-KR/en-US): ');
        const summaryLang = await prompt('Summary Language (ko-KR/en-US): ');

        const res = await apiCall(
          'PATCH',
          '/user-option/summary/language',
          {
            transcriptionLanguage: transcriptionLang,
            summaryLanguage: summaryLang,
          },
          accessToken
        );
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log('Response:', JSON.stringify(res.data, null, 2));
        break;
      }

      case '8': {
        console.log(`\n🔍 Testing: Get Bookmarks (Board: ${boardId})\n`);
        const res = await apiCall(
          'GET',
          `/boards/${boardId}/bookmarks?page=1&limit=10`,
          null,
          accessToken
        );
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log('Response:', JSON.stringify(res.data, null, 2));
        break;
      }

      case '9': {
        console.log(`\n🔍 Testing: Create Bookmark (Board: ${boardId})\n`);
        const title = await prompt('Bookmark title: ');
        const timestamp = await prompt('Timestamp (seconds, optional): ');

        const res = await apiCall(
          'POST',
          `/boards/${boardId}/bookmarks`,
          {
            title,
            timestamp: timestamp ? parseInt(timestamp) : undefined,
          },
          accessToken
        );
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log('Response:', JSON.stringify(res.data, null, 2));
        break;
      }

      case '10': {
        console.log('\n🔍 Testing: Get Notifications\n');
        const res = await apiCall('GET', '/notifications?page=1&limit=10', null, accessToken);
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log('Response:', JSON.stringify(res.data, null, 2));
        break;
      }

      case '11': {
        console.log(`\n🔍 Testing: Get Board Detail (Board: ${boardId})\n`);
        const res = await apiCall('GET', `/boards/${boardId}`, null, accessToken);
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log('Response:', JSON.stringify(res.data, null, 2));
        break;
      }

      case '12': {
        console.log(`\n🔍 Testing: Create Share Link (Board: ${boardId})\n`);
        const res = await apiCall(
          'POST',
          '/boards/share',
          { boardId, isShared: true },
          accessToken
        );
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log('Response:', JSON.stringify(res.data, null, 2));
        break;
      }

      case '13': {
        console.log('\n🔍 Testing: Get Shared Board Info\n');
        const shareId = await prompt('Enter Share ID: ');
        const res = await apiCall('GET', `/shared-board/${shareId}`, null, null);
        console.log(`Status: ${res.status} ${res.statusText}`);
        console.log('Response:', JSON.stringify(res.data, null, 2));
        break;
      }

      case '0': {
        console.log('\n👋 Goodbye!\n');
        rl.close();
        process.exit(0);
      }

      default:
        console.log('❌ Invalid choice. Please try again.');
    }
  }
}

main().catch((error) => {
  console.error('❌ Error:', error);
  rl.close();
  process.exit(1);
});
