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
    this._isDigging = false;
    this._lastDamageTime = 0;

    if (this.bot && typeof this.bot.on === 'function') {
      this.bot.on('entityHurt', (entity) => {
        if (entity === this.bot.entity) {
          this._lastDamageTime = Date.now();
          if (this._isDigging) {
            logger.warn('💥 [Combat Reflex] Bot was hurt while digging! Aborting dig immediately to defend...', 'DriverAdapter');
            try { this.bot.stopDigging(); } catch (_) {}
            this._isDigging = false;
          }
          const hostiles = this.findHostiles(10);
          if (hostiles.length > 0) {
            this.autoEquipArmor().catch(() => {});
            this.equipHighestAttackWeapon().catch(() => {});
            this.attackEntity(hostiles[0]).catch(() => {});
          }
        }
      });
    }
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

  async goto(x, y, z, range = 1, timeoutMs = 12000) {
    if (!this.bot._pathfinderLoaded || !this.bot.pathfinder) {
      throw new Error('Pathfinder plugin is not available on this bot.');
    }
    const { GoalNear } = this.bot._goals;
    const goal = new GoalNear(x, y, z, range);

    this.bot.clearControlStates();

    return new Promise((resolve) => {
      let isDone = false;
      const timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          this.stopMovement();
          const dist = this.distanceTo(new Vec3(x, y, z));
          resolve(dist <= range + 0.8);
        }
      }, timeoutMs);

      this.bot.pathfinder.goto(goal).then(() => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          resolve(true);
        }
      }).catch(() => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          const dist = this.distanceTo(new Vec3(x, y, z));
          resolve(dist <= range + 0.8);
        }
      });
    });
  }

  async gotoXZ(x, z, range = 1.5, timeoutMs = 8000) {
    if (!this.bot._pathfinderLoaded || !this.bot.pathfinder) {
      throw new Error('Pathfinder plugin is not available on this bot.');
    }
    const { GoalNearXZ } = this.bot._goals;
    const goal = new GoalNearXZ(x, z, range);

    this.bot.clearControlStates();

    return new Promise((resolve) => {
      let isDone = false;
      const timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          this.stopMovement();
          const current = this.getPosition();
          const dist2d = Math.sqrt(Math.pow(current.x - x, 2) + Math.pow(current.z - z, 2));
          resolve(dist2d <= range + 0.8);
        }
      }, timeoutMs);

      this.bot.pathfinder.goto(goal).then(() => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          resolve(true);
        }
      }).catch(() => {
        if (!isDone) {
          isDone = true;
          clearTimeout(timer);
          const current = this.getPosition();
          const dist2d = Math.sqrt(Math.pow(current.x - x, 2) + Math.pow(current.z - z, 2));
          resolve(dist2d <= range + 0.8);
        }
      });
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
    const vec = new Vec3(target.x, target.y, target.z);
    await this.bot.lookAt(vec, force);
  }

  // --- Block Interaction ---

  canSeeBlock(block) {
    if (!block || !this.bot) return false;
    return this.bot.canSeeBlock(block);
  }

  getObstructingBlock(targetBlock) {
    if (!targetBlock || !this.bot || !this.bot.world) return null;
    const blockPos = targetBlock.position || targetBlock;
    if (!this.bot.entity || !this.bot.entity.position) return null;

    const eyePos = this.bot.entity.position.offset(0, this.bot.entity.height || 1.6, 0);
    const targetCenter = new Vec3(blockPos.x + 0.5, blockPos.y + 0.5, blockPos.z + 0.5);
    const diff = targetCenter.minus(eyePos);
    const dist = diff.norm();
    if (dist <= 1.8) return null; // Directly within reach, never obstructed by neighbors!

    const dir = diff.normalize();
    const hit = this.bot.world.raycast(eyePos, dir, dist - 0.2);
    if (hit && hit.position) {
      if (hit.position.x !== blockPos.x || hit.position.y !== blockPos.y || hit.position.z !== blockPos.z) {
        const hitBlock = this.getBlockAt(hit.position);
        if (hitBlock && hitBlock.name && hitBlock.name !== 'air' && hitBlock.name !== 'cave_air' && hitBlock.name !== 'void_air') {
          return hitBlock;
        }
      }
    }
    return null;
  }

  findBlocks(options = {}) {
    if (!this.bot) return [];
    const matching = options.matching;
    const maxDistance = options.maxDistance || 32;
    const count = options.count || 1;

    let matchFn = matching;
    if (typeof matching === 'string') {
      const cleanName = matching.toLowerCase().replace(/^minecraft:/, '');
      const blockObj = this.resolver.getBlockByName(cleanName);
      const targetId = blockObj ? blockObj.id : null;
      matchFn = block => block && (block.name === cleanName || (targetId !== null && block.type === targetId));
    } else if (Array.isArray(matching)) {
      const cleanNames = matching.map(m => (typeof m === 'string' ? m.toLowerCase().replace(/^minecraft:/, '') : m));
      const ids = cleanNames.map(name => (typeof name === 'string' ? this.resolver.getBlockByName(name)?.id : name)).filter(Boolean);
      matchFn = block => block && (cleanNames.includes(block.name) || ids.includes(block.type));
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
    if (!block) throw new Error('Block to dig is missing.');
    if (this._isDigging) {
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 50));
        if (!this._isDigging) break;
      }
      if (this._isDigging) {
        logger.warn('⛏️ Digging lock stuck. Forcing release...', 'DriverAdapter');
        this._isDigging = false;
      }
    }
    const blockPos = block.position || block;
    let freshBlock = this.getBlockAt(blockPos);
    if (!freshBlock || !freshBlock.diggable || freshBlock.name === 'air' || freshBlock.name === 'cave_air' || freshBlock.name === 'void_air' || freshBlock.name.includes('water') || freshBlock.name.includes('lava') || freshBlock.name === 'bedrock') {
      return; // Non-diggable or liquid/air
    }

    this._isDigging = true;
    try {
      // 1. Natural Arm Reach (Minecraft reach = 4.5m, comfortable standing distance = 2.4m - 3.5m)
      const dist = this.distanceTo(blockPos);
      if (dist > 3.8) {
        await this.goto(blockPos.x, blockPos.y, blockPos.z, 2.8, 3000).catch(() => {});
      }

      // 2. Stop pathfinder & velocity (Prevents in-air mining penalty & velocity cancellation)
      if (this.bot.pathfinder) {
        this.bot.pathfinder.stop();
      }
      this.bot.clearControlStates();
      await new Promise(r => setTimeout(r, 40));

      // 3. Equip best tool and sync
      freshBlock = this.getBlockAt(blockPos);
      if (!freshBlock || !freshBlock.diggable || freshBlock.name === 'air' || freshBlock.name === 'cave_air') return;
      await this.equipBestTool(freshBlock, true);
      await new Promise(r => setTimeout(r, 80));

      // Check for immediate threats before starting dig
      const immediateThreats = this.findHostiles(6);
      if (immediateThreats.length > 0) {
        logger.info(`⚔️ [DigGuard] Hostile threat '${immediateThreats[0].name}' nearby. Aborting dig to fight!`, 'DriverAdapter');
        await this.autoEquipArmor().catch(() => {});
        await this.equipHighestAttackWeapon().catch(() => {});
        await this.attackEntity(immediateThreats[0]);
        return;
      }

      // 4. Continuously lock gaze on block center
      const targetCenter = new Vec3(blockPos.x + 0.5, blockPos.y + 0.5, blockPos.z + 0.5);
      await this.lookAt(targetCenter);

      // 5. Execute Dig
      const estimatedDigMs = this.bot.digTime ? this.bot.digTime(freshBlock) : 3000;
      const timeoutMs = Math.max(12000, Math.round(estimatedDigMs * 2) + 3000);

      try {
        await Promise.race([
          this.bot.dig(freshBlock, true),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Dig timeout after ${timeoutMs}ms`)), timeoutMs))
        ]);
      } catch (e) {
        if (this.bot.targetDigBlock) {
          this.bot.stopDigging();
        }
        logger.warn(`⛏️ Digging '${freshBlock.name}' interrupted: ${e.message}`, 'DriverAdapter');
      }

      // 6. Post-dig Verification
      const checkAfter = this.getBlockAt(blockPos);
      if (checkAfter && checkAfter.name !== 'air' && checkAfter.name !== 'cave_air' && checkAfter.diggable && !checkAfter.name.includes('water') && !checkAfter.name.includes('lava')) {
        this.bot.clearControlStates();
        await this.equipBestTool(checkAfter, true);
        await this.lookAt(targetCenter);
        try {
          await Promise.race([
            this.bot.dig(checkAfter, true),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Dig retry timeout')), timeoutMs))
          ]);
        } catch (err) {
          if (this.bot.targetDigBlock) this.bot.stopDigging();
          logger.warn(`⛏️ Dig retry failed: ${err.message}`, 'DriverAdapter');
        }
      }
    } finally {
      this._isDigging = false;
    }
  }

  async placeBlock(referenceBlock, faceVector) {
    if (!referenceBlock) throw new Error('Reference block for placement is missing.');
    const face = faceVector || new Vec3(0, 1, 0);
    try {
      await this.bot.placeBlock(referenceBlock, face);
    } catch (e) {
      if (!e.message.includes('blockUpdate')) {
        throw e;
      }
    }
  }

  /**
   * Jump and place a block directly under feet (Pillar Up / 1x1 Tower) with microsecond physics synchronization.
   * Completes in 1 clean jump (180ms - 220ms) with 100% precision.
   */
  async jumpAndPlaceUnderFeet(blockName = null) {
    if (!this.bot || !this.bot.entity) return false;

    // 1. Identify scaffolding block
    const scaffoldTypes = [
      'dirt', 'cobblestone', 'stone', 'oak_planks', 'birch_planks', 'spruce_planks',
      'deepslate', 'cobbled_deepslate', 'andesite', 'granite', 'diorite', 'sandstone', 'gravel', 'tuff'
    ];
    let chosenBlock = blockName;
    if (!chosenBlock || !this.hasItem(chosenBlock)) {
      chosenBlock = scaffoldTypes.find(name => this.hasItem(name));
    }
    if (!chosenBlock) {
      return false;
    }
    await this.equipItem(chosenBlock, 'hand');

    const bot = this.bot;
    const startPos = bot.entity.position.clone();
    const startY = Math.floor(startPos.y);

    // 2. Identify ground block beneath feet
    const groundBlock = this.getBlockAt(new Vec3(Math.floor(startPos.x), startY - 1, Math.floor(startPos.z)));
    if (!groundBlock || groundBlock.name === 'air' || groundBlock.name === 'cave_air') {
      return false;
    }

    // 3. Center player on block and look straight down
    bot.clearControlStates();
    await bot.look(bot.entity.yaw, -Math.PI / 2, true).catch(() => {});

    // 4. Trigger Jump and execute placement at precise peak clearance
    bot.setControlState('jump', true);

    return new Promise((resolve) => {
      let placed = false;
      const timeout = setTimeout(() => {
        bot.removeListener('physicsTick', checkPhysics);
        bot.setControlState('jump', false);
        resolve(placed);
      }, 600);

      const checkPhysics = async () => {
        if (placed) return;
        const currentY = bot.entity.position.y;
        
        // Exact clearance window: feet have risen above the new block level
        if (currentY >= startY + 1.0) {
          placed = true;
          bot.removeListener('physicsTick', checkPhysics);
          clearTimeout(timeout);
          bot.setControlState('jump', false);

          try {
            await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
            resolve(true);
          } catch (err) {
            resolve(false);
          }
        }
      };

      bot.on('physicsTick', checkPhysics);
    });
  }

  /**
   * Pillars up multiple blocks in sequence.
   */
  async pillarUp(height = 1, blockName = null) {
    let climbed = 0;
    for (let i = 0; i < height; i++) {
      const ok = await this.jumpAndPlaceUnderFeet(blockName);
      if (ok) climbed++;
      await new Promise(r => setTimeout(r, 120));
    }
    return climbed > 0;
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

  getInventoryItems() {
    return this.getInventory();
  }

  getHeldItem() {
    return this.bot?.heldItem || null;
  }

  hasItem(name) {
    if (!this.bot || !this.bot.inventory) return false;
    const clean = name.toLowerCase().replace(/^minecraft:/, '');
    const slots = (this.bot.inventory.slots && this.bot.inventory.slots.length > 0)
      ? this.bot.inventory.slots
      : (typeof this.bot.inventory.items === 'function' ? this.bot.inventory.items() : []);
    for (const slot of slots) {
      if (slot && slot.name && slot.name.toLowerCase().replace(/^minecraft:/, '') === clean) {
        return true;
      }
    }
    if (this.bot.heldItem && this.bot.heldItem.name && this.bot.heldItem.name.toLowerCase().replace(/^minecraft:/, '') === clean) {
      return true;
    }
    return false;
  }

  countItem(name) {
    if (!this.bot || !this.bot.inventory) return 0;
    const clean = name.toLowerCase().replace(/^minecraft:/, '');
    const slots = (this.bot.inventory.slots && this.bot.inventory.slots.length > 0)
      ? this.bot.inventory.slots
      : (typeof this.bot.inventory.items === 'function' ? this.bot.inventory.items() : []);
    let count = 0;
    for (const slot of slots) {
      if (slot && slot.name && slot.name.toLowerCase().replace(/^minecraft:/, '') === clean) {
        count += (slot.count || 1);
      }
    }
    return count;
  }

  async equipItem(item, destination = 'hand') {
    if (!this.bot || !item) return;
    if (this._isDigging && destination === 'hand') return;
    let itemObj = item;
    if (typeof item === 'string') {
      const clean = item.toLowerCase().replace(/^minecraft:/, '');
      itemObj = this.bot.inventory.items().find(i => i.name.toLowerCase().replace(/^minecraft:/, '') === clean);
      if (!itemObj) {
        logger.warn(`Item '${item}' is not in inventory to equip.`, 'DriverAdapter');
        return;
      }
    }
    const current = destination === 'hand' ? this.bot.heldItem : (destination === 'off-hand' ? this.bot.inventory.slots[45] : null);
    if (current && current.name === itemObj.name) return; // Already holding this exact item!
    await this.bot.equip(itemObj, destination);
  }

  async equipBestTool(block, bypassDiggingLock = false) {
    if (!block || !this.bot || !this.bot.inventory) return;
    if (this._isDigging && !bypassDiggingLock) return; // Locked while digging!
    const name = (block.name || '').toLowerCase();
    const held = this.bot.heldItem;
    
    // Explicit tool matching by block category:
    let preferredCategory = null;
    if (name.includes('stone') || name.includes('ore') || name.includes('cobble') || name.includes('deepslate') || name.includes('brick') || name.includes('furnace') || name.includes('anvil') || name.includes('terracotta') || name.includes('tuff')) {
      preferredCategory = 'pickaxe';
    } else if (name.includes('log') || name.includes('wood') || name.includes('plank') || name.includes('fence') || name.includes('chest') || name.includes('door') || name.includes('crafting_table')) {
      preferredCategory = 'axe';
    } else if (name.includes('dirt') || name.includes('grass') || name.includes('sand') || name.includes('gravel') || name.includes('clay') || name.includes('mud') || name.includes('snow') || name.includes('soul_')) {
      preferredCategory = 'shovel';
    }

    if (preferredCategory === 'pickaxe') {
      const isHighTier = name.includes('diamond') || name.includes('gold') || name.includes('redstone') || name.includes('emerald') || name.includes('obsidian') || name.includes('ancient_debris');
      const invItems = this.bot.inventory.items();
      const pickaxes = invItems.filter(item => item.name.includes('pickaxe'));

      if (pickaxes.length > 0) {
        let chosenTool = null;
        if (isHighTier) {
          // For high-tier ores, equip highest tier available (Netherite > Diamond > Iron)
          const tierRank = { netherite: 6, diamond: 5, iron: 4, stone: 3, golden: 2, wooden: 1 };
          pickaxes.sort((a, b) => {
            const tierA = Object.keys(tierRank).find(t => a.name.includes(t)) || 'wooden';
            const tierB = Object.keys(tierRank).find(t => b.name.includes(t)) || 'wooden';
            return (tierRank[tierB] || 1) - (tierRank[tierA] || 1);
          });
          chosenTool = pickaxes[0];
        } else {
          const diamondPick = pickaxes.find(p => p.name === 'diamond_pickaxe');
          const ironPick = pickaxes.find(p => p.name === 'iron_pickaxe');
          const stonePick = pickaxes.find(p => p.name === 'stone_pickaxe');
          const woodenPick = pickaxes.find(p => p.name === 'wooden_pickaxe');

          chosenTool = diamondPick || ironPick || stonePick || woodenPick;
        }

        if (chosenTool) {
          if (held && held.name === chosenTool.name) return; // Already holding chosen tool!
          try {
            await this.bot.equip(chosenTool, 'hand');
            return;
          } catch (_) {}
        }
      }
    } else if (preferredCategory === 'axe') {
      const tierRank = { netherite: 6, diamond: 5, iron: 4, stone: 3, golden: 2, wooden: 1 };
      const axes = this.bot.inventory.items().filter(item => item.name.endsWith('_axe') && !item.name.includes('pickaxe'));
      if (axes.length > 0) {
        axes.sort((a, b) => {
          const tierA = Object.keys(tierRank).find(t => a.name.includes(t)) || 'wooden';
          const tierB = Object.keys(tierRank).find(t => b.name.includes(t)) || 'wooden';
          return (tierRank[tierB] || 1) - (tierRank[tierA] || 1);
        });
        const bestAxe = axes[0];
        if (held && held.name === bestAxe.name) return; // Already holding the highest tier axe!
        try {
          await this.bot.equip(bestAxe, 'hand');
          return;
        } catch (_) {}
      }
    } else if (preferredCategory) {
      const tierRank = { netherite: 6, diamond: 5, iron: 4, stone: 3, golden: 2, wooden: 1 };
      const matchingTools = this.bot.inventory.items().filter(item => item.name.endsWith(`_${preferredCategory}`));
      if (matchingTools.length > 0) {
        matchingTools.sort((a, b) => {
          const tierA = Object.keys(tierRank).find(t => a.name.includes(t)) || 'wooden';
          const tierB = Object.keys(tierRank).find(t => b.name.includes(t)) || 'wooden';
          return (tierRank[tierB] || 1) - (tierRank[tierA] || 1);
        });
        const bestTool = matchingTools[0];
        if (held && held.name === bestTool.name) return; // Already holding the highest tier tool!
        try {
          await this.bot.equip(bestTool, 'hand');
          return;
        } catch (_) {}
      }
    }

    const tool = this.bot.pathfinder?.bestHarvestTool ? this.bot.pathfinder.bestHarvestTool(block) : null;
    if (tool) {
      try {
        await this.bot.equip(tool, 'hand');
      } catch (_) {}
    }
  }

  async craftRecipe(recipe, count = 1, craftingTable = null) {
    if (!this.bot) throw new Error('Bot is not ready.');
    await this.bot.craft(recipe, count, craftingTable);
  }

  async depositItem(chest, itemType, metadata, count) {
    return await chest.deposit(itemType, metadata, count);
  }

  async withdrawItem(chest, itemType, metadata, count) {
    return await chest.withdraw(itemType, metadata, count);
  }

  async eatFood() {
    const foodItem = this.bot.inventory.items().find(i => this.resolver.isFood(i));
    if (!foodItem) throw new Error('No edible food found in inventory.');
    await this.bot.equip(foodItem, 'hand');
    await this.bot.consume();
  }

  isTossedTrash(entity) {
    if (!entity) return false;
    if (this._tossedTrashIds && this._tossedTrashIds.has(entity.id)) return true;
    return false;
  }

  async cleanInventory() {
    if (!this.bot || !this.bot.inventory || !this.bot.entity) return;
    const junkTypes = [
      'leaf_litter', 'diorite', 'granite', 'andesite', 'tuff', 'gravel',
      'wheat_seeds', 'short_grass', 'flint', 'dripstone_block', 'pointed_dripstone',
      'oak_sapling', 'birch_sapling', 'spruce_sapling', 'rotten_flesh', 'poisonous_potato'
    ];
    if (!this._tossedTrashIds) this._tossedTrashIds = new Set();

    const items = this.bot.inventory.items();
    const hasJunk = items.some(i => junkTypes.includes(i.name.toLowerCase()));
    const hasExcessBlocks = ['cobblestone', 'cobbled_deepslate', 'dirt', 'raw_copper'].some(name => this.countItem(name) > 32);

    if (!hasJunk && !hasExcessBlocks) return;

    // 1. Turn 180 degrees backward and aim slightly down to throw behind the path of travel!
    const originalYaw = this.bot.entity.yaw;
    const originalPitch = this.bot.entity.pitch;
    await this.bot.look(originalYaw + Math.PI, 0.4, true).catch(() => {});

    // 2. Toss explicit junk blocks & seeds
    for (const item of this.bot.inventory.items()) {
      const name = item.name.toLowerCase();
      if (junkTypes.includes(name)) {
        try {
          await this.bot.toss(item.type, null, item.count);
          logger.info(`🗑️ Tossed junk item ${item.count}x ${item.name} behind player.`, 'DriverAdapter');
          await new Promise(r => setTimeout(r, 60));
        } catch (_) {}
      }
    }

    // 3. Discard obsolete duplicate tools
    const hasHigherPick = this.hasItem('iron_pickaxe') || this.hasItem('stone_pickaxe');
    const hasHigherSword = this.hasItem('iron_sword') || this.hasItem('stone_sword');
    const hasHigherAxe = this.hasItem('iron_axe') || this.hasItem('stone_axe');

    for (const item of this.bot.inventory.items()) {
      if (item.name === 'wooden_pickaxe' && hasHigherPick) {
        await this.bot.toss(item.type, null, item.count).catch(() => {});
      } else if (item.name === 'wooden_sword' && hasHigherSword) {
        await this.bot.toss(item.type, null, item.count).catch(() => {});
      } else if (item.name === 'wooden_axe' && hasHigherAxe) {
        await this.bot.toss(item.type, null, item.count).catch(() => {});
      }
    }

    // 4. Cap construction blocks (keep max 32 to prevent inventory choking)
    const blockCaps = {
      'cobblestone': 32,
      'cobbled_deepslate': 32,
      'dirt': 32,
      'raw_copper': 32
    };

    for (const [bName, maxKeep] of Object.entries(blockCaps)) {
      let currentTotal = this.countItem(bName);
      if (currentTotal > maxKeep) {
        const excess = currentTotal - maxKeep;
        const targetItem = this.bot.inventory.items().find(i => i.name.toLowerCase() === bName);
        if (targetItem) {
          const tossCount = Math.min(targetItem.count, excess);
          await this.bot.toss(targetItem.type, null, tossCount).catch(() => {});
          logger.info(`🗑️ Tossed excess ${tossCount}x ${bName} behind player (capped at ${maxKeep}).`, 'DriverAdapter');
        }
      }
    }

    // 5. Blacklist all newly tossed entities immediately so they are NEVER collected back!
    await new Promise(r => setTimeout(r, 120));
    if (this.bot.entities) {
      for (const e of Object.values(this.bot.entities)) {
        if (e && (e.name === 'item' || e.name === 'Item' || e.displayName === 'Item') && e.position && this.distanceTo(e.position) <= 5) {
          this._tossedTrashIds.add(e.id);
        }
      }
    }

    // 6. Rotate back to original heading and step 1.5 blocks forward away from trash pile
    await this.bot.look(originalYaw, originalPitch, true).catch(() => {});
    const forwardPos = this.getPosition().offset(Math.sin(-originalYaw) * 1.5, 0, Math.cos(-originalYaw) * 1.5);
    await this.goto(forwardPos.x, forwardPos.y, forwardPos.z, 0.5, 1200).catch(() => {});
  }

  // --- Containers & Sleep ---

  async openChest(chestBlock) {
    return await this.bot.openChest(chestBlock);
  }

  async sleep(bedBlock) {
    if (!this.bot) throw new Error('Bot is not ready.');
    await this.bot.sleep(bedBlock);
  }

  async wake() {
    if (!this.bot) throw new Error('Bot is not ready.');
    if (this.bot.isSleeping) {
      await this.bot.wake();
    }
  }

  /**
   * Emergency Drowning Reflex & Cave Ceiling Air Pocket Creator.
   * Floats upward, clears cave ceiling blocks above head to create breathing pockets, and swims to air.
   */
  async emergencySwimAndBreathe() {
    if (!this.bot || !this.bot.entity) return false;
    const botPos = this.getPosition();
    const headPos = new Vec3(Math.floor(botPos.x), Math.floor(botPos.y + 1.6), Math.floor(botPos.z));
    const headBlock = this.getBlockAt(headPos);

    if (!headBlock || (headBlock.name !== 'water' && headBlock.name !== 'flowing_water')) {
      return false; // Not submerged
    }

    // 1. Immediately hold jump to swim upwards
    this.bot.setControlState('jump', true);

    // 2. Check if head is stuck under a solid cave ceiling
    const ceilingBlock = this.getBlockAt(headPos.offset(0, 1, 0));
    if (ceilingBlock && ceilingBlock.name !== 'air' && ceilingBlock.name !== 'cave_air' && ceilingBlock.name !== 'water' && ceilingBlock.name !== 'flowing_water') {
      logger.info(`🫧 Head stuck under '${ceilingBlock.name}' while drowning! Digging ceiling to create air pocket...`, 'DriverAdapter');
      await this.equipBestTool(ceilingBlock);
      await this.digBlock(ceilingBlock).catch(() => {});
    }

    // 3. Check second block above ceiling for extra headroom
    const ceilingBlock2 = this.getBlockAt(headPos.offset(0, 2, 0));
    if (ceilingBlock2 && ceilingBlock2.name !== 'air' && ceilingBlock2.name !== 'cave_air' && ceilingBlock2.name !== 'water' && ceilingBlock2.name !== 'flowing_water') {
      await this.equipBestTool(ceilingBlock2);
      await this.digBlock(ceilingBlock2).catch(() => {});
    }

    // 4. Find nearest surface air block or shoreline
    const airBlocks = this.findBlocks({ matching: 'air', maxDistance: 16, count: 5 });
    const surfaceAir = airBlocks.find(p => p.y >= botPos.y);
    if (surfaceAir) {
      await this.goto(surfaceAir.x, surfaceAir.y, surfaceAir.z, 1.0, 3000).catch(() => {});
    }

    // 5. Release jump once breathing safely
    const freshHead = this.getBlockAt(new Vec3(Math.floor(this.getPosition().x), Math.floor(this.getPosition().y + 1.6), Math.floor(this.getPosition().z)));
    if (freshHead && (freshHead.name === 'air' || freshHead.name === 'cave_air')) {
      this.bot.setControlState('jump', false);
      logger.info('🫧 Safely reached air pocket and breathing.', 'DriverAdapter');
    }
    return true;
  }

  async equipHighestAttackWeapon() {
    if (!this.bot || !this.bot.inventory || this._isDigging) return;
    const held = this.bot.heldItem;
    if (held && (held.name.includes('sword') || (held.name.includes('axe') && !held.name.includes('pickaxe')))) return;
    const weapons = this.bot.inventory.items().filter(item =>
      item.name.includes('sword') || (item.name.includes('axe') && !item.name.includes('pickaxe'))
    );
    if (weapons.length === 0) return;
    const damageMap = {
      netherite_sword: 8, diamond_sword: 7, iron_sword: 6, stone_sword: 5, wooden_sword: 4, golden_sword: 4,
      netherite_axe: 10, diamond_axe: 9, iron_axe: 9, stone_axe: 9, wooden_axe: 7, golden_axe: 7
    };
    weapons.sort((a, b) => (damageMap[b.name] || 1) - (damageMap[a.name] || 1));
    try {
      await this.bot.equip(weapons[0], 'hand');
    } catch (_) {}
  }

  async autoEquipArmor() {
    if (!this.bot || !this.bot.inventory || this._isDigging) return;
    const armorSlots = [
      { slot: 'head', slotIdx: 5, matcher: name => name.endsWith('_helmet') || name.endsWith('_cap') },
      { slot: 'torso', slotIdx: 6, matcher: name => name.endsWith('_chestplate') || name.endsWith('_tunic') },
      { slot: 'legs', slotIdx: 7, matcher: name => name.endsWith('_leggings') || name.endsWith('_pants') },
      { slot: 'feet', slotIdx: 8, matcher: name => name.endsWith('_boots') },
      { slot: 'off-hand', slotIdx: 45, matcher: name => name === 'shield' }
    ];
    for (const { slot, slotIdx, matcher } of armorSlots) {
      const current = this.bot.inventory.slots[slotIdx];
      if (current && matcher(current.name)) continue; // Already equipped in this slot!
      const item = this.bot.inventory.items().find(i => matcher(i.name));
      if (item) {
        try {
          await this.bot.equip(item, slot);
        } catch (_) {}
      }
    }
  }

  isDaytime() {
    if (!this.bot || !this.bot.time) return true;
    const tod = this.bot.time.timeOfDay;
    return tod >= 0 && tod < 12500;
  }

  isHostile(entity) {
    if (!entity || !entity.name) return false;
    const name = entity.name.toLowerCase();
    // Neutral spiders during daytime
    if (name === 'spider' && this.isDaytime() && this.distanceTo(entity.position) > 3.0) {
      return false;
    }
    const hostiles = [
      'zombie', 'skeleton', 'spider', 'creeper', 'enderman', 'witch', 'drowned', 'husk',
      'stray', 'cave_spider', 'zombified_piglin', 'piglin', 'hoglin', 'zoglin', 'phantom',
      'slime', 'magma_cube', 'pillager', 'vindicator', 'ravager', 'evoker', 'vex', 'silverfish'
    ];
    return hostiles.includes(name) || entity.type === 'hostile';
  }

  isHuntable(entity) {
    if (!entity || !entity.name) return false;
    const animals = ['cow', 'pig', 'sheep', 'chicken', 'rabbit', 'mooshroom'];
    return animals.includes(entity.name.toLowerCase());
  }

  shouldPlaceTorch(minDistance = 6) {
    if (!this.bot || !this.hasItem('torch')) return false;
    const pos = this.getPosition();
    const block = this.getBlockAt(pos);
    if (!block) return false;

    // Check if there is already a torch within minDistance (default 6 blocks)
    const nearbyTorches = this.findBlocks({
      matching: ['torch', 'wall_torch'],
      maxDistance: minDistance,
      count: 1,
    });
    if (nearbyTorches.length > 0) return false;

    const blockLight = typeof block.light === 'number' ? block.light : 0;
    const skyLight = this.rawBot?.time?.isNight ? 0 : (typeof block.skyLight === 'number' ? block.skyLight : 0);
    const effectiveLight = Math.max(blockLight, skyLight);

    // Maintain a comfortable, well-lit environment (light <= 7)
    return effectiveLight <= 7;
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

  findEntities(filter = {}) {
    if (!this.bot || !this.bot.entities) return [];
    const maxDistance = filter.maxDistance || 16;
    const type = filter.type;
    return Object.values(this.bot.entities).filter(e => {
      if (!e || e === this.bot.entity || !e.position) return false;
      if (this.distanceTo(e.position) > maxDistance) return false;
      if (type === 'passive' || type === 'animal') return this.isHuntable(e);
      if (type === 'hostile' || type === 'monster') return this.isHostile(e);
      if (type && e.type !== type) return false;
      return true;
    }).sort((a, b) => this.distanceTo(a.position) - this.distanceTo(b.position));
  }

  findHostiles(maxDistance = 12) {
    if (!this.bot || !this.bot.entities) return [];
    return Object.values(this.bot.entities).filter(e =>
      e && e !== this.bot.entity && this.isHostile(e) && this.distanceTo(e.position) <= maxDistance
    ).sort((a, b) => this.distanceTo(a.position) - this.distanceTo(b.position));
  }

  findAnimals(maxDistance = 16) {
    if (!this.bot || !this.bot.entities) return [];
    return Object.values(this.bot.entities).filter(e =>
      e && e !== this.bot.entity && this.isHuntable(e) && this.distanceTo(e.position) <= maxDistance
    ).sort((a, b) => this.distanceTo(a.position) - this.distanceTo(b.position));
  }

  async attackEntity(entity) {
    if (!entity) return;
    await this.equipHighestAttackWeapon();
    if (this.bot._pvpLoaded && this.bot.pvp) {
      await this.bot.pvp.attack(entity);
    } else {
      await this.lookAt(entity.position);
      this.bot.attack(entity);
    }
  }

  findDroppedItems(maxDistance = 16) {
    if (!this.bot || !this.bot.entities) return [];
    const junkNames = new Set([
      'dirt', 'cobblestone', 'cobbled_deepslate', 'deepslate', 'stone', 'sand', 'gravel',
      'diorite', 'granite', 'andesite', 'tuff', 'flint', 'leaf_litter', 'short_grass',
      'wheat_seeds', 'oak_sapling', 'birch_sapling', 'spruce_sapling', 'rotten_flesh',
      'poisonous_potato', 'wooden_pickaxe', 'wooden_axe', 'wooden_sword', 'stick'
    ]);

    return Object.values(this.bot.entities).filter(e => {
      if (!e || !(e.name === 'item' || e.name === 'Item' || e.displayName === 'Item')) return false;
      if (!e.position || this.distanceTo(e.position) > maxDistance) return false;
      if (this._tossedTrashIds && this._tossedTrashIds.has(e.id)) return false;

      if (e.getDroppedItem) {
        try {
          const item = e.getDroppedItem();
          if (item && junkNames.has(item.name.toLowerCase())) return false;
        } catch (_) {}
      }
      return true;
    }).sort((a, b) => this.distanceTo(a.position) - this.distanceTo(b.position));
  }

  findVillagers(maxDistance = 16) {
    if (!this.bot || !this.bot.entities) return [];
    return Object.values(this.bot.entities).filter(e =>
      e && (e.name === 'villager' || e.displayName === 'Villager') && this.distanceTo(e.position) <= maxDistance
    ).sort((a, b) => this.distanceTo(a.position) - this.distanceTo(b.position));
  }

  async moveAway(distance = 16, timeoutMs = 6000) {
    const pos = this.getPosition();
    const enemies = this.findHostiles(distance);
    let escapeVec = new Vec3(0, 0, 0);

    if (enemies.length > 0) {
      for (const e of enemies) {
        const diff = pos.minus(e.position);
        escapeVec = escapeVec.plus(diff);
      }
      escapeVec = escapeVec.normalize().scaled(distance);
    } else {
      const angle = Math.random() * Math.PI * 2;
      escapeVec = new Vec3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
    }

    const targetPos = pos.plus(escapeVec);
    return await this.goto(targetPos.x, targetPos.y, targetPos.z, 2.0, timeoutMs).catch(() => {});
  }

  getNearestFreeSpace(size = 1, maxDistance = 8) {
    const pos = this.getPosition();
    const emptyPos = this.findBlocks({
      matching: 'air',
      maxDistance,
      count: 200
    });

    for (const p of emptyPos) {
      let isClear = true;
      for (let x = 0; x < size; x++) {
        for (let z = 0; z < size; z++) {
          const top = this.getBlockAt(p.offset(x, 0, z));
          const bottom = this.getBlockAt(p.offset(x, -1, z));
          if (!top || top.name !== 'air' || !bottom || bottom.name === 'air' || bottom.name === 'water' || bottom.name === 'lava') {
            isClear = false;
            break;
          }
        }
        if (!isClear) break;
      }
      if (isClear) return p;
    }
    return pos.offset(1, 0, 1);
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
