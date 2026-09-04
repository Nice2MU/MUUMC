/**
 * Skill: hunt_animal
 * Locates and hunts nearby passive animals (chicken, cow, pig, sheep) for food and drops.
 * Supports batch hunting for sustained focus and gathering enough food in one turn.
 */

const targetName = (args.animal_type || args.target || '').toLowerCase();
const radius = args.radius || 28;
const maxHuntCount = args.count || 2;

let totalHunted = 0;
let totalHits = 0;

await adapter.autoEquipArmor().catch(() => {});
await adapter.equipHighestAttackWeapon().catch(() => {});

for (let i = 0; i < maxHuntCount; i++) {
  let animals = adapter.findAnimals(radius, 6);
  if (targetName) {
    const specific = animals.filter(a => a.name.toLowerCase().includes(targetName));
    if (specific.length > 0) {
      animals = specific;
    } else if (totalHunted === 0) {
      logger.info(`[HuntAnimal] Specific '${targetName}' not found within ${radius}m, falling back to any available animals...`, 'SafeDSL');
    }
  }

  if (animals.length === 0) {
    if (totalHunted > 0) break;
    logger.warn(`[HuntAnimal] No ${targetName || 'animals'} found within ${radius}m.`, 'SafeDSL');
    return { success: false, message: 'No animals found' };
  }

  // Sort by distance
  animals.sort((a, b) => adapter.distanceTo(a.position) - adapter.distanceTo(b.position));
  const target = animals[0];

  logger.info(`🍗 [HuntAnimal] Hunting '${target.name}' (${i + 1}/${maxHuntCount}) at distance ${adapter.distanceTo(target.position).toFixed(1)}m...`, 'SafeDSL');

  // Pursue and hunt target until defeated (up to 6 strikes)
  let hits = 0;
  while (target.isValid && (target.health === undefined || target.health > 0) && hits < 6) {
    const dist = adapter.distanceTo(target.position);
    if (dist > 2.8) {
      const pursueTimeout = Math.max(5000, Math.min(10000, Math.round(dist * 650)));
      await adapter.gotoEntity(target, 2.2, pursueTimeout).catch(() => {});
    }
    if (!target.isValid) break;
    const currentDist = adapter.distanceTo(target.position);
    if (currentDist <= 3.8) {
      await adapter.attackEntity(target);
      hits++;
      totalHits++;
      await new Promise(r => setTimeout(r, 400));
    } else if (currentDist <= 5.5) {
      // Minor sprint adjustment for moving animals
      await adapter.attackEntity(target);
      if (adapter.distanceTo(target.position) <= 3.8) {
        hits++;
        totalHits++;
      }
    } else if (hits === 0) {
      break;
    }
  }

  totalHunted++;
  // Vacuum up the dropped meat and items
  await dsl.collectNearbyDrops(12).catch(() => {});
  await new Promise(r => setTimeout(r, 350));
}

return { success: true, huntedCount: totalHunted, totalHits };
