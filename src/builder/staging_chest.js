/**
 * Staging Chest Manager for muu-mc Autonomous Construction.
 * Responsibilities:
 * - Establishing an on-site staging chest in front of the construction footprint
 * - Fulfilling Bill of Materials (BOM) in Creative mode into the staging chest
 * - Inventory verification & material withdrawal during construction
 */

const { Vec3 } = require('vec3');
const { logger } = require('../bot/logger');

class StagingChestManager {
  /**
   * Finds or places a staging chest outside the front entrance of the construction site.
   * @param {Object} bot - Mineflayer bot
   * @param {DriverAdapter} adapter
   * @param {SafeDSL} dsl
   * @param {Vec3} origin - Construction origin
   * @param {Object} dimensions - { x, y, z }
   * @param {Object} bom - { [itemName]: count }
   * @param {Object} options - { creativeFulfill: true }
   */
  async setupStagingChest(bot, adapter, dsl, origin, dimensions, bom, options = {}) {
    const creativeFulfill = options.creativeFulfill !== undefined ? options.creativeFulfill : true;

    // Pre-conjure chest & dirt in creative mode to prevent inventory shortages
    if (creativeFulfill) {
      await this._conjureCreativeItem(bot, 'chest', 4);
      await this._conjureCreativeItem(bot, 'dirt', 64);
    }

    // 1. Calculate staging chest position: 5 blocks in front of the construction site
    const stagingDistance = options.distance !== undefined ? options.distance : 5;
    const chestX = Math.floor(origin.x + dimensions.x / 2);
    const chestZ = Math.floor(origin.z - stagingDistance);

    // Find actual solid ground level at (chestX, chestZ)
    let groundBlock = null;
    for (let dy = 3; dy >= -6; dy--) {
      const checkPos = new Vec3(chestX, Math.floor(origin.y) + dy, chestZ);
      const b = adapter.getBlockAt(checkPos);
      if (b && b.name !== 'air' && b.name !== 'cave_air' && !b.name.includes('leaves') && !b.name.includes('water') && !b.name.includes('lava')) {
        groundBlock = b;
        break;
      }
    }

    let chestPos;
    if (groundBlock) {
      chestPos = groundBlock.position.offset(0, 1, 0);
    } else {
      chestPos = new Vec3(chestX, Math.floor(origin.y), chestZ);
      // Create ground if missing
      const deep = adapter.getBlockAt(chestPos.offset(0, -1, 0));
      if (deep && deep.name === 'air') {
        const bedrockOrFloor = adapter.getBlockAt(chestPos.offset(0, -2, 0));
        if (bedrockOrFloor) {
          await dsl.safePlaceBlock(bedrockOrFloor, new Vec3(0, 1, 0), 'dirt').catch(() => {});
        }
      }
      groundBlock = adapter.getBlockAt(chestPos.offset(0, -1, 0));
    }

    logger.info(`📦 Setting up staging chest at (${chestPos.x}, ${chestPos.y}, ${chestPos.z}) on top of [${groundBlock?.name || 'ground'}] for BOM: ${Object.keys(bom).length} items...`, 'StagingChest');

    // Approach chest location
    await adapter.goto(chestPos.x, chestPos.y, chestPos.z, 2.2, 3500).catch(() => {});

    // Ensure chest position itself is clear of foliage or blocks
    const currentAtChest = adapter.getBlockAt(chestPos);
    if (currentAtChest && currentAtChest.name !== 'air' && currentAtChest.name !== 'chest') {
      await dsl.safeDigBlock(currentAtChest);
    }

    // Check if chest is already placed
    let chestBlock = adapter.getBlockAt(chestPos);
    if (!chestBlock || chestBlock.name !== 'chest') {
      const actualGround = adapter.getBlockAt(chestPos.offset(0, -1, 0));
      if (actualGround && actualGround.name !== 'air') {
        await dsl.safePlaceBlock(actualGround, new Vec3(0, 1, 0), 'chest');
        await new Promise(r => setTimeout(r, 200));
      }
      chestBlock = adapter.getBlockAt(chestPos);
    }

    // Fallback: search 3 blocks around in case of slight offset
    if (!chestBlock || chestBlock.name !== 'chest') {
      const nearbyChests = adapter.findBlocks({ matching: 'chest', maxDistance: 4, count: 1 });
      if (nearbyChests.length > 0) {
        chestBlock = adapter.getBlockAt(nearbyChests[0]);
        chestPos = chestBlock.position;
      }
    }

    if (!chestBlock || chestBlock.name !== 'chest') {
      logger.warn(`Could not place staging chest at (${chestPos.x}, ${chestPos.y}, ${chestPos.z}). Proceeding with direct inventory fulfillment.`, 'StagingChest');
      return { success: false, chestPos, reason: 'Failed to place chest block' };
    }

    // 2. Fulfill materials into chest if in Creative Mode
    if (creativeFulfill) {
      await this._stockChestWithBOM(bot, adapter, chestBlock, bom);
    }

    logger.info(`✅ Staging chest ready and stocked at (${chestPos.x}, ${chestPos.y}, ${chestPos.z})!`, 'StagingChest');
    try {
      bot.chat('มูมิววางกล่องเตรียมของหน้าไซท์งานและเติมของครบตามพิมพ์เขียวเรียบร้อยแล้วค่า! 📦✨');
    } catch (_) {}

    return {
      success: true,
      chestPos,
      chestBlock,
      totalBOMTypes: Object.keys(bom).length,
    };
  }

  /**
   * Stocks the staging chest with all required BOM items using Creative mode APIs.
   * Steps:
   * 1. Conjure all items into player inventory first while outside container window.
   * 2. Approach and open chest.
   * 3. Deposit every matching BOM item from inventory into the chest.
   * 4. Close chest.
   */
  async _stockChestWithBOM(bot, adapter, chestBlock, bom) {
    logger.info(`🎁 Fulfilling ${Object.keys(bom).length} material types into staging chest...`, 'StagingChest');

    try {
      // Step 1: Pre-conjure items into bot inventory slots
      for (const [itemName, requiredCount] of Object.entries(bom)) {
        if (!itemName || itemName === 'air') continue;
        const clean = itemName.toLowerCase().trim().replace(/^minecraft:/, '');
        let remaining = requiredCount;
        while (remaining > 0) {
          const batchCount = Math.min(remaining, 64);
          await this._conjureCreativeItem(bot, clean, batchCount);
          remaining -= batchCount;
        }
      }

      // Step 2: Approach chest closely and look at it
      await adapter.goto(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 1.8, 3000).catch(() => {});
      await bot.lookAt(chestBlock.position.offset(0.5, 0.5, 0.5)).catch(() => {});

      // Step 3: Open chest
      try {
        bot.chat('มูมิวเปิดกล่องเตรียมของและกำลังนำวัสดุตามพิมพ์เขียวใส่ลงในกล่องค่ะ 📦✨');
      } catch (_) {}
      const chest = await bot.openChest(chestBlock);
      logger.info('📦 Opened staging chest. Depositing construction materials into chest...', 'StagingChest');
      await new Promise(r => setTimeout(r, 250));

      // Step 4: Deposit all BOM items into the chest
      for (const [itemName, requiredCount] of Object.entries(bom)) {
        if (!itemName || itemName === 'air') continue;
        const clean = itemName.toLowerCase().trim().replace(/^minecraft:/, '');
        const matchingItems = bot.inventory.items().filter(i => i.name === clean || i.name.includes(clean));
        for (const item of matchingItems) {
          try {
            await chest.deposit(item.type, null, item.count);
            await new Promise(r => setTimeout(r, 120));
          } catch (depErr) {
            logger.debug(`Deposit notice for ${item.name}: ${depErr.message}`, 'StagingChest');
          }
        }
      }

      await new Promise(r => setTimeout(r, 350));
      chest.close();
      logger.info('📦 Staging chest successfully stocked and closed with all construction materials!', 'StagingChest');

      // Clear remaining residue from bot inventory so inventory is completely free for withdrawals
      if (bot.game?.gameMode === 'creative') {
        try {
          bot.chat('/clear');
          await new Promise(r => setTimeout(r, 200));
        } catch (_) {}
      }
    } catch (e) {
      logger.warn(`Notice while stocking chest: ${e.message}`, 'StagingChest');
    }
  }

  /**
   * Conjures an item into bot's inventory using native command or Mineflayer's creative plugin.
   */
  async _conjureCreativeItem(bot, itemName, count = 64) {
    const clean = itemName.toLowerCase().trim().replace(/^minecraft:/, '');

    // 1. Try native /give command in Creative mode (handles modern 1.21+ data components natively)
    if (bot.game?.gameMode === 'creative') {
      try {
        bot.chat(`/give @s ${clean} ${count}`);
        await new Promise(r => setTimeout(r, 150));
        if (bot.inventory.items().some(i => i.name === clean || i.name.includes(clean))) {
          return true;
        }
      } catch (_) {}
    }

    // 2. Fallback to bot.creative.setInventorySlot
    if (!bot.creative || typeof bot.creative.setInventorySlot !== 'function') {
      logger.debug(`bot.creative not available, skipping creative conjure for ${clean}`, 'StagingChest');
      return false;
    }

    const reg = bot.registry;
    const itemDef = reg.itemsByName[clean] || reg.blocksByName[clean];

    if (!itemDef) {
      logger.debug(`Could not find registry definition for item '${clean}'`, 'StagingChest');
      return false;
    }

    try {
      const ItemClass = require('prismarine-item')(bot.version || reg);
      const itemInstance = new ItemClass(itemDef.id, count);

      // Find an empty inventory slot (slots 9 to 44)
      let targetSlot = -1;
      for (let s = 36; s <= 44; s++) { // check hotbar first
        if (!bot.inventory.slots[s]) {
          targetSlot = s;
          break;
        }
      }
      if (targetSlot === -1) {
        for (let s = 9; s <= 35; s++) { // check main inventory
          if (!bot.inventory.slots[s]) {
            targetSlot = s;
            break;
          }
        }
      }
      if (targetSlot === -1) targetSlot = 36; // fallback to hotbar 0

      await bot.creative.setInventorySlot(targetSlot, itemInstance);
      await new Promise(r => setTimeout(r, 60));
      return true;
    } catch (err) {
      logger.debug(`Notice conjuring item ${clean}: ${err.message}`, 'StagingChest');
      return false;
    }
  }

  /**
   * Withdraws required building material from staging chest if bot does not hold it.
   */
  async withdrawMaterial(bot, adapter, chestBlock, itemName, count = 64) {
    if (!chestBlock) return false;

    try {
      let dist = adapter.distanceTo(chestBlock.position);
      if (dist > 2.8) {
        await adapter.goto(chestBlock.position.x, chestBlock.position.y + 1, chestBlock.position.z, 2.0, 4000).catch(() => {});
        dist = adapter.distanceTo(chestBlock.position);
      }

      if (dist > 4.2) {
        logger.debug(`Cannot reach staging chest (dist: ${dist.toFixed(1)}m > 4.2m)`, 'StagingChest');
        return false;
      }

      await bot.lookAt(chestBlock.position.offset(0.5, 0.5, 0.5)).catch(() => {});

      const chest = await bot.openChest(chestBlock);
      await new Promise(r => setTimeout(r, 200));
      const clean = itemName.toLowerCase().trim().replace(/^minecraft:/, '');
      const itemInChest = chest.containerItems().find(i => i.name === clean || i.name.includes(clean));

      if (itemInChest) {
        const withdrawCount = Math.min(itemInChest.count, count);
        await chest.withdraw(itemInChest.type, null, withdrawCount);
        await new Promise(r => setTimeout(r, 120));
        chest.close();
        logger.debug(`Withdrew ${withdrawCount}x ${clean} from staging chest.`, 'StagingChest');
        return true;
      }

      chest.close();
      return false;
    } catch (e) {
      logger.debug(`Withdraw material error: ${e.message}`, 'StagingChest');
      return false;
    }
  }
}

const stagingChestManager = new StagingChestManager();

module.exports = {
  StagingChestManager,
  stagingChestManager,
};
