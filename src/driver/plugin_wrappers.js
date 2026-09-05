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
      defaultMove.canDig = false; // Surface and general travel should navigate cleanly without punching trees or dirt with fists
      defaultMove.allowParkour = true; // Enables jumping 1-block steps and gaps smoothly
      defaultMove.allowSprinting = true; // Enables natural sprint-walking
      defaultMove.allow1by1towers = false; // Do not plan 1x1 scaffolding towers when inventory has no blocks
      defaultMove.canOpenDoors = true; // Enable automatic door opening for seamless house navigation
      defaultMove.maxDropDown = 4;
      defaultMove.dontCreateFlow = true;

      // Mark harmless foliage, flowers, vines, and snow layers as passable empty blocks
      const foliage = [
        'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush',
        'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip',
        'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower',
        'lily_of_the_valley', 'sunflower', 'lilac', 'rose_bush', 'peony',
        'snow', 'sugar_cane', 'hanging_roots', 'spore_blossom', 'glow_lichen',
        'sculk_vein', 'seagrass', 'tall_seagrass', 'kelp', 'pink_petals',
        'bamboo_sapling', 'frogspawn', 'vine'
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
        bot.physics.stepHeight = 0.6; // Vanilla standard 0.6 (prevents server anti-cheat rubberband setbacks)
        bot.physics.yawSpeed = 12.0;
        bot.physics.pitchSpeed = 12.0;
      }

      // Populate scaffolding item IDs (correctly named scafoldingBlocks in mineflayer-pathfinder)
      const scaffoldTypes = [
        'dirt', 'coarse_dirt', 'cobblestone', 'stone', 'cobbled_deepslate', 'deepslate',
        'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks'
      ];
      defaultMove.scafoldingBlocks = [];
      for (const name of scaffoldTypes) {
        const item = mcData.itemsByName[name];
        if (item) {
          defaultMove.scafoldingBlocks.push(item.id);
        }
      }

      bot.pathfinder.setMovements(defaultMove);
      bot.pathfinder.thinkTimeout = 6000;
      bot.pathfinder.searchRadius = 64;

      if (!bot._pathfinderListenersAttached) {
        bot._pathfinderListenersAttached = true;
        bot.on('path_reset', (reason) => {
          logger.info(`🧭 [Pathfinder] Path reset: reason='${reason}'`, 'PluginWrapper');
        });
        bot.on('path_update', (results) => {
          if (results.status !== 'success' && results.status !== 'partial') {
            logger.warn(`🧭 [Pathfinder] Path update: status='${results.status}', len=${results.path?.length || 0}`, 'PluginWrapper');
          }
        });
      }

      PluginWrappers.initAutoJumpAndCornerSlip(bot);
      logger.info('🏃 Optimized Pathfinder Movements initialized (Vanilla safe physics & clean navigation active).', 'PluginWrapper');
      return defaultMove;
    } catch (e) {
      logger.error(`Error initializing Movements: ${e.message}`, 'PluginWrapper');
      return null;
    }
  }

  static initAutoJumpAndCornerSlip(bot) {
    if (bot._autoJumpEngineInstalled) return;
    bot._autoJumpEngineInstalled = true;

    const origSetControlState = bot.setControlState.bind(bot);

    function triggerAutoJump() {
      if (bot._autoJumpLeaping) return;
      bot._autoJumpLeaping = true;
      origSetControlState('jump', true);
      origSetControlState('forward', true);

      setTimeout(() => {
        bot._autoJumpLeaping = false;
        if (bot.entity && !bot.entity.isInWater && !bot.entity.isInLava) {
          origSetControlState('jump', false);
        }
      }, 350);
    }

    bot.on('physicsTick', () => {
      if (!bot.entity || !bot.entity.position) return;

      // 🏊 1. Continuous Water Buoyancy: Hold jump in water so bot always treads water and never sinks/drowns!
      if (bot.entity.isInWater) {
        origSetControlState('jump', true);
      }

      // 🛑 CRITICAL SAFEGUARD: Do NOT interfere when mineflayer-pathfinder is actively navigating!
      // Pathfinder manages its own A* nodes, jumps, and headings. Tampering with yaw/velocity during pathfinding causes stalls.
      if (bot.pathfinder && bot.pathfinder.isMoving()) {
        return;
      }

      // Only assist during manual forward movement (e.g. smartWander or direct player control)
      const isManualMoving = bot.controlState?.forward;
      if (!isManualMoving) {
        return;
      }

      // Check for 1-block step in front
      const yaw = bot.entity.yaw;
      const dirX = -Math.sin(yaw);
      const dirZ = -Math.cos(yaw);

      const frontFeetPos = bot.entity.position.offset(dirX * 0.65, 0, dirZ * 0.65);
      const blockFeet = bot.blockAt(frontFeetPos);
      const blockWaist = bot.blockAt(frontFeetPos.offset(0, 1, 0));
      const blockHead = bot.blockAt(frontFeetPos.offset(0, 2, 0));
      const blockCeiling = bot.blockAt(bot.entity.position.offset(0, 2.1, 0));

      const isFeetSolid = blockFeet && blockFeet.boundingBox === 'block';
      const isWaistClear = !blockWaist || blockWaist.boundingBox === 'empty' || blockWaist.name === 'air';
      const isHeadClear = !blockHead || blockHead.boundingBox === 'empty' || blockHead.name === 'air';
      const isCeilingClear = !blockCeiling || blockCeiling.boundingBox === 'empty' || blockCeiling.name === 'air';

      // 🦘 Auto-Jump for 1-block steps during manual walking
      if (bot.entity.onGround && isFeetSolid && isWaistClear && isHeadClear && isCeilingClear) {
        triggerAutoJump();
      }
    });

    logger.info('🦘 [Auto-Jump Engine] Vanilla Auto-Jump active for manual movement (Zero Pathfinder interference).', 'PluginWrapper');
  }
}

module.exports = {
  PluginWrappers,
};
