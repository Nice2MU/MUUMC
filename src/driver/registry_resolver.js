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
    if (!item || !this.mcData || !this.mcData.foodsByName) return false;
    const name = (typeof item === 'string' ? item : item.name).toLowerCase().replace(/^minecraft:/, '');
    return Boolean(this.mcData.foodsByName[name]);
  }
}

module.exports = {
  RegistryResolver,
};
