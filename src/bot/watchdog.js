/**
 * Vanilla Mechanics Watchdog for muu-mc.
 * Monitors tool durability (< 10%), inventory slot saturation (36 slots),
 * tool lifecycle health, and crafting table deploy & retrieval.
 */

const { logger } = require('./logger');

class GameWatchdog {
  constructor(adapter, resolver) {
    this.adapter = adapter;
    this.resolver = resolver;
    this.minDurabilityPercent = 0.1; // 10%
  }

  /**
   * Retrieves detailed status for a specific tool category.
   * @param {'pickaxe'|'axe'|'sword'|'shovel'|'hoe'} category
   */
  getToolStatus(category) {
    const inv = this.adapter ? this.adapter.getInventory() : [];
    const tierRank = { netherite: 6, diamond: 5, iron: 4, stone: 3, golden: 2, wooden: 1 };
    const cleanCat = (category || 'pickaxe').toLowerCase();

    const tools = inv.filter(i => {
      const name = (i.name || '').toLowerCase();
      if (cleanCat === 'axe') return name.endsWith('_axe') && !name.includes('pickaxe');
      return name.includes(cleanCat);
    });

    if (tools.length === 0) {
      return {
        has_tool: false,
        count: 0,
        tier: null,
        name: null,
        durability_remaining: 0,
        durability_percent: 0,
        is_critical: true,
      };
    }

    // Sort by tier first, then by remaining durability
    tools.sort((a, b) => {
      const tierA = Object.keys(tierRank).find(t => a.name.includes(t)) || 'wooden';
      const tierB = Object.keys(tierRank).find(t => b.name.includes(t)) || 'wooden';
      const rankDiff = (tierRank[tierB] || 1) - (tierRank[tierA] || 1);
      if (rankDiff !== 0) return rankDiff;

      const remA = (a.maxDurability || 100) - (a.durabilityUsed || 0);
      const remB = (b.maxDurability || 100) - (b.durabilityUsed || 0);
      return remB - remA;
    });

    const best = tools[0];
    const maxDur = best.maxDurability || 100;
    const used = best.durabilityUsed || 0;
    const remaining = Math.max(0, maxDur - used);
    const ratio = Math.round((remaining / maxDur) * 100);
    const tier = Object.keys(tierRank).find(t => best.name.includes(t)) || 'wooden';

    const result = {
      has_tool: true,
      count: tools.length,
      tier,
      name: best.name,
      durability_remaining: remaining,
      durability_percent: ratio,
      is_critical: ratio < 10,
    };

    if (cleanCat === 'pickaxe') {
      if (tier === 'diamond' || tier === 'netherite') {
        result.harvestable_ores = ['coal', 'iron', 'copper', 'lapis', 'gold', 'diamond', 'redstone', 'emerald', 'obsidian', 'ancient_debris'];
        result.locked_ores = [];
        result.tech_recommendation = 'อุปกรณ์ระดับสูงสุด ขุดได้ทุกแร่รวมถึงเพชรและออบซิเดียน';
      } else if (tier === 'iron') {
        result.harvestable_ores = ['coal', 'iron', 'copper', 'lapis', 'gold', 'diamond', 'redstone', 'emerald'];
        result.locked_ores = ['obsidian (needs diamond)', 'ancient_debris (needs diamond)'];
        result.tech_recommendation = 'สามารถขุดแร่ทองและเพชรได้อย่างปลอดภัย (ที่ระดับ Y=-54)';
      } else if (tier === 'stone') {
        result.harvestable_ores = ['coal', 'iron', 'copper', 'lapis', 'stone'];
        result.locked_ores = ['gold (needs iron)', 'diamond (needs iron)', 'redstone (needs iron)', 'emerald (needs iron)', 'obsidian (needs diamond)'];
        result.tech_recommendation = 'ห้ามขุดทองหรือเพชรเด็ดขาด! ต้องขุดแร่เหล็ก -> เผาเหล็ก -> คราฟ iron_pickaxe ก่อน';
      } else {
        result.harvestable_ores = ['coal', 'stone'];
        result.locked_ores = ['iron (needs stone)', 'copper (needs stone)', 'gold (needs iron)', 'diamond (needs iron)'];
        result.tech_recommendation = 'ขุดหิน 3 ก้อนเพื่อคราฟ stone_pickaxe';
      }
    }

    return result;
  }

  /**
   * Scans all major tool categories.
   */
  getAllToolsStatus() {
    return {
      pickaxe: this.getToolStatus('pickaxe'),
      axe: this.getToolStatus('axe'),
      sword: this.getToolStatus('sword'),
      shovel: this.getToolStatus('shovel'),
    };
  }

  /**
   * Checks tool durability before usage.
   * Automatically equips a healthier spare tool if available.
   * Returns true if a healthy tool is held or equipped, false if depleted.
   */
  async ensureHealthyTool(toolName) {
    if (!this.adapter) return true;
    const inv = this.adapter.getInventory();
    const clean = (toolName || 'pickaxe').toLowerCase().replace(/^minecraft:/, '');
    const category = ['pickaxe', 'sword', 'axe', 'shovel', 'hoe'].find(c => clean.includes(c)) || 'pickaxe';
    const tierRank = { netherite: 6, diamond: 5, iron: 4, stone: 3, golden: 2, wooden: 1 };

    const currentHeld = this.adapter.getHeldItem();
    let isCurrentCritical = false;

    if (currentHeld && currentHeld.name.includes(category)) {
      if (currentHeld.maxDurability > 0) {
        const remaining = currentHeld.maxDurability - (currentHeld.durabilityUsed || 0);
        const ratio = remaining / currentHeld.maxDurability;
        if (ratio < this.minDurabilityPercent) {
          isCurrentCritical = true;
          logger.warn(`⚠️ Tool '${currentHeld.name}' durability is critical (${Math.round(ratio * 100)}%). Auto-switching to spare...`, 'Watchdog');
        }
      }
    } else if (!currentHeld || !currentHeld.name.includes(category)) {
      isCurrentCritical = true;
    }

    if (isCurrentCritical) {
      // Find healthier tools in the same category
      const spares = inv.filter(i => {
        if (category === 'axe') return i.name.endsWith('_axe') && !i.name.includes('pickaxe');
        return i.name.includes(category);
      });

      // Filter spares with remaining durability > 10%
      const healthySpares = spares.filter(s => {
        if (!s.maxDurability) return true;
        const rem = s.maxDurability - (s.durabilityUsed || 0);
        return (rem / s.maxDurability) >= this.minDurabilityPercent;
      });

      if (healthySpares.length > 0) {
        healthySpares.sort((a, b) => {
          const tierA = Object.keys(tierRank).find(t => a.name.includes(t)) || 'wooden';
          const tierB = Object.keys(tierRank).find(t => b.name.includes(t)) || 'wooden';
          return (tierRank[tierB] || 1) - (tierRank[tierA] || 1);
        });

        await this.adapter.equipItem(healthySpares[0], 'hand');
        logger.info(`✅ Switched to healthy spare tool '${healthySpares[0].name}'.`, 'Watchdog');
        return true;
      }

      logger.warn(`🛑 No healthy spare '${category}' found in inventory! Tool is depleted.`, 'Watchdog');
      return false;
    }

    return true;
  }

  /**
   * Checks if inventory is close to full (e.g. >= 34 slots occupied out of 36).
   */
  isInventoryFull(threshold = 34) {
    if (!this.adapter) return false;
    const items = this.adapter.getInventory();
    return items.length >= threshold;
  }

  /**
   * Gets number of free inventory slots.
   */
  getFreeSlots() {
    if (!this.adapter) return 36;
    const items = this.adapter.getInventory();
    return Math.max(0, 36 - items.length);
  }
}

module.exports = {
  GameWatchdog,
};
