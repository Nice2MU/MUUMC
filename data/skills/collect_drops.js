/**
 * Skill: collect_drops
 * Finds and collects dropped items within search radius.
 */

const radius = args.radius || 16;
dsl.chat(`Searching for dropped items within ${radius} blocks...`);

let collectedCount = 0;
for (let i = 0; i < 10; i++) {
  const dropped = world.findEntity({ type: 'object', maxDistance: radius }) ||
                  world.findEntity({ name: 'item', maxDistance: radius });

  if (!dropped) break;

  await dsl.navigate(dropped.position.x, dropped.position.y, dropped.position.z, 0.5);
  collectedCount++;
  // Brief pause to allow physical item pickup
  await new Promise(r => setTimeout(r, 250));
}

return { success: true, collected_items_count: collectedCount };
