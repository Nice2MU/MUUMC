/**
 * Skill: sleep_bed
 * Locates nearby bed and sleeps until morning.
 */

const bedTypes = ['white_bed', 'red_bed', 'blue_bed', 'black_bed', 'green_bed', 'yellow_bed'];
const beds = world.findBlocks({ matching: bedTypes, maxDistance: 32, count: 1 });

if (beds.length === 0) {
  dsl.chat('No bed found nearby to sleep in.');
  return { success: false, message: 'No bed nearby' };
}

const bedPos = beds[0];
dsl.chat(`Approaching bed at (${bedPos.x}, ${bedPos.y}, ${bedPos.z})...`);
await dsl.navigate(bedPos.x, bedPos.y, bedPos.z, 1.5);

return { success: true, at_bed: bedPos };
