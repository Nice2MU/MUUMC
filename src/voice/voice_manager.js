/**
 * Voice Manager for in-game Simple Voice Chat events.
 * Manages voice message ring buffer and dispatches MCP notifications to MuumiuLLM (Agent 1).
 */

const { logger } = require('../bot/logger');

class VoiceManager {
  constructor() {
    this.mcpServer = null;
    this.recentVoiceEvents = []; // Ring buffer (max 10)
    this.maxHistory = 10;
  }

  setMcpServer(server) {
    this.mcpServer = server;
  }

  handleVoiceUtterance(data) {
    if (!data || data.type !== 'game_voice') return;

    const player = data.player || {};
    const playerName = player.name || 'Unknown';
    const distance = player.distance != null ? player.distance : 0.0;

    logger.info(
      `🎙️ [VoiceManager] Received in-game voice utterance from '${playerName}' (dist: ${distance.toFixed(1)}m, dur: ${data.duration_sec}s)`,
      'VoiceManager'
    );

    // Capture real-time in-game telemetry so Agent 1 knows exactly what Muumiu is doing
    let gameContext = null;
    try {
      const { botClient } = require('../bot/client');
      if (botClient && botClient.isSpawned && botClient.stateScanner) {
        const currentActivity = botClient.stateScanner.getRealtimeActivity();
        const status = botClient.stateScanner.getBotStatus('summary');
        gameContext = {
          current_goal: currentActivity,
          position: status.position,
          health: status.health,
          food: status.food,
        };
      }
    } catch (err) {
      logger.debug(`Could not collect game context: ${err.message}`, 'VoiceManager');
    }

    const eventRecord = {
      id: 'voice_' + Date.now(),
      player: player,
      game_context: gameContext,
      audio_format: data.audio_format,
      audio_base64: data.audio_base64,
      duration_sec: data.duration_sec,
      timestamp: data.timestamp || Date.now(),
      received_at: new Date().toISOString(),
    };

    // Maintain Ring Buffer
    this.recentVoiceEvents.unshift(eventRecord);
    if (this.recentVoiceEvents.length > this.maxHistory) {
      this.recentVoiceEvents.pop();
    }

    // Forward notification to MuumiuLLM MCP Client (Agent 1)
    if (this.mcpServer && typeof this.mcpServer.notification === 'function') {
      try {
        this.mcpServer.notification({
          method: 'notifications/game_voice',
          params: eventRecord,
        });
        logger.info(
          `📢 [VoiceManager] Forwarded 'notifications/game_voice' to Agent 1 (MuumiuLLM)`,
          'VoiceManager'
        );
      } catch (err) {
        logger.warn(`Failed to dispatch MCP notification: ${err.message}`, 'VoiceManager');
      }
    }
  }

  getRecentEvents(limit = 5) {
    return this.recentVoiceEvents.slice(0, limit);
  }
}

const voiceManager = new VoiceManager();

module.exports = {
  voiceManager,
  VoiceManager,
};
