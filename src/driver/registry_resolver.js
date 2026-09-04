/**
 * Dynamic Registry Resolver for Minecraft Java Version Compatibility (1.16 - 1.21+).
 * Resolves Block, Item, Recipe, and Entity IDs dynamically using minecraft-data.
 */

const minecraftData = require('minecraft-data');
const { logger } = require('../bot/logger');

class RegistryResolver {
  constructor(version = '1.20.4') {
    this.version = version;
    this.mcData = minecraftData(version) || minecraftData('1.20.4');
  }

  setVersion(version) {
    if (!version) return;
    try {
      this.version = version;
      this.mcData = minecraftData(version);
      logger.info(`RegistryResolver updated to Minecraft version: ${this.version}`, 'Registry');
    } catch (e) {
      logger.warn(`Could not load mcData for version ${version}, falling back: ${e.message}`, 'Registry');
    }
  }

  getBlockByName(name) {
    if (!this.mcData || !this.mcData.blocksByName) return null;
    const clean = name.toLowerCase().replace(/^minecraft:/, '');
    return this.mcData.blocksByName[clean] || null;
  }

  getBlockById(id) {
    if (!this.mcData || !this.mcData.blocks) return null;
    return this.mcData.blocks[id] || null;
  }

  getItemByName(name) {
    if (!this.mcData || !this.mcData.itemsByName) return null;
    const clean = name.toLowerCase().replace(/^minecraft:/, '');
    return this.mcData.itemsByName[clean] || null;
  }

  getItemById(id) {
    if (!this.mcData || !this.mcData.items) return null;
    return this.mcData.items[id] || null;
  }

  findRecipes(itemId) {
    if (!this.mcData || !this.mcData.recipes) return [];
    return this.mcData.recipes[itemId] || [];
  }

  getEntityByName(name) {
    if (!this.mcData || !this.mcData.entitiesByName) return null;
    const clean = name.toLowerCase().replace(/^minecraft:/, '');
    return this.mcData.entitiesByName[clean] || null;
  }

  isLog(name) {
    return name && (name.endsWith('_log') || name.endsWith('_stem') || name.endsWith('_wood'));
  }

  isPlanks(name) {
    return name && name.endsWith('_planks');
  }

  isSapling(name) {
    return name && (name.endsWith('_sapling') || name.endsWith('_propagule'));
  }

  isOre(name) {
    return name && (name.endsWith('_ore') || name.startsWith('deepslate_') && name.endsWith('_ore'));
  }

  isTool(name) {
    if (!name) return false;
    return (
      name.endsWith('_pickaxe') ||
      name.endsWith('_axe') ||
      name.endsWith('_shovel') ||
      name.endsWith('_sword') ||
      name.endsWith('_hoe')
    );
  }

  isFood(item) {
    if (!item) return false;
    const name = (typeof item === 'string' ? item : item.name).toLowerCase().replace(/^minecraft:/, '');
    if (this.mcData && this.mcData.foodsByName && this.mcData.foodsByName[name]) return true;

    // Common aliases (raw meats often named raw_xxx or protocol variations)
    const foodAliases = {
      'raw_chicken': 'chicken',
      'raw_beef': 'beef',
      'raw_pork': 'porkchop',
      'raw_porkchop': 'porkchop',
      'raw_mutton': 'mutton',
      'raw_rabbit': 'rabbit',
      'raw_salmon': 'salmon',
      'raw_cod': 'cod',
    };
    const mapped = foodAliases[name];
    if (mapped && this.mcData && this.mcData.foodsByName && this.mcData.foodsByName[mapped]) return true;

    const commonFoods = [
      'apple', 'bread', 'porkchop', 'cooked_porkchop', 'golden_apple', 'enchanted_golden_apple',
      'cod', 'salmon', 'tropical_fish', 'cooked_cod', 'cooked_salmon', 'cookie', 'melon_slice',
      'dried_kelp', 'beef', 'cooked_beef', 'chicken', 'cooked_chicken', 'rotten_flesh', 'spider_eye',
      'carrot', 'potato', 'baked_potato', 'poisonous_potato', 'golden_carrot', 'pumpkin_pie',
      'mutton', 'cooked_mutton', 'rabbit', 'cooked_rabbit', 'rabbit_stew', 'beetroot',
      'beetroot_soup', 'sweet_berries', 'glow_berries', 'honey_bottle'
    ];
    return commonFoods.includes(name) || (mapped && commonFoods.includes(mapped));
  }

  /**
   * Returns an array of tool item names that can harvest this block and produce item drops.
   * If the block drops items with bare hands (e.g. dirt, logs), returns null.
   * @param {string|number} blockNameOrId
   * @returns {string[]|null}
   */
  getHarvestTools(blockNameOrId) {
    if (!this.mcData) return null;
    let blockObj = null;
    if (typeof blockNameOrId === 'number') {
      blockObj = this.getBlockById(blockNameOrId);
    } else if (typeof blockNameOrId === 'string') {
      const clean = blockNameOrId.toLowerCase().replace(/^minecraft:/, '');
      blockObj = this.getBlockByName(clean);
    }
    if (!blockObj || !blockObj.harvestTools) return null;

    const toolIds = Object.keys(blockObj.harvestTools);
    if (toolIds.length === 0) return null;

    return toolIds.map(id => this.getItemById(Number(id))?.name).filter(Boolean);
  }

  /**
   * Returns the minimum tool required to harvest a block (e.g. 'iron_pickaxe' for gold/diamonds,
   * 'stone_pickaxe' for iron, 'diamond_pickaxe' for obsidian).
   * Returns null if no tool is required.
   */
  getMinimumToolRequired(blockNameOrId) {
    const tools = this.getHarvestTools(blockNameOrId);
    if (!tools || tools.length === 0) return null;

    const tierHierarchy = [
      'wooden_pickaxe', 'golden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe',
      'wooden_axe', 'golden_axe', 'stone_axe', 'iron_axe', 'diamond_axe', 'netherite_axe',
      'wooden_shovel', 'golden_shovel', 'stone_shovel', 'iron_shovel', 'diamond_shovel', 'netherite_shovel',
    ];

    for (const tool of tierHierarchy) {
      if (tools.includes(tool)) return tool;
    }
    return tools[0];
  }

  /**
   * Checks if a given tool item name can harvest the target block.
   */
  canHarvest(blockNameOrId, toolItemName = null) {
    const validTools = this.getHarvestTools(blockNameOrId);
    if (!validTools) return true; // Any tool or bare hand can harvest
    if (!toolItemName) return false; // Requires a tool, but holding nothing/hand
    return validTools.includes(toolItemName);
  }
}

module.exports = {
  RegistryResolver,
};
