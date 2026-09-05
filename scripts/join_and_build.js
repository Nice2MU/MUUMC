/**
 * Autonomous Construction Launcher for Muumiu.
 * 1. Connects to the active local Minecraft server (127.0.0.1:25565)
 * 2. Greet player Nice2MU in in-game chat
 * 3. Teleports/approaches near player Nice2MU
 * 4. Clears site, places staging supply chest, fulfills BOM in Creative mode
 * 5. Builds 'small_wood_house' layer-by-layer
 * 6. Keeps bot running online in server
 */

const { Vec3 } = require('vec3');
const { botClient } = require('../src/bot/client');
const { structureBuilder, blueprintLoader } = require('../src/builder');
const { logger } = require('../src/bot/logger');

async function main() {
  const bpName = process.argv[2] || 'small_wood_house';
  logger.info(`🚀 Starting Muumiu Construction Runner with blueprint: '${bpName}'...`, 'BuilderRunner');

  await botClient.connect();

  const waitForSpawn = () => new Promise((resolve) => {
    if (botClient.bot?.entity) return resolve();
    const interval = setInterval(() => {
      if (botClient.bot?.entity) {
        clearInterval(interval);
        resolve();
      }
    }, 200);
  });

  await waitForSpawn();
  logger.info('🌍 Muumiu spawned in world successfully!', 'BuilderRunner');
  await new Promise(r => setTimeout(r, 2000));

    // 1. Clean Inventory
    try {
      botClient.bot.chat('/clear');
    } catch (_) {}

    // 2. Teleport to Player Nice2MU
    logger.info('Teleporting near Nice2MU...', 'BuilderRunner');
    try {
      botClient.bot.chat('/tp Nice2MU');
      await new Promise(r => setTimeout(r, 1200));
    } catch (_) {}
    let player = botClient.bot.players['Nice2MU'];

    // 3. Determine Build Origin on Solid Ground
    let origin;
    const botPos = botClient.adapter.getPosition();

    if (player && player.entity) {
      const pPos = player.entity.position;
      logger.info(`📍 Found Nice2MU at (${pPos.x.toFixed(1)}, ${pPos.y.toFixed(1)}, ${pPos.z.toFixed(1)})`, 'BuilderRunner');
      await botClient.adapter.lookAt(pPos).catch(() => {});

      const targetX = Math.floor(pPos.x + 4);
      const targetZ = Math.floor(pPos.z + 4);

      // Raycast down to find true solid ground surface
      let surfaceY = -60;
      for (let y = Math.floor(pPos.y); y >= -64; y--) {
        const b = botClient.adapter.getBlockAt(new Vec3(targetX, y, targetZ));
        if (b && b.name !== 'air' && b.name !== 'cave_air') {
          surfaceY = y + 1;
          break;
        }
      }

      origin = new Vec3(targetX, surfaceY, targetZ);
    } else {
      logger.info(`📍 Building directly in front of bot spawn (${botPos.x.toFixed(1)}, ${botPos.y.toFixed(1)}, ${botPos.z.toFixed(1)})`, 'BuilderRunner');
      const targetX = Math.floor(botPos.x + 3);
      const targetZ = Math.floor(botPos.z + 3);
      let surfaceY = Math.floor(botPos.y);
      for (let y = Math.floor(botPos.y); y >= -64; y--) {
        const b = botClient.adapter.getBlockAt(new Vec3(targetX, y, targetZ));
        if (b && b.name !== 'air' && b.name !== 'cave_air') {
          surfaceY = y + 1;
          break;
        }
      }
      origin = new Vec3(targetX, surfaceY, targetZ);
    }

    // 4. Start Autonomous Construction
    try {
      logger.info(`🏗️ Launching StructureBuilder for '${bpName}' at origin (${origin.x}, ${origin.y}, ${origin.z})...`, 'BuilderRunner');

      const result = await structureBuilder.build(botClient, bpName, {
        coords: origin,
        rotation: 0,
        clearSite: true,
        useStagingChest: true,
        creativeFulfill: true,
      });

      logger.info(`🎉 Construction result: ${JSON.stringify(result)}`, 'BuilderRunner');
      if (botClient.autonomousEngine) {
        botClient.autonomousEngine.stop();
      }
      const p = botClient.bot.players['Nice2MU'];
      if (p && p.entity) {
        await botClient.adapter.lookAt(p.entity.position).catch(() => {});
      }
      logger.info(`🎉 Construction finished: ${result.placedCount} blocks placed.`, 'BuilderRunner');
    } catch (err) {
      logger.error(`❌ Build error encountered: ${err.message}\n${err.stack}`, 'BuilderRunner');
    }

    logger.info('✨ Muumiu remains online and active in server. Press Ctrl+C to disconnect.', 'BuilderRunner');
}

main().catch(err => {
  logger.error(`Fatal launcher error: ${err.message}`, 'BuilderRunner');
  process.exit(1);
});
