/**
 * Skill: hunt_animal
 * Locates and hunts nearby passive animals (chicken, cow, pig, sheep) for food and drops.
 */

const targetName = (args.animal_type || args.target || '').toLowerCase();
const radius = args.radius || 20;

let animals = adapter.findAnimals(radius);
if (targetName) {
  animals = animals.filter(a => a.name.toLowerCase().includes(targetName));
}

if (animals.length === 0) {
  logger.warn(`[HuntAnimal] No ${targetName || 'animals'} found within ${radius}m.`, 'SafeDSL');
  return { success: false, message: 'No animals found' };
}

// Sort by distance
animals.sort((a, b) => adapter.distanceTo(a.position) - adapter.distanceTo(b.position));
const target = animals[0];

logger.info(`🍗 [HuntAnimal] Hunting '${target.name}' at distance ${adapter.distanceTo(target.position).toFixed(1)}m...`, 'SafeDSL');
await adapter.autoEquipArmor().catch(() => {});
await adapter.equipHighestAttackWeapon().catch(() => {});
await adapter.attackEntity(target);

// Vacuum up the dropped meat and items
await dsl.collectNearbyDrops(10).catch(() => {});

return { success: true, hunted: target.name };
