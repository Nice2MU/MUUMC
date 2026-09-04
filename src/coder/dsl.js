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

    // 1. Natural Arm Reach Approach (Minecraft human survival reach = 4.5m, comfortable distance = 3.2m - 3.8m)
    let dist = this.adapter.eyeDistanceTo ? this.adapter.eyeDistanceTo(blockPos) : this.adapter.distanceTo(blockPos);
    if (dist > 4.2) {
      const navTimeout = Math.max(3500, Math.min(8000, Math.round(dist * 700)));
      await this.adapter.gotoXZ(blockPos.x, blockPos.z, 3.4, navTimeout).catch(() => {});
      dist = this.adapter.eyeDistanceTo ? this.adapter.eyeDistanceTo(blockPos) : this.adapter.distanceTo(blockPos);
    }
    // Hard Reach Limit: (Minecraft Vanilla max reach = 4.5m, Mineflayer allows up to 5.1m)
    if (dist > 4.8) {
      logger.warn(`Target block at (${blockPos.x}, ${blockPos.y}, ${blockPos.z}) is out of reach (${dist.toFixed(1)}m > 4.8m). Skipping.`, 'SafeDSL');
      return false;
    }

    // 2. Threat check: never stand still digging while hostiles are nearby
    const threats = this.adapter.findHostiles(7);
    if (threats.length > 0) {
      logger.info(`⚔️ [Threat Guard] Hostile '${threats[0].name}' is within 7m! Halting dig to fight...`, 'SafeDSL');
      await this.adapter.autoEquipArmor().catch(() => {});
      await this.adapter.equipHighestAttackWeapon().catch(() => {});
      await this.adapter.attackEntity(threats[0]);
      return false;
    }

    // 3. Verify target block exists and is diggable
    const freshTarget = this.adapter.getBlockAt(blockPos);
    if (!freshTarget || freshTarget.name === 'air' || freshTarget.name === 'cave_air' || freshTarget.name === 'void_air') {
      return true; // Already broken
    }

    // 4. Line of sight clearance: If target is obstructed by a solid block in front, clear the obstruction first!
    if (this.adapter.rawBot && this.adapter.rawBot.blockAtCursor) {
      await this.adapter.lookAt(new Vec3(blockPos.x + 0.5, blockPos.y + 0.5, blockPos.z + 0.5));
      const cursor = this.adapter.rawBot.blockAtCursor(4.5);
      if (cursor && cursor.position && !cursor.position.equals(blockPos) && cursor.diggable && cursor.name !== 'air' && cursor.name !== 'cave_air' && !cursor.name.includes('water') && !cursor.name.includes('lava') && cursor.name !== 'bedrock') {
        logger.info(`⛏️ Clearing obstructing block '${cursor.name}' at (${cursor.position.x}, ${cursor.position.y}, ${cursor.position.z}) in front of target...`, 'SafeDSL');
        await this.adapter.digBlock(cursor);
      }
    }

    const isOre = freshTarget.name.includes('_ore') || freshTarget.name === 'ancient_debris';
    logger.info(`⛏️ Digging block '${freshTarget.name}' at (${blockPos.x}, ${blockPos.y}, ${blockPos.z})...`, 'SafeDSL');

    try {
      await this.adapter.digBlock(freshTarget);
    } catch (err) {
      if (err.message && err.message.includes('ToolTierInsufficient')) {
        logger.warn(`🛑 [SafeDSL] Cannot harvest '${freshTarget.name}': ${err.message}`, 'SafeDSL');
        if (this.adapter?.botClient?.autonomousEngine) {
          const minTool = this.resolver?.getMinimumToolRequired(freshTarget.name) || 'iron_pickaxe';
          this.adapter.botClient.autonomousEngine.reportToolTierInsufficient(freshTarget.name, minTool);
        }
        return false;
      } else if (err.message && err.message.includes('ToolDepleted')) {
        logger.warn(`⚠️ [Tool Depleted] Pickaxe missing for '${freshTarget.name}'. Triggering tool reflex...`, 'SafeDSL');
        const autoCrafted = await this._tryAutoCraftPickaxe();
        if (autoCrafted) {
          logger.info(`🔨 Auto-crafted replacement pickaxe! Retrying dig on '${freshTarget.name}'...`, 'SafeDSL');
          try {
            await this.adapter.digBlock(freshTarget);
          } catch (_) {
            return false;
          }
        } else {
          logger.warn(`🛑 [SafeDSL] Cannot continue mining '${freshTarget.name}': No pickaxe and no crafting materials in inventory!`, 'SafeDSL');
          if (this.adapter?.botClient?.autonomousEngine) {
            this.adapter.botClient.autonomousEngine.reportToolDepleted('pickaxe');
          }
          return false;
        }
      } else {
        logger.warn(`⛏️ Digging '${freshTarget.name}' failed: ${err.message}`, 'SafeDSL');
        return false;
      }
    }

    if (this.worldMemory) {
      this.worldMemory.removeDiscoveredOre(null, blockPos);
    }

    // Vacuum Dropped Items: Whenever ANY block is broken in standalone mode, vacuum drop if nearby
    const dropsItem = !['air', 'cave_air', 'fire', 'water', 'lava', 'bedrock'].includes(freshTarget.name);
    if (dropsItem && !options.skipVacuum) {
      await new Promise(r => setTimeout(r, 120)); // Brief tick for item drop physics
      const nearbyDrops = this.adapter.findDroppedItems ? this.adapter.findDroppedItems(6) : [];
      const relevantDrops = nearbyDrops.filter(d => d.position && Math.hypot(d.position.x - blockPos.x, d.position.z - blockPos.z) <= 4.5);

      if (relevantDrops.length > 0) {
        for (const drop of relevantDrops) {
          if (!drop || !drop.position) continue;
          const dropDist = this.adapter.distanceTo(drop.position);
          if (dropDist > 0.35) {
            const vacuumTimeout = Math.max(2000, Math.min(5000, Math.round(dropDist * 800)));
            const reached = await this.adapter.gotoXZ(drop.position.x, drop.position.z, 0.35, vacuumTimeout).catch(() => false);
            if (!reached && drop.isValid) {
              await this.adapter.unstuck(drop.position);
              await this.adapter.gotoXZ(drop.position.x, drop.position.z, 0.35, 2000).catch(() => {});
            }
          }
        }
      } else {
        // Step directly into the mined block cavity if outside comfortable pickup reach
        const currentDist = this.adapter.distanceTo(blockPos);
        if (currentDist > 0.4) {
          await this.adapter.gotoXZ(blockPos.x + 0.5, blockPos.z + 0.5, 0.4, 2500).catch(() => {});
        }
      }
      await new Promise(r => setTimeout(r, 80));
    }

    return true;
  }

  /**
   * Proactive Reflex: Attempts to auto-craft a Stone or Wooden Pickaxe on the spot.
   */
  async _tryAutoCraftPickaxe() {
    try {
      const cobble = this.adapter.countItem('cobblestone');
      const sticks = this.adapter.countItem('stick');
      const planks = this.adapter.countItem('oak_planks') + this.adapter.countItem('birch_planks') + this.adapter.countItem('spruce_planks');
      const logs = this.adapter.countItem('oak_log') + this.adapter.countItem('birch_log') + this.adapter.countItem('spruce_log');

      // 1. Try Stone Pickaxe
      if (cobble >= 3) {
        if (sticks < 2) {
          if (planks < 2 && logs >= 1) {
            await this.craftItem('oak_planks', 4).catch(() => {});
          }
          if (this.adapter.countItem('oak_planks') >= 2) {
            await this.craftItem('stick', 4).catch(() => {});
          }
        }
        if (this.adapter.countItem('stick') >= 2) {
          logger.info('🔨 [Tool Reflex] Auto-crafting Stone Pickaxe replacement on the spot...', 'SafeDSL');
          await this.craftItem('stone_pickaxe', 1);
          return this.adapter.hasPickaxe();
        }
      }

      // 2. Try Wooden Pickaxe
      if (planks >= 3 || logs >= 1) {
        if (this.adapter.countItem('oak_planks') < 3 && logs >= 1) {
          await this.craftItem('oak_planks', 4).catch(() => {});
        }
        if (this.adapter.countItem('stick') < 2 && this.adapter.countItem('oak_planks') >= 2) {
          await this.craftItem('stick', 4).catch(() => {});
        }
        if (this.adapter.countItem('stick') >= 2 && this.adapter.countItem('oak_planks') >= 3) {
          logger.info('🔨 [Tool Reflex] Auto-crafting Wooden Pickaxe replacement on the spot...', 'SafeDSL');
          await this.craftItem('wooden_pickaxe', 1);
          return this.adapter.hasPickaxe();
        }
      }
    } catch (e) {
      logger.debug(`[Tool Reflex] Auto-craft attempt failed: ${e.message}`, 'SafeDSL');
    }
    return false;
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

    // 1. Natural Arm Reach Approach: If too far (>4.0m), approach to 3.2m (comfortable arm reach)
    let dist = this.adapter.eyeDistanceTo ? this.adapter.eyeDistanceTo(refPos) : this.adapter.distanceTo(refPos);
    if (dist > 4.0) {
      await this.adapter.goto(refPos.x, refPos.y + 1, refPos.z, 3.2, 2500).catch(() => {});
      dist = this.adapter.eyeDistanceTo ? this.adapter.eyeDistanceTo(refPos) : this.adapter.distanceTo(refPos);
    }
    // Hard Reach Limit: Minecraft allows placing blocks up to 4.5m
    if (dist > 4.6) {
      logger.warn(`Reference block at (${refPos.x}, ${refPos.y}, ${refPos.z}) is out of reach (${dist.toFixed(1)}m > 4.6m). Skipping placement.`, 'SafeDSL');
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

    // 0. Auto-Equip / Auto-Craft Best Axe before chopping!
    const hasAnyAxe = this.adapter.hasItem('diamond_axe') || this.adapter.hasItem('iron_axe') || this.adapter.hasItem('stone_axe') || this.adapter.hasItem('wooden_axe');
    if (!hasAnyAxe) {
      if (this.adapter.countItem('cobblestone') >= 3 && (this.adapter.hasItem('stick') || this.adapter.hasItem('oak_planks') || this.adapter.hasItem('spruce_planks') || this.adapter.hasItem('birch_planks')) && (this.adapter.hasItem('crafting_table') || this.adapter.findBlocks({ matching: 'crafting_table', maxDistance: 12, count: 1 }).length > 0)) {
        await this.craftItem('stone_axe', 1).catch(() => {});
      } else if ((this.adapter.countItem('oak_planks') >= 3 || this.adapter.countItem('spruce_planks') >= 3 || this.adapter.countItem('birch_planks') >= 3) && (this.adapter.hasItem('crafting_table') || this.adapter.findBlocks({ matching: 'crafting_table', maxDistance: 12, count: 1 }).length > 0)) {
        await this.craftItem('wooden_axe', 1).catch(() => {});
      }
    }

    const logTypes = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log', 'mangrove_log'];
    
    for (let i = 0; i < count; i++) {
      let logs = this.adapter.findBlocks({ matching: logTypes, maxDistance: 64, count: 15 });
      if (logs.length === 0 && this.adapter.getPosition().y < 62) {
        logger.info('🌲 Bot is underground. Navigating up towards surface to reach trees...', 'SafeDSL');
        await this.goToSurface();
        logs = this.adapter.findBlocks({ matching: logTypes, maxDistance: 64, count: 15 });
      }

      if (!this._unreachableTreePositions) this._unreachableTreePositions = new Map();
      const now = Date.now();
      logs = logs.filter(l => {
        const key = `${l.x},${l.y},${l.z}`;
        return !this._unreachableTreePositions.has(key) || this._unreachableTreePositions.get(key) <= now;
      });

      if (logs.length === 0) {
        logger.warn('No reachable trees found within 64 blocks. Exploring terrain to find new trees...', 'SafeDSL');
        await this.adapter.exploreTerrain(24).catch(() => {});
        break;
      }

      // Prioritize grounded trees (rooted in dirt/grass) and lowest log in each trunk
      logs.sort((a, b) => {
        const belowA = this.adapter.getBlockAt(new Vec3(a.x, a.y - 1, a.z));
        const belowB = this.adapter.getBlockAt(new Vec3(b.x, b.y - 1, b.z));
        const isRootA = belowA && (belowA.name === 'dirt' || belowA.name === 'grass_block' || belowA.name === 'podzol' || belowA.name.includes('dirt'));
        const isRootB = belowB && (belowB.name === 'dirt' || belowB.name === 'grass_block' || belowB.name === 'podzol' || belowB.name.includes('dirt'));
        if (isRootA && !isRootB) return -1;
        if (!isRootA && isRootB) return 1;
        if (a.y !== b.y) return a.y - b.y; // Lowest log first
        return this.adapter.distanceTo(a) - this.adapter.distanceTo(b);
      });
      const targetLog = logs[0];

      // Navigate to tree only if outside comfortable swinging reach (> 3.6m)
      const initialDist = this.adapter.distanceTo(targetLog);
      if (initialDist > 3.6) {
        const navTime = Math.max(4000, Math.min(10000, Math.round(initialDist * 800)));
        await this.adapter.gotoXZ(targetLog.x, targetLog.z, 2.6, navTime).catch(() => {});
      }

      if (this.adapter.distanceTo(targetLog) > 4.5) {
        logger.warn(`Tree at (${targetLog.x}, ${targetLog.y}, ${targetLog.z}) unreachable. Blacklisting for 60s...`, 'SafeDSL');
        this._unreachableTreePositions.set(`${targetLog.x},${targetLog.y},${targetLog.z}`, Date.now() + 60000);
        continue;
      }

      const digResult = await this.safeDigBlock(targetLog);
      if (!digResult) {
        this._unreachableTreePositions.set(`${targetLog.x},${targetLog.y},${targetLog.z}`, Date.now() + 60000);
        continue;
      }
      chopped++;
      // Check if there are logs directly above (fell entire tree trunk within human reach <= 4.5m)
      let abovePos = new Vec3(targetLog.x, targetLog.y + 1, targetLog.z);
      while (chopped < count) {
        const aboveBlock = this.adapter.getBlockAt(abovePos);
        if (aboveBlock && this.resolver.isLog(aboveBlock.name)) {
          const heightDiff = abovePos.y - this.adapter.getPosition().y;
          // Standard player reach limit: reach up to 4.5 blocks above feet
          if (heightDiff > 4.5) {
            break;
          }
          await this.safeDigBlock(aboveBlock);
          chopped++;
          abovePos = new Vec3(abovePos.x, abovePos.y + 1, abovePos.z);
        } else {
          break;
        }
      }

      // Clear low leaves that often trap fallen logs or block walking around the tree base
      const lowLeaves = this.adapter.findBlocks({
        matching: ['oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves', 'acacia_leaves', 'dark_oak_leaves', 'cherry_leaves', 'mangrove_leaves'],
        maxDistance: 3,
        maxDistanceY: 2,
        count: 4
      });
      for (const leafPos of lowLeaves) {
        const leafBlock = this.adapter.getBlockAt(leafPos);
        if (leafBlock) {
          await this.safeDigBlock(leafBlock, { skipVacuum: true }).catch(() => {});
        }
      }

      // Collect fallen wood drops immediately right under the tree before moving to the next
      await this.pickupNearbyItems(8).catch(() => {});
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

    return { success: chopped > 0, chopped };
  }

  // --- Prerequisite Sub-Ingredient Resolver ---
  async ensureIngredients(itemName, count = 1) {
    const clean = itemName.toLowerCase().replace(/^minecraft:/, '');
    const logTypes = ['oak_log', 'birch_log', 'spruce_log', 'cherry_log', 'acacia_log', 'jungle_log', 'dark_oak_log'];
    const plankTypes = ['oak_planks', 'birch_planks', 'spruce_planks', 'cherry_planks', 'acacia_planks'];
    const bot = this.adapter.rawBot;

    // 1. Auto-craft planks if needed for crafting table / tools / sticks / chests / shields / beds
    const needsPlanks = clean.includes('plank') || clean === 'crafting_table' || clean === 'stick' ||
                        clean === 'shield' || clean === 'chest' || clean.includes('bed') || clean.includes('pickaxe') ||
                        clean.includes('axe') || clean.includes('sword') || clean.includes('shovel') || clean.includes('hoe');

    if (needsPlanks) {
      let currentPlanks = 0;
      for (const p of plankTypes) currentPlanks += this.adapter.countItem(p);

      let requiredPlanks = 2;
      if (clean === 'crafting_table') requiredPlanks = 4;
      else if (clean === 'chest') requiredPlanks = 8;
      else if (clean === 'shield') requiredPlanks = 6;
      else if (clean.includes('bed')) requiredPlanks = 3;
      else if (clean.includes('plank')) requiredPlanks = count;
      else if (clean.startsWith('wooden_')) requiredPlanks = 3;

      if (currentPlanks < requiredPlanks) {
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
          if (pObj) {
            const pRecipes = bot.recipesFor(pObj.id, null, 1, null);
            if (pRecipes.length > 0) {
              const logsNeeded = Math.min(this.adapter.countItem(hasLog), Math.ceil((requiredPlanks - currentPlanks) / 4));
              try {
                await bot.craft(pRecipes[0], logsNeeded, null);
                logger.info(`🔨 Auto-crafted ${logsNeeded * 4}x ${targetPlank} from ${logsNeeded}x ${hasLog}`, 'SafeDSL');
                await new Promise(r => setTimeout(r, 150));
              } catch (e) {
                logger.warn(`Notice while auto-crafting planks: ${e.message}`, 'SafeDSL');
              }
            }
          }
        }
      }
    }

    // 2. Auto-craft sticks if needed for tools / torches / ladders
    const isTool = clean.includes('pickaxe') || clean.includes('axe') || clean.includes('shovel') || clean.includes('hoe');
    const isSword = clean.includes('sword');
    const isTorch = clean === 'torch';
    const requiredSticks = isTool ? (count * 2) : (isSword ? count : (isTorch ? Math.ceil(count / 4) : count));

    if ((isTool || isSword || isTorch) && this.adapter.countItem('stick') < requiredSticks) {
      const neededSticks = requiredSticks - this.adapter.countItem('stick');
      const batchesNeeded = Math.ceil(neededSticks / 4);

      // Make sure we have enough planks for sticks
      let currentPlanks = 0;
      for (const p of plankTypes) currentPlanks += this.adapter.countItem(p);
      if (currentPlanks < (batchesNeeded * 2)) {
        const hasLog = logTypes.find(l => this.adapter.hasItem(l));
        if (hasLog) {
          const targetPlank = hasLog.replace('_log', '_planks');
          const pObj = this.resolver.getItemByName(targetPlank);
          const pRecipes = bot.recipesFor(pObj.id, null, 1, null);
          if (pRecipes.length > 0) {
            await Promise.race([
              bot.craft(pRecipes[0], 1, null),
              new Promise(r => setTimeout(r, 400))
            ]).catch(() => {});
            logger.info(`🔨 Auto-crafted ${targetPlank} from ${hasLog} for sticks`, 'SafeDSL');
          }
        }
      }

      const availablePlank = plankTypes.find(p => this.adapter.hasItem(p));
      if (availablePlank) {
        const stickObj = this.resolver.getItemByName('stick');
        const stickRecipes = bot.recipesFor(stickObj.id, null, 1, null);
        if (stickRecipes.length > 0) {
          for (let b = 0; b < batchesNeeded; b++) {
            await Promise.race([
              bot.craft(stickRecipes[0], 1, null),
              new Promise(r => setTimeout(r, 400))
            ]).catch(() => {});
          }
          logger.info(`🔨 Auto-crafted Sticks from Planks (${batchesNeeded} batches, ${batchesNeeded * 4} sticks) for recipe prerequisite.`, 'SafeDSL');
        }
      }
    }
  }

  isSolidFloor(block) {
    if (!block || !block.name) return false;
    const nonSolid = [
      'air', 'cave_air', 'void_air', 'water', 'flowing_water', 'lava', 'flowing_lava',
      'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush',
      'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip',
      'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower',
      'lily_of_the_valley', 'sunflower', 'lilac', 'rose_bush', 'peony',
      'torch', 'wall_torch', 'redstone_torch', 'redstone_wire', 'rail', 'sugar_cane',
      'sweet_berry_bush', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant',
      'snow', 'vine', 'hanging_roots'
    ];
    return !nonSolid.includes(block.name);
  }

  isPassableFoliage(block) {
    if (!block || !block.name) return false;
    const foliage = [
      'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush',
      'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip',
      'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower',
      'lily_of_the_valley', 'sunflower', 'lilac', 'rose_bush', 'peony',
      'torch', 'wall_torch', 'snow'
    ];
    return foliage.includes(block.name);
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

          const isOpenSpace = space && (space.name === 'air' || space.name === 'cave_air' || this.isPassableFoliage(space));
          const isSolidFloor = this.isSolidFloor(floor);

          if (isOpenSpace && isSolidFloor) {
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
    let targetName = itemName;
    if (itemName === 'planks' || itemName === 'oak_planks' || itemName === 'wood_planks') {
      const logTypes = ['spruce_log', 'birch_log', 'oak_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'cherry_log', 'mangrove_log'];
      const availableLog = logTypes.find(l => this.adapter.hasItem(l));
      if (availableLog) {
        targetName = availableLog.replace('_log', '_planks');
      }
    }
    const itemObj = this.resolver.getItemByName(targetName);
    if (!itemObj) throw new Error(`Unknown item name: '${targetName}'`);

    // Ensure prerequisite ingredients (sticks, planks) exist first
    await this.ensureIngredients(targetName, count);

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
            if (curSpace && this.isPassableFoliage(curSpace)) {
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
    await new Promise(r => setTimeout(r, 300));

    if (placedTablePos) {
      this._activeCraftingTablePos = placedTablePos;
    }

    return { success: this.adapter.hasItem(itemName), crafted: itemName, count };
  }

  /**
   * 📦 Tidily packs up deployed crafting table before traveling or descending into mines.
   */
  async packUpCraftingTable() {
    const nearby = this.adapter.findBlocks({ matching: 'crafting_table', maxDistance: 5.0, count: 1 });
    if (nearby.length > 0) {
      const table = this.adapter.getBlockAt(nearby[0]);
      if (table && table.name === 'crafting_table') {
        logger.info(`📦 [Housekeeping] Packing up Crafting Table at (${nearby[0].x}, ${nearby[0].y}, ${nearby[0].z}) before moving...`, 'SafeDSL');
        await this.safeDigBlock(table).catch(() => {});
        await this.navigateXZ(nearby[0].x + 0.5, nearby[0].z + 0.5, 0.4, 2000).catch(() => {});
      }
    }
    this._activeCraftingTablePos = null;
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

    // 3. Clean Housekeeping: Pick up the deployed Furnace so we NEVER leave it behind!
    if (placedFurnacePos && furnaceBlock) {
      logger.info('📦 [Housekeeping] Packing up Furnace back into inventory...', 'SafeDSL');
      const freshFurnace = this.adapter.getBlockAt(placedFurnacePos);
      if (freshFurnace && (freshFurnace.name === 'furnace' || freshFurnace.name === 'lit_furnace')) {
        await this.safeDigBlock(freshFurnace).catch(() => {});
        await this.navigateXZ(placedFurnacePos.x + 0.5, placedFurnacePos.z + 0.5, 0.4, 2000).catch(() => {});
      }
    }

    return { success: true, smelted: itemName, count: collected };
  }

  /**
   * Evaluates if an ore block is in a SAFE location to mine.
   * Skips submerged/underwater ores, lava/fire adjacent ores, mob-camped ores, and gravel drop traps.
   */
  isOreSafeToHarvest(bPos) {
    if (!bPos) return false;
    const now = Date.now();
    const key = `${bPos.x},${bPos.y},${bPos.z}`;
    if (this._unreachableOrePositions && this._unreachableOrePositions.has(key)) {
      if (this._unreachableOrePositions.get(key) > now) return false;
    }

    const oreBlock = this.adapter.getBlockAt(bPos);
    if (!oreBlock) return false;

    const adjacent = [
      new Vec3(bPos.x + 1, bPos.y, bPos.z),
      new Vec3(bPos.x - 1, bPos.y, bPos.z),
      new Vec3(bPos.x, bPos.y + 1, bPos.z),
      new Vec3(bPos.x, bPos.y - 1, bPos.z),
      new Vec3(bPos.x, bPos.y, bPos.z + 1),
      new Vec3(bPos.x, bPos.y, bPos.z - 1)
    ];

    const neighbors = adjacent.map(p => this.adapter.getBlockAt(p)).filter(Boolean);

    // Hazard 1: Lava proximity — Never mine ores touching or near lava/fire!
    const hasLava = neighbors.some(b => b.name.includes('lava') || b.name.includes('fire'));
    if (hasLava) {
      return false; // Extreme burn hazard!
    }

    // Hazard 2: Underwater / Drowning — Never mine submerged ores in lakes/oceans/flooded shafts!
    // Must have at least 1 breathable dry air space (air or cave_air)
    const hasDryBreathableAir = neighbors.some(b => b.name === 'air' || b.name === 'cave_air' || b.name === 'torch');
    const waterNeighbors = neighbors.filter(b => b.name.includes('water'));
    const isUnderWaterSource = neighbors.some(b => b.position.y > bPos.y && b.name.includes('water'));

    if (!hasDryBreathableAir || waterNeighbors.length >= 2 || isUnderWaterSource) {
      return false; // Drowning / flooded hazard!
    }

    // Hazard 3: Mob ambush / camping around the ore
    const hostiles = this.adapter.findHostiles(8);
    const nearbyHostiles = hostiles.filter(h => h.position && this.adapter.distanceTo(h.position) <= 5.0);
    const currentHp = this.adapter.bot?.health || 20;
    if (nearbyHostiles.length >= 2 || (nearbyHostiles.length >= 1 && currentHp <= 12)) {
      return false; // Mob threat hazard!
    }

    // Hazard 4: Suffocation from overhead falling gravel or sand
    const above = this.adapter.getBlockAt(new Vec3(bPos.x, bPos.y + 1, bPos.z));
    if (above && (above.name.includes('gravel') || above.name.includes('sand'))) {
      const twoAbove = this.adapter.getBlockAt(new Vec3(bPos.x, bPos.y + 2, bPos.z));
      if (twoAbove && (twoAbove.name.includes('gravel') || twoAbove.name.includes('sand'))) {
        return false; // Falling block suffocation hazard!
      }
    }

    return true;
  }

  /**
   * Finds all exposed ore blocks visible in nearby air/caves that the bot CAN harvest safely.
   */
  findNearbyExposedOres(maxDistance = 16, maxDistanceY = 6) {
    const hasDiamondPick = this.adapter.hasItem('diamond_pickaxe') || this.adapter.hasItem('netherite_pickaxe');
    const hasIronPick = hasDiamondPick || this.adapter.hasItem('iron_pickaxe');
    const hasStonePick = hasIronPick || this.adapter.hasItem('stone_pickaxe');
    const hasWoodenPick = hasStonePick || this.adapter.hasItem('wooden_pickaxe');

    // Opportunistic Memory: If high-tier ores (diamond, gold, redstone) are visible but we lack an Iron Pickaxe,
    // record their coordinates in long-term world memory so we can return and harvest them later!
    if (!hasIronPick && this.worldMemory) {
      const highTierOres = this.adapter.findBlocks({
        matching: ['diamond_ore', 'deepslate_diamond_ore', 'gold_ore', 'deepslate_gold_ore', 'ancient_debris'],
        maxDistance,
        maxDistanceY,
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
      allowedOres.push(
        'iron_ore', 'deepslate_iron_ore',
        'copper_ore', 'deepslate_copper_ore',
        'lapis_ore', 'deepslate_lapis_ore'
      );
    }
    if (hasIronPick) {
      allowedOres.push(
        'gold_ore', 'deepslate_gold_ore',
        'diamond_ore', 'deepslate_diamond_ore',
        'redstone_ore', 'deepslate_redstone_ore',
        'emerald_ore', 'deepslate_emerald_ore'
      );
    }
    if (hasDiamondPick) {
      allowedOres.push('ancient_debris');
    }

    const blocks = this.adapter.findBlocks({ matching: allowedOres, maxDistance, maxDistanceY, count: 25 });
    const currentPos = this.adapter.getPosition();
    return blocks.filter(bPos => Math.abs(bPos.y - currentPos.y) <= maxDistanceY && this.isOreSafeToHarvest(bPos));
  }

  /**
   * Mines an entire connected ore vein (BFS cluster extraction) down to the last block,
   * then steps over to vacuum all dropped loot into inventory.
   */
  async mineConnectedVein(startPos, oreNames) {
    if (!this._unreachableOrePositions) this._unreachableOrePositions = new Map();

    // 1. Approach vein first so bot is standing within comfortable arm reach (3.2m)
    const distToVein = this.adapter.eyeDistanceTo ? this.adapter.eyeDistanceTo(startPos) : this.adapter.distanceTo(startPos);
    if (distToVein > 4.0) {
      await this.adapter.gotoXZ(startPos.x, startPos.z, 3.2, 3500).catch(() => {});
      const afterDist = this.adapter.eyeDistanceTo ? this.adapter.eyeDistanceTo(startPos) : this.adapter.distanceTo(startPos);
      if (afterDist > 4.8) {
        logger.info(`Cannot reach ore vein at (${startPos.x}, ${startPos.y}, ${startPos.z}) (distance: ${afterDist.toFixed(1)}m > 4.8m). Skipping unreachable vein.`, 'SafeDSL');
        this._unreachableOrePositions.set(`${startPos.x},${startPos.y},${startPos.z}`, Date.now() + 30000);
        return 0;
      }
    }

    const queue = [startPos];
    const visited = new Set();
    visited.add(`${startPos.x},${startPos.y},${startPos.z}`);
    let minedCount = 0;

    while (queue.length > 0 && minedCount < 16) {
      // Threat check: If attacked or mob approached within 8m, halt vein mining immediately!
      const threats = this.adapter.findHostiles(8);
      if (threats.length > 0) {
        logger.info(`⚔️ [Threat Guard] Hostile '${threats[0].name}' approached during vein mining! Halting vein extraction to fight...`, 'SafeDSL');
        await this.adapter.autoEquipArmor().catch(() => {});
        await this.adapter.equipHighestAttackWeapon().catch(() => {});
        await this.adapter.attackEntity(threats[0]);
        break;
      }

      const current = queue.shift();
      const block = this.adapter.getBlockAt(current);
      if (block && oreNames.includes(block.name)) {
        logger.info(`⛏️ Mining connected ore '${block.name}' at (${current.x}, ${current.y}, ${current.z})...`, 'SafeDSL');
        const res = await this.safeDigBlock(block);
        if (res) {
          minedCount++;
        } else if (!this.adapter.hasPickaxe()) {
          logger.warn('🛑 [Vein Mining Halted] Pickaxe depleted! Halting vein extraction.', 'SafeDSL');
          break;
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
            if (nBlock && oreNames.includes(nBlock.name) && this.isOreSafeToHarvest(n)) {
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
      if (dist > 0.8) {
        const reached = await this.adapter.gotoXZ(drop.position.x, drop.position.z, 0.8, 2000).catch(() => false);
        if (!reached && drop.isValid) {
          await this.adapter.unstuck(drop.position);
          await this.adapter.gotoXZ(drop.position.x, drop.position.z, 0.8, 2000).catch(() => {});
        }
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

      const threats = this.adapter.findHostiles(8);
      if (threats.length > 0) {
        logger.info(`⚔️ [Threat Guard] Hostile '${threats[0].name}' in cave! Halting ore gathering to fight...`, 'SafeDSL');
        await this.adapter.autoEquipArmor().catch(() => {});
        await this.adapter.equipHighestAttackWeapon().catch(() => {});
        await this.adapter.attackEntity(threats[0]);
        break; // Break the whole ore loop to prioritize combat
      }

      if (!this.adapter.hasPickaxe()) {
        logger.warn('🛑 [Ore Gathering Halted] Pickaxe depleted! Stopping ore gathering.', 'SafeDSL');
        break;
      }

      const bObj = this.adapter.getBlockAt(bPos);
      if (bObj && bObj.name !== 'air' && bObj.name !== 'cave_air') {
        const minedInVein = await this.mineConnectedVein(bPos, [bObj.name, `deepslate_${bObj.name.replace('deepslate_', '')}`]);
        mined += minedInVein;
      }
    }

    if (mined > 0) {
      await this.collectNearbyDrops(10).catch(() => {});
    }
    return mined;
  }

  /**
   * Mines target ores safely with ore-specific tool requirements.
   */
  async mineOres(oreType, count = 1) {
    const cleanOre = (oreType || '').toLowerCase();
    const isHighTierOre = cleanOre.includes('gold') || cleanOre.includes('diamond') || cleanOre.includes('redstone') || cleanOre.includes('emerald');
    const isMediumTierOre = cleanOre.includes('iron') || cleanOre.includes('copper') || cleanOre.includes('lapis');

    // Upfront Tool Tier Guard: Prevent destroying rare ores without required pickaxe tier
    if (isHighTierOre && !this.adapter.hasPickaxe('iron_pickaxe')) {
      logger.warn(`🛑 [SafeDSL] Cannot mine '${oreType}'! Requires Iron Pickaxe or higher. Current tools cannot harvest this ore.`, 'SafeDSL');
      if (this.adapter?.botClient?.autonomousEngine) {
        this.adapter.botClient.autonomousEngine.reportToolTierInsufficient(`${cleanOre}_ore`, 'iron_pickaxe');
      }
      return { success: false, reason: 'requires_iron_pickaxe' };
    }

    if (isMediumTierOre && !this.adapter.hasPickaxe('stone_pickaxe')) {
      logger.warn(`🛑 [SafeDSL] Cannot mine '${oreType}'! Requires Stone Pickaxe or higher.`, 'SafeDSL');
      if (this.adapter?.botClient?.autonomousEngine) {
        this.adapter.botClient.autonomousEngine.reportToolTierInsufficient(`${cleanOre}_ore`, 'stone_pickaxe');
      }
      return { success: false, reason: 'requires_stone_pickaxe' };
    }

    const oreNames = [
      oreType,
      `${oreType}_ore`,
      `deepslate_${oreType}_ore`
    ];

    const isDiamond = oreType.includes('diamond');
    const isStoneLike = cleanOre.includes('stone') || cleanOre.includes('cobble') || cleanOre.includes('deepslate');
    const stoneMatches = ['stone', 'cobblestone', 'deepslate', 'cobbled_deepslate', 'andesite', 'diorite', 'granite', 'tuff'];
    let targetBlocks = [];

    if (isStoneLike) {
      // 🪨 Direct Stone / Cobblestone gathering: Scan solid stone blocks within reach
      targetBlocks = this.adapter.findBlocks({
        matching: stoneMatches,
        maxDistance: 16,
        maxDistanceY: 6,
        count: Math.max(16, count * 3),
      }).filter(bPos => {
        const above = this.adapter.getBlockAt(bPos.offset(0, 1, 0));
        return !above || (!above.name.includes('lava') && !above.name.includes('water'));
      });
    } else if (isDiamond) {
      // 💎 Diamonds: Absolute Top Priority — scan all diamond ores in 16m radius
      targetBlocks = this.adapter.findBlocks({ matching: ['diamond_ore', 'deepslate_diamond_ore'], maxDistance: 16, count: 10 });
    } else {
      // Standard ores: Find exposed ores
      targetBlocks = this.findNearbyExposedOres(16, 6).filter(bPos => {
        const b = this.adapter.getBlockAt(bPos);
        return b && (oreNames.includes(b.name) || b.name.includes(oreType));
      });
    }

    if (targetBlocks.length === 0) {
      const currentY = this.adapter.getPosition().y;
      if (isStoneLike) {
        logger.info('No exposed stone on surface. Digging down 2-3 blocks safely to expose stone...', 'SafeDSL');
        await this.digDown(3);
        const freshStone = this.adapter.findBlocks({ matching: stoneMatches, maxDistance: 8, maxDistanceY: 4, count: count * 2 });
        if (freshStone.length > 0) {
          targetBlocks = freshStone;
        } else {
          return await this.mineStrategically('stone', 55);
        }
      } else {
        if (currentY <= -53) {
          logger.info(`💎 Already at optimal Diamond depth Y=${Math.round(currentY)} (above bedrock). Switching to horizontal Fishbone/Strip Mining!`, 'SafeDSL');
          return await this.branchMine({ length: 15, spacing: 3, branchLength: 6 });
        }
        logger.info(`No ${oreType} ores visible nearby. Descending towards Y=${isDiamond ? -54 : 16}...`, 'SafeDSL');
        return await this.mineStrategically(oreType, isDiamond ? -54 : 16);
      }
    }

    // Sort by closest distance
    targetBlocks.sort((a, b) => this.adapter.distanceTo(a) - this.adapter.distanceTo(b));

    let totalMined = 0;
    let interruptedByThreat = false;

    for (const bPos of targetBlocks) {
      const threats = this.adapter.findHostiles(8);
      if (threats.length > 0) {
        logger.info(`⚔️ [Threat Guard] Hostile '${threats[0].name}' in area! Halting ore gathering to fight...`, 'SafeDSL');
        await this.adapter.autoEquipArmor().catch(() => {});
        await this.adapter.equipHighestAttackWeapon().catch(() => {});
        await this.adapter.attackEntity(threats[0]);
        interruptedByThreat = true;
        break;
      }

      const bObj = this.adapter.getBlockAt(bPos);
      const isMatch = isStoneLike
        ? (bObj && stoneMatches.includes(bObj.name))
        : (bObj && (oreNames.includes(bObj.name) || bObj.name.includes(oreType) || isDiamond));

      if (bObj && isMatch) {
        if (isStoneLike) {
          const dug = await this.safeDigBlock(bObj);
          if (dug) totalMined++;
          if (totalMined >= count) break;
        } else {
          const minedInVein = await this.mineConnectedVein(bPos, isDiamond ? ['diamond_ore', 'deepslate_diamond_ore'] : oreNames);
          totalMined += minedInVein;
          if (totalMined >= count) break;
        }
      }
    }

    if (interruptedByThreat) {
      return { success: false, reason: 'interrupted_by_combat' };
    }

    if (totalMined === 0) {
      const currentY = this.adapter.getPosition().y;
      if (currentY <= -53) {
        logger.info(`All visible ${oreType} ores were unreachable. Switching to horizontal Fishbone Mining at Y=${Math.round(currentY)}...`, 'SafeDSL');
        return await this.branchMine({ length: 15, spacing: 3, branchLength: 6 });
      }
      logger.info(`All visible ${oreType} ores were unreachable. Descending towards Y=${isDiamond ? -54 : 16}...`, 'SafeDSL');
      return await this.mineStrategically(oreType, isDiamond ? -54 : 16);
    }

    if (totalMined > 0) {
      logger.info(`📦 Sweeping and collecting all dropped items after mining ${totalMined} block(s)...`, 'SafeDSL');
      await this.collectNearbyDrops(10).catch(() => {});
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

    // Record chest inventory in worldMemory
    if (this.worldMemory) {
      const serverKey = this.adapter?.botClient?.getServerIdentifier?.() || null;
      const chestItems = (chest.items ? chest.items() : []).map(i => ({
        name: i.name,
        count: i.count,
      }));
      this.worldMemory.updateChest(
        serverKey,
        chestBlock.position,
        chestItems,
        'Base Storage Chest'
      );
    }

    chest.close();
    return true;
  }

  /**
   * Safely mines a 1x2 diagonal staircase downwards to target depth.
   * Default target depth is Y=16 (optimal Iron Ore level), avoiding digging down to Bedrock (-54) unnecessarily.
   */
  async staircaseMineDown(targetY = 16) {
    await this.packUpCraftingTable().catch(() => {});
    const current = this.adapter.getPosition();
    const safeTargetY = Math.max(-54, targetY);

    // Auto-record MineEntrance landmark when starting descent from surface
    if (current && current.y >= 55 && this.worldMemory) {
      const serverKey = this.adapter?.botClient?.getServerIdentifier?.() || null;
      const existing = this.worldMemory.getLandmarks(serverKey);
      if (!existing['MineEntrance']) {
        this.worldMemory.saveLandmark(
          serverKey,
          'MineEntrance',
          { x: Math.round(current.x * 10) / 10, y: Math.round(current.y * 10) / 10, z: Math.round(current.z * 10) / 10 },
          'ทางลงเหมืองบันไดหลัก'
        );
        this.worldMemory.recordDiaryEvent(
          serverKey,
          'เปิดปากทางเหมือง',
          `มูมิวเริ่มขุดบันไดลงเหมืองที่ (${Math.round(current.x)}, ${Math.round(current.y)}, ${Math.round(current.z)}) เพื่อค้นหาแร่ใต้พิภพ!`,
          'happy'
        );
      }
    }

    if (Math.round(current.y) <= safeTargetY) {
      logger.info(`🛑 [Target Depth Reached] Current depth Y=${Math.round(current.y)} <= ${safeTargetY}. Halting descent to start branch mining!`, 'SafeDSL');
      return await this.branchMine({ length: 15, spacing: 3, branchLength: 6 });
    }

    const effectiveTargetY = Math.max(-54, Math.min(safeTargetY, Math.round(current.y) - 2));

    // 1. Opportunistic Cave Exploration: If open cave or exposed ores are visible, explore the cave!
    const initialOres = this.findNearbyExposedOres(14);
    if (initialOres.length >= 3 && Math.round(current.y) < 60) {
      logger.info(`🦇 [Cave Discovery] Detected ${initialOres.length} exposed ores in open cave system! Halting staircase to explore cave...`, 'SafeDSL');
      return await this.exploreCave({ maxSteps: 25, maxDurationSec: 60 });
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
    this._staircaseDir = dir;

    for (let step = 0; step < 4; step++) {
      // Threat check: If attacked or mob approached within 8m, halt staircase digging immediately!
      const threats = this.adapter.findHostiles(8);
      if (threats.length > 0) {
        logger.info(`⚔️ [Threat Guard] Hostile '${threats[0].name}' in mine shaft! Halting staircase digging to fight...`, 'SafeDSL');
        await this.adapter.autoEquipArmor().catch(() => {});
        await this.adapter.equipHighestAttackWeapon().catch(() => {});
        await this.adapter.attackEntity(threats[0]);
        break;
      }

      const pos = this.adapter.getPosition();
      if (pos.y <= effectiveTargetY && step >= 2) break;

      // Check hazards for both step 1 and step 2 ahead using arm reach
      const step1Top = this.adapter.getBlockAt(pos.offset(dir.x, 1, dir.z));
      const step1Head = this.adapter.getBlockAt(pos.offset(dir.x, 0, dir.z));
      const step1Feet = this.adapter.getBlockAt(pos.offset(dir.x, -1, dir.z));

      const step2Top = this.adapter.getBlockAt(pos.offset(dir.x * 2, 0, dir.z * 2));
      const step2Head = this.adapter.getBlockAt(pos.offset(dir.x * 2, -1, dir.z * 2));
      const step2Feet = this.adapter.getBlockAt(pos.offset(dir.x * 2, -2, dir.z * 2));

      // 💧 Water & Lava Hazard Avoidance (เลี่ยงน้ำ ถอยหลัง อุดรู และเจาะทางใหม่ในหินแห้ง)
      const currentBlock = this.adapter.getBlockAt(pos);
      const isSubmerged = currentBlock && (currentBlock.name.includes('water') || currentBlock.name.includes('lava'));
      const hasLiquid = isSubmerged || [step1Top, step1Head, step1Feet, step2Top, step2Head, step2Feet].some(b => b && (b.name.includes('water') || b.name.includes('lava')));

      if (hasLiquid) {
        logger.warn(`💧 Water/liquid hazard detected at mine front (${dir.x}, ${dir.z})! Avoiding water, stepping back, and carving new dry path...`, 'SafeDSL');

        // 1. Seal/Plug water leak with solid block if possible
        const leakBlock = [step1Feet, step1Head, step1Top, step2Feet, step2Head, step2Top].find(b => b && (b.name.includes('water') || b.name.includes('lava')));
        if (leakBlock) {
          const plugMat = ['cobblestone', 'dirt', 'stone', 'deepslate', 'gravel'].find(m => this.adapter.hasItem(m));
          if (plugMat) {
            const support = this.adapter.getBlockAt(pos.offset(0, -1, 0));
            if (support) await this.safePlaceBlock(support, dir, plugMat).catch(() => {});
          }
        }

        // 2. Step back 2 blocks along dry shaft
        logger.info('🔙 Stepping back 2 blocks to escape water flow...', 'SafeDSL');
        await this.navigateXZ(pos.x - dir.x * 2, pos.z - dir.z * 2, 0.4, 2500).catch(() => {});

        // 3. Pivot into an alternate dry orthogonal direction to carve a new path
        const newPos = this.adapter.getPosition();
        const altDirs = directions.filter(d => d.x !== dir.x || d.z !== dir.z);
        const dryAlt = altDirs.find(d => {
          const f = this.adapter.getBlockAt(newPos.offset(d.x, -1, d.z));
          const h = this.adapter.getBlockAt(newPos.offset(d.x, 0, d.z));
          const t = this.adapter.getBlockAt(newPos.offset(d.x, 1, d.z));
          return ![f, h, t].some(b => b && (b.name.includes('water') || b.name.includes('lava')));
        });

        if (dryAlt) {
          dir = dryAlt;
          logger.info(`🔄 Successfully pivoted staircase into dry rock (${dir.x}, ${dir.z}). Carving new dry path down...`, 'SafeDSL');
          continue;
        } else {
          logger.warn('⚠️ All immediate headings flooded. Halting descent in water to preserve oxygen.', 'SafeDSL');
          break;
        }
      }

      // Dig Step 2 ahead first (furthest reach), then Step 1 using human arm reach
      if (step2Top && step2Top.name !== 'air' && !step2Top.name.includes('water')) await this.safeDigBlock(step2Top, { skipVacuum: true });
      if (step2Head && step2Head.name !== 'air' && !step2Head.name.includes('water')) await this.safeDigBlock(step2Head, { skipVacuum: true });
      if (step2Feet && step2Feet.name !== 'air' && !step2Feet.name.includes('water')) await this.safeDigBlock(step2Feet, { skipVacuum: true });

      if (step1Top && step1Top.name !== 'air' && !step1Top.name.includes('water')) await this.safeDigBlock(step1Top, { skipVacuum: true });
      if (step1Head && step1Head.name !== 'air' && !step1Head.name.includes('water')) await this.safeDigBlock(step1Head, { skipVacuum: true });
      if (step1Feet && step1Feet.name !== 'air' && !step1Feet.name.includes('water')) await this.safeDigBlock(step1Feet, { skipVacuum: true });

      if (!this.adapter.hasPickaxe()) {
        logger.warn('🛑 [Staircase Mining Halted] Pickaxe depleted! Stopping descent to allow AI re-planning.', 'SafeDSL');
        break;
      }

      await this.navigateXZ(pos.x + dir.x, pos.z + dir.z, 0.4, 2000);

      // 💎 Opportunistic Ore Extraction: Check for exposed ores along staircase walls, floor, and ceiling
      const wallOres = this.findNearbyExposedOres(4);
      if (wallOres.length > 0) {
        logger.info(`💎 [Staircase Mining] Revealed ore vein during descent! Extracting vein...`, 'SafeDSL');
        await this.mineAllNearbyOres(5, 6);
        await this.collectNearbyDrops(6);
      }

      // Place torch every 4-5 blocks if dark on dry ground
      if (step === 3 && this.adapter.shouldPlaceTorch(6)) {
        const floor = this.adapter.getBlockAt(this.adapter.getPosition().offset(0, -1, 0));
        if (floor && floor.name !== 'air' && floor.name !== 'cave_air' && !floor.name.includes('water')) {
          await this.safePlaceBlock(floor, new Vec3(0, 1, 0), 'torch');
        }
      }
    }
    await this.collectNearbyDrops(8).catch(() => {});
    return { reached: this.adapter.getPosition().y <= targetY, depth: this.adapter.getPosition().y };
  }

  /**
   * 🐟 Branch / Fishbone Mining: Excavates a main tunnel and side branches every 3 blocks.
   * Maximizes ore discovery efficiency at optimal mining depth (e.g. Y=16 or Y=-54).
   */
  async branchMine(options = {}) {
    await this.packUpCraftingTable().catch(() => {});
    const mainLength = options.length || 12;
    const branchSpacing = options.spacing || 3;
    const branchLength = options.branchLength || 5;
    const initialPos = this.adapter.getPosition();
    const currentY = Math.round(initialPos.y);

    logger.info(`🐟 [Fishbone Mining] Starting Branch Mining at Y=${currentY} (Main: ${mainLength}m, Branches: ${branchLength}m every ${branchSpacing}m)...`, 'SafeDSL');

    const forwardDir = new Vec3(1, 0, 0);
    const leftDir = new Vec3(0, 0, 1);
    const rightDir = new Vec3(0, 0, -1);

    let totalOresFound = 0;

    for (let step = 0; step < mainLength; step += 3) {
      // Threat check
      const threats = this.adapter.findHostiles(8);
      if (threats.length > 0) {
        logger.info(`⚔️ [Threat Guard] Hostile '${threats[0].name}' in mine branch! Halting mining to engage...`, 'SafeDSL');
        await this.adapter.autoEquipArmor().catch(() => {});
        await this.adapter.equipHighestAttackWeapon().catch(() => {});
        await this.adapter.attackEntity(threats[0]);
        break;
      }

      const curPos = this.adapter.getPosition();
      // Reach forward: Dig up to 4 blocks ahead from standing position using natural human arm reach!
      let flooded = false;
      for (let d = 1; d <= 4; d++) {
        const h = this.adapter.getBlockAt(curPos.offset(forwardDir.x * d, 1, forwardDir.z * d));
        const f = this.adapter.getBlockAt(curPos.offset(forwardDir.x * d, 0, forwardDir.z * d));
        if ([h, f].some(b => b && (b.name.includes('water') || b.name.includes('lava')))) {
          flooded = true;
          break;
        }
      }

      // 💧 Water/Lava avoidance in branch mine: Never dig into flooded rock!
      if (flooded) {
        logger.warn('💧 Flooded tunnel/aquifer detected ahead! Sealing branch and halting forward mining...', 'SafeDSL');
        const plugMat = ['cobblestone', 'dirt', 'stone', 'deepslate'].find(m => this.adapter.hasItem(m));
        if (plugMat) {
          const support = this.adapter.getBlockAt(curPos.offset(0, -1, 0));
          if (support) await this.safePlaceBlock(support, forwardDir, plugMat).catch(() => {});
        }
        break;
      }

      // Dig depth 4 down to 1 (furthest to closest) using human reach
      for (let depth = 4; depth >= 1; depth--) {
        const headBlock = this.adapter.getBlockAt(curPos.offset(forwardDir.x * depth, 1, forwardDir.z * depth));
        const feetBlock = this.adapter.getBlockAt(curPos.offset(forwardDir.x * depth, 0, forwardDir.z * depth));
        if (headBlock && headBlock.name !== 'air' && !headBlock.name.includes('water')) {
          await this.safeDigBlock(headBlock, { skipVacuum: true });
        }
        if (feetBlock && feetBlock.name !== 'air' && !feetBlock.name.includes('water')) {
          await this.safeDigBlock(feetBlock, { skipVacuum: true });
        }
        if (!this.adapter.hasPickaxe()) break;
      }

      if (!this.adapter.hasPickaxe()) {
        logger.warn('🛑 [Branch Mining Halted] Pickaxe depleted! Stopping branch mine to allow AI re-planning.', 'SafeDSL');
        break;
      }

      // Step forward 3 blocks into newly cleared corridor (smoothly collects drops)
      await this.navigateXZ(curPos.x + forwardDir.x * 3, curPos.z + forwardDir.z * 3, 0.4, 2500);

      // Place torch along main tunnel
      if (step % 6 === 0 && this.adapter.shouldPlaceTorch(6)) {
        const floor = this.adapter.getBlockAt(this.adapter.getPosition().offset(0, -1, 0));
        if (floor && floor.name !== 'air' && floor.name !== 'cave_air' && !floor.name.includes('water')) {
          await this.safePlaceBlock(floor, new Vec3(0, 1, 0), 'torch');
        }
      }

      // Check for exposed ores along main tunnel
      const exposed = this.findNearbyExposedOres(6);
      if (exposed.length > 0) {
        const mined = await this.mineAllNearbyOres(8, 4);
        totalOresFound += mined;
      }

      // Every branchSpacing blocks, dig side branches to the left and right using human reach (up to 4 blocks deep)!
      if (step > 0 && step % branchSpacing === 0) {
        const branchHubPos = this.adapter.getPosition();

        // 1. Left Branch (Reaching up to 4 blocks deep from standing position)
        logger.info(`🌿 Digging left branch at step ${step} (${branchLength}m)...`, 'SafeDSL');
        for (let b = 0; b < branchLength; b += 3) {
          const bPos = this.adapter.getPosition();
          const maxReach = Math.min(4, branchLength - b);
          for (let depth = maxReach; depth >= 1; depth--) {
            const bHead = this.adapter.getBlockAt(bPos.offset(leftDir.x * depth, 1, leftDir.z * depth));
            const bFeet = this.adapter.getBlockAt(bPos.offset(leftDir.x * depth, 0, leftDir.z * depth));
            if (bHead && bHead.name !== 'air' && !bHead.name.includes('water')) await this.safeDigBlock(bHead, { skipVacuum: true });
            if (bFeet && bFeet.name !== 'air' && !bFeet.name.includes('water')) await this.safeDigBlock(bFeet, { skipVacuum: true });
            if (!this.adapter.hasPickaxe()) break;
          }

          if (!this.adapter.hasPickaxe()) {
            logger.warn('🛑 [Branch Mining Halted] Pickaxe depleted in side branch! Stopping.', 'SafeDSL');
            break;
          }

          if (branchLength - b > 3) {
            await this.navigateXZ(bPos.x + leftDir.x * 3, bPos.z + leftDir.z * 3, 0.4, 2000);
          }

          const branchOres = this.findNearbyExposedOres(4);
          if (branchOres.length > 0) {
            totalOresFound += await this.mineAllNearbyOres(6, 4);
          }
        }
        // Return to main tunnel hub
        await this.navigateXZ(branchHubPos.x, branchHubPos.z, 0.4, 3000);

        // 2. Right Branch (Reaching up to 4 blocks deep from standing position)
        logger.info(`🌿 Digging right branch at step ${step} (${branchLength}m)...`, 'SafeDSL');
        for (let b = 0; b < branchLength; b += 3) {
          const bPos = this.adapter.getPosition();
          const maxReach = Math.min(4, branchLength - b);
          for (let depth = maxReach; depth >= 1; depth--) {
            const bHead = this.adapter.getBlockAt(bPos.offset(rightDir.x * depth, 1, rightDir.z * depth));
            const bFeet = this.adapter.getBlockAt(bPos.offset(rightDir.x * depth, 0, rightDir.z * depth));
            if (bHead && bHead.name !== 'air' && !bHead.name.includes('water')) await this.safeDigBlock(bHead, { skipVacuum: true });
            if (bFeet && bFeet.name !== 'air' && !bFeet.name.includes('water')) await this.safeDigBlock(bFeet, { skipVacuum: true });
            if (!this.adapter.hasPickaxe()) break;
          }

          if (!this.adapter.hasPickaxe()) {
            logger.warn('🛑 [Branch Mining Halted] Pickaxe depleted in side branch! Stopping.', 'SafeDSL');
            break;
          }

          if (branchLength - b > 3) {
            await this.navigateXZ(bPos.x + rightDir.x * 3, bPos.z + rightDir.z * 3, 0.4, 2000);
          }

          const branchOres = this.findNearbyExposedOres(4);
          if (branchOres.length > 0) {
            totalOresFound += await this.mineAllNearbyOres(6, 4);
          }
        }
        // Return to main tunnel hub
        await this.navigateXZ(branchHubPos.x, branchHubPos.z, 0.4, 3000);
      }
    }

    await this.collectNearbyDrops(12).catch(() => {});
    return { success: true, oresFound: totalOresFound };
  }

  /**
   * 🚇 Strip / Tunnel Mining: Digs a straight 1x2 or 2x2 horizontal tunnel to discover ore veins.
   */
  async stripMine(options = {}) {
    await this.packUpCraftingTable().catch(() => {});
    const length = options.length || 16;
    const forwardDir = new Vec3(1, 0, 0);
    logger.info(`🚇 [Strip Mining] Excavating straight 1x2 tunnel forward (${length} blocks)...`, 'SafeDSL');

    let totalOres = 0;
    for (let step = 0; step < length; step += 3) {
      const threats = this.adapter.findHostiles(8);
      if (threats.length > 0) {
        logger.info(`⚔️ [Threat Guard] Hostile '${threats[0].name}' in tunnel! Halting to fight...`, 'SafeDSL');
        await this.adapter.autoEquipArmor().catch(() => {});
        await this.adapter.equipHighestAttackWeapon().catch(() => {});
        await this.adapter.attackEntity(threats[0]);
        break;
      }

      const curPos = this.adapter.getPosition();
      // Check hazards first across depth 1..4
      let flooded = false;
      for (let d = 1; d <= 4; d++) {
        const h = this.adapter.getBlockAt(curPos.offset(forwardDir.x * d, 1, forwardDir.z * d));
        const f = this.adapter.getBlockAt(curPos.offset(forwardDir.x * d, 0, forwardDir.z * d));
        if ([h, f].some(b => b && (b.name.includes('water') || b.name.includes('lava')))) {
          flooded = true;
          break;
        }
      }

      if (flooded) {
        logger.warn('💧 Flooded tunnel/aquifer detected ahead! Halting strip mining...', 'SafeDSL');
        break;
      }

      // Reach up to 4 blocks deep using human arm reach (depth = 4 down to 1)
      for (let depth = 4; depth >= 1; depth--) {
        const head = this.adapter.getBlockAt(curPos.offset(forwardDir.x * depth, 1, forwardDir.z * depth));
        const feet = this.adapter.getBlockAt(curPos.offset(forwardDir.x * depth, 0, forwardDir.z * depth));
        if (head && head.name !== 'air' && !head.name.includes('water')) await this.safeDigBlock(head, { skipVacuum: true });
        if (feet && feet.name !== 'air' && !feet.name.includes('water')) await this.safeDigBlock(feet, { skipVacuum: true });
        if (!this.adapter.hasPickaxe()) break;
      }

      if (!this.adapter.hasPickaxe()) {
        logger.warn('🛑 [Strip Mining Halted] Pickaxe depleted! Stopping strip mine.', 'SafeDSL');
        break;
      }

      await this.navigateXZ(curPos.x + forwardDir.x * 3, curPos.z + forwardDir.z * 3, 0.4, 2500);

      if (step % 6 === 0 && this.adapter.shouldPlaceTorch(6)) {
        const floor = this.adapter.getBlockAt(this.adapter.getPosition().offset(0, -1, 0));
        if (floor && floor.name !== 'air' && floor.name !== 'cave_air' && !floor.name.includes('water')) {
          await this.safePlaceBlock(floor, new Vec3(0, 1, 0), 'torch');
        }
      }

      const exposed = this.findNearbyExposedOres(6);
      if (exposed.length > 0) {
        totalOres += await this.mineAllNearbyOres(8, 4);
      }
    }

    return { success: true, oresFound: totalOres };
  }

  /**
   * 🕳️ 2x1 Safe Vertical Shaft Descent:
   * Pro-Minecraft Technique: Stands directly on the center seam (border) between 2 blocks.
   * Player hitbox (0.6m) straddles both blocks simultaneously so digging one side never drops the player.
   */
  async safeShaftMine2x1(targetY = 16) {
    await this.packUpCraftingTable().catch(() => {});
    const startPos = this.adapter.getPosition();
    const safeTargetY = Math.max(-54, targetY);

    if (Math.round(startPos.y) <= safeTargetY) {
      logger.info(`🛑 [Safety Floor] Already at deep safe mining level Y=${Math.round(startPos.y)} <= ${safeTargetY}. Switching to horizontal Strip/Branch Mining!`, 'SafeDSL');
      return await this.stripMine({ length: 18 });
    }

    const effectiveTargetY = Math.max(-54, Math.min(safeTargetY, Math.round(startPos.y) - 6));
    
    // Choose 2 adjacent blocks along X-axis: Block A (west) and Block B (east)
    const baseBlockX = Math.floor(startPos.x);
    const baseBlockZ = Math.floor(startPos.z);
    const seamX = baseBlockX + 1.0; // The exact edge/seam dividing Block A (X) and Block B (X+1)
    const seamZ = baseBlockZ + 0.5; // Center along Z

    logger.info(`🕳️ [2x1 Safe Shaft] Positioning precisely on the seam (X=${seamX}, Z=${seamZ}) straddling 2 blocks down to Y=${effectiveTargetY}...`, 'SafeDSL');

    // 1. Walk directly onto the border seam between the two blocks
    await this.navigateXZ(seamX, seamZ, 0.1, 2500);

    let currentBaseY = Math.round(startPos.y);

    while (currentBaseY > effectiveTargetY && currentBaseY > -54) {
      // Keep bot centered on the seam
      await this.navigateXZ(seamX, seamZ, 0.15, 800).catch(() => {});

      const blockAPos = new Vec3(baseBlockX, currentBaseY - 1, baseBlockZ);
      const blockBPos = new Vec3(baseBlockX + 1, currentBaseY - 1, baseBlockZ);

      // --- STEP 1: Dig Block A while firmly supported by Block B ---
      const blockA = this.adapter.getBlockAt(blockAPos);
      if (blockA && blockA.name !== 'air' && !blockA.name.includes('water')) {
        await this.adapter.lookAt(new Vec3(blockAPos.x + 0.5, currentBaseY - 1 + 0.5, blockAPos.z + 0.5));
        await this.safeDigBlock(blockA);
      }

      // --- STEP 2: Safety Hazard Scan beneath Block A ---
      // Check for lava lake, void, or extreme drop (> 3 blocks) beneath Block A
      const deepUnderA = this.adapter.getBlockAt(blockAPos.offset(0, -1, 0));
      const isHazard = deepUnderA && (deepUnderA.name.includes('lava') || deepUnderA.name.includes('void'));
      const isCaveAirDrop = deepUnderA && (deepUnderA.name === 'air' || deepUnderA.name === 'cave_air');

      if (isHazard || isCaveAirDrop) {
        logger.warn(`⚠️ [Hazard Pre-detection] Dangerous cavern/liquid detected beneath Block A! Sealing shaft and halting descent to prevent fall...`, 'SafeDSL');
        const plugMat = ['cobblestone', 'dirt', 'stone', 'deepslate'].find(m => this.adapter.hasItem(m));
        if (plugMat) {
          const support = this.adapter.getBlockAt(blockAPos.offset(0, -1, 0));
          if (support) await this.safePlaceBlock(support, new Vec3(0, 1, 0), plugMat).catch(() => {});
        }
        break;
      }

      // --- STEP 3: Dig Block B while supported by the hole floor of Block A ---
      const blockB = this.adapter.getBlockAt(blockBPos);
      if (blockB && blockB.name !== 'air' && !blockB.name.includes('water')) {
        await this.adapter.lookAt(new Vec3(blockBPos.x + 0.5, currentBaseY - 1 + 0.5, blockBPos.z + 0.5));
        await this.safeDigBlock(blockB);
      }

      // Once both blocks are broken, the bot drops 1 block down safely into the shaft
      await new Promise(r => setTimeout(r, 180));
      currentBaseY--;

      // Check for exposed wall ores around the 2x1 shaft
      const wallOres = this.findNearbyExposedOres(3);
      if (wallOres.length > 0) {
        logger.info(`💎 [2x1 Shaft] Exposed ore vein in shaft wall! Extracting...`, 'SafeDSL');
        await this.mineAllNearbyOres(4, 4);
        await this.collectNearbyDrops(4);
        // Re-center on seam after mining wall ore
        await this.navigateXZ(seamX, seamZ, 0.15, 1000).catch(() => {});
      }

      // Place torch on wall every 6 blocks
      if (currentBaseY % 6 === 0 && this.adapter.shouldPlaceTorch(5)) {
        const wall = this.adapter.getBlockAt(new Vec3(baseBlockX - 1, currentBaseY, baseBlockZ));
        if (wall && wall.name !== 'air' && wall.name !== 'cave_air') {
          await this.safePlaceBlock(wall, new Vec3(1, 0, 0), 'torch').catch(() => {});
        }
      }
    }

    return { success: true, reachedY: currentBaseY };
  }

  /**
   * 🦇 Cave Spelunking & Natural Cave Exploration:
   * Traverses underground cave systems, lights dark tunnels with torches, and harvests all exposed wall/ceiling/floor ores.
   */
  async exploreCave(options = {}) {
    await this.packUpCraftingTable().catch(() => {});
    const maxSteps = options.maxSteps || 20;
    const maxDurationSec = options.maxDurationSec || 45;
    const startTime = Date.now();

    logger.info(`🦇 [Cave Spelunking] Starting Cave System Exploration (maxSteps: ${maxSteps}, maxDuration: ${maxDurationSec}s)...`, 'SafeDSL');

    let totalOresHarvested = 0;
    const visitedPositions = new Set();

    for (let step = 0; step < maxSteps; step++) {
      if ((Date.now() - startTime) > (maxDurationSec * 1000)) {
        logger.info('🦇 [Cave Spelunking] Max exploration duration reached. Ending spelunking pass.', 'SafeDSL');
        break;
      }

      // 1. Threat & Combat Check
      const threats = this.adapter.findHostiles(9);
      if (threats.length > 0) {
        logger.info(`⚔️ [Cave Combat] Hostile '${threats[0].name}' encountered in cave! Engaging threat...`, 'SafeDSL');
        await this.adapter.autoEquipArmor().catch(() => {});
        await this.adapter.equipHighestAttackWeapon().catch(() => {});
        await this.adapter.attackEntity(threats[0]);
      }

      // 2. Harvest all exposed ores visible from current cave vantage point
      const visibleOres = this.findNearbyExposedOres(14);
      if (visibleOres.length > 0) {
        logger.info(`💎 [Cave Spelunking] Found ${visibleOres.length} exposed ores in cave sector! Harvesting...`, 'SafeDSL');
        const mined = await this.mineAllNearbyOres(14, 8);
        totalOresHarvested += mined;
      }

      if (!this.adapter.hasPickaxe()) {
        logger.warn('🛑 [Cave Spelunking Halted] Pickaxe depleted! Ending cave exploration pass to allow AI re-planning.', 'SafeDSL');
        break;
      }

      // 3. Place torch if dark on dry cave floor or wall
      if (this.adapter.shouldPlaceTorch(6)) {
        const floor = this.adapter.getBlockAt(this.adapter.getPosition().offset(0, -1, 0));
        if (floor && floor.name !== 'air' && floor.name !== 'cave_air' && !floor.name.includes('water') && !floor.name.includes('lava')) {
          await this.safePlaceBlock(floor, new Vec3(0, 1, 0), 'torch').catch(() => {});
        }
      }

      // 4. Find next walkable cave floor node that hasn't been visited yet
      const curPos = this.adapter.getPosition();
      const currentKey = `${Math.floor(curPos.x / 4)},${Math.floor(curPos.z / 4)}`;
      visitedPositions.add(currentKey);

      // Search for open cave air spaces with walkable solid floor below within 12m
      const candidateNodes = [];
      for (let dx = -8; dx <= 8; dx += 2) {
        for (let dz = -8; dz <= 8; dz += 2) {
          for (let dy = -4; dy <= 4; dy++) {
            const checkPos = new Vec3(Math.floor(curPos.x) + dx, Math.floor(curPos.y) + dy, Math.floor(curPos.z) + dz);
            const head = this.adapter.getBlockAt(checkPos.offset(0, 1, 0));
            const feet = this.adapter.getBlockAt(checkPos);
            const floor = this.adapter.getBlockAt(checkPos.offset(0, -1, 0));

            const isOpenAir = head && (head.name === 'air' || head.name === 'cave_air') &&
                             feet && (feet.name === 'air' || feet.name === 'cave_air');
            const isWalkableFloor = floor && floor.name !== 'air' && floor.name !== 'cave_air' && !floor.name.includes('water') && !floor.name.includes('lava') && floor.name !== 'bedrock';

            if (isOpenAir && isWalkableFloor) {
              const nodeKey = `${Math.floor(checkPos.x / 4)},${Math.floor(checkPos.z / 4)}`;
              const dist = this.adapter.distanceTo(checkPos);
              if (dist >= 3.0 && dist <= 12.0 && !visitedPositions.has(nodeKey)) {
                candidateNodes.push({ pos: checkPos, dist, key: nodeKey });
              }
            }
          }
        }
      }

      if (candidateNodes.length === 0) {
        logger.info('🦇 [Cave Spelunking] No further unexplored cave passages in current sector.', 'SafeDSL');
        break;
      }

      // Sort candidate nodes: Prefer nodes that lead deeper or towards unexplored areas
      candidateNodes.sort((a, b) => a.pos.y - b.pos.y || a.dist - b.dist);
      const nextTarget = candidateNodes[0];

      logger.info(`🦇 [Cave Spelunking] Walking along cave tunnel to (${nextTarget.pos.x}, ${nextTarget.pos.y}, ${nextTarget.pos.z})...`, 'SafeDSL');
      visitedPositions.add(nextTarget.key);
      await this.adapter.gotoXZ(nextTarget.pos.x, nextTarget.pos.z, 1.5, 4000).catch(() => {});
    }

    logger.info(`🦇 [Cave Spelunking] Completed cave exploration run. Total ores harvested: ${totalOresHarvested}`, 'SafeDSL');
    return { success: true, oresMined: totalOresHarvested };
  }

  /**
   * 🧠 Smart Strategic Mining Selector:
   * Dynamically chooses between Cave Spelunking, Staircase Descent, 2x1 Vertical Shaft, Fishbone Mining, or Strip Mining!
   */
  async mineStrategically(oreType = 'iron', targetDepth = null) {
    const currentY = this.adapter.getPosition().y;
    const optimalDepth = targetDepth !== null ? targetDepth : (oreType === 'diamond' ? -54 : 16);

    // 0. If open cave with exposed ores is visible nearby underground, explore the natural cave first!
    const caveOres = this.findNearbyExposedOres(16);
    if (currentY < 60 && caveOres.length >= 2) {
      logger.info(`🦇 [Strategy] Detected open cave system with ${caveOres.length} exposed ores at Y=${Math.round(currentY)}! Prioritizing Cave Spelunking & Exploration...`, 'SafeDSL');
      return await this.exploreCave({ maxSteps: 25, maxDurationSec: 60 });
    }

    // 1. If we are high above the target depth, descend using safe Staircase!
    if (currentY > optimalDepth + 3) {
      logger.info(`🪜 [Strategy] Current depth Y=${Math.round(currentY)} is above target Y=${optimalDepth}. Digging safe diagonal staircase down...`, 'SafeDSL');
      return await this.staircaseMineDown(optimalDepth);
    }

    // 2. Once at optimal depth, prioritize Horizontal Strip Mining (อุโมงค์ตรง) and Fishbone Mining!
    if (Math.random() < 0.6) {
      logger.info(`🚇 [Strategy] At optimal ore depth Y=${Math.round(currentY)}. Executing Strip Mining (ขุดอุโมงค์ทางตรง 1x2 ยาว 18 บล็อก)!`, 'SafeDSL');
      return await this.stripMine({ length: 18 });
    } else {
      logger.info(`🐟 [Strategy] At optimal ore depth Y=${Math.round(currentY)}. Executing High-Efficiency Fishbone (ก้างปลา) Mining!`, 'SafeDSL');
      return await this.branchMine({ length: 15, spacing: 3, branchLength: 6 });
    }
  }

  /**
   * Climbs the excavated staircase tunnel back up to the surface.
   */
  async climbStaircaseUp(targetY = 64) {
    const current = this.adapter.getPosition();
    logger.info(`🪜 Climbing staircase back up from Y=${Math.round(current.y)} towards target Y=${targetY}...`, 'SafeDSL');
    const reverseDir = this._staircaseDir ? this._staircaseDir.scaled(-1) : new Vec3(-1, 0, 0);
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
      const targetZ = Math.floor(pos.z) + reverseDir.z;

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
      if (item && item.isValid && item.position) {
        const currentDist = this.adapter.distanceTo(item.position);
        if (currentDist > 0.8) {
          const reached = await this.adapter.gotoXZ(item.position.x, item.position.z, 0.8, 2500).catch(() => false);
          if (!reached && item.isValid) {
            logger.info(`🚧 [CollectDrops] Obstructed on route to '${item.name || 'item'}'. Clearing obstacles & jumping forward...`, 'SafeDSL');
            await this.adapter.unstuck(item.position);
            await this.adapter.gotoXZ(item.position.x, item.position.z, 0.8, 2000).catch(() => {});

            // Direct hop forward if within close reach (< 2.2m)
            if (this.adapter.distanceTo(item.position) < 2.2 && this.adapter.bot) {
              await this.adapter.lookAt(item.position).catch(() => {});
              this.adapter.bot.setControlState('forward', true);
              this.adapter.bot.setControlState('jump', true);
              await new Promise(r => setTimeout(r, 400));
              this.adapter.bot.clearControlStates();
            }
          }
        }
        await new Promise(r => setTimeout(r, 80));
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
   * Finds nearest bed (all 16 colors) or places one from inventory and sleeps through the night.
   */
  async goToBed() {
    const allBedColors = [
      'white_bed', 'orange_bed', 'magenta_bed', 'light_blue_bed', 'yellow_bed',
      'lime_bed', 'pink_bed', 'gray_bed', 'light_gray_bed', 'cyan_bed',
      'purple_bed', 'blue_bed', 'brown_bed', 'green_bed', 'red_bed', 'black_bed'
    ];

    let beds = this.adapter.findBlocks({ matching: allBedColors, maxDistance: 32, count: 1 });
    let placedFromInventory = false;

    // If no bed is placed nearby, check if we carry one in inventory
    if (beds.length === 0) {
      const invBed = this.adapter.getInventory().find(i => i.name && i.name.endsWith('_bed'));
      if (invBed) {
        logger.info(`🛏️ [Bed Deployment] Carrying '${invBed.name}' in inventory. Finding a spot to place bed...`, 'SafeDSL');
        const pos = this.adapter.getPosition();
        const candidateOffsets = [
          new Vec3(1, 0, 0),
          new Vec3(-1, 0, 0),
          new Vec3(0, 0, 1),
          new Vec3(0, 0, -1)
        ];

        for (const off of candidateOffsets) {
          const supportPos = new Vec3(Math.floor(pos.x) + off.x, Math.floor(pos.y) - 1, Math.floor(pos.z) + off.z);
          const bedHeadSupport = supportPos.offset(off.x, 0, off.z);
          const placePos = supportPos.offset(0, 1, 0);
          const placeHeadPos = bedHeadSupport.offset(0, 1, 0);

          const supportBlock = this.adapter.getBlockAt(supportPos);
          const headSupportBlock = this.adapter.getBlockAt(bedHeadSupport);
          const targetBlock = this.adapter.getBlockAt(placePos);
          const targetHeadBlock = this.adapter.getBlockAt(placeHeadPos);

          const isSupportSolid = supportBlock && !['air', 'cave_air', 'water', 'lava'].includes(supportBlock.name);
          const isHeadSupportSolid = headSupportBlock && !['air', 'cave_air', 'water', 'lava'].includes(headSupportBlock.name);
          const isTargetAir = targetBlock && ['air', 'cave_air'].includes(targetBlock.name);
          const isHeadAir = targetHeadBlock && ['air', 'cave_air'].includes(targetHeadBlock.name);

          if (isSupportSolid && isHeadSupportSolid && isTargetAir && isHeadAir) {
            const placed = await this.safePlaceBlock(invBed.name, placePos, supportPos).catch(() => false);
            if (placed) {
              placedFromInventory = true;
              beds = this.adapter.findBlocks({ matching: allBedColors, maxDistance: 6, count: 1 });
              break;
            }
          }
        }
      }
    }

    if (beds.length === 0) {
      logger.warn('No beds found nearby and no bed in inventory.', 'SafeDSL');
      return { success: false, reason: 'no_bed_available' };
    }

    const bedBlock = this.adapter.getBlockAt(beds[0]);
    if (!bedBlock) return { success: false };

    try {
      await this.adapter.goto(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 1.5, 6000);
      await this.adapter.rawBot.sleep(bedBlock);
      logger.info('🛌 Sleeping peacefully in bed...', 'SafeDSL');
    } catch (err) {
      logger.warn(`Could not sleep in bed: ${err.message}`, 'SafeDSL');
      return { success: false, reason: err.message };
    }

    // Auto-record HomeBed landmark in worldMemory
    if (this.worldMemory && !placedFromInventory) {
      const serverKey = this.adapter?.botClient?.getServerIdentifier?.() || null;
      this.worldMemory.saveLandmark(
        serverKey,
        'HomeBed',
        { x: Math.round(bedBlock.position.x * 10) / 10, y: Math.round(bedBlock.position.y * 10) / 10, z: Math.round(bedBlock.position.z * 10) / 10 },
        'เตียงนอนประจำบ้าน'
      );
    }

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
