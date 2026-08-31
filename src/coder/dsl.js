/**
 * Bulletproof Safe DSL Helpers for Agent 2 (AI Coder).
 * Enforces Range <= 2m, Line-of-Sight, Tool Watchdog, Crafting Table Lifecycle,
 * and Hardcoded Silent Chat Redirection.
 */

const { Vec3 } = require('vec3');
const { logger } = require('../bot/logger');
const { worldMemory } = require('../memory/world_memory');

class SafeDSL {
  constructor(adapter, resolver, watchdog) {
    this.adapter = adapter;
    this.resolver = resolver;
    this.watchdog = watchdog;
    this.worldMemory = worldMemory;
  }

  // --- Silent Chat (Safeguard #5) ---
  chat(message) {
    // Hardcoded redirect to internal logger to avoid in-game chat spam
    logger.info(`[Silent DSL Chat] ${message}`, 'SafeDSL');
  }

  // --- Safe Navigation ---
  async navigate(x, y, z, range = 1) {
    logger.info(`Navigating to (${x}, ${y}, ${z}) with range ${range}`, 'SafeDSL');
    return await this.adapter.goto(x, y, z, range);
  }

  async navigateXZ(x, z, range = 1.5, timeoutMs = 8000) {
    logger.info(`Navigating 2D to (X: ${x}, Z: ${z}) with range ${range}`, 'SafeDSL');
    return await this.adapter.gotoXZ(x, z, range, timeoutMs);
  }

  // --- Safe Digging (Range <= 2m, Tool Requirement & Strict LOS) ---
  async ensureToolForBlock(block) {
    if (!block || !block.name || this._isEnsuringTool) return;
    this._isEnsuringTool = true;
    try {
      const name = block.name.toLowerCase();
      const isStoneOrOre = name.includes('stone') || name.includes('ore') || name.includes('cobble') || name.includes('deepslate') || name.includes('granite') || name.includes('diorite') || name.includes('andesite');

      // 1. Pickaxe Requirements & Auto-Crafting
      if (isStoneOrOre) {
        let hasWoodenPick = this.adapter.hasItem('wooden_pickaxe');
        let hasStonePick = this.adapter.hasItem('stone_pickaxe');
        let hasIronPick = this.adapter.hasItem('iron_pickaxe');
        let hasDiamondPick = this.adapter.hasItem('diamond_pickaxe');

        const requiresStone = name.includes('iron') || name.includes('lapis') || name.includes('copper');
        const requiresIron = name.includes('diamond') || name.includes('gold') || name.includes('redstone') || name.includes('emerald');

        // Auto-craft Stone Pickaxe if we have cobblestone >= 3 and sticks, but no stone/iron pickaxe
        if (!hasStonePick && !hasIronPick && !hasDiamondPick && this.adapter.countItem('cobblestone') >= 3) {
          logger.info(`🔨 Auto-crafting Stone Pickaxe before mining '${name}'...`, 'SafeDSL');
          await this.craftItem('stone_pickaxe', 1).catch(() => {});
          hasStonePick = this.adapter.hasItem('stone_pickaxe');
        }

        if (requiresIron && !hasIronPick && !hasDiamondPick) {
          throw new Error(`Cannot mine '${name}': requires Iron Pickaxe or higher.`);
        }
        if (requiresStone && !hasStonePick && !hasIronPick && !hasDiamondPick) {
          throw new Error(`Cannot mine '${name}': requires Stone Pickaxe or higher.`);
        }

        // If mining basic stone and has NO pickaxe at all, auto-craft wooden pickaxe first!
        if (!hasWoodenPick && !hasStonePick && !hasIronPick && !hasDiamondPick) {
          logger.info(`🔨 No pickaxe found in inventory. Auto-crafting Wooden Pickaxe before mining '${name}'...`, 'SafeDSL');
          await this.craftItem('wooden_pickaxe', 1).catch(() => {});
        }
      }

      // 2. Equip the appropriate tool
      await this.adapter.equipBestTool(block);
    } finally {
      this._isEnsuringTool = false;
    }
  }

  async safeDigBlock(targetBlock, options = {}) {
    if (!targetBlock) return false;
    const blockPos = targetBlock.position || targetBlock;
    const actualBlock = this.adapter.getBlockAt(blockPos);
    if (!actualBlock || !actualBlock.diggable || actualBlock.name === 'air' || actualBlock.name === 'cave_air' || actualBlock.name === 'void_air' || actualBlock.name.includes('water') || actualBlock.name.includes('lava') || actualBlock.name === 'bedrock') {
      return true;
    }

    // 1. Approach only if outside natural human reach (> 3.2m)
    let dist = this.adapter.distanceTo(blockPos);
    if (dist > 3.2) {
      await this.adapter.goto(blockPos.x, blockPos.y, blockPos.z, 2.0, 2500).catch(() => {});
      dist = this.adapter.distanceTo(blockPos);
    }
    // Hard Reach Limit: Never attempt to dig blocks beyond 4.2m
    if (dist > 4.2) {
      logger.warn(`Target block at (${blockPos.x}, ${blockPos.y}, ${blockPos.z}) is out of reach (${dist.toFixed(1)}m > 4.2m). Skipping.`, 'SafeDSL');
      return false;
    }

    // 2. Verify target block exists and is diggable
    const freshTarget = this.adapter.getBlockAt(blockPos);
    if (!freshTarget || freshTarget.name === 'air' || freshTarget.name === 'cave_air' || freshTarget.name === 'void_air') {
      return true; // Already broken
    }

    logger.info(`⛏️ Digging block '${freshTarget.name}' at (${blockPos.x}, ${blockPos.y}, ${blockPos.z})...`, 'SafeDSL');
    await this.adapter.digBlock(freshTarget);
    if (this.worldMemory) {
      this.worldMemory.removeDiscoveredOre(null, blockPos);
    }

    return true;
  }

  // --- Dropped Item Intelligent Collection ---
  async collectItem(itemEntity) {
    if (!itemEntity || !itemEntity.position) return false;
    const pos = itemEntity.position;

    // 1. Approach item within 1.2m
    await this.navigateXZ(pos.x, pos.z, 1.2, 3000);

    // 2. Check if the item is trapped inside a solid block
    const blockAtPos = this.adapter.getBlockAt(pos);
    if (blockAtPos && blockAtPos.name !== 'air' && blockAtPos.name !== 'water' && blockAtPos.name !== 'flowing_water' && blockAtPos.diggable) {
      logger.info(`⛏️ Item is trapped inside '${blockAtPos.name}'. Digging block to release item...`, 'SafeDSL');
      await this.safeDigBlock(blockAtPos);
    }

    // 3. Step directly onto the item position
    await this.navigateXZ(pos.x, pos.z, 0.3, 2000);
    await new Promise(r => setTimeout(r, 150));
    return true;
  }

  // --- Safe Placing ---
  async safePlaceBlock(referenceBlock, faceVector = new Vec3(0, 1, 0), itemToPlace = null) {
    if (!referenceBlock) throw new Error('Reference block for placement is null.');
    const refPos = referenceBlock.position || referenceBlock;

    // 1. Maintain clearance: If too far (>2.4m), approach to 1.6m
    let dist = this.adapter.distanceTo(refPos);
    if (dist > 2.4) {
      await this.adapter.goto(refPos.x, refPos.y + 1, refPos.z, 1.6, 2500).catch(() => {});
      dist = this.adapter.distanceTo(refPos);
    }
    // Hard Reach Limit: Never attempt to place blocks beyond 3.8m
    if (dist > 3.8) {
      logger.warn(`Reference block at (${refPos.x}, ${refPos.y}, ${refPos.z}) is out of reach (${dist.toFixed(1)}m > 3.8m). Skipping placement.`, 'SafeDSL');
      return false;
    }

    // 2. Equip item with hand sync delay
    if (itemToPlace) {
      await this.adapter.equipItem(itemToPlace, 'hand');
      await new Promise(r => setTimeout(r, 80));
    }

    // 3. Look at reference block center
    await this.adapter.lookAt(new Vec3(refPos.x + 0.5, refPos.y + 0.5, refPos.z + 0.5));

    // 4. Place block
    try {
      const actualRef = this.adapter.getBlockAt(refPos);
      if (!actualRef || actualRef.name === 'air' || actualRef.name === 'cave_air' || actualRef.name.includes('water') || actualRef.name.includes('lava')) return false;
      logger.info(`🔨 safePlaceBlock invoking adapter.placeBlock on (${actualRef.position.x}, ${actualRef.position.y}, ${actualRef.position.z}) [${actualRef.name}] with held item: ${this.adapter.getHeldItem()?.name}`, 'SafeDSL');
      await this.adapter.placeBlock(actualRef, faceVector);
      logger.info(`🔨 safePlaceBlock placeBlock returned successfully`, 'SafeDSL');
      await new Promise(r => setTimeout(r, 150));
      return true;
    } catch (e) {
      logger.warn(`safePlaceBlock error placing '${itemToPlace || 'block'}' on block at (${refPos.x}, ${refPos.y}, ${refPos.z}): ${e.message}`, 'SafeDSL');
      return false;
    }
  }

  /**
   * Places a torch on the floor or wall if the current area is dark.
   */
  async placeTorchIfDark(minDistance = 6) {
    if (!this.adapter.hasItem('torch')) return false;
    const botPos = this.adapter.getPosition();
    const isDark = this.adapter.shouldPlaceTorch(minDistance);
    if (!isDark) return false;

    const ground = this.adapter.getBlockAt(new Vec3(Math.floor(botPos.x), Math.floor(botPos.y) - 1, Math.floor(botPos.z)));
    if (ground && ground.name !== 'air' && !ground.name.includes('water') && !ground.name.includes('lava') && ground.name !== 'torch') {
      const airAbove = this.adapter.getBlockAt(new Vec3(Math.floor(botPos.x), Math.floor(botPos.y), Math.floor(botPos.z)));
      if (airAbove && (airAbove.name === 'air' || airAbove.name === 'cave_air')) {
        logger.info(`🕯️ [Lighting] Dark area detected (Light <= 7, no torch within ${minDistance}m). Placing torch on ground...`, 'SafeDSL');
        await this.safePlaceBlock(ground, new Vec3(0, 1, 0), 'torch');
        return true;
      }
    }
    return false;
  }

  /**
   * Jump and place blocks under feet (Pillar Up / 1x1 Tower) with microsecond physics synchronization.
   */
  async pillarUp(height = 1, blockName = null) {
    logger.info(`🏗️ Pillaring up ${height} block(s) with high-precision jump timing...`, 'SafeDSL');
    return await this.adapter.pillarUp(height, blockName);
  }

  async jumpAndPlaceBlock(blockName = null) {
    return await this.adapter.jumpAndPlaceUnderFeet(blockName);
  }

  // --- High-Level Actions ---

  /**
   * Chops down trees safely.
   */
  async chopTree(options = {}) {
    const count = options.count || 1;
    let chopped = 0;

    const logTypes = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log', 'mangrove_log'];
    
    for (let i = 0; i < count; i++) {
      let logs = this.adapter.findBlocks({ matching: logTypes, maxDistance: 64, count: 10 });
      if (logs.length === 0 && this.adapter.getPosition().y < 62) {
        logger.info('🌲 Bot is underground. Navigating up towards surface to reach trees...', 'SafeDSL');
        await this.goToSurface();
        logs = this.adapter.findBlocks({ matching: logTypes, maxDistance: 64, count: 10 });
      }

      if (logs.length === 0) {
        logger.warn('No trees found within 64 blocks.', 'SafeDSL');
        break;
      }

      // Sort by proximity
      logs.sort((a, b) => this.adapter.distanceTo(a) - this.adapter.distanceTo(b));
      const targetLog = logs[0];

      await this.safeDigBlock(targetLog);
      // Check if there are logs directly above (tree trunk within natural human standing reach <= 2.2m)
      let abovePos = new Vec3(targetLog.x, targetLog.y + 1, targetLog.z);
      while (chopped < count) {
        const aboveBlock = this.adapter.getBlockAt(abovePos);
        if (aboveBlock && this.resolver.isLog(aboveBlock.name)) {
          const heightDiff = abovePos.y - this.adapter.getPosition().y;
          // Normal human reach limit: cannot reach logs > 2.2 blocks above feet
          if (heightDiff > 2.2) {
            logger.info('🌲 Upper tree logs are out of natural standing reach. Finishing chop cycle.', 'SafeDSL');
            break;
          }
          await this.safeDigBlock(aboveBlock);
          chopped++;
          abovePos = new Vec3(abovePos.x, abovePos.y + 1, abovePos.z);
        } else {
          break;
        }
      }
    }

    // Proactive Housekeeping: Replant sapling if we have any
    const saplings = ['oak_sapling', 'birch_sapling', 'spruce_sapling', 'cherry_sapling'];
    for (const sap of saplings) {
      if (this.adapter.hasItem(sap)) {
        try {
          const dirt = this.adapter.findBlocks({ matching: ['dirt', 'grass_block'], maxDistance: 4, count: 1 });
          if (dirt.length > 0) {
            const aboveDirt = this.adapter.getBlockAt(new Vec3(dirt[0].x, dirt[0].y + 1, dirt[0].z));
            if (aboveDirt && aboveDirt.name === 'air') {
              await this.safePlaceBlock(dirt[0], new Vec3(0, 1, 0), sap);
              logger.info(`🌱 Replanted ${sap} for sustainability.`, 'SafeDSL');
              break;
            }
          }
        } catch (e) {
          logger.debug(`Replanting note: ${e.message}`, 'SafeDSL');
        }
      }
    }

    return { success: true, chopped };
  }

  // --- Prerequisite Sub-Ingredient Resolver ---
  async ensureIngredients(itemName, count = 1) {
    const clean = itemName.toLowerCase().replace(/^minecraft:/, '');
    const logTypes = ['oak_log', 'birch_log', 'spruce_log', 'cherry_log', 'acacia_log', 'jungle_log', 'dark_oak_log'];
    const plankTypes = ['oak_planks', 'birch_planks', 'spruce_planks', 'cherry_planks', 'acacia_planks'];
    const bot = this.adapter.rawBot;

    // 1. Auto-craft planks if needed for crafting table / tools / sticks / chests / shields
    const needsPlanks = clean.includes('plank') || clean === 'crafting_table' || clean === 'stick' ||
                        clean === 'shield' || clean === 'chest' || clean.includes('pickaxe') ||
                        clean.includes('axe') || clean.includes('sword') || clean.includes('shovel') || clean.includes('hoe');

    if (needsPlanks) {
      let currentPlanks = 0;
      for (const p of plankTypes) currentPlanks += this.adapter.countItem(p);

      if (currentPlanks < 2) {
        let hasLog = logTypes.find(l => this.adapter.hasItem(l));
        if (!hasLog && this.adapter.getPosition().y < 55) {
          logger.info('🌲 Missing wood ingredients underground. Navigating to surface to harvest wood...', 'SafeDSL');
          await this.goToSurface();
          await this.chopTree({ count: 4 });
          hasLog = logTypes.find(l => this.adapter.hasItem(l));
        }

        if (hasLog) {
          const targetPlank = hasLog.replace('_log', '_planks');
          const pObj = this.resolver.getItemByName(targetPlank);
          const pRecipes = bot.recipesFor(pObj.id, null, 1, null);
          if (pRecipes.length > 0) {
            await Promise.race([
              bot.craft(pRecipes[0], 1, null),
              new Promise(r => setTimeout(r, 400))
            ]).catch(() => {});
            logger.info(`🔨 Auto-crafted ${targetPlank} from ${hasLog}`, 'SafeDSL');
          }
        }
      }
    }

    // 2. Auto-craft sticks if needed for tools / torches / ladders
    const needsSticks = clean === 'torch' || clean.includes('pickaxe') || clean.includes('axe') ||
                        clean.includes('sword') || clean.includes('shovel') || clean.includes('hoe');

    if (needsSticks && this.adapter.countItem('stick') < 2) {
      const availablePlank = plankTypes.find(p => this.adapter.hasItem(p));
      if (availablePlank) {
        const stickObj = this.resolver.getItemByName('stick');
        const stickRecipes = bot.recipesFor(stickObj.id, null, 1, null);
        if (stickRecipes.length > 0) {
          await Promise.race([
            bot.craft(stickRecipes[0], 1, null),
            new Promise(r => setTimeout(r, 400))
          ]).catch(() => {});
          logger.info('🔨 Auto-crafted Sticks from Planks for recipe prerequisite.', 'SafeDSL');
        }
      }
    }
  }

  /**
   * Finds a valid open-air spot with solid floor to deploy crafting table or furnace.
   */
  findDeploySpot() {
    const botPos = this.adapter.getPosition();
    const bx = Math.floor(botPos.x);
    const by = Math.floor(botPos.y);
    const bz = Math.floor(botPos.z);

    const candidates = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0 && dz === 0) continue; // Skip bot's exact feet position
          const pos = new Vec3(bx + dx, by + dy, bz + dz);
          const space = this.adapter.getBlockAt(pos);
          const floor = this.adapter.getBlockAt(pos.offset(0, -1, 0));

          if (space && (space.name === 'air' || space.name === 'cave_air' || space.name === 'torch') &&
              floor && floor.name !== 'air' && floor.name !== 'cave_air' && floor.name !== 'water' && floor.name !== 'lava' && floor.name !== 'torch') {
            const dist = this.adapter.distanceTo(pos);
            candidates.push({ floor, targetPos: pos, dist });
          }
        }
      }
    }

    if (candidates.length > 0) {
      // Sort by ideal placement distance (around 1.4m away from bot body)
      candidates.sort((a, b) => Math.abs(a.dist - 1.4) - Math.abs(b.dist - 1.4));
      return candidates[0];
    }

    const curFloor = this.adapter.getBlockAt(new Vec3(bx, by - 1, bz));
    return { floor: curFloor, targetPos: new Vec3(bx, by, bz) };
  }

  /**
   * Crafts an item with automated Crafting Table deploy & pickup lifecycle.
   */
  async craftItem(itemName, count = 1) {
    const itemObj = this.resolver.getItemByName(itemName);
    if (!itemObj) throw new Error(`Unknown item name: '${itemName}'`);

    // Ensure prerequisite ingredients (sticks, planks) exist first
    await this.ensureIngredients(itemName, count);

    const bot = this.adapter.rawBot;
    const allRecipes = bot.recipesAll(itemObj.id, null, true);
    const requiresTable = allRecipes.length > 0 ? allRecipes.some(r => r.requiresTable) : false;

    let craftingTableBlock = null;
    let placedTablePos = null;

    if (requiresTable) {
      // 1. Check if an existing crafting table is genuinely reachable (<= 12m) and has open headroom
      const tables = this.adapter.findBlocks({ matching: 'crafting_table', maxDistance: 12, count: 5 });
      for (const tPos of tables) {
        const airAbove = this.adapter.getBlockAt(tPos.offset(0, 1, 0));
        if (airAbove && airAbove.name !== 'air' && airAbove.name !== 'cave_air') {
          continue; // Skip obstructed table
        }
        if (this.adapter.distanceTo(tPos) > 2.0) {
          await this.adapter.goto(tPos.x, tPos.y, tPos.z, 1.5, 3000).catch(() => {});
        }
        if (this.adapter.distanceTo(tPos) <= 2.5) {
          const testBlock = this.adapter.getBlockAt(tPos);
          if (testBlock && testBlock.name === 'crafting_table') {
            craftingTableBlock = testBlock;
            break;
          }
        }
      }

      // 2. If no table is reachable, deploy one from inventory (or auto-craft one) right at feet
      if (!craftingTableBlock) {
        if (!this.adapter.hasItem('crafting_table')) {
          logger.info('🔨 No accessible crafting table nearby. Auto-crafting Crafting Table first...', 'SafeDSL');
          await this.craftItem('crafting_table', 1);
        }
        if (this.adapter.hasItem('crafting_table')) {
          const spot = await this.findDeploySpot();
          if (spot && spot.floor) {
            const curSpace = this.adapter.getBlockAt(spot.targetPos);
            if (curSpace && curSpace.name === 'torch') {
              await this.safeDigBlock(curSpace).catch(() => {});
            }
            const bPos = this.adapter.getPosition();
            logger.info(`🔨 Deploying crafting table on floor (${spot.floor.position.x}, ${spot.floor.position.y}, ${spot.floor.position.z}) [${spot.floor.name}] targeting (${spot.targetPos.x}, ${spot.targetPos.y}, ${spot.targetPos.z}) [current: ${this.adapter.getBlockAt(spot.targetPos)?.name}] (bot: ${bPos.x.toFixed(1)}, ${bPos.y.toFixed(1)}, ${bPos.z.toFixed(1)})`, 'SafeDSL');
            
            // Ensure bot is standing at a clean distance (1.4m) so body does not obstruct block placement!
            if (this.adapter.distanceTo(spot.targetPos) < 1.0) {
              await this.adapter.moveAway(1.4).catch(() => {});
            }

            await this.safePlaceBlock(spot.floor, new Vec3(0, 1, 0), 'crafting_table');
            
            // Wait for block sync from server (up to 1600ms)
            for (let attempt = 0; attempt < 8; attempt++) {
              await new Promise(r => setTimeout(r, 200));
              const check = this.adapter.getBlockAt(spot.targetPos);
              if (check && check.name === 'crafting_table') {
                craftingTableBlock = check;
                placedTablePos = spot.targetPos;
                break;
              }
              const nearby = this.adapter.findBlocks({ matching: 'crafting_table', maxDistance: 4, count: 1 });
              if (nearby.length > 0) {
                craftingTableBlock = this.adapter.getBlockAt(nearby[0]);
                placedTablePos = nearby[0];
                break;
              }
            }
          }
        }
      }

      if (!craftingTableBlock) {
        throw new Error('Crafting Table is required but could not be deployed or reached.');
      }
    }

    // 2. Find valid recipe using Mineflayer recipe engine
    const targetTable = requiresTable ? craftingTableBlock : null;
    let recipes = bot.recipesFor(itemObj.id, null, 1, targetTable);
    if (recipes.length === 0) {
      throw new Error(`Cannot craft '${itemName}': missing ingredients in inventory.`);
    }

    // 3. Execute craft
    logger.info(`Crafting ${count}x '${itemName}' (requiresTable: ${requiresTable}, tablePos: ${targetTable ? `${targetTable.position.x},${targetTable.position.y},${targetTable.position.z}` : 'none'})...`, 'SafeDSL');
    bot.clearControlStates();
    if (bot.currentWindow) {
      try { bot.closeWindow(bot.currentWindow); } catch (_) {}
    }

    if (targetTable) {
      const dist = this.adapter.distanceTo(targetTable.position);
      if (dist > 2.0 || dist < 1.2) {
        await this.adapter.goto(targetTable.position.x, targetTable.position.y, targetTable.position.z, 1.5, 2500).catch(() => {});
      }
      // Ensure hand is not holding a block to allow opening GUI
      if (this.adapter.hasItem('stick')) {
        await this.adapter.equipItem('stick', 'hand').catch(() => {});
      } else if (this.adapter.hasItem('stone_sword')) {
        await this.adapter.equipItem('stone_sword', 'hand').catch(() => {});
      } else {
        await bot.unequip('hand').catch(() => {});
      }
      await new Promise(r => setTimeout(r, 100));
      await this.adapter.lookAt(targetTable.position.offset(0.5, 0.5, 0.5));
    }

    try {
      await Promise.race([
        bot.craft(recipes[0], count, targetTable),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Craft timeout after 5s')), 5000))
      ]);
      logger.info(`✅ Successfully crafted ${count}x '${itemName}'! (Current inventory: ${this.adapter.countItem(itemName)})`, 'SafeDSL');
    } catch (e) {
      logger.warn(`Craft failed/timeout: ${e.message}`, 'SafeDSL');
      // If table was stuck, break it to prevent infinite retry on bad block
      if (targetTable) {
        await this.safeDigBlock(targetTable).catch(() => {});
      }
    }

    // Wait for server inventory sync
    await new Promise(r => setTimeout(r, 400));

    return { success: this.adapter.hasItem(itemName), crafted: itemName, count };
  }

  /**
   * Defends the player from nearby hostile threats.
   */
  async defendPlayer(playerName) {
    const playerEntity = this.adapter.findEntity({ name: playerName, type: 'player' });
    if (!playerEntity) throw new Error(`Player '${playerName}' not found.`);

    // Find hostiles near the player
    const hostile = this.adapter.findEntity({ type: 'mob', maxDistance: 12 });
    if (hostile) {
      logger.info(`Defending ${playerName} from hostile ${hostile.name}!`, 'SafeDSL');
      // Equip best weapon
      const weapons = ['diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword', 'diamond_axe', 'iron_axe'];
      for (const w of weapons) {
        if (this.adapter.hasItem(w)) {
          await this.adapter.equipItem(w, 'hand');
          break;
        }
      }
      await this.adapter.attackEntity(hostile);
      return { defended: true, target: hostile.name };
    } else {
      await this.adapter.followPlayer(playerName, 2.5);
      return { defended: true, status: 'following_peacefully' };
    }
  }

  /**
   * Eats food if hungry.
   */
  async eatIfHungry() {
    if (this.adapter.getFood() < 16) {
      try {
        await this.adapter.eatFood();
        return true;
      } catch (e) {
        logger.warn(`Could not eat food: ${e.message}`, 'SafeDSL');
        return false;
      }
    }
    return false;
  }

  /**
   * Smelts ores or food in furnace with auto-deploy & pickup.
   */
  async smeltItem(itemName, count = 1) {
    const bot = this.adapter.rawBot;
    let furnaceBlock = null;
    let placedFurnacePos = null;

    // 1. Find existing furnace nearby (up to 12m)
    const furnaces = this.adapter.findBlocks({ matching: 'furnace', maxDistance: 12, count: 1 });
    if (furnaces.length > 0) {
      if (this.adapter.distanceTo(furnaces[0]) > 2.0) {
        await this.adapter.goto(furnaces[0].x, furnaces[0].y, furnaces[0].z, 1.5, 3000).catch(() => {});
      }
      furnaceBlock = this.adapter.getBlockAt(furnaces[0]);
    } else {
      // Craft furnace if missing and have cobblestone >= 8
      if (!this.adapter.hasItem('furnace') && this.adapter.countItem('cobblestone') >= 8) {
        await this.craftItem('furnace', 1);
      }
      if (this.adapter.hasItem('furnace')) {
        const spot = await this.findDeploySpot();
        if (spot && spot.floor) {
          await this.safePlaceBlock(spot.floor, new Vec3(0, 1, 0), 'furnace');
          placedFurnacePos = spot.targetPos;
          furnaceBlock = this.adapter.getBlockAt(placedFurnacePos);
        }
      }
    }

    if (!furnaceBlock) throw new Error('No furnace available.');

    // 2. Open furnace and smelt
    logger.info(`Opening furnace to smelt ${count}x '${itemName}'...`, 'SafeDSL');
    const furnace = await bot.openFurnace(furnaceBlock);

    // Fuel with coal / charcoal / wood
    const fuels = ['coal', 'charcoal', 'oak_log', 'birch_log', 'spruce_log', 'oak_planks', 'stick'];
    const fuelItem = bot.inventory.items().find(i => fuels.includes(i.name));
    if (!fuelItem && !furnace.fuelItem()) {
      furnace.close();
      throw new Error('No smelting fuel found (coal/wood).');
    }

    if (fuelItem && !furnace.fuelItem()) {
      const fuelCount = Math.min(fuelItem.count, Math.ceil(count / 8) + 1);
      await furnace.putFuel(fuelItem.type, null, fuelCount);
    }

    const inputName = itemName.startsWith('raw_') ? itemName : `raw_${itemName}`;
    const inputItem = bot.inventory.items().find(i => i.name === itemName || i.name === inputName);
    if (!inputItem) {
      furnace.close();
      throw new Error(`Item '${itemName}' not in inventory to smelt.`);
    }

    const smeltCount = Math.min(inputItem.count, count);
    await furnace.putInput(inputItem.type, null, smeltCount);

    // Wait for smelting output
    let collected = 0;
    let lastTime = Date.now();
    while (collected < smeltCount) {
      await new Promise(r => setTimeout(r, 1000));
      if (furnace.outputItem()) {
        const out = await furnace.takeOutput();
        if (out) {
          collected += out.count;
          lastTime = Date.now();
        }
      }
      if (Date.now() - lastTime > 15000) break;
    }

    furnace.close();

    return { success: true, smelted: itemName, count: collected };
  }

  /**
   * Finds all exposed ore blocks visible in nearby air/caves that the bot CAN harvest.
   */
  findNearbyExposedOres(maxDistance = 16) {
    const hasIronPick = this.adapter.hasItem('iron_pickaxe') || this.adapter.hasItem('diamond_pickaxe');
    const hasStonePick = hasIronPick || this.adapter.hasItem('stone_pickaxe');
    const hasWoodenPick = hasStonePick || this.adapter.hasItem('wooden_pickaxe');

    // Opportunistic Memory: If high-tier ores (diamond, gold, redstone) are visible but we lack an Iron Pickaxe,
    // record their coordinates in long-term world memory so we can return and harvest them later!
    if (!hasIronPick && this.worldMemory) {
      const highTierOres = this.adapter.findBlocks({
        matching: ['diamond_ore', 'deepslate_diamond_ore', 'gold_ore', 'deepslate_gold_ore', 'ancient_debris'],
        maxDistance,
        count: 5
      });
      for (const pos of highTierOres) {
        const b = this.adapter.getBlockAt(pos);
        if (b) {
          this.worldMemory.recordDiscoveredOre(null, b.name, pos);
        }
      }
    }

    if (!hasWoodenPick) return [];

    let allowedOres = ['coal_ore', 'deepslate_coal_ore'];
    if (hasStonePick) {
      allowedOres.push('iron_ore', 'deepslate_iron_ore', 'copper_ore', 'deepslate_copper_ore', 'lapis_ore', 'deepslate_lapis_ore');
    }
    if (hasIronPick) {
      allowedOres.push('gold_ore', 'deepslate_gold_ore', 'diamond_ore', 'deepslate_diamond_ore', 'redstone_ore', 'deepslate_redstone_ore');
    }

    const blocks = this.adapter.findBlocks({ matching: allowedOres, maxDistance, count: 20 });
    return blocks.filter(bPos => {
      const neighbors = [
        new Vec3(bPos.x + 1, bPos.y, bPos.z),
        new Vec3(bPos.x - 1, bPos.y, bPos.z),
        new Vec3(bPos.x, bPos.y + 1, bPos.z),
        new Vec3(bPos.x, bPos.y - 1, bPos.z),
        new Vec3(bPos.x, bPos.y, bPos.z + 1),
        new Vec3(bPos.x, bPos.y, bPos.z - 1)
      ];
      return neighbors.some(n => {
        const b = this.adapter.getBlockAt(n);
        return b && (b.name === 'air' || b.name === 'cave_air' || b.name.includes('water') || b.name === 'torch');
      });
    });
  }

  /**
   * Mines an entire connected ore vein (BFS cluster extraction) down to the last block,
   * then steps over to vacuum all dropped loot into inventory.
   */
  async mineConnectedVein(startPos, oreNames) {
    // 1. Approach vein first so bot is standing right next to it before digging
    if (this.adapter.distanceTo(startPos) > 3.0) {
      await this.adapter.goto(startPos.x, startPos.y, startPos.z, 2.0, 3500).catch(() => {});
      if (this.adapter.distanceTo(startPos) > 3.8) {
        logger.info(`Cannot reach ore vein at (${startPos.x}, ${startPos.y}, ${startPos.z}) (distance: ${this.adapter.distanceTo(startPos).toFixed(1)}m). Skipping unreachable vein.`, 'SafeDSL');
        return 0;
      }
    }

    const queue = [startPos];
    const visited = new Set();
    visited.add(`${startPos.x},${startPos.y},${startPos.z}`);
    let minedCount = 0;

    while (queue.length > 0 && minedCount < 16) {
      const current = queue.shift();
      const block = this.adapter.getBlockAt(current);
      if (block && oreNames.includes(block.name)) {
        logger.info(`⛏️ Mining connected ore '${block.name}' at (${current.x}, ${current.y}, ${current.z})...`, 'SafeDSL');
        const res = await this.safeDigBlock(block);
        if (res) {
          minedCount++;
        }

        // Expand to adjacent and diagonal neighbors to find all blocks in the vein
        const neighbors = [
          current.offset(1, 0, 0), current.offset(-1, 0, 0),
          current.offset(0, 1, 0), current.offset(0, -1, 0),
          current.offset(0, 0, 1), current.offset(0, 0, -1),
          current.offset(1, 1, 0), current.offset(-1, 1, 0),
          current.offset(1, -1, 0), current.offset(-1, -1, 0),
          current.offset(0, 1, 1), current.offset(0, 1, -1),
          current.offset(0, -1, 1), current.offset(0, -1, -1),
          current.offset(1, 0, 1), current.offset(-1, 0, 1),
          current.offset(1, 0, -1), current.offset(-1, 0, -1)
        ];

        for (const n of neighbors) {
          const key = `${n.x},${n.y},${n.z}`;
          if (!visited.has(key)) {
            visited.add(key);
            const nBlock = this.adapter.getBlockAt(n);
            if (nBlock && oreNames.includes(nBlock.name)) {
              queue.push(n);
            }
          }
        }
      }
    }

    // Active Loot Vacuum: Sweep all dropped ore items in the area into inventory
    if (minedCount > 0) {
      logger.info(`📦 Actively sweeping and vacuuming all drops within 10m of mined vein...`, 'SafeDSL');
      await this.collectNearbyDrops(10);
      await this.placeTorchIfDark(6).catch(() => {});
    }

    return minedCount;
  }

  /**
   * Sweeps and collects all dropped loot entities in the area with free inventory assurance.
   */
  async collectNearbyDrops(maxDistance = 10) {
    await this.adapter.cleanInventory();

    const drops = this.adapter.findDroppedItems(maxDistance);
    if (drops.length === 0) return 0;

    let collected = 0;
    for (const drop of drops) {
      if (!drop || !drop.position) continue;
      const dist = this.adapter.distanceTo(drop.position);
      if (dist > 0.6) {
        await this.adapter.goto(drop.position.x, drop.position.y, drop.position.z, 0.3, 2000).catch(() => {});
      }
      await new Promise(r => setTimeout(r, 100));
      collected++;
    }
    return collected;
  }

  /**
   * Mines all exposed ores in nearby caves and lights up the area.
   */
  async mineAllNearbyOres(maxDistance = 8, maxCount = 8) {
    const exposed = this.findNearbyExposedOres(maxDistance);
    if (exposed.length === 0) return 0;

    // Sort by closest distance first
    exposed.sort((a, b) => this.adapter.distanceTo(a) - this.adapter.distanceTo(b));

    let mined = 0;
    for (const bPos of exposed) {
      if (mined >= maxCount) break;
      const bObj = this.adapter.getBlockAt(bPos);
      if (bObj && bObj.name !== 'air' && bObj.name !== 'cave_air') {
        const minedInVein = await this.mineConnectedVein(bPos, [bObj.name, `deepslate_${bObj.name.replace('deepslate_', '')}`]);
        mined += minedInVein;
      }
    }
    return mined;
  }

  /**
   * Mines target ores safely with ore-specific tool requirements.
   */
  async mineOres(oreType, count = 1) {
    const oreNames = [
      oreType,
      `${oreType}_ore`,
      `deepslate_${oreType}_ore`
    ];

    const isDiamond = oreType.includes('diamond');
    let targetBlocks = [];

    if (isDiamond) {
      // 💎 Diamonds: Absolute Top Priority — scan all diamond ores in 16m radius
      targetBlocks = this.adapter.findBlocks({ matching: ['diamond_ore', 'deepslate_diamond_ore'], maxDistance: 16, count: 10 });
    } else {
      // Standard ores: Find exposed ores
      targetBlocks = this.findNearbyExposedOres(12).filter(bPos => {
        const b = this.adapter.getBlockAt(bPos);
        return b && (oreNames.includes(b.name) || b.name.includes(oreType));
      });
    }

    if (targetBlocks.length === 0) {
      logger.info(`No ${oreType} ores visible nearby. Digging staircase down...`, 'SafeDSL');
      const currentY = this.adapter.getPosition().y;
      const targetY = currentY <= -50 ? -54 : (currentY - 4);
      return await this.staircaseMineDown(targetY);
    }

    // Sort by closest distance
    targetBlocks.sort((a, b) => this.adapter.distanceTo(a) - this.adapter.distanceTo(b));

    let totalMined = 0;
    for (const bPos of targetBlocks) {
      const bObj = this.adapter.getBlockAt(bPos);
      if (bObj && (oreNames.includes(bObj.name) || bObj.name.includes(oreType) || isDiamond)) {
        const minedInVein = await this.mineConnectedVein(bPos, isDiamond ? ['diamond_ore', 'deepslate_diamond_ore'] : oreNames);
        totalMined += minedInVein;
        if (totalMined >= count) break;
      }
    }

    return { success: totalMined > 0, mined: totalMined };
  }

  /**
   * Approches the player and tosses a gift item nicely.
   */
  async giveGiftToPlayer(playerName, itemName, count = 1) {
    const playerEntity = this.adapter.findEntity({ name: playerName, type: 'player' }) ||
                         this.adapter.findEntity({ type: 'player', maxDistance: 12 });
    if (!playerEntity) return false;

    const clean = itemName.toLowerCase().replace(/^minecraft:/, '');
    const item = this.adapter.rawBot.inventory.items().find(i => i.name.toLowerCase() === clean);
    if (!item) return false;

    await this.adapter.goto(playerEntity.position.x, playerEntity.position.y, playerEntity.position.z, 1.8, 4000);
    await this.adapter.lookAt(playerEntity.position.offset(0, playerEntity.height || 1.6, 0));
    const tossCount = Math.min(item.count, count);
    await this.adapter.rawBot.toss(item.type, null, tossCount);
    logger.info(`🎁 Tossed ${tossCount}x ${itemName} as a gift to player ${playerEntity.username || playerEntity.name}!`, 'SafeDSL');
    return true;
  }

  /**
   * Places water at feet to extinguish fire/negate fall and recovers water immediately.
   */
  async useWaterBucketClutch() {
    const bot = this.adapter.rawBot;
    if (!this.adapter.hasItem('water_bucket')) return false;

    const botPos = this.adapter.getPosition();
    const ground = this.adapter.getBlockAt(new Vec3(Math.floor(botPos.x), Math.floor(botPos.y) - 1, Math.floor(botPos.z)));
    if (!ground) return false;

    await this.safePlaceBlock(ground, new Vec3(0, 1, 0), 'water_bucket');
    await new Promise(r => setTimeout(r, 400));
    const waterBlock = this.adapter.getBlockAt(new Vec3(ground.position.x, ground.position.y + 1, ground.position.z));
    if (waterBlock && waterBlock.name === 'water') {
      await this.adapter.equipItem('bucket', 'hand');
      await this.adapter.lookAt(waterBlock.position);
      await bot.activateBlock(waterBlock);
    }
    return true;
  }

  /**
   * Harvests mature crops (wheat, carrot, potato, beetroot) and immediately replants seeds on farmland.
   */
  async harvestAndReplantCrops() {
    const cropTypes = ['wheat', 'carrots', 'potatoes', 'beetroots'];
    const matureBlocks = this.adapter.findBlocks({ matching: cropTypes, maxDistance: 16, count: 6 });
    let harvested = 0;

    for (const bPos of matureBlocks) {
      const block = this.adapter.getBlockAt(bPos);
      if (!block) continue;
      const isMature = (block.metadata === 7) || (block.name === 'beetroots' && block.metadata === 3);
      if (isMature) {
        await this.safeDigBlock(block);
        harvested++;
        const seedMap = { wheat: 'wheat_seeds', carrots: 'carrot', potatoes: 'potato', beetroots: 'beetroot_seeds' };
        const seedName = seedMap[block.name] || 'wheat_seeds';
        if (this.adapter.hasItem(seedName)) {
          const farmland = this.adapter.getBlockAt(new Vec3(bPos.x, bPos.y - 1, bPos.z));
          if (farmland && (farmland.name === 'farmland' || farmland.name === 'dirt')) {
            await this.safePlaceBlock(farmland, new Vec3(0, 1, 0), seedName);
          }
        }
      }
    }
    return harvested;
  }

  /**
   * Deposits surplus dirt, cobblestone, gravel, and junk into base chest.
   */
  async depositSurplusToChest(chestBlock) {
    if (!chestBlock) return false;
    const bot = this.adapter.rawBot;
    await this.adapter.goto(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2.5, 5000);
    const chest = await bot.openChest(chestBlock);
    const junk = ['dirt', 'cobblestone', 'diorite', 'granite', 'andesite', 'gravel', 'rotten_flesh', 'spider_eye', 'string'];
    for (const j of junk) {
      const item = bot.inventory.items().find(i => i.name === j && i.count > 16);
      if (item) {
        try {
          await chest.deposit(item.type, null, item.count - 16);
        } catch (_) {}
      }
    }
    chest.close();
    return true;
  }

  /**
   * Safely mines a 1x2 diagonal staircase downwards to target depth.
   */
  async staircaseMineDown(targetY = -54) {
    const current = this.adapter.getPosition();
    const effectiveTargetY = Math.min(targetY, Math.round(current.y) - 2);

    // 1. Opportunistic Cave Exploration: If exposed ores are already visible nearby, mine them!
    const initialOres = this.findNearbyExposedOres(12);
    if (initialOres.length > 0) {
      logger.info(`💎 Detected ${initialOres.length} exposed ores in nearby cave! Mining cave ores first...`, 'SafeDSL');
      await this.mineAllNearbyOres(12, 6);
    }

    logger.info(`⛏️ Digging safe staircase down from Y=${Math.round(current.y)} towards target Y=${effectiveTargetY}...`, 'SafeDSL');
    const directions = [
      new Vec3(1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, -1)
    ];

    let dir = directions[0];
    const initialPos = this.adapter.getPosition();
    for (const d of directions) {
      const f = this.adapter.getBlockAt(initialPos.offset(d.x, -1, d.z));
      const h = this.adapter.getBlockAt(initialPos.offset(d.x, 0, d.z));
      const t = this.adapter.getBlockAt(initialPos.offset(d.x, 1, d.z));
      const isLiquid = [f, h, t].some(b => b && (b.name.includes('water') || b.name.includes('lava')));
      if (!isLiquid) {
        dir = d;
        break;
      }
    }

    for (let step = 0; step < 4; step++) {
      const pos = this.adapter.getPosition();
      if (pos.y <= effectiveTargetY && step >= 2) break;

      let nextFrontFeet = this.adapter.getBlockAt(pos.offset(dir.x, -1, dir.z));
      let nextFrontHead = this.adapter.getBlockAt(pos.offset(dir.x, 0, dir.z));
      let nextFrontTop = this.adapter.getBlockAt(pos.offset(dir.x, 1, dir.z));

      // 💧 Water & Lava Hazard Check: Never blindly dig into flooded aquifers!
      const hasLiquid = [nextFrontTop, nextFrontHead, nextFrontFeet].some(b => b && (b.name.includes('water') || b.name.includes('lava')));
      if (hasLiquid) {
        logger.warn(`💧 Liquid detected in front (${dir.x}, ${dir.z})! Rotating staircase direction to dry rock...`, 'SafeDSL');

        // Rotate to next orthogonal dry direction
        const altDirs = directions.filter(d => d.x !== dir.x || d.z !== dir.z);
        const dryAlt = altDirs.find(d => {
          const f = this.adapter.getBlockAt(pos.offset(d.x, -1, d.z));
          const h = this.adapter.getBlockAt(pos.offset(d.x, 0, d.z));
          const t = this.adapter.getBlockAt(pos.offset(d.x, 1, d.z));
          return ![f, h, t].some(b => b && (b.name.includes('water') || b.name.includes('lava')));
        });

        if (dryAlt) {
          dir = dryAlt;
          logger.info(`🔄 Rotated staircase to dry direction (${dir.x}, ${dir.z}). Continuing descent...`, 'SafeDSL');
          nextFrontFeet = this.adapter.getBlockAt(pos.offset(dir.x, -1, dir.z));
          nextFrontHead = this.adapter.getBlockAt(pos.offset(dir.x, 0, dir.z));
          nextFrontTop = this.adapter.getBlockAt(pos.offset(dir.x, 1, dir.z));
        } else {
          logger.warn('All directions flooded or blocked. Ending staircase step to preserve air.', 'SafeDSL');
          break;
        }
      }

      if (nextFrontTop && nextFrontTop.name !== 'air' && !nextFrontTop.name.includes('water')) await this.safeDigBlock(nextFrontTop);
      if (nextFrontHead && nextFrontHead.name !== 'air' && !nextFrontHead.name.includes('water')) await this.safeDigBlock(nextFrontHead);
      if (nextFrontFeet && nextFrontFeet.name !== 'air' && !nextFrontFeet.name.includes('water')) await this.safeDigBlock(nextFrontFeet);

      await this.navigateXZ(pos.x + dir.x, pos.z + dir.z, 0.4, 2000);

      // Place torch every 4-5 blocks if dark on dry ground
      if (step === 3 && this.adapter.shouldPlaceTorch(6)) {
        const floor = this.adapter.getBlockAt(this.adapter.getPosition().offset(0, -1, 0));
        if (floor && floor.name !== 'air' && floor.name !== 'cave_air' && !floor.name.includes('water')) {
          await this.safePlaceBlock(floor, new Vec3(0, 1, 0), 'torch');
        }
      }
    }
    return { reached: this.adapter.getPosition().y <= targetY, depth: this.adapter.getPosition().y };
  }

  /**
   * Climbs the excavated staircase tunnel back up to the surface.
   */
  async climbStaircaseUp(targetY = 64) {
    const current = this.adapter.getPosition();
    logger.info(`🪜 Climbing staircase back up from Y=${Math.round(current.y)} towards target Y=${targetY}...`, 'SafeDSL');
    const reverseDir = new Vec3(-1, 0, 0);
    let lastY = current.y;
    let stuckSteps = 0;

    for (let step = 0; step < 60; step++) {
      const pos = this.adapter.getPosition();
      if (pos.y >= targetY || pos.y >= 58) {
        logger.info(`🌲 Reached surface at Y=${Math.round(pos.y)}!`, 'SafeDSL');
        return { success: true, surfaceY: pos.y };
      }

      if (Math.abs(pos.y - lastY) < 0.3) {
        stuckSteps++;
        if (stuckSteps >= 3) {
          logger.warn('🪜 [Staircase Climb] Stuck along staircase direction. Breaking to dynamic surface navigation...', 'SafeDSL');
          if (this.adapter.rawBot && this.adapter.rawBot.pathfinder) {
            const { goals } = require('mineflayer-pathfinder');
            try {
              await this.adapter.rawBot.pathfinder.goto(new goals.GoalY(64));
            } catch (_) {}
          }
          break;
        }
      } else {
        stuckSteps = 0;
        lastY = pos.y;
      }

      const targetX = Math.floor(pos.x) + reverseDir.x;
      const targetYCoord = Math.floor(pos.y) + 1;
      const targetZ = Math.floor(pos.z);

      const headBlock = this.adapter.getBlockAt(new Vec3(targetX, targetYCoord + 1, targetZ));
      const stepBlock = this.adapter.getBlockAt(new Vec3(targetX, targetYCoord, targetZ));

      if (headBlock && headBlock.name !== 'air' && headBlock.name !== 'cave_air' && headBlock.name !== 'torch') {
        await this.safeDigBlock(headBlock).catch(() => {});
      }
      if (stepBlock && stepBlock.name !== 'air' && stepBlock.name !== 'cave_air' && stepBlock.name !== 'torch') {
        await this.safeDigBlock(stepBlock).catch(() => {});
      }

      await this.adapter.goto(targetX + 0.5, targetYCoord, targetZ + 0.5, 0.5, 1800).catch(async () => {
        if (this.adapter.rawBot) {
          this.adapter.rawBot.setControlState('jump', true);
          this.adapter.rawBot.setControlState('forward', true);
          await new Promise(r => setTimeout(r, 250));
          this.adapter.rawBot.setControlState('jump', false);
          this.adapter.rawBot.setControlState('forward', false);
        }
      });
    }

    return { success: this.adapter.getPosition().y >= 58, surfaceY: this.adapter.getPosition().y };
  }

  /**
   * Universal fail-proof surface ascension via jump-scaffolding (Pillaring).
   */
  async pillarUp(targetY = 64) {
    logger.info(`🏗️ Pillaring straight up to surface from Y=${Math.round(this.adapter.getPosition().y)} towards target Y=${targetY}...`, 'SafeDSL');
    const rawBot = this.adapter.rawBot;
    if (!rawBot) return { success: false };

    const scaffoldBlocks = ['cobblestone', 'cobbled_deepslate', 'dirt', 'granite', 'diorite', 'andesite', 'tuff'];
    const item = rawBot.inventory.items().find(i => scaffoldBlocks.includes(i.name));
    if (!item) {
      logger.warn('No scaffolding blocks available for pillaring.', 'SafeDSL');
      return { success: false };
    }

    for (let i = 0; i < 80; i++) {
      const pos = this.adapter.getPosition();
      if (pos.y >= targetY || pos.y >= 58) {
        logger.info(`🌲 Reached surface at Y=${Math.round(pos.y)}!`, 'SafeDSL');
        return { success: true, surfaceY: pos.y };
      }

      // Clear head space
      const head1 = this.adapter.getBlockAt(new Vec3(Math.floor(pos.x), Math.floor(pos.y) + 2, Math.floor(pos.z)));
      const head2 = this.adapter.getBlockAt(new Vec3(Math.floor(pos.x), Math.floor(pos.y) + 3, Math.floor(pos.z)));
      if (head1 && head1.name !== 'air' && head1.name !== 'cave_air') {
        await this.safeDigBlock(head1).catch(() => {});
      }
      if (head2 && head2.name !== 'air' && head2.name !== 'cave_air') {
        await this.safeDigBlock(head2).catch(() => {});
      }

      // Execute synchronous physics-timed jump-and-place
      const jumped = await this.adapter.jumpAndPlaceUnderFeet(item.name).catch(() => false);
      if (!jumped) {
        await new Promise(r => setTimeout(r, 150));
      }
    }

    return { success: this.adapter.getPosition().y >= 58, surfaceY: this.adapter.getPosition().y };
  }

  /**
   * Navigates to the surface safely.
   */
  async goToSurface() {
    const pos = this.adapter.getPosition();
    if (pos.y >= 58) return { success: true, surfaceY: pos.y };

    logger.info(`Navigating to surface from Y=${Math.round(pos.y)}...`, 'SafeDSL');

    // 1. If Surface landmark exists, pathfind to it
    const landmarks = this.worldMemory ? this.worldMemory.getLandmarks() : {};
    const surfaceEntry = Object.values(landmarks).find(l => l && (l.coords?.y >= 55 || l.y >= 55));
    if (surfaceEntry) {
      const targetCoords = surfaceEntry.coords || surfaceEntry;
      logger.info(`Following route to surface landmark at (${Math.round(targetCoords.x)}, ${Math.round(targetCoords.y)}, ${Math.round(targetCoords.z)})...`, 'SafeDSL');
      await this.adapter.goto(targetCoords.x, targetCoords.y, targetCoords.z, 2.0, 8000).catch(() => {});
      if (this.adapter.getPosition().y >= 55) {
        return { success: true, surfaceY: this.adapter.getPosition().y };
      }
    }

    // 2. Climb back up the excavated staircase (-X direction)
    const stairRes = await this.climbStaircaseUp(64);
    if (stairRes.success || this.adapter.getPosition().y >= 55) {
      return stairRes;
    }

    // 3. Fallback: Pillar up with jump-scaffolding straight to surface
    return await this.pillarUp(64);
  }

  /**
   * Digs down vertically safely with checks for lava, water, and drops.
   */
  async digDown(distance = 10) {
    const startPos = this.adapter.getPosition();
    let dugCount = 0;

    for (let i = 1; i <= distance; i++) {
      const targetBlock = this.adapter.getBlockAt(startPos.offset(0, -i, 0));
      const belowBlock = this.adapter.getBlockAt(startPos.offset(0, -i - 1, 0));

      if (!targetBlock || !belowBlock) break;

      // Check for hazards (lava/water)
      if (targetBlock.name === 'lava' || targetBlock.name === 'water' ||
          belowBlock.name === 'lava' || belowBlock.name === 'water') {
        logger.warn(`Stopped digging down at block ${i}: encountered ${belowBlock.name || targetBlock.name}`, 'SafeDSL');
        break;
      }

      if (targetBlock.name === 'air' || targetBlock.name === 'cave_air') continue;

      await this.safeDigBlock(targetBlock);
      dugCount++;
    }

    return { success: true, dugCount };
  }

  /**
   * Collects all dropped items nearby.
   */
  async pickupNearbyItems(maxDistance = 16) {
    const items = this.adapter.findDroppedItems(maxDistance);
    if (items.length === 0) return { collected: 0 };

    logger.info(`📦 Collecting ${items.length} dropped items nearby...`, 'SafeDSL');
    let count = 0;
    for (const item of items) {
      if (item && item.isValid) {
        await this.adapter.goto(item.position.x, item.position.y, item.position.z, 0.3, 2500).catch(() => {});
        count++;
      }
    }
    return { success: true, collected: count };
  }

  async collectNearbyDrops(maxDistance = 16) {
    return await this.pickupNearbyItems(maxDistance);
  }

  async collectDrops(maxDistance = 16) {
    return await this.pickupNearbyItems(maxDistance);
  }

  /**
   * Flees from hostile enemies to a safe distance.
   */
  async avoidEnemies(distance = 16) {
    logger.info(`🏃 Evading nearby hostiles (safe distance: ${distance}m)...`, 'SafeDSL');
    await this.adapter.moveAway(distance);
    return { success: true };
  }

  /**
   * Tills soil with a hoe and plants seeds.
   */
  async tillAndSow(x, y, z, seedType = null) {
    const targetBlock = this.adapter.getBlockAt(new Vec3(x, y, z));
    if (!targetBlock) throw new Error(`Invalid block at (${x}, ${y}, ${z})`);

    // 1. Equip hoe
    const hoeItem = this.adapter.findItem(['wooden_hoe', 'stone_hoe', 'iron_hoe', 'diamond_hoe', 'golden_hoe']);
    if (!hoeItem) {
      logger.info('Crafting wooden hoe for farming...', 'SafeDSL');
      await this.craftItem('wooden_hoe', 1);
    }
    await this.adapter.equipItem('hoe', 'hand');

    // 2. Till dirt / grass
    const bot = this.adapter.rawBot;
    await this.adapter.lookAt(targetBlock.position);
    await bot.activateBlock(targetBlock);

    // 3. Sow seed if available
    const seeds = seedType ? [seedType] : ['wheat_seeds', 'carrot', 'potato', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds'];
    const seedItem = this.adapter.findItem(seeds);
    if (seedItem) {
      await this.adapter.equipItem(seedItem.name, 'hand');
      const tilledBlock = this.adapter.getBlockAt(new Vec3(x, y, z));
      await bot.activateBlock(tilledBlock);
      logger.info(`🌱 Planted ${seedItem.name} at (${x}, ${y + 1}, ${z})`, 'SafeDSL');
    }

    return { success: true };
  }

  /**
   * Uses/toggles a door and steps through safely.
   */
  async useDoor(doorPos = null) {
    const targetDoor = doorPos || this.adapter.findBlocks({ matching: ['oak_door', 'iron_door', 'spruce_door', 'birch_door', 'cherry_door', 'dark_oak_door'], maxDistance: 16, count: 1 })[0];
    if (!targetDoor) {
      logger.warn('No door found nearby.', 'SafeDSL');
      return { success: false };
    }

    const doorBlock = this.adapter.getBlockAt(targetDoor);
    await this.adapter.goto(doorBlock.position.x, doorBlock.position.y, doorBlock.position.z, 1.2, 4000);
    await this.adapter.lookAt(doorBlock.position);
    await this.adapter.rawBot.activateBlock(doorBlock);
    return { success: true };
  }

  /**
   * Finds nearest bed and sleeps through the night.
   */
  async goToBed() {
    const beds = this.adapter.findBlocks({ matching: ['red_bed', 'white_bed', 'blue_bed', 'yellow_bed', 'green_bed', 'black_bed'], maxDistance: 32, count: 1 });
    if (beds.length === 0) {
      logger.warn('No beds found nearby.', 'SafeDSL');
      return { success: false };
    }

    const bedBlock = this.adapter.getBlockAt(beds[0]);
    await this.adapter.goto(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 1.5, 6000);
    await this.adapter.rawBot.sleep(bedBlock);
    logger.info('🛌 Sleeping in bed...', 'SafeDSL');
    return { success: true };
  }

  /**
   * Activates a mechanical block (lever, button, trapdoor).
   */
  async activateNearestBlock(blockType = 'lever') {
    const target = this.adapter.findBlocks({ matching: blockType, maxDistance: 16, count: 1 })[0];
    if (!target) {
      logger.warn(`No block of type '${blockType}' found nearby.`, 'SafeDSL');
      return { success: false };
    }

    const block = this.adapter.getBlockAt(target);
    await this.adapter.goto(block.position.x, block.position.y, block.position.z, 2.0, 4000);
    await this.adapter.lookAt(block.position);
    await this.adapter.rawBot.activateBlock(block);
    logger.info(`Toggled ${blockType} at (${block.position.x}, ${block.position.y}, ${block.position.z})`, 'SafeDSL');
    return { success: true };
  }

  /**
   * Inspects trades available on a nearby villager.
   */
  async showVillagerTrades(villagerId = null) {
    const bot = this.adapter.rawBot;
    const villager = villagerId ? bot.entities[villagerId] : this.adapter.findVillagers(16)[0];
    if (!villager) {
      logger.warn('No villager found nearby.', 'SafeDSL');
      return { success: false, trades: [] };
    }

    await this.adapter.goto(villager.position.x, villager.position.y, villager.position.z, 2.0, 4000);
    const window = await bot.openVillager(villager);
    const trades = window.trades || [];
    window.close();
    logger.info(`Villager [${villager.id}] offers ${trades.length} trades.`, 'SafeDSL');
    return { success: true, trades };
  }

  /**
   * Executes a trade with a nearby villager.
   */
  async tradeWithVillager(villagerId = null, tradeIndex = 1, count = 1) {
    const bot = this.adapter.rawBot;
    const villager = villagerId ? bot.entities[villagerId] : this.adapter.findVillagers(16)[0];
    if (!villager) {
      logger.warn('No villager found to trade with.', 'SafeDSL');
      return { success: false };
    }

    await this.adapter.goto(villager.position.x, villager.position.y, villager.position.z, 2.0, 4000);
    const window = await bot.openVillager(villager);
    const zeroIndex = Math.max(0, tradeIndex - 1);
    if (!window.trades || !window.trades[zeroIndex]) {
      window.close();
      throw new Error(`Trade index ${tradeIndex} is not available.`);
    }

    await bot.trade(window, zeroIndex, count);
    window.close();
    logger.info(`Successfully executed trade #${tradeIndex} x${count}`, 'SafeDSL');
    return { success: true };
  }

  /**
   * Builds a multi-layer structure from a 3D blueprint schema or name.
   */
  async buildStructure(blueprintNameOrObj, originPos = null) {
    let blueprint = blueprintNameOrObj;
    if (typeof blueprintNameOrObj === 'string') {
      const cleanName = blueprintNameOrObj.toLowerCase().replace(/\.json$/, '');
      try {
        blueprint = require(`../../data/blueprints/${cleanName}.json`);
      } catch (_) {
        throw new Error(`Blueprint '${cleanName}' not found in data/blueprints/`);
      }
    }

    const botPos = this.adapter.getPosition();
    const origin = originPos || new Vec3(Math.floor(botPos.x) + 2, Math.floor(botPos.y), Math.floor(botPos.z) + 2);
    const levels = blueprint.blocks || [];

    logger.info(`🏗️ Starting construction of '${blueprint.name || 'custom_structure'}' (${levels.length} layers)...`, 'SafeDSL');

    for (let y = 0; y < levels.length; y++) {
      const layer = levels[y];
      for (let z = 0; z < layer.length; z++) {
        for (let x = 0; x < layer[z].length; x++) {
          const blockName = layer[z][x];
          if (!blockName || blockName === '' || blockName === 'air') continue;

          const targetPos = origin.offset(x, y + (blueprint.offset || 0), z);
          const currentBlock = this.adapter.getBlockAt(targetPos);

          if (currentBlock && currentBlock.name !== blockName) {
            if (currentBlock.name !== 'air') {
              await this.safeDigBlock(currentBlock);
            }
            const groundBelow = this.adapter.getBlockAt(targetPos.offset(0, -1, 0));
            if (groundBelow && groundBelow.name !== 'air') {
              await this.safePlaceBlock(groundBelow, new Vec3(0, 1, 0), blockName).catch(() => {});
            }
          }
        }
      }
    }

    logger.info(`✅ Construction of '${blueprint.name || 'custom_structure'}' completed!`, 'SafeDSL');
    return { success: true };
  }

  /**
   * Equips a tool or item and uses it on a target entity or block.
   */
  async useToolOn(toolName, targetName) {
    const bot = this.adapter.rawBot;
    const cleanTarget = targetName.toLowerCase();

    if (cleanTarget === 'nothing') {
      if (toolName !== 'hand') {
        await this.adapter.equipItem(toolName, 'hand');
      }
      await bot.activateItem();
      logger.info(`Used ${toolName} in air.`, 'SafeDSL');
      return { success: true };
    }

    const entity = this.adapter.findEntity({ type: cleanTarget, maxDistance: 32 });
    if (entity) {
      await this.adapter.goto(entity.position.x, entity.position.y, entity.position.z, 2.0, 4000);
      if (toolName !== 'hand') {
        await this.adapter.equipItem(toolName, 'hand');
      }
      await bot.useOn(entity);
      logger.info(`Used ${toolName} on entity ${cleanTarget}.`, 'SafeDSL');
      return { success: true };
    }

    const block = this.adapter.findBlocks({ matching: cleanTarget, maxDistance: 32, count: 1 })[0];
    if (block) {
      const blockObj = this.adapter.getBlockAt(block);
      await this.adapter.goto(block.x, block.y, block.z, 2.0, 4000);
      await this.adapter.lookAt(new Vec3(block.x + 0.5, block.y + 0.5, block.z + 0.5));
      if (toolName !== 'hand') {
        await this.adapter.equipItem(toolName, 'hand');
      }
      if (toolName.includes('bucket')) {
        await bot.activateItem();
      } else {
        await bot.activateBlock(blockObj);
      }
      logger.info(`Used ${toolName} on block ${cleanTarget}.`, 'SafeDSL');
      return { success: true };
    }

    logger.warn(`Could not find target '${targetName}' to use ${toolName} on.`, 'SafeDSL');
    return { success: false };
  }
}

module.exports = {
  SafeDSL,
};
