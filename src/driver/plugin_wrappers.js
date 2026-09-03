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
      defaultMove.canDig = true;
      defaultMove.allowParkour = true; // Enables jumping 1-block steps and gaps smoothly
      defaultMove.allowSprinting = true; // Enables natural sprint-walking
      defaultMove.allow1by1towers = false;
      defaultMove.canOpenDoors = true;
      defaultMove.maxDropDown = 4;
      defaultMove.dontCreateFlow = true;

      // Mark harmless foliage & snow layers as passable empty blocks
      const foliage = [
        'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush',
        'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip',
        'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower',
        'lily_of_the_valley', 'sunflower', 'lilac', 'rose_bush', 'peony',
        'snow'
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
        bot.physics.stepHeight = 1.2; // Native 1-block step-assist (seamlessly steps up 1-block dirt, grass, stone)
        bot.physics.yawSpeed = 12.0;
        bot.physics.pitchSpeed = 12.0;
      }
      defaultMove.canDig = true;
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
      PluginWrappers.initAutoJumpAndCornerSlip(bot);
      logger.info('🏃 Optimized Pathfinder Movements initialized (Vanilla safe physics & rich scaffolding active).', 'PluginWrapper');
      return defaultMove;
    } catch (e) {
      logger.error(`Error initializing Movements: ${e.message}`, 'PluginWrapper');
      return null;
    }
  }

  static initAutoJumpAndCornerSlip(bot) {
    if (bot._autoJumpEngineInstalled) return;
    bot._autoJumpEngineInstalled = true;

    // 1. Intercept setControlState to protect Auto-Jump leaps from pathfinder cancellation
    const origSetControlState = bot.setControlState.bind(bot);
    bot.setControlState = (control, state) => {
      if ((control === 'jump' || control === 'forward') && !state && bot._autoJumpLeaping) {
        // Suppress pathfinder cancelling jump or releasing forward key while leap is executing
        return;
      }
      return origSetControlState(control, state);
    };

    let collidedTicks = 0;
    let lastStrafeDir = 'right';

    function triggerAutoJump() {
      if (bot._autoJumpLeaping) return;
      bot._autoJumpLeaping = true;
      bot.jumpQueued = true;
      origSetControlState('jump', true);
      origSetControlState('forward', true);

      // Impart forward horizontal momentum into physics engine so bot doesn't jump straight up and fall back down!
      if (bot.entity && bot.entity.velocity) {
        const yaw = bot.entity.yaw || 0;
        bot.entity.velocity.x = -Math.sin(yaw) * 0.24;
        bot.entity.velocity.z = -Math.cos(yaw) * 0.24;
        if (bot.entity.onGround) {
          bot.entity.velocity.y = 0.42;
        }
      }

      setTimeout(() => {
        bot._autoJumpLeaping = false;
        if (bot.entity && !bot.entity.isInWater && !bot.entity.isInLava) {
          origSetControlState('jump', false);
        }
      }, 300);
    }

    bot.on('physicsTick', () => {
      if (!bot.entity || !bot.entity.position) return;

      // 🏊 1. Continuous Water Buoyancy: Hold jump in water so bot always treads water and never sinks/drowns!
      if (bot.entity.isInWater) {
        origSetControlState('jump', true);
      }

      const isMoving = bot.controlState?.forward || (bot.pathfinder && bot.pathfinder.isMoving());
      if (!isMoving) {
        collidedTicks = 0;
        return;
      }

      // Check for 1-block step in front (Vanilla Auto-Jump)
      const yaw = bot.entity.yaw;
      const dirX = -Math.sin(yaw);
      const dirZ = -Math.cos(yaw);

      // Raycast 0.65m in front at feet, waist (+1), head (+2), and ceiling
      const frontFeetPos = bot.entity.position.offset(dirX * 0.65, 0, dirZ * 0.65);
      const blockFeet = bot.blockAt(frontFeetPos);
      const blockWaist = bot.blockAt(frontFeetPos.offset(0, 1, 0));
      const blockHead = bot.blockAt(frontFeetPos.offset(0, 2, 0));
      const blockCeiling = bot.blockAt(bot.entity.position.offset(0, 2.1, 0));

      const isFeetSolid = blockFeet && blockFeet.boundingBox === 'block';
      const isWaistClear = !blockWaist || blockWaist.boundingBox === 'empty' || blockWaist.name === 'air';
      const isHeadClear = !blockHead || blockHead.boundingBox === 'empty' || blockHead.name === 'air';
      const isCeilingClear = !blockCeiling || blockCeiling.boundingBox === 'empty' || blockCeiling.name === 'air';

      // 🦘 1. PROACTIVE AUTO-JUMP: 1-block step in front with open headroom -> JUMP!
      if (bot.entity.onGround && isFeetSolid && isWaistClear && isHeadClear && isCeilingClear) {
        triggerAutoJump();
        return;
      }

      // 🚧 2. COLLISION HANDLING (If bumping against wall, fence, or corner):
      if (bot.entity.isCollidedHorizontally) {
        collidedTicks++;

        // If bumping against a 1-block obstacle that wasn't raycasted (e.g. diagonal step):
        if (bot.entity.onGround && isWaistClear && isCeilingClear) {
          triggerAutoJump();
          return;
        }

        // Corner Glancing / Edge Slip: Obstacle is taller than 1 block (e.g. wall, tree, building corner)
        if (collidedTicks >= 4 && collidedTicks % 4 === 0) {
          // Check which side has more clearance: left or right
          const leftPos = bot.entity.position.offset(-dirZ * 0.8, 0, dirX * 0.8);
          const rightPos = bot.entity.position.offset(dirZ * 0.8, 0, -dirX * 0.8);
          const blockLeft = bot.blockAt(leftPos);
          const blockRight = bot.blockAt(rightPos);

          const leftClear = !blockLeft || blockLeft.boundingBox === 'empty';
          const rightClear = !blockRight || blockRight.boundingBox === 'empty';

          if (leftClear && !rightClear) {
            lastStrafeDir = 'left';
          } else if (rightClear && !leftClear) {
            lastStrafeDir = 'right';
          } else {
            lastStrafeDir = lastStrafeDir === 'left' ? 'right' : 'left';
          }

          origSetControlState(lastStrafeDir, true);

          // Nudge yaw slightly (~25 degrees / 0.42 rad) to slide off the corner vertex
          const glanceYaw = bot.entity.yaw + (lastStrafeDir === 'left' ? -0.42 : 0.42);
          bot.look(glanceYaw, bot.entity.pitch, true).catch(() => {});
          if (bot.entity && bot.entity.velocity) {
            bot.entity.velocity.x += -Math.sin(glanceYaw) * 0.12;
            bot.entity.velocity.z += -Math.cos(glanceYaw) * 0.12;
          }

          setTimeout(() => {
            if (bot?.controlState) {
              origSetControlState(lastStrafeDir, false);
            }
          }, 180);
        }

        // Deep Corner Hop Evasion (stuck for > 15 ticks / 0.75s)
        if (collidedTicks >= 15) {
          triggerAutoJump();
          const escapeYaw = bot.entity.yaw + (Math.random() < 0.5 ? 0.85 : -0.85);
          bot.look(escapeYaw, 0, true).catch(() => {});
          collidedTicks = 0;
        }
      } else {
        if (collidedTicks > 0) {
          collidedTicks = 0;
          origSetControlState('left', false);
          origSetControlState('right', false);
        }
      }
    });

    logger.info('🦘 [Auto-Jump Engine] Vanilla Auto-Jump & Smart Corner Glancing active on physics ticks.', 'PluginWrapper');
  }
}

module.exports = {
  PluginWrappers,
};
