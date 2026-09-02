const assert = require('assert');
const { voiceBridgeClient } = require('../src/voice/voice_client');

async function testLiveBridge() {
  console.log('🧪 Testing Live Voice Bridge Client connection to Minecraft Server...');

  voiceBridgeClient.start();

  // Wait up to 3 seconds for connection
  for (let i = 0; i < 30; i++) {
    if (voiceBridgeClient.isConnected) break;
    await new Promise(r => setTimeout(r, 100));
  }

  assert(voiceBridgeClient.isConnected, 'voiceBridgeClient should be connected to live Minecraft server!');
  console.log('✅ LIVE CONNECT SUCCESS: voiceBridgeClient is connected to MuuVoiceBridge (Port 25570)!');

  voiceBridgeClient.stop();
  console.log('🛑 Disconnected cleanly.');
}

testLiveBridge().catch(err => {
  console.error('❌ Live test failed:', err);
  process.exit(1);
});
