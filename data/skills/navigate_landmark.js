// Navigate to Saved Landmark Skill
const targetName = args.landmark_name || args.name || 'SurfaceSpawn';
const landmarks = dsl.worldMemory ? dsl.worldMemory.getLandmarks() : {};
const target = landmarks[targetName];

if (!target || !target.coords) {
  logger.warn(`Landmark '${targetName}' not found in memory. Available: ${Object.keys(landmarks).join(', ')}`, 'SafeDSL');
  return { success: false, error: `Landmark '${targetName}' not found` };
}

logger.info(`📍 Navigating to landmark '${targetName}' at (${target.coords.x}, ${target.coords.y}, ${target.coords.z})...`, 'SafeDSL');
await dsl.navigate(target.coords.x, target.coords.y, target.coords.z, 2.0, 15000).catch(() => {});
return { success: true, landmark: targetName };
