/**
 * Structure Builder Engine for muu-mc Autonomous Construction.
 * Orchestrates:
 * - Blueprint loading & 3D rotation
 * - Site footprint clearance & foundation leveling
 * - Staging supply chest establishment & Creative fulfillment
 * - Inside-out, bottom-to-top safe multi-face placement
 * - Anti-trapping bot positioning & temporary scaffolding management
 */

const { Vec3 } = require('vec3');
const { logger } = require('../bot/logger');
const { blueprintLoader } = require('./blueprint_loader');
const { sitePreparer } = require('./site_preparer');
const { stagingChestManager } = require('./staging_chest');

class StructureBuilder {
  /**
   * Builds an entire structure from a blueprint or schematic name.
   * @param {Object} botClient - MinecraftBotClient
   * @param {string|Object} blueprintNameOrObj
   * @param {Object} options - { origin, rotation, clearSite, useStagingChest, creativeFulfill }
   */
  async build(botClient, blueprintNameOrObj, options = {}) {
    const adapter = botClient.adapter;
    const dsl = botClient.dsl;
    const bot = botClient.bot;

    if (!adapter || !dsl || !bot) {
      throw new Error('Bot is not fully connected or adapter/dsl is not initialized.');
    }

    if (botClient.autonomousEngine) {
      botClient.autonomousEngine.notifyTaskStarted();
    }

    try {
      // 1. Load & Normalize Blueprint
    let blueprint = typeof blueprintNameOrObj === 'string'
      ? await blueprintLoader.load(blueprintNameOrObj, { version: bot.version || '1.20.4' })
      : blueprintNameOrObj;

    // 2. Rotate Blueprint if specified
    if (options.rotation) {
      blueprint = blueprintLoader.rotate(blueprint, options.rotation);
    }

    // 3. Determine Origin Position
    const botPos = adapter.getPosition();
    let origin;
    if (options.coords) {
      origin = new Vec3(
        Math.floor(options.coords.x),
        Math.floor(options.coords.y),
        Math.floor(options.coords.z)
      );
    } else {
      // Default: 2 blocks in front of bot along current heading
      const forwardDir = adapter.getForwardDirection ? adapter.getForwardDirection() : new Vec3(0, 0, 1);
      origin = new Vec3(
        Math.floor(botPos.x + forwardDir.x * 2),
        Math.floor(botPos.y),
        Math.floor(botPos.z + forwardDir.z * 2)
      );
    }

    const dims = blueprint.dimensions;
    const offset = blueprint.offset || 0;
    logger.info(`🏗️ Starting autonomous construction of '${blueprint.name}' at (${origin.x}, ${origin.y}, ${origin.z}) [${dims.x}x${dims.y}x${dims.z}]...`, 'StructureBuilder');

    // Enable pathfinder to open wooden doors freely and forbid digging house blocks
    if (bot.pathfinder && bot.pathfinder.movements) {
      bot.pathfinder.movements.canOpenDoors = true;
      bot.pathfinder.movements.canDig = false;
    }

    // 4. Setup Staging Supply Chest & Fulfill Materials (Logistics Staging 5 blocks in front of site)
    let stagingChestData = null;
    if (options.useStagingChest !== false) {
      stagingChestData = await stagingChestManager.setupStagingChest(
        bot,
        adapter,
        dsl,
        origin.offset(0, offset, 0),
        dims,
        blueprint.bom,
        {
          creativeFulfill: options.creativeFulfill !== false,
          distance: options.stagingDistance || 5,
        }
      );
    }

    // 5. Site Clearance & Foundation Leveling
    if (options.clearSite !== false) {
      await sitePreparer.clearAndLevelSite(adapter, dsl, origin.offset(0, offset, 0), dims, {
        foundationBlock: options.foundationBlock || 'dirt',
        isCreative: options.creativeFulfill !== false,
      });

      // Clear inventory clutter from site preparation drops (dirt, seeds, stones)
      if (options.creativeFulfill !== false && bot.game?.gameMode === 'creative') {
        try {
          bot.chat('/clear');
          await new Promise(r => setTimeout(r, 200));
        } catch (_) {}
      }
    }

    // 6. Initial Material Withdrawal: Withdraw all required BOM materials from Staging Chest
    if (stagingChestData?.chestBlock) {
      logger.info('📦 Withdrawing initial building materials from staging chest...', 'StructureBuilder');
      await adapter.goto(stagingChestData.chestPos.x, stagingChestData.chestPos.y, stagingChestData.chestPos.z, 2.2, 4000).catch(() => {});
      for (const [matName, count] of Object.entries(blueprint.bom)) {
        if (!matName || matName === 'air') continue;
        const clean = matName.toLowerCase().trim().replace(/^minecraft:/, '');
        await stagingChestManager.withdrawMaterial(bot, adapter, stagingChestData.chestBlock, clean, Math.min(count, 64));
      }
      logger.info('🔨 Materials withdrawn from staging chest. Starting layer construction...', 'StructureBuilder');
    }

    // 7. Layer-by-Layer Construction
    const scaffoldPositions = [];
    let placedCount = 0;
    const levels = blueprint.blocks || [];

    for (let y = 0; y < levels.length; y++) {
      const layer = levels[y];
      logger.info(`🔨 Constructing layer ${y + 1}/${levels.length} (Y = ${origin.y + y + offset})...`, 'StructureBuilder');

      // Sort placements inside layer:
      // Priority 1: Solid structural blocks (planks, stone, logs)
      // Priority 2: Interior furniture (chests, beds, furnaces, tables)
      // Priority 3: Transparent / Attached blocks (glass, doors, torches)
      const tasks = [];
      for (let z = 0; z < layer.length; z++) {
        for (let x = 0; x < layer[z].length; x++) {
          const rawName = layer[z][x];
          const blockName = blueprintLoader.normalizeBlockName(rawName);
          if (!blockName || blockName === 'air') continue;

          let priority = 1;
          if (blockName.includes('chest') || blockName.includes('bed') || blockName.includes('table') || blockName.includes('furnace')) {
            priority = 2;
          } else if (blockName.includes('door') || blockName.includes('torch') || blockName.includes('glass')) {
            priority = 3;
          }

          tasks.push({ x, y, z, blockName, priority });
        }
      }

      tasks.sort((a, b) => a.priority - b.priority);

      // Verify layer materials before building layer
      for (const task of tasks) {
        if (!adapter.hasItem(task.blockName)) {
          if (stagingChestData?.chestBlock) {
            await stagingChestManager.withdrawMaterial(bot, adapter, stagingChestData.chestBlock, task.blockName, 32);
          }
        }
      }

      for (const task of tasks) {
        const targetPos = origin.offset(task.x, task.y + offset, task.z);
        const currentBlock = adapter.getBlockAt(targetPos);

        // Already correct block?
        if (currentBlock && (currentBlock.name === task.blockName || currentBlock.name.includes(task.blockName))) {
          continue;
        }

        // Dig obstruction if needed
        if (currentBlock && currentBlock.name !== 'air' && currentBlock.name !== 'cave_air') {
          await dsl.safeDigBlock(currentBlock);
        }

        // Material Check & Withdrawal from Staging Chest / Creative Conjure
        await this._ensureMaterialInHand(bot, adapter, stagingChestData?.chestBlock, task.blockName, options.creativeFulfill !== false);

        // Distance & Scaffolding Check
        const currentBotPos = adapter.getPosition();
        const eyeDist = adapter.eyeDistanceTo ? adapter.eyeDistanceTo(targetPos) : adapter.distanceTo(targetPos);
        if (eyeDist > 4.2) {
          // Move closer to comfortable reach (~2.8m, allows time to walk around walls or through doors)
          await adapter.goto(targetPos.x, currentBotPos.y, targetPos.z, 2.8, 8000).catch(() => {});
        }

        // High block reach check (e.g. roof)
        const updatedBotPos = adapter.getPosition();
        if (targetPos.y > updatedBotPos.y + 2.5) {
          const pillarHeight = Math.min(Math.ceil(targetPos.y - updatedBotPos.y - 1), 4);
          if (pillarHeight > 0) {
            const startPillarX = Math.floor(updatedBotPos.x);
            const startPillarY = Math.floor(updatedBotPos.y);
            const startPillarZ = Math.floor(updatedBotPos.z);
            logger.debug(`Elevating scaffolding (+${pillarHeight} blocks) to reach roof level...`, 'StructureBuilder');
            await dsl.pillarUp(pillarHeight, 'dirt');
            for (let i = 0; i < pillarHeight; i++) {
              scaffoldPositions.push(new Vec3(startPillarX, startPillarY + i, startPillarZ));
            }
          }
        }

        // Specialized Bed Placement (handles 2-block extension, wall collision, and inner placement)
        if (task.blockName.includes('bed')) {
          const bedPlaced = await this._placeBedOptimized(bot, adapter, dsl, targetPos, task.blockName);
          if (bedPlaced) {
            placedCount++;
            continue;
          }
        }

        // Placement with Anti-Crowding & Multi-Attempt Repositioning
        let isPlaced = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          // 1. Evacuate placement zone (bed 2-block clearance, door 2-block clearance, head/feet intersection)
          await this._evacuatePlacementZone(bot, adapter, targetPos, task.blockName);

          // 2. Multi-Face Placement Search
          const placementRef = this._findPlacementReference(adapter, targetPos, task.blockName);
          if (placementRef) {
            try {
              await dsl.safePlaceBlock(placementRef.refBlock, placementRef.faceVector, task.blockName);
              await new Promise(r => setTimeout(r, 60));

              // Verify placement in world
              const verifyBlock = adapter.getBlockAt(targetPos);
              if (verifyBlock && (
                verifyBlock.name === task.blockName ||
                verifyBlock.name.includes(task.blockName) ||
                task.blockName.includes(verifyBlock.name) ||
                (task.blockName.includes('door') && verifyBlock.name.includes('door')) ||
                (task.blockName.includes('bed') && verifyBlock.name.includes('bed'))
              )) {
                isPlaced = true;
                placedCount++;
                break;
              } else {
                logger.debug(`⚠️ Placement attempt ${attempt} for '${task.blockName}' at (${targetPos.x}, ${targetPos.y}, ${targetPos.z}) did not appear in world. Repositioning...`, 'StructureBuilder');
              }
            } catch (placeErr) {
              logger.debug(`Placement retry for ${task.blockName}: ${placeErr.message}`, 'StructureBuilder');
            }
          } else {
            // No adjacent block: create temporary scaffolding support below
            const tempGround = adapter.getBlockAt(targetPos.offset(0, -1, 0));
            if (tempGround && tempGround.name === 'air') {
              const deepGround = adapter.getBlockAt(targetPos.offset(0, -2, 0));
              if (deepGround && deepGround.name !== 'air') {
                if (options.creativeFulfill !== false && !adapter.hasItem('dirt')) {
                  await stagingChestManager._conjureCreativeItem(bot, 'dirt', 16);
                }
                await dsl.safePlaceBlock(deepGround, new Vec3(0, 1, 0), 'dirt').catch(() => {});
                const placedGround = adapter.getBlockAt(targetPos.offset(0, -1, 0));
                if (placedGround && placedGround.name !== 'air') {
                  scaffoldPositions.push(targetPos.offset(0, -1, 0));
                  await dsl.safePlaceBlock(placedGround, new Vec3(0, 1, 0), task.blockName).catch(() => {});
                  const verifyScaffold = adapter.getBlockAt(targetPos);
                  if (verifyScaffold && (verifyScaffold.name === task.blockName || verifyScaffold.name.includes(task.blockName))) {
                    isPlaced = true;
                    placedCount++;
                    break;
                  }
                }
              }
            }
          }

          // If attempt failed, step to an alternate vantage point before retrying
          if (!isPlaced && attempt < 3) {
            const currentBot = adapter.getPosition();
            const altX = attempt === 1 ? currentBot.x + 1.6 : currentBot.x - 1.6;
            const altZ = attempt === 1 ? currentBot.z - 1.6 : currentBot.z + 1.6;
            await adapter.goto(altX, currentBot.y, altZ, 0.8, 1500).catch(() => {});
            await new Promise(r => setTimeout(r, 80));
          }
        }
      }
    }

    // 7. Comprehensive Scaffolding & Stray Pillar Cleanup
    logger.info('🧹 Cleaning up temporary construction scaffolding and stray pillars...', 'StructureBuilder');

    // Step down to ground level in front of the house before cleaning up
    if (bot.entity && bot.entity.position.y > origin.y + 1) {
      const safeGround = origin.offset(Math.floor(blueprint.blocks[0][0].length / 2), 0, -2);
      await adapter.goto(safeGround.x, safeGround.y, safeGround.z, 2.5, 6000).catch(() => {});
    }

    // A. Clean tracked scaffolding positions from top to bottom (descending Y)
    scaffoldPositions.sort((a, b) => b.y - a.y);
    for (const pos of scaffoldPositions) {
      if (pos.y >= origin.y) {
        const b = adapter.getBlockAt(pos);
        if (b && (b.name === 'dirt' || b.name === 'scaffolding')) {
          // Double check: Never dig if this position is supposed to be a solid block in the blueprint
          const relX = pos.x - origin.x;
          const relY = pos.y - (origin.y + offset);
          const relZ = pos.z - origin.z;
          const bpBlock = (relY >= 0 && relY < blueprint.blocks.length &&
                           relZ >= 0 && relZ < blueprint.blocks[relY].length &&
                           relX >= 0 && relX < blueprint.blocks[relY][relZ].length)
            ? blueprintLoader.normalizeBlockName(blueprint.blocks[relY][relZ][relX])
            : 'air';

          if (bpBlock === 'air' || bpBlock !== b.name) {
            await dsl.safeDigBlock(b, { skipVacuum: false }).catch(() => {});
          }
        }
      }
    }

    // B. Full-Volume Scan: Clear any stray dirt / scaffolding inside blueprint where air is expected
    for (let y = 0; y < blueprint.blocks.length; y++) {
      for (let z = 0; z < blueprint.blocks[y].length; z++) {
        for (let x = 0; x < blueprint.blocks[y][z].length; x++) {
          const expected = blueprintLoader.normalizeBlockName(blueprint.blocks[y][z][x]);
          if (!expected || expected === 'air') {
            const worldPos = origin.offset(x, y + offset, z);
            const actual = adapter.getBlockAt(worldPos);
            if (actual && (actual.name === 'dirt' || actual.name === 'scaffolding')) {
              logger.info(`🧹 Clearing stray scaffolding '${actual.name}' at (${worldPos.x}, ${worldPos.y}, ${worldPos.z})...`, 'StructureBuilder');
              await dsl.safeDigBlock(actual, { skipVacuum: false }).catch(() => {});
            }
          }
        }
      }
    }

    // 7.5 Blueprint Integrity Inspection & Zero-Hole Patching Pass
    logger.info(`🔍 [StructureBuilder] Inspecting structure integrity for any missing blocks...`, 'StructureBuilder');
    const missingTasks = [];
    for (let y = 0; y < blueprint.blocks.length; y++) {
      for (let z = 0; z < blueprint.blocks[y].length; z++) {
        for (let x = 0; x < blueprint.blocks[y][z].length; x++) {
          const rawName = blueprint.blocks[y][z][x];
          const blockName = blueprintLoader.normalizeBlockName(rawName);
          if (!blockName || blockName === 'air') continue;

          const worldPos = origin.offset(x, y + offset, z);
          const actualBlock = adapter.getBlockAt(worldPos);
          const matches = actualBlock && (
            actualBlock.name === blockName ||
            actualBlock.name.includes(blockName) ||
            blockName.includes(actualBlock.name) ||
            (blockName.includes('door') && actualBlock.name.includes('door')) ||
            (blockName.includes('bed') && actualBlock.name.includes('bed'))
          );

          if (!matches) {
            missingTasks.push({ x, y, z, blockName, worldPos });
          }
        }
      }
    }

    if (missingTasks.length > 0) {
      logger.warn(`🛠️ [StructureBuilder] Detected ${missingTasks.length} missing blocks! Initiating automated zero-hole patching pass...`, 'StructureBuilder');
      for (const patch of missingTasks) {
        if (patch.blockName.includes('bed')) {
          const bedPlaced = await this._placeBedOptimized(bot, adapter, dsl, patch.worldPos, patch.blockName);
          if (bedPlaced) {
            placedCount++;
            logger.info(`🩹 [StructureBuilder] Successfully patched missing bed '${patch.blockName}' at (${patch.worldPos.x}, ${patch.worldPos.y}, ${patch.worldPos.z})`, 'StructureBuilder');
            continue;
          }
        }

        await this._evacuatePlacementZone(bot, adapter, patch.worldPos, patch.blockName);
        await this._ensureMaterialInHand(bot, adapter, stagingChestData?.chestBlock, patch.blockName, options.creativeFulfill !== false);
        const placementRef = this._findPlacementReference(adapter, patch.worldPos, patch.blockName);
        if (placementRef) {
          await dsl.safePlaceBlock(placementRef.refBlock, placementRef.faceVector, patch.blockName).catch(() => {});
          await new Promise(r => setTimeout(r, 60));
          const verify = adapter.getBlockAt(patch.worldPos);
          if (verify && (verify.name === patch.blockName || verify.name.includes(patch.blockName) || (patch.blockName.includes('bed') && verify.name.includes('bed')))) {
            placedCount++;
            logger.info(`🩹 [StructureBuilder] Successfully patched missing block '${patch.blockName}' at (${patch.worldPos.x}, ${patch.worldPos.y}, ${patch.worldPos.z})`, 'StructureBuilder');
          }
        }
      }
    } else {
      logger.info(`✨ [StructureBuilder] Blueprint integrity 100% verified! Zero missing blocks or gaps.`, 'StructureBuilder');
    }

    // 8. Return to front entrance
    const frontEntrance = origin.offset(Math.floor(dims.x / 2), 0, -3);
    await adapter.goto(frontEntrance.x, frontEntrance.y, frontEntrance.z, 2.0, 4000).catch(() => {});

    logger.info(`🎉 Successfully completed autonomous construction of '${blueprint.name}'! (${placedCount} blocks placed)`, 'StructureBuilder');

    return {
      success: true,
      name: blueprint.name,
      origin: { x: origin.x, y: origin.y, z: origin.z },
      placedCount,
      totalBlocks: blueprint.totalBlocks,
      stagingChest: stagingChestData?.chestPos,
    };
    } finally {
      if (botClient.autonomousEngine) {
        botClient.autonomousEngine.notifyTaskCompleted();
      }
    }
  }

  /**
   * Finds a valid solid neighbor block to place against (6-face search).
   * Prioritizes solid blocks and avoids placing torches or blocks on top of interactive containers.
   */
  _findPlacementReference(adapter, targetPos, itemToPlace = null) {
    const faces = [
      { vec: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) }, // Bottom face (place on floor)
      { vec: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) }, // North face
      { vec: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) }, // South face
      { vec: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) }, // West face
      { vec: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) }, // East face
      { vec: new Vec3(0, 1, 0), face: new Vec3(0, -1, 0) }, // Top face (ceiling)
    ];

    const cleanItem = (itemToPlace || '').toLowerCase().replace(/^minecraft:/, '');
    const isTorch = cleanItem.includes('torch');
    const isDoor = cleanItem.includes('door') && !cleanItem.includes('trapdoor');
    const isBed = cleanItem.includes('bed');

    const candidates = [];

    for (const { vec, face } of faces) {
      const neighbor = adapter.getBlockAt(targetPos.plus(vec));
      if (!neighbor || neighbor.name === 'air' || neighbor.name === 'cave_air' || neighbor.name.includes('water') || neighbor.name.includes('lava')) {
        continue;
      }
      const nName = neighbor.name.toLowerCase();

      // Doors and beds must be placed strictly on the top face of the floor block underneath
      if ((isDoor || isBed) && face.y !== 1) {
        continue;
      }

      // Floor underneath door/bed cannot be interactive, glass, or torch
      if ((isDoor || isBed) && (nName.includes('door') || nName.includes('chest') || nName.includes('glass') || nName.includes('torch') || nName.includes('bed'))) {
        continue;
      }

      // Torches cannot stand on chests, beds, doors, glass, or other torches
      if (isTorch && face.y === 1) {
        if (nName.includes('chest') || nName.includes('barrel') || nName.includes('bed') || nName.includes('door') || nName.includes('glass') || nName.includes('torch')) {
          continue;
        }
      }

      // Torches cannot attach sideways to chests, beds, glass, doors, or other torches
      if (isTorch && face.y === 0) {
        if (nName.includes('chest') || nName.includes('barrel') || nName.includes('bed') || nName.includes('door') || nName.includes('glass') || nName.includes('torch')) {
          continue;
        }
      }

      // Score candidates:
      // High score for solid blocks (planks, log, stone, dirt)
      // Low score for interactive containers and furniture
      let score = 10;
      if (nName.includes('chest') || nName.includes('barrel') || nName.includes('bed') || nName.includes('door') || nName.includes('trapdoor') || nName.includes('torch')) {
        score = 1;
      } else if (face.y === 1) {
        score = 20; // Solid floor block
      } else {
        score = 15; // Solid wall block
      }

      candidates.push({ refBlock: neighbor, faceVector: face, score });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.score - a.score);
    return { refBlock: candidates[0].refBlock, faceVector: candidates[0].faceVector };
  }

  /**
   * Ensures the bot has the required block item in inventory, withdrawing from chest or conjuring in creative mode.
   */
  async _ensureMaterialInHand(bot, adapter, chestBlock, itemName, isCreative) {
    if (adapter.hasItem(itemName)) return true;

    // 1. Try to withdraw from staging chest
    if (chestBlock) {
      const withdrawn = await stagingChestManager.withdrawMaterial(bot, adapter, chestBlock, itemName, 32);
      if (withdrawn && adapter.hasItem(itemName)) return true;
    }

    // 2. If in creative mode, conjure directly
    if (isCreative) {
      return await stagingChestManager._conjureCreativeItem(bot, itemName, 64);
    }

    return false;
  }

  /**
   * Intelligently places a 2-block bed avoiding self-collision, wall clipping, and reaching issues.
   * Handles placement from adjacent interior block facing the wall target, or direct side-placement.
   */
  async _placeBedOptimized(bot, adapter, dsl, targetPos, bedName) {
    logger.info(`🛏️ [StructureBuilder] Initiating specialized bed placement for '${bedName}' at (${targetPos.x}, ${targetPos.y}, ${targetPos.z})...`, 'StructureBuilder');

    // 1. Check if bed already placed and verified
    const existing = adapter.getBlockAt(targetPos);
    if (existing && existing.name.includes('bed')) {
      return true;
    }

    // Ensure bed is in hand
    await adapter.equipItem(bedName, 'hand').catch(() => {});

    // Cardinal directions: North, South, West, East
    const directions = [
      { name: 'South', wallCheck: { x: 0, z: 1 }, inner: { x: 0, z: -1 }, stand: { x: 0, z: -2 } },
      { name: 'North', wallCheck: { x: 0, z: -1 }, inner: { x: 0, z: 1 }, stand: { x: 0, z: 2 } },
      { name: 'East',  wallCheck: { x: 1, z: 0 }, inner: { x: -1, z: 0 }, stand: { x: -2, z: 0 } },
      { name: 'West',  wallCheck: { x: -1, z: 0 }, inner: { x: 1, z: 0 }, stand: { x: 2, z: 0 } },
    ];

    // Check if targetPos is backed by a wall / obstacle
    for (const dir of directions) {
      const wallPos = targetPos.offset(dir.wallCheck.x, 0, dir.wallCheck.z);
      const wallBlock = adapter.getBlockAt(wallPos);
      const isWall = wallBlock && wallBlock.name !== 'air' && !wallBlock.name.includes('bed') && !wallBlock.name.includes('water');

      if (isWall) {
        // Method 1: Place from the inner room block towards the wall
        // Inner position where bed foot will sit
        const innerPos = targetPos.offset(dir.inner.x, 0, dir.inner.z);
        const innerFloor = adapter.getBlockAt(innerPos.offset(0, -1, 0));
        const innerAir = adapter.getBlockAt(innerPos);

        const isInnerAir = !innerAir || innerAir.name === 'air' || innerAir.name === 'cave_air';
        const isInnerFloorSolid = innerFloor && innerFloor.name !== 'air' && !innerFloor.name.includes('water') && !innerFloor.name.includes('lava');

        if (isInnerAir && isInnerFloorSolid) {
          // Standing spot inside the room looking towards the wall
          const standPos = targetPos.offset(dir.stand.x, 0, dir.stand.z);
          const standFloor = adapter.getBlockAt(standPos.offset(0, -1, 0));
          const standAir = adapter.getBlockAt(standPos);

          if ((!standAir || standAir.name === 'air') && standFloor && standFloor.name !== 'air') {
            logger.info(`🛏️ [StructureBuilder] Positioning inside room at (${standPos.x}, ${standPos.y}, ${standPos.z}) facing ${dir.name} towards wall...`, 'StructureBuilder');
            await adapter.goto(standPos.x + 0.5, standPos.y, standPos.z + 0.5, 0.6, 2500).catch(() => {});

            // Look directly at inner floor block
            await adapter.lookAt(new Vec3(innerPos.x + 0.5, innerPos.y - 0.2, innerPos.z + 0.5)).catch(() => {});
            if (bot.waitForTicks) await bot.waitForTicks(2).catch(() => {});

            try {
              await adapter.placeBlock(innerFloor, new Vec3(0, 1, 0));
              await new Promise(r => setTimeout(r, 150));

              const checkTarget = adapter.getBlockAt(targetPos);
              if (checkTarget && checkTarget.name.includes('bed')) {
                logger.info(`🎉 [StructureBuilder] Bed successfully placed spanning (${innerPos.x}, ${innerPos.y}, ${innerPos.z}) to (${targetPos.x}, ${targetPos.y}, ${targetPos.z})!`, 'StructureBuilder');
                return true;
              }
            } catch (err) {
              logger.debug(`Method 1 bed placement notice: ${err.message}`, 'StructureBuilder');
            }
          }
        }
      }
    }

    // Method 2: Direct placement with SafeDSL bed alignment
    const targetFloor = adapter.getBlockAt(targetPos.offset(0, -1, 0));
    if (targetFloor && targetFloor.name !== 'air') {
      try {
        await dsl.safePlaceBlock(targetFloor, new Vec3(0, 1, 0), bedName);
        await new Promise(r => setTimeout(r, 100));
        const checkTarget = adapter.getBlockAt(targetPos);
        if (checkTarget && checkTarget.name.includes('bed')) {
          return true;
        }
      } catch (_) {}
    }

    return false;
  }

  /**
   * Checks if the bot is currently colliding with or crowding the placement volume of a block.
   * Handles standard 1x1 blocks, 2-block tall doors, 2-block long beds, and head/feet intersections.
   */
  _isBotCollidingPlacement(botPos, targetPos, blockName) {
    if (!botPos || !targetPos) return false;
    const cleanName = (blockName || '').toLowerCase();
    const isBed = cleanName.includes('bed');
    const isDoor = cleanName.includes('door') && !cleanName.includes('trapdoor');

    const dx = Math.abs(botPos.x - (targetPos.x + 0.5));
    const dz = Math.abs(botPos.z - (targetPos.z + 0.5));

    // Bed requires modest horizontal clearance (1.25m) so bot stays inside room without intersecting placement volume
    const minXZ = isBed ? 1.25 : (isDoor ? 1.5 : 1.1);

    // Vertical overlap check: bot is 1.8 blocks tall [botPos.y, botPos.y + 1.8]
    // Door is 2 blocks tall [targetPos.y, targetPos.y + 2]
    const maxTargetY = isDoor ? targetPos.y + 2.0 : targetPos.y + 1.0;
    const botTopY = botPos.y + 1.85;
    const botBottomY = botPos.y - 0.05;

    const verticalOverlap = (botBottomY < maxTargetY) && (botTopY > targetPos.y);

    return verticalOverlap && (dx < minXZ) && (dz < minXZ);
  }

  /**
   * Finds a safe, standable position 1.4m - 2.0m away from targetPos where the bot will not obstruct placement.
   */
  _findClearStandingSpot(adapter, targetPos, blockName) {
    const cleanName = (blockName || '').toLowerCase();
    const isBed = cleanName.includes('bed');
    // Radius of 1.4m for beds keeps bot within small 3x3 interior rooms
    const radius = isBed ? 1.4 : 2.0;

    const offsets = [
      { x: radius, z: 0 },
      { x: -radius, z: 0 },
      { x: 0, z: radius },
      { x: 0, z: -radius },
      { x: radius * 0.7, z: radius * 0.7 },
      { x: -radius * 0.7, z: radius * 0.7 },
      { x: radius * 0.7, z: -radius * 0.7 },
      { x: -radius * 0.7, z: -radius * 0.7 },
    ];

    const currentBotPos = adapter.getPosition();
    const candidateSpots = [];

    for (const off of offsets) {
      const spotX = targetPos.x + 0.5 + off.x;
      const spotZ = targetPos.z + 0.5 + off.z;

      for (const yOffset of [0, 1, -1, 2, -2]) {
        const testY = Math.floor(currentBotPos.y) + yOffset;
        const groundBlock = adapter.getBlockAt(new Vec3(Math.floor(spotX), testY - 1, Math.floor(spotZ)));
        const feetBlock = adapter.getBlockAt(new Vec3(Math.floor(spotX), testY, Math.floor(spotZ)));
        const headBlock = adapter.getBlockAt(new Vec3(Math.floor(spotX), testY + 1, Math.floor(spotZ)));

        const isGroundSolid = groundBlock && groundBlock.name !== 'air' && groundBlock.name !== 'cave_air' && !groundBlock.name.includes('lava') && !groundBlock.name.includes('water');
        const isHeadroomClear = feetBlock && (feetBlock.name === 'air' || feetBlock.name === 'cave_air') &&
                                headBlock && (headBlock.name === 'air' || headBlock.name === 'cave_air');

        if (isGroundSolid && isHeadroomClear) {
          const distToBot = Math.hypot(spotX - currentBotPos.x, spotZ - currentBotPos.z);
          candidateSpots.push({ x: spotX, y: testY, z: spotZ, distToBot });
          break;
        }
      }
    }

    if (candidateSpots.length === 0) return null;

    candidateSpots.sort((a, b) => a.distToBot - b.distToBot);
    return candidateSpots[0];
  }

  /**
   * Proactively evacuates the bot outside the block placement zone before placing.
   */
  async _evacuatePlacementZone(bot, adapter, targetPos, blockName) {
    const botPos = adapter.getPosition();
    if (!this._isBotCollidingPlacement(botPos, targetPos, blockName)) {
      return true;
    }

    logger.debug(`🚶 Bot is crowding placement of '${blockName}' at (${targetPos.x}, ${targetPos.y}, ${targetPos.z}). Evacuating placement zone...`, 'StructureBuilder');

    const spot = this._findClearStandingSpot(adapter, targetPos, blockName);
    if (spot) {
      await adapter.goto(spot.x, spot.y, spot.z, 0.6, 2000).catch(() => {});
      await new Promise(r => setTimeout(r, 80));
    } else {
      // Fallback: push away along vector from targetPos to botPos
      const dx = botPos.x - (targetPos.x + 0.5);
      const dz = botPos.z - (targetPos.z + 0.5);
      const len = Math.hypot(dx, dz) || 1;
      const isBed = (blockName || '').toLowerCase().includes('bed');
      const pushDist = isBed ? 2.5 : 2.2;
      const pushX = targetPos.x + 0.5 + (dx / len) * pushDist;
      const pushZ = targetPos.z + 0.5 + (dz / len) * pushDist;
      await adapter.goto(pushX, botPos.y, pushZ, 0.8, 1500).catch(() => {});
      await new Promise(r => setTimeout(r, 80));
    }

    // Physical backup step if bot is still too close
    if (adapter.distanceTo(targetPos) < 1.15 && bot?.setControlState) {
      bot.setControlState('back', true);
      await new Promise(r => setTimeout(r, 200));
      bot.setControlState('back', false);
      await new Promise(r => setTimeout(r, 50));
    }

    return true;
  }
}

const structureBuilder = new StructureBuilder();

module.exports = {
  StructureBuilder,
  structureBuilder,
};
