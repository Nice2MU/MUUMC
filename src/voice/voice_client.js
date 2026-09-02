/**
 * Voice Bridge Client for muu-mc Subsystem.
 * Connects outward to the remote Minecraft server's MuuVoiceBridge WebSocket (Port 25570).
 * Bypasses NAT/firewalls via persistent outbound connection with automatic reconnection.
 */

const { config } = require('../config/loader');
const { logger } = require('../bot/logger');
const { voiceManager } = require('./voice_manager');

class VoiceBridgeClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this._isExplicitlyClosed = false;
  }

  start() {
    const vbConfig = config.minecraft.voice_bridge || {};
    if (vbConfig.enabled === false) {
      logger.info('Voice Bridge is disabled in minecraft.yaml', 'VoiceClient');
      return;
    }

    const host = vbConfig.host || config.minecraft.server.host || '127.0.0.1';
    const port = vbConfig.ws_port || 25570;
    const token = vbConfig.auth_token || '';

    const url = `ws://${host}:${port}/muu-voice?token=${encodeURIComponent(token)}`;

    logger.info(`🔌 Connecting to MuuVoiceBridge at ws://${host}:${port}...`, 'VoiceClient');

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        logger.info(`✅ Connected to in-game Voice Bridge (ws://${host}:${port})!`, 'VoiceClient');

        // Start Heartbeat Ping every 15 seconds
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send('ping');
          }
        }, 15000);
      };

      this.ws.onmessage = (event) => {
        const rawData = event.data;
        if (rawData === 'pong') return;

        try {
          const payload = JSON.parse(rawData);
          if (payload.type === 'auth_success') {
            logger.info(`🔑 Voice Bridge Authentication Verified: ${payload.message}`, 'VoiceClient');
            return;
          }

          if (payload.type === 'game_voice') {
            voiceManager.handleVoiceUtterance(payload);
          }
        } catch (err) {
          logger.warn(`Error parsing voice bridge message: ${err.message}`, 'VoiceClient');
        }
      };

      this.ws.onclose = (event) => {
        this.isConnected = false;
        if (this.pingTimer) clearInterval(this.pingTimer);

        if (!this._isExplicitlyClosed) {
          logger.warn(
            `⚠️ Disconnected from Voice Bridge (code: ${event.code}, reason: ${event.reason || 'None'}). Reconnecting in 3s...`,
            'VoiceClient'
          );
          this._scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        logger.warn(`Voice Bridge WebSocket connection error: ${err.message || 'Connection refused'}. Will retry...`, 'VoiceClient');
        if (!this.isConnected && !this._isExplicitlyClosed) {
          this._scheduleReconnect();
        }
      };
    } catch (e) {
      logger.error(`Failed to initiate Voice Bridge WebSocket: ${e.message}`, 'VoiceClient');
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this._isExplicitlyClosed) return;
    if (this.reconnectTimer) return; // already scheduled

    const delay = (config.minecraft.voice_bridge && config.minecraft.voice_bridge.reconnect_delay_ms) || 3000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, delay);
  }

  sendVoice(audioBase64) {
    if (this.ws && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: 'play_voice',
          audio_base64: audioBase64,
          timestamp: Date.now(),
        }));
        logger.info(`📢 Sent ${audioBase64.length} chars of TTS voice audio to in-game Voice Bridge`, 'VoiceClient');
        return true;
      } catch (e) {
        logger.error(`Error sending voice audio to bridge: ${e.message}`, 'VoiceClient');
        return false;
      }
    }
    logger.warn('Cannot send voice: VoiceBridgeClient is not connected', 'VoiceClient');
    return false;
  }

  stop() {
    this._isExplicitlyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.isConnected = false;
  }
}

const voiceBridgeClient = new VoiceBridgeClient();

module.exports = {
  voiceBridgeClient,
  VoiceBridgeClient,
};
