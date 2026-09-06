/**
 * Skill: establish_base
 * Scouts a flat, safe surface plot 24-64 blocks away from Master Nice2MU's house/location,
 * establishes HomeBase, deploys core camp anchors (crafting table, main chest, furnace, bed, perimeter torches),
 * and registers them into worldMemory.
 */

async function establish_base(dsl, world, args) {
  const targetMaster = args?.target_master || 'Nice2MU';
  const minDistance = args?.min_distance || 24;
  const maxDistance = args?.max_distance || 64;
  const serverKey = dsl.adapter?.botClient?.getServerIdentifier?.() || null;
  const rawBot = dsl.adapter?.rawBot;

// 1. Locate Master Player Nice2MU or MasterHouse Landmark
let masterPos = null;
if (rawBot && rawBot.players) {
  for (const name of Object.keys(rawBot.players)) {
    if (name.toLowerCase() === targetMaster.toLowerCase() || name.toLowerCase().includes('nice2mu')) {
      const p = rawBot.players[name];
      if (p && p.entity && p.entity.position) {
        masterPos = p.entity.position.clone();
        logger.info(`👑 [EstablishBase] Master '${targetMaster}' detected at (${Math.round(masterPos.x)}, ${Math.round(masterPos.y)}, ${Math.round(masterPos.z)})`, 'SafeDSL');
        if (dsl.worldMemory) {
          dsl.worldMemory.setMasterHouse(serverKey, masterPos, `บ้านคุณ ${targetMaster}`);
        }
        break;
      }
    }
  }
}

if (!masterPos && dsl.worldMemory) {
  const masterHouse = dsl.worldMemory.getMasterHouse(serverKey);
  if (masterHouse && masterHouse.coords) {
    masterPos = new Vec3(masterHouse.coords.x, masterHouse.coords.y, masterHouse.coords.z);
    logger.info(`📍 [EstablishBase] Using remembered MasterHouse at (${masterPos.x}, ${masterPos.y}, ${masterPos.z})`, 'SafeDSL');
  }
}

// Fallback to bot current position if master not found anywhere
const botPos = dsl.adapter.getPosition();
if (!masterPos) {
  masterPos = botPos.clone();
  logger.info(`ℹ️ [EstablishBase] Master player not found in world. Using current position as neighborhood anchor.`, 'SafeDSL');
}

// 2. Check if HomeBase is already established in memory
const existingHomeBase = dsl.worldMemory ? dsl.worldMemory.getHomeBase(serverKey) : null;
let homePos = null;

if (existingHomeBase && existingHomeBase.coords) {
  const distToMaster = Math.hypot(existingHomeBase.coords.x - masterPos.x, existingHomeBase.coords.z - masterPos.z);
  if (distToMaster >= minDistance && distToMaster <= maxDistance * 1.5) {
    homePos = new Vec3(existingHomeBase.coords.x, existingHomeBase.coords.y, existingHomeBase.coords.z);
    logger.info(`🏡 [EstablishBase] Existing HomeBase verified at (${homePos.x}, ${homePos.y}, ${homePos.z}) [${Math.round(distToMaster)}m from Master]`, 'SafeDSL');
  }
}

// 3. Scout a new 24-64m neighbor plot if HomeBase doesn't exist yet
if (!homePos) {
  logger.info(`🔍 [EstablishBase] Scouting suitable flat plot ${minDistance}-${maxDistance}m from Master...`, 'SafeDSL');
  
  // Test 8 radial directions at ~32m distance
  const targetDist = 32;
  const angles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (5 * Math.PI) / 4, (3 * Math.PI) / 2, (7 * Math.PI) / 4];
  let bestSpot = null;
  let bestScore = -Infinity;

  for (const theta of angles) {
    const candidateX = Math.floor(masterPos.x + Math.cos(theta) * targetDist);
    const candidateZ = Math.floor(masterPos.z + Math.sin(theta) * targetDist);

    // Scan top-down for solid ground
    for (let candidateY = Math.min(Math.floor(masterPos.y) + 10, 100); candidateY >= 62; candidateY--) {
      const block = dsl.adapter.getBlockAt(new Vec3(candidateX, candidateY, candidateZ));
      const above1 = dsl.adapter.getBlockAt(new Vec3(candidateX, candidateY + 1, candidateZ));
      const above2 = dsl.adapter.getBlockAt(new Vec3(candidateX, candidateY + 2, candidateZ));

      if (block && block.boundingBox === 'block' && block.name !== 'leaves' && block.name !== 'water' && block.name !== 'lava') {
        const isHeadroomClear = above1 && (above1.name === 'air' || above1.name === 'grass' || above1.name === 'fern' || above1.name === 'flower') &&
                                above2 && above2.name === 'air';
        if (isHeadroomClear) {
          // Flatness check: check 4 neighbors
          let flatCount = 0;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nb = dsl.adapter.getBlockAt(new Vec3(candidateX + dx, candidateY, candidateZ + dz));
            if (nb && nb.boundingBox === 'block') flatCount++;
          }

          const score = (flatCount * 10) - Math.abs(candidateY - masterPos.y);
          if (score > bestScore) {
            bestScore = score;
            bestSpot = new Vec3(candidateX, candidateY + 1, candidateZ);
          }
          break;
        }
      }
    }
  }

  if (bestSpot) {
    homePos = bestSpot;
  } else {
    // Direct offset fallback
    homePos = new Vec3(Math.floor(masterPos.x + 28), Math.floor(masterPos.y), Math.floor(masterPos.z + 12));
  }
}

logger.info(`🎯 [EstablishBase] Selected HomeBase Plot at (${homePos.x}, ${homePos.y}, ${homePos.z}) [${Math.round(Math.hypot(homePos.x - masterPos.x, homePos.z - masterPos.z))}m from Master]`, 'SafeDSL');

// 4. Navigate safely to HomeBase
await dsl.adapter.goto(homePos.x, homePos.y, homePos.z, 1.5, 15000).catch(() => {});

// 5. Clear vegetation at center floor
const centerFloor = homePos.offset(0, -1, 0);
const centerAir = homePos;
const foliage = dsl.adapter.getBlockAt(centerAir);
if (foliage && (foliage.name === 'grass' || foliage.name === 'tall_grass' || foliage.name === 'fern' || foliage.name.includes('flower'))) {
  await dsl.safeDigBlock(foliage).catch(() => {});
}

// 6. Deploy / Place Base Crafting Table
const anchors = {};
let tablePos = homePos.offset(1, 0, 0);
let existingTable = dsl.adapter.findBlocks({ matching: 'crafting_table', maxDistance: 6, count: 1 });
if (existingTable.length > 0) {
  tablePos = existingTable[0];
  anchors.crafting_table = { x: tablePos.x, y: tablePos.y, z: tablePos.z };
} else {
  if (!dsl.adapter.hasItem('crafting_table')) {
    await dsl.craftItem('crafting_table', 1).catch(() => {});
  }
  if (dsl.adapter.hasItem('crafting_table')) {
    const tableFloor = tablePos.offset(0, -1, 0);
    const flBlock = dsl.adapter.getBlockAt(tableFloor);
    if (flBlock && flBlock.boundingBox === 'block') {
      await dsl.safePlaceBlock(flBlock, new Vec3(0, 1, 0), 'crafting_table').catch(() => {});
      anchors.crafting_table = { x: tablePos.x, y: tablePos.y, z: tablePos.z };
    }
  }
}

// 7. Deploy / Place Base Main Storage Chest
let chestPos = homePos.offset(0, 0, 1);
let existingChest = dsl.adapter.findBlocks({ matching: ['chest', 'barrel', 'trapped_chest'], maxDistance: 6, count: 1 });
if (existingChest.length > 0) {
  chestPos = existingChest[0];
  anchors.main_chest = { x: chestPos.x, y: chestPos.y, z: chestPos.z };
} else {
  if (!dsl.adapter.hasItem('chest') && !dsl.adapter.hasItem('barrel')) {
    await dsl.craftItem('chest', 1).catch(() => {});
  }
  if (dsl.adapter.hasItem('chest') || dsl.adapter.hasItem('barrel')) {
    const chestItem = dsl.adapter.hasItem('chest') ? 'chest' : 'barrel';
    const chestFloor = chestPos.offset(0, -1, 0);
    const flBlock = dsl.adapter.getBlockAt(chestFloor);
    if (flBlock && flBlock.boundingBox === 'block') {
      if (dsl.adapter.distanceTo(chestPos) < 1.2) {
        await dsl.adapter.moveAway(1.5).catch(() => {});
      }
      await dsl.safePlaceBlock(flBlock, new Vec3(0, 1, 0), chestItem).catch(() => {});
      anchors.main_chest = { x: chestPos.x, y: chestPos.y, z: chestPos.z };
      if (dsl.worldMemory) {
        dsl.worldMemory.saveChest(serverKey, chestPos, [], 'Base Main Chest', 'Chest_Blocks');
      }
    }
  }
}

// 8. Place Furnace if held or craftable
if (dsl.adapter.hasItem('furnace')) {
  const furnacePos = homePos.offset(-1, 0, 0);
  const furnaceFloor = furnacePos.offset(0, -1, 0);
  const flBlock = dsl.adapter.getBlockAt(furnaceFloor);
  if (flBlock && flBlock.boundingBox === 'block') {
    await dsl.safePlaceBlock(flBlock, new Vec3(0, 1, 0), 'furnace').catch(() => {});
    anchors.furnace = { x: furnacePos.x, y: furnacePos.y, z: furnacePos.z };
  }
}

// 9. Place Bed if held
const bedItem = dsl.adapter.getInventory().find(i => i.name.endsWith('_bed'));
if (bedItem) {
  const bedPos = homePos.offset(0, 0, -1);
  const bedFloor = bedPos.offset(0, -1, 0);
  const flBlock = dsl.adapter.getBlockAt(bedFloor);
  if (flBlock && flBlock.boundingBox === 'block') {
    await dsl.safePlaceBlock(flBlock, new Vec3(0, 1, 0), bedItem.name).catch(() => {});
    anchors.bed = { x: bedPos.x, y: bedPos.y, z: bedPos.z };
  }
}

// 10. Light Perimeter with Torches
if (dsl.adapter.hasItem('torch')) {
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
    const tSpot = homePos.offset(dx, 0, dz);
    const tFloor = tSpot.offset(0, -1, 0);
    const flBlock = dsl.adapter.getBlockAt(tFloor);
    const airBlock = dsl.adapter.getBlockAt(tSpot);
    if (flBlock && flBlock.boundingBox === 'block' && airBlock && airBlock.name === 'air') {
      await dsl.safePlaceBlock(flBlock, new Vec3(0, 1, 0), 'torch').catch(() => {});
    }
  }
}

// 11. Save HomeBase Anchor into WorldMemory
if (dsl.worldMemory) {
  dsl.worldMemory.setHomeBase(serverKey, homePos, anchors, `ฐานปฏิบัติการข้างบ้านคุณ ${targetMaster}`);
  dsl.worldMemory.saveLandmark(serverKey, 'HomeBase', homePos, `ฐานปฏิบัติการหลักข้างบ้านคุณ ${targetMaster}`);
  dsl.worldMemory.recordDiaryEvent(
    serverKey,
    'สถาปนา HomeBase สำเร็จ',
    `มูมิวตั้งฐานทัพที่ (${homePos.x}, ${homePos.y}, ${homePos.z}) ห่างจากบ้านคุณ ${targetMaster} ${Math.round(Math.hypot(homePos.x - masterPos.x, homePos.z - masterPos.z))} บล็อกแล้วค่า! ✨`,
    'love_eye'
  );
}

logger.info(`🏡 [EstablishBase] HomeBase established successfully at (${homePos.x}, ${homePos.y}, ${homePos.z})!`, 'SafeDSL');
  return {
    success: true,
    coords: { x: homePos.x, y: homePos.y, z: homePos.z },
    anchors,
    distance_to_master: Math.round(Math.hypot(homePos.x - masterPos.x, homePos.z - masterPos.z)),
  };
}

module.exports = establish_base;
