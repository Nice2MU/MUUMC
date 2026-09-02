/**
 * Test Suite for In-Game Voice Bridge & Voice Manager.
 */

const assert = require('assert');
const { voiceManager } = require('../src/voice/voice_manager');
const { TOOL_DEFINITIONS, MCPToolHandler } = require('../src/mcp/tools');

async function runTests() {
  console.log('🧪 Starting Voice Bridge & Voice Manager Tests...');

  // 1. Verify Tool Definition is present
  const voiceTool = TOOL_DEFINITIONS.find(t => t.name === 'muu_mc_get_recent_voice_chats');
  assert(voiceTool, 'muu_mc_get_recent_voice_chats tool must be registered in TOOL_DEFINITIONS');
  console.log('✅ Test 1 Passed: muu_mc_get_recent_voice_chats is registered in TOOL_DEFINITIONS.');

  // 2. Mock MCP Server notification callback
  let notificationReceived = null;
  const mockMcpServer = {
    notification: (notif) => {
      notificationReceived = notif;
    },
  };
  voiceManager.setMcpServer(mockMcpServer);

  // 3. Dispatch simulated in-game speech utterance
  const mockPayload = {
    type: 'game_voice',
    player: {
      name: 'nice2mu',
      uuid: 'c06b2b54-94c6-43b9-a2a1-5f25725f0e31',
      distance: 3.42,
      world: 'world',
      position: { x: 100.5, y: 64.0, z: -200.2 },
    },
    audio_format: 'wav_16000_s16le',
    audio_base64: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
    duration_sec: 2.5,
    timestamp: Date.now(),
  };

  voiceManager.handleVoiceUtterance(mockPayload);

  // 4. Verify Notification was emitted to MCP Server
  assert(notificationReceived, 'MCP Server must receive notification');
  assert.strictEqual(notificationReceived.method, 'notifications/game_voice');
  assert.strictEqual(notificationReceived.params.player.name, 'nice2mu');
  assert.strictEqual(notificationReceived.params.player.distance, 3.42);
  console.log('✅ Test 2 Passed: VoiceManager dispatched notifications/game_voice to MCP Server.');

  // 5. Verify Tool Execution retrieves recent events
  const result = await MCPToolHandler.handleToolCall('muu_mc_get_recent_voice_chats', { limit: 5 });
  assert.strictEqual(result.status, 'success');
  assert.strictEqual(result.total_events, 1);
  assert.strictEqual(result.voice_chats[0].player_name, 'nice2mu');
  console.log('✅ Test 3 Passed: muu_mc_get_recent_voice_chats returned stored voice event successfully.');

  console.log('🎉 ALL VOICE BRIDGE UNIT TESTS PASSED (100%)!');
}

runTests().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
