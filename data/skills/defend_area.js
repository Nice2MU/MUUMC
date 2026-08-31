/**
 * Skill: defend_area
 * Guards the area against hostile mobs within radius.
 */

const radius = args.radius || 16;
dsl.chat(`Scanning area for threats within ${radius} blocks...`);

const hostile = world.findEntity({ type: 'mob', maxDistance: radius });
if (hostile) {
  dsl.chat(`Threat detected: ${hostile.name}. Engaging...`);
  // Navigate close and defend
  await dsl.navigate(hostile.position.x, hostile.position.y, hostile.position.z, 2.5);
  // Attack will be handled by combat logic
  return { success: true, target_engaged: hostile.name };
} else {
  dsl.chat('Area is clear of immediate hostile threats.');
  return { success: true, status: 'clear' };
}
