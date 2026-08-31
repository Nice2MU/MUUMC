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
          const { getVersion } = require('prismarine-viewer/viewer/lib/version');
          const port = config.viewer.port || 3007;

          // If current version is not in prismarine-viewer's texture map (e.g. snapshot 26.1), fallback to 1.21.4
          if (!getVersion(bot.version)) {
            bot.version = '1.21.4';
          }

          viewer(bot, { port, firstPerson: config.viewer.first_person !== false });
          logger.info(`🌐 Prismarine Web 3D Viewer running at http://127.0.0.1:${port} (Textures: ${bot.version})`, 'Viewer');
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
      defaultMove.canDig = false; // Disable digging while walking to prevent pausing/jittering on harmless grass
      defaultMove.allowParkour = true; // Enables jumping 1-block steps and gaps smoothly
      defaultMove.allowSprinting = true; // Enables natural sprint-walking
      defaultMove.allow1by1towers = false;
      defaultMove.canOpenDoors = true;
      defaultMove.maxDropDown = 4;
      defaultMove.dontCreateFlow = true;

      // Mark harmless foliage as passable empty blocks
      const foliage = [
        'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush',
        'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip',
        'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower',
        'lily_of_the_valley', 'sunflower', 'lilac', 'rose_bush', 'peony'
      ];
      for (const name of foliage) {
        const blk = mcData.blocksByName[name];
        if (blk) {
          defaultMove.emptyBlocks.add(blk.id);
        }
      }

      // Avoid hazardous blocks
      const hazards = ['cactus', 'fire', 'lava', 'magma_block', 'sweet_berry_bush', 'wither_rose'];
      for (const name of hazards) {
        const blk = mcData.blocksByName[name];
        if (blk) {
          defaultMove.blocksToAvoid.add(blk.id);
        }
      }

      if (bot.physics) {
        bot.physics.stepHeight = 0.6; // Vanilla safe step height (prevents server invalid_player_movement kick)
        bot.physics.yawSpeed = 12.0;
        bot.physics.pitchSpeed = 12.0;
      }
      defaultMove.canDigits = true;
      defaultMove.allowParkour = true;
      defaultMove.allow1by1towers = true;

      // Populate rich scaffolding blocks for seamless pillar up / towering
      const scaffoldTypes = [
        'dirt', 'coarse_dirt', 'cobblestone', 'stone', 'cobbled_deepslate', 'deepslate',
        'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks',
        'granite', 'diorite', 'andesite', 'sandstone', 'netherrack', 'gravel'
      ];
      defaultMove.scaffoldingBlocks = [];
      for (const name of scaffoldTypes) {
        const blk = mcData.blocksByName[name];
        if (blk) {
          defaultMove.scaffoldingBlocks.push(blk.id);
        }
      }

      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.thinkTimeout = 5000;
      bot.pathfinder.searchRadius = 64;
      logger.info('🏃 Optimized Pathfinder Movements initialized (Vanilla safe physics & rich scaffolding active).', 'PluginWrapper');
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
