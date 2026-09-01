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

await dsl.navigate(x, y, z, 1.5).catch(() => {});
const block = dsl.adapter.getBlockAt(targetPos);
if (block && block.name !== 'air' && block.name !== 'cave_air') {
  await dsl.safeDigBlock(block);
  logger.info(`💎 [Victory] Successfully mined remembered diamond block '${block.name}' at (${x}, ${y}, ${z})!`, 'SafeDSL');
}
if (dsl.worldMemory) {
  dsl.worldMemory.removeDiscoveredOre(null, targetPos);
}
return { success: true };
