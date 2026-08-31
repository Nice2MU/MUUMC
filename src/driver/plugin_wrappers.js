/**
 * Defensive Plugin Wrappers and Fallbacks for Mineflayer Plugins.
 * Wraps pathfinder, pvp, collectBlock, and prismarine-viewer with graceful fallbacks.
 */

const { logger } = require('../bot/logger');

class PluginWrappers {
  static loadPlugins(bot, config) {
    // 1. Load Pathfinder
    try {
      const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
      bot.loadPlugin(pathfinder);
      bot._pathfinderLoaded = true;
      bot._MovementsClass = Movements;
      bot._goals = goals;
      logger.info('📦 mineflayer-pathfinder loaded successfully.', 'PluginWrapper');
    } catch (e) {
      bot._pathfinderLoaded = false;
      logger.warn(`Failed to load mineflayer-pathfinder: ${e.message}`, 'PluginWrapper');
    }

    // 2. Load PvP
    try {
      const { plugin: pvp } = require('mineflayer-pvp');
      bot.loadPlugin(pvp);
      bot._pvpLoaded = true;
      logger.info('📦 mineflayer-pvp loaded successfully.', 'PluginWrapper');
    } catch (e) {
      bot._pvpLoaded = false;
      logger.warn(`Failed to load mineflayer-pvp: ${e.message}`, 'PluginWrapper');
    }

    // 3. Load CollectBlock
    try {
      const { plugin: collectBlock } = require('mineflayer-collectblock');
      bot.loadPlugin(collectBlock);
      bot._collectBlockLoaded = true;
      logger.info('📦 mineflayer-collectblock loaded successfully.', 'PluginWrapper');
    } catch (e) {
      bot._collectBlockLoaded = false;
      logger.warn(`Failed to load mineflayer-collectblock: ${e.message}`, 'PluginWrapper');
    }

    // 4. Load 3D Web Viewer (optional)
    if (config?.viewer?.enabled) {
      bot.once('spawn', () => {
        try {
          const { mineflayer: viewer } = require('prismarine-viewer');
          const port = config.viewer.port || 3007;
          viewer(bot, { port, firstPerson: config.viewer.first_person !== false });
          logger.info(`🌐 Prismarine Web 3D Viewer running at http://127.0.0.1:${port}`, 'Viewer');
        } catch (e) {
          logger.warn(`Failed to start 3D Web Viewer: ${e.message}`, 'Viewer');
        }
      });
    }
  }

  static initMovements(bot, mcData) {
    if (!bot._pathfinderLoaded || !bot._MovementsClass || !mcData) return null;
    try {
      const defaultMove = new bot._MovementsClass(bot, mcData);
      defaultMove.canDig = true;
      defaultMove.allow1by1towers = true;
      defaultMove.scafoldingBlocks = [];
      bot.pathfinder.setMovements(defaultMove);
      return defaultMove;
    } catch (e) {
      logger.error(`Error initializing Movements: ${e.message}`, 'PluginWrapper');
      return null;
    }
  }
}

module.exports = {
  PluginWrappers,
};
