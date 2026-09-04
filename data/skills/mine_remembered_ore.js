// Mine Remembered Ore Skill
const { x, y, z } = args;
const targetPos = new Vec3(x, y, z);
logger.info(`💎 Navigating to remembered diamond ore at (${x}, ${y}, ${z})...`, 'SafeDSL');

const currentPos = dsl.adapter ? dsl.adapter.getPosition() : bot.entity.position;
if (currentPos.y > (y + 4)) {
  logger.info(`⛏️ Digging down towards target depth Y=${y}...`, 'SafeDSL');
  await dsl.navigateXZ(x, z, 8, 8000).catch(() => {});
  await dsl.staircaseMineDown(y);
}

await dsl.navigate(x, y, z, 3.2).catch(() => {});
const block = dsl.adapter.getBlockAt(targetPos);
if (block && block.name !== 'air' && block.name !== 'cave_air') {
  const canHarvest = dsl.adapter.canHarvestBlock ? dsl.adapter.canHarvestBlock(block) : true;
  if (!canHarvest) {
    const minTool = dsl.resolver?.getMinimumToolRequired(block.name) || 'iron_pickaxe';
    logger.warn(`🛑 [Skill: mine_remembered_ore] Cannot mine '${block.name}' at (${x}, ${y}, ${z})! Requires '${minTool}'. Current tools cannot drop items. Preserving ore in memory.`, 'SafeDSL');
    if (dsl.adapter?.botClient?.autonomousEngine) {
      dsl.adapter.botClient.autonomousEngine.reportToolTierInsufficient(block.name, minTool);
    }
    return { success: false, reason: `requires_${minTool}` };
  }

  const dug = await dsl.safeDigBlock(block);
  if (dug) {
    logger.info(`💎 [Victory] Successfully mined remembered ore block '${block.name}' at (${x}, ${y}, ${z})!`, 'SafeDSL');
    if (dsl.worldMemory) {
      dsl.worldMemory.removeDiscoveredOre(null, targetPos);
    }
    return { success: true };
  }
  return { success: false };
}
return { success: false, reason: 'block_not_found' };
