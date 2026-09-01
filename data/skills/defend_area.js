/**
 * Skill: defend_area
 * Guards the area against hostile mobs within radius.
 */

const radius = args.radius || 16;
const hostiles = adapter.findHostiles(radius);

if (hostiles.length > 0) {
  hostiles.sort((a, b) => adapter.distanceTo(a.position) - adapter.distanceTo(b.position));
  const target = hostiles[0];

  await adapter.autoEquipArmor().catch(() => {});
  await adapter.equipHighestAttackWeapon().catch(() => {});

  logger.info(`⚔️ [DefendArea] Engaging threat '${target.name}' at distance ${adapter.distanceTo(target.position).toFixed(1)}m...`, 'SafeDSL');
  await adapter.attackEntity(target);
  return { success: true, target_engaged: target.name };
} else {
  logger.info('🛡️ [DefendArea] Area is clear of immediate hostile threats.', 'SafeDSL');
  return { success: true, status: 'clear' };
}
