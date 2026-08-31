/**
 * Driver Adapter Layer (Hexagonal Firewall).
 * Normalizes all Mineflayer API interactions into standard asynchronous methods.
 * Decouples upstream Mineflayer changes from the Safe DSL and AI Coder.
 */

const { Vec3 } = require('vec3');
const { logger } = require('../bot/logger');

class DriverAdapter {
  constructor(bot, registryResolver) {
    this.bot = bot;
    this.resolver = registryResolver;
  }

  get rawBot() {
    return this.bot;
  }

  isReady() {
    return Boolean(this.bot && this.bot.entity);
  }

  getPosition() {
    if (!this.bot || !this.bot.entity) return new Vec3(0, 0, 0);
    return this.bot.entity.position.clone();
  }

  getHealth() {
    return this.bot?.health || 20;
  }

  getFood() {
    return this.bot?.food || 20;
  }

  isDead() {
    return this.getHealth() <= 0;
  }

  distanceTo(targetPos) {
    const current = this.getPosition();
    if (!targetPos) return Infinity;
    const target = targetPos.position || targetPos;
    return current.distanceTo(new Vec3(target.x, target.y, target.z));
  }

  // --- Movement & Navigation ---

  async goto(x, y, z, range = 1, timeoutMs = 15000) {
    if (!this.bot._pathfinderLoaded || !this.bot.pathfinder) {
      throw new Error('Pathfinder plugin is not available on this bot.');
    }
    const { GoalNear } = this.bot._goals;
    const goal = new GoalNear(x, y, z, range);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.stopMovement();
        reject(new Error(`Navigation to (${x}, ${y}, ${z}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.bot.pathfinder.setGoal(goal);

      const checkArrival = () => {
        if (this.distanceTo(new Vec3(x, y, z)) <= range + 0.5) {
          clearTimeout(timer);
          this.bot.removeListener('goal_reached', onGoalReached);
          resolve(true);
        }
      };

      const onGoalReached = () => {
        clearTimeout(timer);
        this.bot.removeListener('goal_reached', onGoalReached);
        resolve(true);
      };

      this.bot.once('goal_reached', onGoalReached);
      const interval = setInterval(() => {
        if (!this.bot.pathfinder.isMoving()) {
          clearInterval(interval);
          checkArrival();
        }
      }, 500);
    });
  }

  async followPlayer(username, range = 2) {
    if (!this.bot._pathfinderLoaded || !this.bot.pathfinder) {
      throw new Error('Pathfinder plugin not available.');
    }
    const target = this.bot.players[username]?.entity;
    if (!target) {
      throw new Error(`Player '${username}' not found or out of visual range.`);
    }
    const { GoalFollow } = this.bot._goals;
    this.bot.pathfinder.setGoal(new GoalFollow(target, range), true);
    return true;
  }

  stopMovement() {
    if (this.bot._pathfinderLoaded && this.bot.pathfinder) {
      this.bot.pathfinder.setGoal(null);
      this.bot.pathfinder.stop();
    }
    if (this.bot._pvpLoaded && this.bot.pvp) {
      this.bot.pvp.stop();
    }
    this.bot.clearControlStates();
  }

  async lookAt(targetPos, force = false) {
    if (!this.bot || typeof this.bot.lookAt !== 'function') return;
    const target = targetPos.position || targetPos;
    const vec = new Vec3(target.x, target.y + 1.2, target.z);
    await this.bot.lookAt(vec, force);
  }

  // --- Block Interaction ---

  canSeeBlock(block) {
    if (!block || !this.bot) return false;
    return this.bot.canSeeBlock(block);
  }

  findBlocks(options = {}) {
    if (!this.bot) return [];
    const matching = options.matching;
    const maxDistance = options.maxDistance || 32;
    const count = options.count || 1;

    let matchFn = matching;
    if (typeof matching === 'string') {
      const blockObj = this.resolver.getBlockByName(matching);
      if (!blockObj) return [];
      matchFn = blockObj.id;
    } else if (Array.isArray(matching)) {
      const ids = matching.map(name => (typeof name === 'string' ? this.resolver.getBlockByName(name)?.id : name)).filter(Boolean);
      matchFn = block => ids.includes(block.type);
    }

    return this.bot.findBlocks({
      matching: matchFn,
      maxDistance,
      count,
    });
  }

  getBlockAt(pos) {
    if (!this.bot) return null;
    return this.bot.blockAt(new Vec3(pos.x, pos.y, pos.z));
  }

  async digBlock(block) {
    if (!block) throw new Error('Cannot dig undefined block.');
    if (!this.bot.canDigBlock(block)) {
      throw new Error(`Bot cannot dig block '${block.name}' at (${block.position.x}, ${block.position.y}, ${block.position.z})`);
    }
    await this.bot.dig(block, 'ignore');
  }

  async placeBlock(referenceBlock, faceVector) {
    if (!referenceBlock) throw new Error('Reference block for placement is missing.');
    const face = faceVector || new Vec3(0, 1, 0);
    await this.bot.placeBlock(referenceBlock, face);
  }

  // --- Inventory & Items ---

  getInventory() {
    if (!this.bot || !this.bot.inventory) return [];
    return this.bot.inventory.items().map(item => ({
      id: item.type,
      name: item.name,
      count: item.count,
      slot: item.slot,
      durabilityUsed: item.durabilityUsed || 0,
      maxDurability: item.maxDurability || 0,
    }));
  }

  getHeldItem() {
    return this.bot?.heldItem || null;
  }

  hasItem(name) {
    return this.countItem(name) > 0;
  }

  countItem(name) {
    const clean = name.toLowerCase().replace(/^minecraft:/, '');
    const items = this.getInventory();
    return items
      .filter(i => i.name.toLowerCase().replace(/^minecraft:/, '') === clean)
      .reduce((sum, i) => sum + i.count, 0);
  }

  async equipItem(name, destination = 'hand') {
    const clean = name.toLowerCase().replace(/^minecraft:/, '');
    const item = this.bot.inventory.items().find(i => i.name.toLowerCase().replace(/^minecraft:/, '') === clean);
    if (!item) {
      throw new Error(`Item '${name}' is not in inventory.`);
    }
    await this.bot.equip(item, destination);
  }

  async equipBestTool(block) {
    if (!block || !this.bot) return;
    const tool = this.bot.pathfinder?.bestHarvestTool ? this.bot.pathfinder.bestHarvestTool(block) : null;
    if (tool) {
      await this.bot.equip(tool, 'hand');
    }
  }

  async craftRecipe(recipe, count = 1, craftingTable = null) {
    if (!this.bot) throw new Error('Bot is not ready.');
    await this.bot.craft(recipe, count, craftingTable);
  }

  async eatFood() {
    const foodItem = this.bot.inventory.items().find(i => this.resolver.isFood(i));
    if (!foodItem) throw new Error('No edible food found in inventory.');
    await this.bot.equip(foodItem, 'hand');
    await this.bot.consume();
  }

  // --- Containers & Sleep ---

  async openChest(chestBlock) {
    return await this.bot.openChest(chestBlock);
  }

  async sleep(bedBlock) {
    return await this.bot.sleep(bedBlock);
  }

  async wake() {
    if (this.bot.isSleeping) {
      await this.bot.wake();
    }
  }

  // --- Entities & Combat ---

  findEntity(options = {}) {
    const maxDistance = options.maxDistance || 16;
    const type = options.type;
    const name = options.name;

    const entities = Object.values(this.bot.entities).filter(entity => {
      if (!entity || entity === this.bot.entity) return false;
      if (this.distanceTo(entity.position) > maxDistance) return false;
      if (type && entity.type !== type) return false;
      if (name && entity.name !== name && entity.username !== name) return false;
      return true;
    });

    entities.sort((a, b) => this.distanceTo(a.position) - this.distanceTo(b.position));
    return entities[0] || null;
  }

  async attackEntity(entity) {
    if (!entity) return;
    if (this.bot._pvpLoaded && this.bot.pvp) {
      await this.bot.pvp.attack(entity);
    } else {
      await this.lookAt(entity.position);
      this.bot.attack(entity);
    }
  }

  // --- Chat & Communications ---

  chat(message) {
    if (this.bot) {
      this.bot.chat(message);
    }
  }

  whisper(username, message) {
    if (this.bot) {
      this.bot.whisper(username, message);
    }
  }
}

module.exports = {
  DriverAdapter,
};
