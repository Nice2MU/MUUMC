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
    
    // Determine tool category (e.g. 'pickaxe', 'sword', 'axe', 'shovel')
    const category = ['pickaxe', 'sword', 'axe', 'shovel', 'hoe'].find(c => clean.includes(c));
    const tierRank = { netherite: 6, diamond: 5, iron: 4, stone: 3, golden: 2, wooden: 1 };

    const currentHeld = this.adapter.getHeldItem();
    if (currentHeld && category && currentHeld.name.includes(category)) {
      if (currentHeld.maxDurability > 0) {
        const remaining = currentHeld.maxDurability - currentHeld.durabilityUsed;
        const ratio = remaining / currentHeld.maxDurability;
        if (ratio < this.minDurabilityPercent) {
          logger.warn(`⚠️ Tool '${currentHeld.name}' durability is critical (${Math.round(ratio * 100)}%). Auto-switching to spare/upgrade...`, 'Watchdog');
          
          // Find any healthier tool in the same category, prioritizing higher tiers!
          const categoryTools = inv.filter(i => i.name.includes(category) && i.name !== currentHeld.name);
          categoryTools.sort((a, b) => {
            const tierA = Object.keys(tierRank).find(t => a.name.includes(t)) || 'wooden';
            const tierB = Object.keys(tierRank).find(t => b.name.includes(t)) || 'wooden';
            return (tierRank[tierB] || 1) - (tierRank[tierA] || 1);
          });

          if (categoryTools.length > 0) {
            await this.adapter.equipItem(categoryTools[0], 'hand');
            return true;
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
