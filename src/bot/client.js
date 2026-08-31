/**
 * Mineflayer Bot Lifecycle & Connection Manager.
 * Orchestrates connection, plugins, reconnection, and subsystem wiring.
 */

const mineflayer = require('mineflayer');
const { logger } = require('./logger');
const { config } = require('../config/loader');
const { RegistryResolver } = require('../driver/registry_resolver');
const { PluginWrappers } = require('../driver/plugin_wrappers');
const { DriverAdapter } = require('../driver/adapter');
const { GameWatchdog } = require('./watchdog');
const { GameStateScanner } = require('./state');
const { SafeDSL } = require('../coder/dsl');
const { AutonomousEngine } = require('./autonomous_engine');

class MinecraftBotClient {
  constructor(customConfig = null) {
    this.config = customConfig || config.minecraft;
    this.bot = null;
    this.resolver = new RegistryResolver(this.config.server.version || '1.20.4');
    this.adapter = null;
    this.watchdog = null;
    this.stateScanner = null;
    this.dsl = null;
    this.autonomousEngine = new AutonomousEngine(this);
    this.isConnected = false;
    this.isSpawned = false;
    this.retryCount = 0;
    this._reconnectTimer = null;
  }

  async connect() {
    if (this.bot) {
      logger.info('Bot instance already exists. Reconnecting...', 'BotClient');
      this.disconnect();
    }

    const srv = this.config.server;
    const botCfg = this.config.bot;

    logger.info(`Connecting bot '${botCfg.username}' to ${srv.host}:${srv.port} (version: ${srv.version || 'auto'})...`, 'BotClient');

    const botOptions = {
      host: srv.host || '127.0.0.1',
      port: srv.port || 25565,
      username: botCfg.username || 'Muumiu',
      auth: srv.auth || 'offline',
      viewDistance: botCfg.view_distance || 'far',
      checkTimeoutInterval: botCfg.check_timeout_interval || 30000,
    };

    if (srv.version) {
      botOptions.version = srv.version;
    }

    try {
      this.bot = mineflayer.createBot(botOptions);
      this._wireSubsystems();
      this._setupEventHandlers();
      return true;
    } catch (e) {
      logger.error(`Failed to create bot: ${e.message}`, 'BotClient');
      this._scheduleReconnect();
      return false;
    }
  }

  _wireSubsystems() {
    this.adapter = new DriverAdapter(this.bot, this.resolver);
    this.watchdog = new GameWatchdog(this.adapter, this.resolver);
    this.stateScanner = new GameStateScanner(this.adapter, this.resolver, this.watchdog);
    this.dsl = new SafeDSL(this.adapter, this.resolver, this.watchdog);
    PluginWrappers.loadPlugins(this.bot, this.config);
  }

  _setupEventHandlers() {
    this.bot.on('error', (err) => {
      logger.warn(`Bot network notice: ${err.message}`, 'BotClient');
    });

    if (this.bot._client) {
      this.bot._client.on('error', (err) => {
        logger.warn(`Protocol notice: ${err.message}`, 'BotClient');
      });
    }

    this.bot.once('inject_allowed', () => {
      if (this.bot.version) {
        this.resolver.setVersion(this.bot.version);
        PluginWrappers.initMovements(this.bot, this.resolver.mcData);
      }
    });

    this.bot.on('login', () => {
      logger.info(`✅ Bot '${this.bot.username}' logged into server successfully!`, 'BotClient');
      this.isConnected = true;
      this.retryCount = 0;
    });

    this.bot.on('spawn', () => {
      logger.info('🌍 Bot spawned into the world.', 'BotClient');
      this.isSpawned = true;
      if (this.bot.physics) {
        this.bot.physics.stepHeight = 1.0; // Step up 1-block heights smoothly like Vanilla Auto-Jump
        this.bot.physics.yawSpeed = 12.0;
        this.bot.physics.pitchSpeed = 12.0;
      }
      if (this.bot.version) {
        this.resolver.setVersion(this.bot.version);
        PluginWrappers.initMovements(this.bot, this.resolver.mcData);
      }
      this.autonomousEngine.start();
    });

    this.bot.on('death', () => {
      logger.warn('💀 Bot died! Waiting for respawn...', 'BotClient');
      this.adapter.stopMovement();
    });

    this.bot.on('kicked', (reason) => {
      const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
      logger.warn(`⚠️ Bot kicked: ${reasonStr}`, 'BotClient');
      this.autonomousEngine.stop();
      this.isConnected = false;
      this.isSpawned = false;
      this._scheduleReconnect();
    });

    this.bot.on('end', () => {
      logger.warn('🔌 Bot disconnected from server.', 'BotClient');
      this.autonomousEngine.stop();
      this.isConnected = false;
      this.isSpawned = false;
      this._scheduleReconnect();
    });

    this.bot.on('error', (err) => {
      logger.error(`Bot error: ${err.message}`, 'BotClient');
    });
  }

  _scheduleReconnect() {
    if (!this.config.auto_reconnect?.enabled) return;
    const maxRetries = this.config.auto_reconnect.max_retries || 10;
    const delay = this.config.auto_reconnect.retry_delay_ms || 5000;

    if (this.retryCount >= maxRetries) {
      logger.error(`Reached maximum reconnection attempts (${maxRetries}).`, 'BotClient');
      return;
    }

    this.retryCount++;
    logger.info(`Scheduling reconnect attempt ${this.retryCount}/${maxRetries} in ${delay / 1000}s...`, 'BotClient');

    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect() {
    this.autonomousEngine.stop();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.bot) {
      try {
        this.adapter.stopMovement();
        this.bot.quit();
      } catch (e) {
        logger.debug(`Error during quit: ${e.message}`, 'BotClient');
      }
      this.bot = null;
    }
    this.isConnected = false;
    this.isSpawned = false;
    logger.info('Bot disconnected and cleaned up.', 'BotClient');
  }

  getServerIdentifier() {
    const srv = this.config.server;
    const host = (srv.host || 'localhost').replace(/[^a-zA-Z0-9.-]/g, '_');
    const port = srv.port || 25565;
    return `${host}_${port}`;
  }
}

// Global Singleton
const botClient = new MinecraftBotClient();

module.exports = {
  MinecraftBotClient,
  botClient,
};
