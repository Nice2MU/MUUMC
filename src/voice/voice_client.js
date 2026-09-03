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
    this.bot = null;
    this.isPluginChannelActive = false;
    this._incomingChunks = {};
  }

  attachBot(bot) {
    if (!bot || !bot._client) return;
    this.bot = bot;

    try {
      if (typeof bot._client.registerChannel === 'function') {
        bot._client.registerChannel('muu:voice', null, true);
      }

      // Listen on custom_payload
      bot._client.on('custom_payload', (packet) => {
        if (packet && packet.channel === 'muu:voice') {
          this._handleChannelPacket(packet.data);
        }
      });

      // Also listen on direct channel event if emitted
      bot._client.on('muu:voice', (data) => {
        this._handleChannelPacket(data);
      });

      this.isPluginChannelActive = true;
      logger.info('📡 [VoiceClient] Attached to Minecraft Plugin Channel: "muu:voice" on port 25565 (Zero extra ports needed)!', 'VoiceClient');
    } catch (e) {
      logger.warn(`Error registering muu:voice plugin channel: ${e.message}`, 'VoiceClient');
    }
  }

  detachBot() {
    this.bot = null;
    this.isPluginChannelActive = false;
    this._incomingChunks = {};
  }

  _handleChannelPacket(buf) {
    if (!buf) return;
    try {
      const str = buf.toString('utf8');
      if (str.startsWith('{"type":"chunk"')) {
        const chunk = JSON.parse(str);
        if (!this._incomingChunks[chunk.id]) this._incomingChunks[chunk.id] = [];
        this._incomingChunks[chunk.id][chunk.idx] = chunk.data;

        let receivedCount = 0;
        for (let i = 0; i < chunk.total; i++) {
          if (this._incomingChunks[chunk.id][i] !== undefined) receivedCount++;
        }

        if (receivedCount === chunk.total) {
          const fullJson = this._incomingChunks[chunk.id].join('');
          delete this._incomingChunks[chunk.id];
          const payload = JSON.parse(fullJson);
          if (payload.type === 'game_voice') {
            logger.info(`🎙️ [VoiceClient] Received speech from '${payload.player?.name}' (${payload.duration_sec}s) via native Plugin Channel!`, 'VoiceClient');
            voiceManager.handleVoiceUtterance(payload);
          }
        }
      } else {
        const payload = JSON.parse(str);
        if (payload.type === 'game_voice') {
          logger.info(`🎙️ [VoiceClient] Received speech from '${payload.player?.name}' (${payload.duration_sec}s) via native Plugin Channel!`, 'VoiceClient');
          voiceManager.handleVoiceUtterance(payload);
        }
      }
    } catch (err) {
      logger.warn(`Error handling plugin channel packet: ${err.message}`, 'VoiceClient');
    }
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

        if (!this._isExplicitlyClosed && !this.isPluginChannelActive) {
          logger.warn(
            `⚠️ Disconnected from Voice Bridge (code: ${event.code}, reason: ${event.reason || 'None'}). Reconnecting in 3s...`,
            'VoiceClient'
          );
          this._scheduleReconnect();
        } else if (!this._isExplicitlyClosed) {
          // If plugin channel is active, silently retry without loud warning spam
          this._scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        if (!this.isPluginChannelActive) {
          logger.warn(`Voice Bridge WebSocket connection error: ${err.message || 'Connection refused'}. Will retry...`, 'VoiceClient');
        }
        if (!this.isConnected && !this._isExplicitlyClosed) {
          this._scheduleReconnect();
        }
      };
    } catch (e) {
      if (!this.isPluginChannelActive) {
        logger.error(`Failed to initiate Voice Bridge WebSocket: ${e.message}`, 'VoiceClient');
      }
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this._isExplicitlyClosed) return;
    if (this.reconnectTimer) return; // already scheduled

    const delay = (config.minecraft.voice_bridge && config.minecraft.voice_bridge.reconnect_delay_ms) || 5000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start();
    }, delay);
  }

  sendVoice(audioBase64) {
    // 1. Primary Transport: Native Minecraft Plugin Channel (Port 25565)
    if (this.bot && this.bot._client) {
      try {
        const jsonStr = JSON.stringify({
          type: 'play_voice',
          audio_base64: audioBase64,
          timestamp: Date.now(),
        });
        const utf8Buf = Buffer.from(jsonStr, 'utf8');

        if (utf8Buf.length <= 30000) {
          this.bot._client.write('custom_payload', {
            channel: 'muu:voice',
            data: utf8Buf,
          });
        } else {
          const id = Math.random().toString(36).substring(2, 10);
          const chunkSize = 28000;
          const totalChunks = Math.ceil(jsonStr.length / chunkSize);
          for (let i = 0; i < totalChunks; i++) {
            const chunkData = jsonStr.substring(i * chunkSize, (i + 1) * chunkSize);
            const chunkBuf = Buffer.from(JSON.stringify({
              type: 'chunk',
              id,
              idx: i,
              total: totalChunks,
              data: chunkData,
            }), 'utf8');
            this.bot._client.write('custom_payload', {
              channel: 'muu:voice',
              data: chunkBuf,
            });
          }
        }
        logger.info(`📢 Dispatched ${audioBase64.length} chars TTS voice via native Plugin Channel ('muu:voice' on port 25565)`, 'VoiceClient');
        return true;
      } catch (err) {
        logger.warn(`Error sending via plugin channel: ${err.message}. Falling back to WebSocket...`, 'VoiceClient');
      }
    }

    // 2. Secondary Transport: WebSocket (Port 25570 fallback)
    if (this.ws && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: 'play_voice',
          audio_base64: audioBase64,
          timestamp: Date.now(),
        }));
        logger.info(`📢 Sent ${audioBase64.length} chars of TTS voice audio to in-game Voice Bridge via WebSocket`, 'VoiceClient');
        return true;
      } catch (e) {
        logger.error(`Error sending voice audio to bridge: ${e.message}`, 'VoiceClient');
        return false;
      }
    }

    logger.warn('Cannot send voice: Neither Plugin Channel nor WebSocket is connected', 'VoiceClient');
    return false;
  }

  stop() {
    this._isExplicitlyClosed = true;
    this.detachBot();
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
