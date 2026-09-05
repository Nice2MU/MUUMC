/**
 * Autonomous AI Architecture & Construction Runner for MuumiuLLM
 * Workflow:
 * 1. AI conceptualizes & designs an original 3D blueprint JSON using LLM.
 * 2. Saves blueprint into library and computes Bill of Materials (BOM).
 * 3. Bot logs into Minecraft, finds player Nice2MU, and announces the design.
 * 4. Places Staging Supply Chest 5 blocks in front of the site.
 * 5. Fulfills & visibly stocks all materials into the chest.
 * 6. Clears and levels construction site.
 * 7. Withdraws materials from chest and builds the AI-designed structure layer-by-layer!
 */

const { Vec3 } = require('vec3');
const { config } = require('../src/config/loader');
const { logger } = require('../src/bot/logger');
const { botClient } = require('../src/bot/client');
const { structureBuilder, aiArchitect } = require('../src/builder');

async function main() {
  const themeArg = process.argv.slice(2).join(' ').trim() || null;
  logger.info(`🚀 [AI Architect Runner] Starting autonomous design & build workflow...`, 'BuilderRunner');

  // 1. AI Designs 3D Blueprint
  const designed = await aiArchitect.designBlueprint(themeArg);
  logger.info(`🎨 [AI Architect Runner] Concept finalized: '${designed.name}' - ${designed.description}`, 'BuilderRunner');
  logger.info(`📐 Dimensions: ${designed.dimensions.x}x${designed.dimensions.y}x${designed.dimensions.z}, Total Blocks: ${designed.blueprint.totalBlocks}`, 'BuilderRunner');
  logger.info(`📦 BOM Required: ${JSON.stringify(designed.bom)}`, 'BuilderRunner');

  // 2. Connect Bot to Minecraft Server
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

  // Pause autonomous survival loop so bot focuses 100% on construction
  if (botClient.autonomousEngine) {
    botClient.autonomousEngine.stop();
  }
  botClient.adapter.stopMovement();
  await new Promise(r => setTimeout(r, 1000));

  // Initial Inventory Clearance
  try {
    botClient.bot.chat('/clear');
  } catch (_) {}

  // 3. Teleport near player Nice2MU
  logger.info('Teleporting near Nice2MU...', 'BuilderRunner');
  try {
    botClient.bot.chat('/tp Nice2MU');
    await new Promise(r => setTimeout(r, 1200));
  } catch (_) {}

  const player = botClient.bot.players['Nice2MU'];
  let origin;
  const botPos = botClient.adapter.getPosition();

  if (player && player.entity) {
    const pPos = player.entity.position;
    logger.info(`📍 Found Nice2MU at (${pPos.x.toFixed(1)}, ${pPos.y.toFixed(1)}, ${pPos.z.toFixed(1)})`, 'BuilderRunner');
    await botClient.adapter.lookAt(pPos).catch(() => {});

    const targetX = Math.floor(pPos.x + 4);
    const targetZ = Math.floor(pPos.z + 4);

    // Raycast down to find solid ground
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
    origin = new Vec3(Math.floor(botPos.x + 3), Math.floor(botPos.y), Math.floor(botPos.z + 3));
  }

  // 4. Log AI Design info
  logger.info(`🎨 AI designed blueprint: '${designed.name}' (${designed.description}). Starting staging and construction...`, 'BuilderRunner');

  // 5. Construct AI Structure
  try {
    logger.info(`🏗️ Launching StructureBuilder for AI design '${designed.name}' at origin (${origin.x}, ${origin.y}, ${origin.z})...`, 'BuilderRunner');

    const result = await structureBuilder.build(botClient, designed.name, {
      coords: origin,
      rotation: 0,
      clearSite: true,
      useStagingChest: true,
      stagingDistance: 5,
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

    logger.info(`🎉 Successfully finished building '${designed.name}'. Placed ${result.placedCount} blocks!`, 'BuilderRunner');
  } catch (err) {
    logger.error(`❌ Build error encountered: ${err.message}\n${err.stack}`, 'BuilderRunner');
  }

  logger.info('✨ Muumiu remains online and active in server. Press Ctrl+C to disconnect.', 'BuilderRunner');
}

main().catch(err => {
  logger.error(`Fatal launcher error: ${err.message}`, 'BuilderRunner');
  process.exit(1);
});
