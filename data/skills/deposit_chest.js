// Deposit Surplus Items into Nearest Chest Skill
const chests = dsl.worldMemory ? Object.values(dsl.worldMemory.getChests()) : [];
const pos = dsl.adapter ? dsl.adapter.getPosition() : bot.entity.position;
let nearestChest = null;
let minDistance = Infinity;

for (const c of chests) {
  const dist = Math.hypot(c.coords.x - pos.x, c.coords.z - pos.z);
  if (dist < minDistance) {
    minDistance = dist;
    nearestChest = c;
  }
}

if (!nearestChest) {
  const nearbyChestBlocks = dsl.adapter ? dsl.adapter.findBlocks({ matching: ['chest', 'trapped_chest', 'barrel'], maxDistance: 16, count: 1 }) : [];
  if (nearbyChestBlocks.length > 0) {
    nearestChest = { coords: nearbyChestBlocks[0] };
  }
}

if (!nearestChest) {
  logger.info('No storage chest found in memory or nearby.', 'SafeDSL');
  return { success: false, error: 'No chest found' };
}

logger.info(`📦 Depositing surplus items into chest at (${nearestChest.coords.x}, ${nearestChest.coords.y}, ${nearestChest.coords.z})...`, 'SafeDSL');
const chestBlock = dsl.adapter.getBlockAt(nearestChest.coords);
if (chestBlock) {
  await dsl.depositSurplusToChest(chestBlock);
  return { success: true };
}
return { success: false, error: 'Chest block not accessible' };
