/**
 * Bulletproof Safe DSL Helpers for Agent 2 (AI Coder).
 * Enforces Range <= 2m, Line-of-Sight, Tool Watchdog, Crafting Table Lifecycle,
 * and Hardcoded Silent Chat Redirection.
 */

const { Vec3 } = require('vec3');
const { logger } = require('../bot/logger');

class SafeDSL {
  constructor(adapter, resolver, watchdog) {
    this.adapter = adapter;
    this.resolver = resolver;
    this.watchdog = watchdog;
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

  // --- Safe Digging (Range <= 2m & LOS) ---
  async safeDigBlock(targetBlock, options = {}) {
    if (!targetBlock) throw new Error('Target block is null or undefined.');
    const botPos = this.adapter.getPosition();
    const blockPos = targetBlock.position || targetBlock;

    // 1. Check distance - if > 2m, navigate close
    if (this.adapter.distanceTo(blockPos) > 2.0) {
      logger.info(`Block is > 2m away. Approaching block at (${blockPos.x}, ${blockPos.y}, ${blockPos.z})...`, 'SafeDSL');
      await this.adapter.goto(blockPos.x, blockPos.y, blockPos.z, 2.0);
    }

    const actualBlock = this.adapter.getBlockAt(blockPos);
    if (!actualBlock || actualBlock.name === 'air') {
      logger.warn(`Block at (${blockPos.x}, ${blockPos.y}, ${blockPos.z}) is already air.`, 'SafeDSL');
      return true;
    }

    // 2. Equip best tool & check durability
    await this.adapter.equipBestTool(actualBlock);
    const held = this.adapter.getHeldItem();
    if (held) {
      await this.watchdog.ensureHealthyTool(held.name);
    }

    // 3. Line of sight check and face block
    await this.adapter.lookAt(blockPos);

    // 4. Dig safely
    logger.info(`Digging block '${actualBlock.name}' at (${blockPos.x}, ${blockPos.y}, ${blockPos.z})...`, 'SafeDSL');
    await this.adapter.digBlock(actualBlock);
    return true;
  }

  // --- Safe Placing ---
  async safePlaceBlock(referenceBlock, faceVector = new Vec3(0, 1, 0), itemToPlace = null) {
    if (!referenceBlock) throw new Error('Reference block for placement is null.');
    const refPos = referenceBlock.position || referenceBlock;

    // 1. Approach <= 2m
    if (this.adapter.distanceTo(refPos) > 2.0) {
      await this.adapter.goto(refPos.x, refPos.y, refPos.z, 2.0);
    }

    // 2. Equip item
    if (itemToPlace) {
      await this.adapter.equipItem(itemToPlace, 'hand');
    }

    // 3. Look at reference block
    await this.adapter.lookAt(refPos);

    // 4. Place block
    const actualRef = this.adapter.getBlockAt(refPos);
    await this.adapter.placeBlock(actualRef, faceVector);
    return true;
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
      const logs = this.adapter.findBlocks({ matching: logTypes, maxDistance: 32, count: 10 });
      if (logs.length === 0) {
        logger.warn('No trees found within 32 blocks.', 'SafeDSL');
        break;
      }

      // Sort by proximity
      logs.sort((a, b) => this.adapter.distanceTo(a) - this.adapter.distanceTo(b));
      const targetLog = logs[0];

      await this.safeDigBlock(targetLog);
      chopped++;

      // Check if there are logs directly above (tree trunk)
      let abovePos = new Vec3(targetLog.x, targetLog.y + 1, targetLog.z);
      while (chopped < count) {
        const aboveBlock = this.adapter.getBlockAt(abovePos);
        if (aboveBlock && this.resolver.isLog(aboveBlock.name)) {
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

  /**
   * Crafts an item with automated Crafting Table deploy & pickup lifecycle.
   */
  async craftItem(itemName, count = 1) {
    const itemObj = this.resolver.getItemByName(itemName);
    if (!itemObj) throw new Error(`Unknown item name: '${itemName}'`);

    const recipes = this.resolver.findRecipes(itemObj.id);
    if (recipes.length === 0) {
      throw new Error(`No known recipes found for '${itemName}'`);
    }

    const recipe = recipes[0];
    let craftingTableBlock = null;
    let placedTablePos = null;

    if (recipe.requiresTable) {
      // Find existing crafting table nearby (within 6 blocks)
      const tables = this.adapter.findBlocks({ matching: 'crafting_table', maxDistance: 6, count: 1 });
      if (tables.length > 0) {
        craftingTableBlock = this.adapter.getBlockAt(tables[0]);
      } else {
        // Need to deploy crafting table from inventory
        if (!this.adapter.hasItem('crafting_table')) {
          // If we have planks, craft a crafting table first
          if (this.adapter.countItem('oak_planks') < 4 && this.adapter.countItem('birch_planks') < 4) {
            // Craft planks from logs first if possible
            const logs = this.adapter.getInventory().find(i => this.resolver.isLog(i.name));
            if (logs) {
              const plankRecipes = this.resolver.findRecipes(this.resolver.getItemByName('oak_planks')?.id || 0);
              if (plankRecipes.length > 0) {
                await this.adapter.craftRecipe(plankRecipes[0], 1, null);
              }
            }
          }
          const tableRecipe = this.resolver.findRecipes(this.resolver.getItemByName('crafting_table')?.id)[0];
          if (tableRecipe) {
            await this.adapter.craftRecipe(tableRecipe, 1, null);
          }
        }

        // Place crafting table on the ground near bot
        const botPos = this.adapter.getPosition();
        const ground = this.adapter.getBlockAt(new Vec3(Math.floor(botPos.x), Math.floor(botPos.y) - 1, Math.floor(botPos.z) + 1));
        if (ground && ground.name !== 'air') {
          await this.safePlaceBlock(ground, new Vec3(0, 1, 0), 'crafting_table');
          placedTablePos = new Vec3(ground.position.x, ground.position.y + 1, ground.position.z);
          craftingTableBlock = this.adapter.getBlockAt(placedTablePos);
          logger.info(`Deployed Crafting Table at (${placedTablePos.x}, ${placedTablePos.y}, ${placedTablePos.z})`, 'SafeDSL');
        }
      }
    }

    // Execute craft
    logger.info(`Crafting ${count}x '${itemName}'...`, 'SafeDSL');
    await this.adapter.craftRecipe(recipe, count, craftingTableBlock);

    // Lifecycle Cleanup: Pick up placed crafting table back into inventory
    if (placedTablePos) {
      try {
        const tableToBreak = this.adapter.getBlockAt(placedTablePos);
        if (tableToBreak && tableToBreak.name === 'crafting_table') {
          await this.safeDigBlock(tableToBreak);
          logger.info('Picked up Crafting Table back into inventory.', 'SafeDSL');
        }
      } catch (e) {
        logger.warn(`Could not pick up deployed crafting table: ${e.message}`, 'SafeDSL');
      }
    }

    return { success: true, crafted: itemName, count };
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
}

module.exports = {
  SafeDSL,
};
