/**
 * Vanilla Mechanics Watchdog for muu-mc.
 * Monitors tool durability (< 10%), inventory slot saturation (36 slots),
 * and crafting table deploy & retrieval lifecycle.
 */

const { logger } = require('./logger');

class GameWatchdog {
  constructor(adapter, resolver) {
    this.adapter = adapter;
    this.resolver = resolver;
    this.minDurabilityPercent = 0.1; // 10%
  }

  /**
   * Checks tool durability before usage.
   * Returns true if safe, or automatically equips a healthier spare tool if available.
   */
  async ensureHealthyTool(toolName) {
    const inv = this.adapter.getInventory();
    const clean = toolName.toLowerCase().replace(/^minecraft:/, '');
    const tools = inv.filter(i => i.name.toLowerCase().replace(/^minecraft:/, '') === clean);

    if (tools.length === 0) return true;

    const currentHeld = this.adapter.getHeldItem();
    if (currentHeld && currentHeld.name.toLowerCase().replace(/^minecraft:/, '') === clean) {
      if (currentHeld.maxDurability > 0) {
        const remaining = currentHeld.maxDurability - currentHeld.durabilityUsed;
        const ratio = remaining / currentHeld.maxDurability;
        if (ratio < this.minDurabilityPercent) {
          logger.warn(`⚠️ Tool '${toolName}' durability is critical (${Math.round(ratio * 100)}%). Auto-switching to spare...`, 'Watchdog');
          // Find spare with higher durability
          const spare = tools.find(t => {
            const spareRatio = (t.maxDurability - t.durabilityUsed) / (t.maxDurability || 1);
            return spareRatio > this.minDurabilityPercent;
          });
          if (spare) {
            await this.adapter.rawBot.equip(spare, 'hand');
            return true;
          } else {
            logger.warn(`No healthy spare for '${toolName}' available!`, 'Watchdog');
            return false;
          }
        }
      }
    }
    return true;
  }

  /**
   * Checks if inventory is close to full (e.g. >= 34 slots occupied out of 36).
   */
  isInventoryFull(threshold = 34) {
    const items = this.adapter.getInventory();
    return items.length >= threshold;
  }

  /**
   * Gets number of free inventory slots.
   */
  getFreeSlots() {
    const items = this.adapter.getInventory();
    return Math.max(0, 36 - items.length);
  }
}

module.exports = {
  GameWatchdog,
};
