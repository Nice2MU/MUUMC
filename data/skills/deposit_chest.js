/**
 * Skill: deposit_chest
 * Deposits surplus blocks, excess mob drops, and duplicate tools into storage chests.
 * Prioritizes HomeBase main chest / categorized chests before falling back to local deploy.
 */

async function deposit_chest(dsl, world, args) {
  const pos = dsl.adapter ? dsl.adapter.getPosition() : bot.entity.position;
  const serverKey = dsl.adapter?.botClient?.getServerIdentifier?.() || null;

  // 0. Pre-emptively clean inventory if free slots are critically low (<= 2)
  const freeSlots = dsl.adapter.countFreeSlots ? dsl.adapter.countFreeSlots() : (dsl.adapter.rawBot?.inventory ? dsl.adapter.rawBot.inventory.emptySlotCount() : 0);
  if (freeSlots <= 2) {
    logger.info(`🧹 Inventory is congested (${freeSlots} free slots). Purging surplus duplicate tools and excess blocks first...`, 'SafeDSL');
    await dsl.cleanInventory();
  }

  // 1. Check if HomeBase has an established main chest
  let targetChest = null;
  const homeBase = dsl.worldMemory ? dsl.worldMemory.getHomeBase(serverKey) : null;

  if (homeBase && homeBase.anchors && homeBase.anchors.main_chest) {
    const mc = homeBase.anchors.main_chest;
    const distToHome = Math.hypot(mc.x - pos.x, mc.z - pos.z);
    if (distToHome <= 64) {
      targetChest = { coords: mc, is_home: true };
      logger.info(`🏡 [DepositChest] Returning to HomeBase main chest at (${mc.x}, ${mc.y}, ${mc.z}) [${Math.round(distToHome)}m away]`, 'SafeDSL');
    }
  }

  // 2. Search known chests in memory or nearby environment
  if (!targetChest) {
    const chests = dsl.worldMemory ? Object.values(dsl.worldMemory.getChests(serverKey)) : [];
    let minDistance = Infinity;

    for (const c of chests) {
      const dist = Math.hypot(c.coords.x - pos.x, c.coords.z - pos.z);
      if (dist < minDistance && dist <= 48) {
        minDistance = dist;
        targetChest = c;
      }
    }
  }

  if (!targetChest) {
    const nearbyChestBlocks = dsl.adapter ? dsl.adapter.findBlocks({ matching: ['chest', 'trapped_chest', 'barrel'], maxDistance: 20, count: 1 }) : [];
    if (nearbyChestBlocks.length > 0) {
      targetChest = { coords: nearbyChestBlocks[0] };
    }
  }

  // 3. If no chest exists within reach, CRAFT & DEPLOY ONE
  if (!targetChest) {
    logger.info('📦 No accessible chest nearby. Auto-crafting & placing a storage chest...', 'SafeDSL');
    
    // Check if bot already holds a chest in inventory
    if (!dsl.adapter.hasItem('chest') && !dsl.adapter.hasItem('trapped_chest') && !dsl.adapter.hasItem('barrel')) {
      const hasTable = dsl.adapter.hasItem('crafting_table') || (dsl.adapter.findBlocks && dsl.adapter.findBlocks({ matching: 'crafting_table', maxDistance: 12, count: 1 }).length > 0);
      const requiredPlanks = hasTable ? 8 : 12;
      const totalPlanks = dsl.adapter.countItem('oak_planks') + dsl.adapter.countItem('birch_planks') + dsl.adapter.countItem('spruce_planks');
      const totalLogs = dsl.adapter.countItem('oak_log') + dsl.adapter.countItem('birch_log') + dsl.adapter.countItem('spruce_log');

      if (totalPlanks + (totalLogs * 4) < requiredPlanks) {
        logger.info(`🪓 Not enough wood for chest (need ${requiredPlanks} planks, have ${totalPlanks + totalLogs * 4}). Chopping trees first...`, 'SafeDSL');
        await dsl.chopTree({ count: 2 }).catch(() => {});
      }

      await dsl.craftItem('chest', 1).catch((err) => {
        logger.warn(`Craft chest attempt notice: ${err?.message}`, 'SafeDSL');
      });
    }

    // Place the chest near feet
    if (dsl.adapter.hasItem('chest') || dsl.adapter.hasItem('trapped_chest') || dsl.adapter.hasItem('barrel')) {
      const spot = dsl.findDeploySpot();
      if (spot && spot.floor) {
        const chestItem = dsl.adapter.hasItem('chest') ? 'chest' : (dsl.adapter.hasItem('barrel') ? 'barrel' : 'trapped_chest');
        if (dsl.adapter.distanceTo(spot.targetPos) < 1.1) {
          await dsl.adapter.moveAway(1.4).catch(() => {});
        }
        await dsl.safePlaceBlock(spot.floor, new Vec3(0, 1, 0), chestItem);
        
        // Verification loop with nearby fallback
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise(r => setTimeout(r, 200));
          const checkBlock = dsl.adapter.getBlockAt(spot.targetPos);
          if (checkBlock && ['chest', 'trapped_chest', 'barrel'].includes(checkBlock.name)) {
            targetChest = { coords: spot.targetPos };
            break;
          }
          const nearbyPlaced = dsl.adapter.findBlocks({ matching: ['chest', 'trapped_chest', 'barrel'], maxDistance: 4, count: 1 });
          if (nearbyPlaced.length > 0) {
            targetChest = { coords: nearbyPlaced[0] };
            break;
          }
        }

        if (targetChest && dsl.worldMemory) {
          dsl.worldMemory.saveChest(serverKey, targetChest.coords, [], 'Base Storage Chest', 'Chest_Blocks');
          dsl.worldMemory.saveLandmark(serverKey, 'BaseChest', targetChest.coords, 'หีบเก็บของหลัก');
        }
      }
    }
  }

  if (!targetChest) {
    logger.warn('Could not find or deploy a chest.', 'SafeDSL');
    return { success: false, error: 'Failed to deploy chest' };
  }

  logger.info(`📦 Approaching storage chest at (${targetChest.coords.x}, ${targetChest.coords.y}, ${targetChest.coords.z})...`, 'SafeDSL');
  await dsl.adapter.goto(targetChest.coords.x, targetChest.coords.y, targetChest.coords.z, 2.2, 10000).catch(() => {});

  let chestBlock = dsl.adapter.getBlockAt(targetChest.coords);
  if (!chestBlock || !['chest', 'trapped_chest', 'barrel'].includes(chestBlock.name)) {
    const nearby = dsl.adapter.findBlocks({ matching: ['chest', 'trapped_chest', 'barrel'], maxDistance: 5, count: 1 });
    if (nearby.length > 0) {
      chestBlock = dsl.adapter.getBlockAt(nearby[0]);
    }
  }

  if (chestBlock) {
    await dsl.depositSurplusToChest(chestBlock);
    return { success: true };
  }
  return { success: false, error: 'Chest block not accessible' };
}

module.exports = deposit_chest;
