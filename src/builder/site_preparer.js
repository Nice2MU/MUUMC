/**
 * Construction Site Preparer for muu-mc.
 * Handles:
 * - Footprint Obstruction Clearing (foliage, trees, dirt mounds inside bounding box)
 * - Foundation Leveling (filling holes under building footprint with dirt/stone)
 * - Clean site vacuuming (collecting loose dropped items before building)
 */

const { Vec3 } = require('vec3');
const { logger } = require('../bot/logger');
const { stagingChestManager } = require('./staging_chest');

class SitePreparer {
  /**
   * Clears all non-air blocks within the bounding box and ensures solid foundation under floor.
   * @param {DriverAdapter} adapter
   * @param {SafeDSL} dsl
   * @param {Vec3} origin - Bottom-front-left coordinate
   * @param {Object} dimensions - { x: width, y: height, z: length }
   * @param {Object} options
   */
  async clearAndLevelSite(adapter, dsl, origin, dimensions, options = {}) {
    const { x: width, y: height, z: length } = dimensions;
    const isCreative = options.isCreative === true && adapter.bot?.game?.gameMode === 'creative';

    logger.info(`🚜 Preparing construction site at (${origin.x}, ${origin.y}, ${origin.z}) [${width}x${height}x${length}] (Survival Legitimate)...`, 'SitePreparer');

    let clearedCount = 0;
    let leveledCount = 0;

    // 1. Clear bounding box from top to bottom (y = height - 1 down to 0) to avoid ceiling collapses
    for (let y = height - 1; y >= 0; y--) {
      for (let z = 0; z < length; z++) {
        for (let x = 0; x < width; x++) {
          const targetPos = origin.offset(x, y, z);
          const block = adapter.getBlockAt(targetPos);

          if (!block || block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') {
            continue;
          }

          // Do not break indestructible blocks (bedrock)
          if (block.name === 'bedrock') continue;

          // Let safeDigBlock handle optimal 3D approach and auto-tool equipping

          try {
            const currentBlock = adapter.getBlockAt(targetPos);
            if (currentBlock && currentBlock.name !== 'air') {
              logger.debug(`Clearing obstacle '${currentBlock.name}' at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})`, 'SitePreparer');
              await dsl.safeDigBlock(currentBlock, { autoSwitchTool: true, skipVacuum: true });
              clearedCount++;
            }
          } catch (e) {
            logger.warn(`Notice while clearing block at (${targetPos.x}, ${targetPos.y}, ${targetPos.z}): ${e.message}`, 'SitePreparer');
          }
        }
      }
    }

    // 2. Foundation Leveling (Check layer Y = -1 under the footprint)
    for (let z = 0; z < length; z++) {
      for (let x = 0; x < width; x++) {
        const floorPos = origin.offset(x, -1, z);
        const block = adapter.getBlockAt(floorPos);

        if (!block || block.name === 'air' || block.name === 'cave_air' || block.name.includes('water') || block.name.includes('lava')) {
          // Find adjacent solid block or block below to place against
          const below = adapter.getBlockAt(floorPos.offset(0, -1, 0));
          if (below && below.name !== 'air') {
            const dist = adapter.distanceTo(floorPos);
            if (dist > 3.5) {
              await adapter.goto(floorPos.x, floorPos.y + 1, floorPos.z, 2.0, 3000).catch(() => {});
            }

            try {
              const availableFoundation = adapter.hasItem('dirt') ? 'dirt' : (adapter.hasItem('cobblestone') ? 'cobblestone' : (adapter.hasItem('stone') ? 'stone' : null));
              if (availableFoundation) {
                await dsl.safePlaceBlock(below, new Vec3(0, 1, 0), availableFoundation).catch(() => {});
                leveledCount++;
              }
            } catch (err) {
              logger.debug(`Notice leveling foundation at (${floorPos.x}, ${floorPos.y}, ${floorPos.z}): ${err.message}`, 'SitePreparer');
            }
          }
        }
      }
    }

    // 3. Collect loose drops from clearing
    try {
      await dsl.pickupNearbyItems(12);
    } catch (_) {}

    logger.info(`✅ Construction site ready! Cleared: ${clearedCount} blocks, Leveled: ${leveledCount} foundation blocks.`, 'SitePreparer');

    return {
      success: true,
      clearedCount,
      leveledCount,
    };
  }
}

const sitePreparer = new SitePreparer();

module.exports = {
  SitePreparer,
  sitePreparer,
};
