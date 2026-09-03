/**
 * Supercharged Autonomous Dual-Agent Loop for Muumiu (Minecraft Companion AI).
 * 
 * 👑 Agent 1 (Executive Goal Planner & Persona):
 *    - Continuously inspects real-time telemetry (HP, food, inventory, depth, surrounding blocks).
 *    - Dynamically formulates the active autonomous quest/prompt in natural language.
 * 
 * 🧑‍💻 Agent 2 (Tactical AI Coder & Universal Sandbox):
 *    - Receives natural language goal from Agent 1.
 *    - Invokes Local Ollama (qwen2.5-coder:3b) to generate safe JavaScript DSL code in real time.
 *    - Runs the code in Universal Sandbox with 1-shot self-healing and Live2D telemetry reflection.
 * 
 * 🤖 Bot (Driver Adapter):
 *    - Performs the physics-accurate Minecraft actions in the live world.
 */

const { Vec3 } = require('vec3');
const { logger } = require('./logger');
const { config } = require('../config/loader');

class AutonomousEngine {
  constructor(client) {
    this.client = client;
    this.isRunning = false;
    this.isBusy = false;
    this._loopInterval = null;
    this._cfg = config.minecraft?.autonomous || {
      enabled: true,
      idle_timeout_ms: 3000,
      explore_radius: 24,
      gather_drops: true,
      auto_eat: true,
      auto_sleep: true,
      replant_saplings: true,
      self_defense: true,
      auto_armor: true,
      auto_torch: true,
      hunting: true,
      farming: true,
      gift_giving: true,
      base_storage: true,
    };
    this._idleTimeoutMs = this._cfg.idle_timeout_ms || 1500;
    this._lastTaskTime = 0;
    this._spawnPos = null;
    this._currentGoal = 'idle';
    this._unreachableDrops = new Set();
    this._dropAttempts = {};
    this._lastTorchPlace = 0;
    this._lastGiftTime = 0;
    this._lastBanterTime = {};
    this._goalCooldowns = {};
    this._preemptController = new AbortController();

    // 🚨 Anti-Stall & Proactive Liveness Watchdog
    this._lastMeaningfulActionTime = Date.now();
    this._busyStartTime = 0;
    this._watchdogInterval = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._lastTaskTime = 0;
    this._lastMeaningfulActionTime = Date.now();
    logger.info('🤖 Perpetual Dual-Agent Loop started (Agent 1 Goal Formulation ➔ Agent 2 Ollama Coder Active)!', 'AutonomousEngine');

    if (this.client && this.client.adapter && typeof this.client.adapter.getPosition === 'function') {
      const p = this.client.adapter.getPosition();
      if (p && p.y >= 55) {
        this._spawnPos = p.clone();
        if (this.client.worldMemory && typeof this.client.worldMemory.setLandmark === 'function') {
          this.client.worldMemory.setLandmark('SurfaceSpawn', p.x, p.y, p.z);
        }
      }
    }

    this._loopInterval = setInterval(() => {
      this._tick();
    }, 2000);

    // Dedicated 1-Second Liveness & Anti-Stall Watchdog Heartbeat
    this._watchdogInterval = setInterval(() => {
      this._runWatchdog();
    }, 1000);
  }

  stop() {
    this.isRunning = false;
    if (this._loopInterval) {
      clearInterval(this._loopInterval);
      this._loopInterval = null;
    }
    if (this._watchdogInterval) {
      clearInterval(this._watchdogInterval);
      this._watchdogInterval = null;
    }
    this.preempt();
    logger.info('Autonomous Agent Loop stopped.', 'AutonomousEngine');
  }

  notifyTaskStarted() {
    this._lastTaskTime = Date.now();
    this.preempt();
  }

  notifyTaskCompleted() {
    this._lastTaskTime = Date.now();
    logger.info('✨ Task completed. Muumiu resuming autonomous Dual-Agent loop...', 'AutonomousEngine');
  }

  preempt() {
    if (this.isBusy) {
      logger.info('⚡ Preempting autonomous gameplay for player command (0.01s instant response)...', 'AutonomousEngine');
      this._preemptController.abort();
      this._preemptController = new AbortController();
      this.isBusy = false;
      if (this.client.adapter) {
        this.client.adapter.stopMovement();
      }
    }
  }

  getCurrentGoal() {
    return this._currentGoal;
  }

  emitBanter(eventKey) {
    const now = Date.now();
    if (this._lastBanterTime[eventKey] && now - this._lastBanterTime[eventKey] < 45000) {
      return;
    }
    this._lastBanterTime[eventKey] = now;

    const events = config.dialogues?.minecraft_events || {};
    const lines = events[eventKey] || [];
    if (lines.length > 0) {
      const rawLine = lines[Math.floor(Math.random() * lines.length)];
      const cleanLine = rawLine.replace(/\[\w+\]\s*/g, '');
      this.client.adapter.chat(cleanLine);
      logger.info(`💬 [Milestone Banter] (${eventKey}): ${cleanLine}`, 'AutonomousEngine');
    }
  }

  async dispatchGoalToAI(goalPrompt, goalKey = null) {
    const key = goalKey || goalPrompt;
    if (this._goalCooldowns[key] && Date.now() < this._goalCooldowns[key]) {
      return { status: 'cooldown' };
    }

    logger.info(`👑 [Agent 1 Planner] Formulated Autonomous Goal: "${goalPrompt}"`, 'AutonomousEngine');
    const { MCPToolHandler } = require('../mcp/tools');
    const result = await MCPToolHandler.handleToolCall('muu_mc_execute_task', { task: goalPrompt }, true);
    
    if (result.status === 'error' || result.isError) {
      this._goalCooldowns[key] = Date.now() + 20000;
      logger.warn(`Goal failed. Backing off "${goalPrompt}" for 20s...`, 'AutonomousEngine');
    } else {
      delete this._goalCooldowns[key];
    }

    logger.info(`🧑‍💻 [Agent 2 AI Coder] Executed task with status: ${result.status} (source: ${result.source})`, 'AutonomousEngine');
    this._lastMeaningfulActionTime = Date.now();
    return result;
  }

  /**
   * Dedicated Anti-Stall & Liveness Watchdog.
   * Runs every 3s to guarantee zero deadlock and zero idling.
   */
  async _runWatchdog() {
    if (!this.isRunning) return;
    if (!this.client.isConnected || !this.client.isSpawned) return;

    const adapter = this.client.adapter;
    const dsl = this.client.dsl;
    if (!adapter || !dsl) return;

    const currentPos = adapter.getPosition();
    if (!this._lastWatchdogPos) {
      this._lastWatchdogPos = currentPos.clone();
      this._lastWatchdogMoveTime = Date.now();
    } else {
      const dist = currentPos.distanceTo(this._lastWatchdogPos);
      if (dist > 0.8) {
        this._lastWatchdogPos = currentPos.clone();
        this._lastWatchdogMoveTime = Date.now();
        this._lastMeaningfulActionTime = Date.now();
      }
    }

    // If bot is actively digging, it is working normally — do NOT interrupt or abort!
    if (adapter._isDigging) {
      this._lastWatchdogMoveTime = Date.now();
      this._lastMeaningfulActionTime = Date.now();
      return;
    }

    // 1. Stuck Lock Release Guard: If bot hasn't moved or dug for >25s while busy:
    const timeWithoutMovement = Date.now() - (this._lastWatchdogMoveTime || Date.now());
    if (this.isBusy && timeWithoutMovement > 25000) {
      logger.warn(`🚨 [Anti-Stall Watchdog] Bot stalled for ${(timeWithoutMovement / 1000).toFixed(1)}s! Forcing abort & unstuck hop...`, 'AutonomousEngine');
      this.preempt();
      this.isBusy = false;
      this._busyStartTime = 0;
      this._lastMeaningfulActionTime = Date.now();
      this._lastWatchdogMoveTime = Date.now();
      await adapter.moveAway(3).catch(() => {});
      return;
    }

    // 2. Proactive Anti-Sleep Kickstart (>2s inactivity when not busy)
    const inactiveDuration = Date.now() - this._lastMeaningfulActionTime;
    if (!this.isBusy && inactiveDuration > 2000) {
      logger.warn(`🚨 [Anti-Stall Watchdog] Bot idle for ${(inactiveDuration / 1000).toFixed(1)}s! Stimulating immediate action...`, 'AutonomousEngine');
      this._lastMeaningfulActionTime = Date.now();
      this._lastWatchdogMoveTime = Date.now();
      await this._forceKickstartAction(adapter, dsl);
    }
  }

  async _forceKickstartAction(adapter, dsl) {
    if (this.isBusy) return;
    this.isBusy = true;
    this._busyStartTime = Date.now();
    try {
      const botPos = adapter.getPosition();

      // Check if head is inside solid block
      const headBlock = adapter.getBlockAt(botPos.offset(0, 1.6, 0));
      if (headBlock && headBlock.name !== 'air' && headBlock.name !== 'cave_air' && headBlock.name !== 'water') {
        logger.info(`🚨 [Anti-Stall] Clearing head block '${headBlock.name}'...`, 'AutonomousEngine');
        await dsl.safeDigBlock(headBlock);
      }

      if (botPos.y < 55) {
        // Underground: Scan for exposed cave ores
        const exposed = dsl.findNearbyExposedOres(16);
        if (exposed.length > 0) {
          logger.info(`🚨 [Anti-Stall] Found ${exposed.length} exposed cave ores! Mining cave ores...`, 'AutonomousEngine');
          await dsl.mineAllNearbyOres(16, 4);
        } else {
          logger.info('🚨 [Anti-Stall] Staircase mining down to discover new veins...', 'AutonomousEngine');
          await dsl.staircaseMineDown(Math.round(botPos.y) - 3);
        }
      } else {
        // Surface: Check inventory for wood
        const woodItems = adapter.getInventoryItems().filter(i => i.name.includes('log') || i.name.includes('planks'));
        const totalWood = woodItems.reduce((acc, i) => acc + i.count, 0);
        if (totalWood >= 8) {
          logger.info('🚨 [Anti-Stall] Bot has wood in inventory. Exploring surroundings...', 'AutonomousEngine');
          await adapter.exploreTerrain(16).catch(() => {});
        } else {
          logger.info('🚨 [Anti-Stall] Searching for trees or exploring terrain...', 'AutonomousEngine');
          const chopSuccess = await dsl.chopTree({ count: 2 }).catch(() => false);
          if (!chopSuccess) {
            await adapter.exploreTerrain(16).catch(() => {});
          }
        }
      }
    } catch (e) {
      logger.debug(`Anti-Stall kickstart note: ${e.message}`, 'AutonomousEngine');
    } finally {
      this.isBusy = false;
      this._busyStartTime = 0;
      this._lastMeaningfulActionTime = Date.now();
    }
  }

  async _tick() {
    if (!this.isRunning || this.isBusy) return;
    if (!this.client.isConnected || !this.client.isSpawned) return;

    const idleDuration = Date.now() - this._lastTaskTime;
    if (idleDuration < this._idleTimeoutMs) return;

    const adapter = this.client.adapter;
    const dsl = this.client.dsl;
    const stateScanner = this.client.stateScanner;

    if (!adapter || !dsl || !stateScanner) return;

    if (!this._spawnPos) {
      this._spawnPos = adapter.getPosition();
    }

    this.isBusy = true;
    this._busyStartTime = Date.now();
    const signal = this._preemptController.signal;

    try {
      const rawBot = adapter.rawBot;
      const botPos = adapter.getPosition();

      // =========================================================================
      // 🛡️ MODE 0: 🛡️ Auto-Equip Armor & Shields
      // =========================================================================
      if (this._cfg.auto_armor !== false) {
        await adapter.autoEquipArmor();
      }

      // =========================================================================
      // 🚧 MODE 0.5: 🚧 Stuck Position Detection & Resolution
      // =========================================================================
      if (!this._lastStuckCheckPos) {
        this._lastStuckCheckPos = botPos.clone();
        this._lastStuckCheckTime = Date.now();
      } else {
        const distMoved = botPos.distanceTo(this._lastStuckCheckPos);
        const timeElapsed = Date.now() - this._lastStuckCheckTime;
        if (timeElapsed > 25000) {
          if (distMoved < 1.5 && !rawBot.isSleeping && !adapter._isDigging) {
            logger.warn('🚧 Bot stuck in the same position for >25s. Triggering Unstuck evasive hop...', 'AutonomousEngine');
            await adapter.moveAway(3);
          }
          this._lastStuckCheckPos = botPos.clone();
          this._lastStuckCheckTime = Date.now();
        }
      }

      // =========================================================================
      // 🚨 MODE 1: ⛑️ Self-Preservation (Drowning, Burning, Low HP)
      // =========================================================================
      if (rawBot) {
        const headPos = new Vec3(Math.floor(botPos.x), Math.floor(botPos.y + 1.6), Math.floor(botPos.z));
        const blockHead = adapter.getBlockAt(headPos);
        if (blockHead && (blockHead.name === 'water' || blockHead.name === 'flowing_water')) {
          this._currentGoal = 'emergency_swimming';
          logger.warn('🫧 [Emergency] Bot is submerged underwater! Executing emergency surface swim & cave air pocket creation...', 'AutonomousEngine');
          await adapter.emergencySwimAndBreathe();
          return;
        }

        // 2. Fire / Burning & Lava Reflex (ดับไฟด้วยถังน้ำ หรือวิ่งลงน้ำใกล้ที่สุด)
        const blockIn = adapter.getBlockAt(botPos);
        const isOnFire = rawBot.entity?.isOnFire || (blockIn && (blockIn.name === 'fire' || blockIn.name === 'lava' || blockIn.name === 'flowing_lava'));
        if (isOnFire) {
          this._currentGoal = 'extinguishing_fire';
          logger.warn('🔥 [Reflex] Bot is on fire! Seeking immediate water or bucket clutch...', 'AutonomousEngine');

          // Option A: Water Bucket Clutch (place water at feet, extinguish, and scoop back)
          if (adapter.hasItem('water_bucket')) {
            logger.info('💧 [Reflex] Executing water bucket clutch to douse flames...', 'AutonomousEngine');
            const clutched = await dsl.useWaterBucketClutch().catch(() => false);
            if (clutched) return;
          }

          // Option B: Run into nearest water block within 16m
          const nearbyWater = adapter.findBlocks({ matching: ['water', 'flowing_water'], maxDistance: 16, count: 1 });
          if (nearbyWater.length > 0) {
            logger.info(`🌊 [Reflex] Running to nearest water at (${nearbyWater[0].x}, ${nearbyWater[0].y}, ${nearbyWater[0].z}) to extinguish fire!`, 'AutonomousEngine');
            await adapter.goto(nearbyWater[0].x, nearbyWater[0].y, nearbyWater[0].z, 1.0, 3500).catch(() => {});
            return;
          }

          // Fallback: Sprint away from fire/lava source
          logger.warn('🔥 [Reflex] No water bucket or water nearby. Sprinting away to open ground!', 'AutonomousEngine');
          await adapter.moveAway(14);
          return;
        }

        if (adapter.getHealth() < 8) {
          const hostiles = adapter.findHostiles(12);
          if (hostiles.length > 0) {
            this._currentGoal = 'fleeing_danger';
            logger.warn(`🏃 [Reflex] Low HP (${adapter.getHealth()})! Executing native tactical retreat from ${hostiles[0].name}...`, 'AutonomousEngine');
            await adapter.moveAway(16);
            return;
          }
        }
      }

      // =========================================================================
      // ⚔️ MODE 2: ⚔️ Native Self-Defense, Agile Combat & Mob Group Evasion
      // =========================================================================
      if (this._cfg.self_defense !== false) {
        if (!this._unreachableHostiles) this._unreachableHostiles = new Map();
        const now = Date.now();
        const hostiles = adapter.findHostiles(12).filter(e => {
          return !this._unreachableHostiles.has(e.id) || this._unreachableHostiles.get(e.id) <= now;
        });

        // 🛡️ Group Threat Evasion: If 2 or more hostiles are grouped nearby, retreat instead of suicidal trade!
        if (hostiles.length >= 2) {
          this._currentGoal = 'evading_mob_group';
          logger.warn(`🛡️ [Reflex] Mob group detected (${hostiles.length} hostiles: ${hostiles.map(h => h.name).join(', ')})! Avoiding group combat and retreating...`, 'AutonomousEngine');
          await adapter.moveAway(16);
          return;
        }

        // Single Target Tactical Combat (Hit-and-Retreat)
        if (hostiles.length === 1) {
          const targetEnemy = hostiles[0];
          this._currentGoal = 'defending_self';
          this.emitBanter('hostile_spotted');
          logger.info(`⚔️ [Reflex] Hostile '${targetEnemy.name}' detected at ${adapter.distanceTo(targetEnemy.position).toFixed(1)}m. Engaging with Hit-and-Retreat combat...`, 'AutonomousEngine');
          await adapter.equipHighestAttackWeapon();
          await adapter.attackEntity(targetEnemy);
          if (adapter.distanceTo(targetEnemy.position) > 4.5) {
            this._unreachableHostiles.set(targetEnemy.id, Date.now() + 15000);
          }
          return;
        }
      }

      // =========================================================================
      // 🌾 MODE 3: 🌾 Sustenance, Farming & Hunger
      // =========================================================================
      if (this._cfg.farming !== false) {
        const matureCrops = adapter.findBlocks({
          matching: ['wheat', 'carrots', 'potatoes', 'beetroots'],
          maxDistance: 16,
          count: 1,
        });
        if (matureCrops.length > 0) {
          this.emitBanter('farming_harvest');
          await this.dispatchGoalToAI('เก็บเกี่ยวพืชผลทางการเกษตรที่โตเต็มวัย และปลูกเมล็ดพันธุ์ทดแทนลงดิน');
          if (signal.aborted) return;
        }
      }

      // 🍖 Native Auto-Eat Reflex (0 AI, Eats directly from inventory)
      if (this._cfg.auto_eat && (adapter.getFood() < 16 || adapter.getHealth() < 16)) {
        const ate = await adapter.eatFood().catch(() => false);
        if (ate) {
          logger.info(`🍖 [Reflex] Consumed food to restore hunger/HP (Food: ${adapter.getFood()}, HP: ${adapter.getHealth()})`, 'AutonomousEngine');
          return;
        } else if (!this._lastHuntAttempt || Date.now() - this._lastHuntAttempt > 30000) {
          const passives = adapter.findEntities({ type: 'passive', maxDistance: 16 });
          if (passives.length > 0) {
            this._currentGoal = 'hunting_for_food';
            this._lastHuntAttempt = Date.now();
            await this.dispatchGoalToAI(`ล่าสัตว์ ${passives[0].name} ใกล้ๆ เพื่อหาเนื้อมาทำอาหารฟื้นฟูความหิว`);
            if (signal.aborted) return;
            return;
          }
        }
      }

      if (this._cfg.auto_sleep && rawBot?.time?.isNight && !rawBot?.isSleeping) {
        this._currentGoal = 'sleeping';
        this.emitBanter('sunset_approaching');
        await this.dispatchGoalToAI('เดินไปนอนที่เตียงนอนใกล้ๆ เนื่องจากเป็นเวลากลางคืน');
        if (signal.aborted) return;
        return;
      }

      // =========================================================================
      // 📦 MODE 4: 📦 Native Ground Loot Collection (Focused & Low-Distraction)
      // =========================================================================
      if (this._cfg.gather_drops && this._currentGoal !== 'returning_to_remembered_diamonds' && !this._currentGoal?.includes('mining') && !this._currentGoal?.includes('chopping')) {
        if (rawBot && rawBot.inventory.emptySlotCount() === 0) {
          await adapter.cleanInventory();
        }

        if (rawBot && rawBot.inventory.emptySlotCount() >= 2) {
          const droppedItems = adapter.findDroppedItems(6);
          const accessibleDrop = droppedItems.find(d => !this._unreachableDrops.has(d.id) && !adapter.isTossedTrash(d));

          // Always collect dropped ores/valuables, or normal drops if >= 2 items or close by
          const isValuable = adapter.isValuableDrop(accessibleDrop);
          if (accessibleDrop && (isValuable || droppedItems.length >= 2 || adapter.distanceTo(accessibleDrop.position) <= 3.5)) {
            this._dropAttempts[accessibleDrop.id] = (this._dropAttempts[accessibleDrop.id] || 0) + 1;
            if (this._dropAttempts[accessibleDrop.id] >= 2) {
              this._unreachableDrops.add(accessibleDrop.id);
              logger.info(`📦 [Loot] Item ${accessibleDrop.id} uncollectible. Bypassing...`, 'AutonomousEngine');
            } else {
              this._currentGoal = 'gathering_loot';
              logger.info(`📦 [Reflex] Collecting ${droppedItems.length} dropped item(s) nearby natively (valuable: ${isValuable})...`, 'AutonomousEngine');
              await dsl.collectDrops(isValuable ? 10 : 5).catch(() => {});
              return;
            }
          }
        }
      }

      // =========================================================================
      // 💎 MODE 4.5: 💎 Opportunistic Ore Harvesting Reflex (Mine on Sight!)
      // =========================================================================
      if (!this._currentGoal?.includes('emergency') && !this._currentGoal?.includes('hunting')) {
        const hasDiamondPick = adapter.hasItem('diamond_pickaxe') || adapter.hasItem('netherite_pickaxe');
        const hasIronPick = hasDiamondPick || adapter.hasItem('iron_pickaxe');
        const hasStonePick = hasIronPick || adapter.hasItem('stone_pickaxe');
        const hasWoodenPick = hasStonePick || adapter.hasItem('wooden_pickaxe');

        // Safety gate: Never mine opportunistic ores if submerged in water, low oxygen, or low HP!
        const isSubmerged = rawBot?.entity?.isInWater || (rawBot?.oxygenLevel !== undefined && rawBot.oxygenLevel < 18);
        const isLowHp = (rawBot?.health || 20) <= 10;

        if (hasWoodenPick && !isSubmerged && !isLowHp && rawBot && rawBot.inventory.emptySlotCount() >= 1) {
          const exposedOres = dsl.findNearbyExposedOres(12).filter(bPos => dsl.isOreSafeToHarvest(bPos));
          if (exposedOres.length > 0) {
            // Prioritize: Diamond > Ancient Debris > Iron > Gold > Coal > Lapis > Redstone > Copper
            const orePriority = (name) => {
              if (name.includes('diamond')) return 100;
              if (name.includes('ancient_debris')) return 90;
              if (name.includes('iron')) return 80;
              if (name.includes('gold')) return 70;
              if (name.includes('coal')) return 60;
              if (name.includes('lapis')) return 50;
              if (name.includes('redstone')) return 40;
              if (name.includes('copper')) return 30;
              return 10;
            };

            exposedOres.sort((a, b) => {
              const bA = adapter.getBlockAt(a);
              const bB = adapter.getBlockAt(b);
              const pA = bA ? orePriority(bA.name) : 0;
              const pB = bB ? orePriority(bB.name) : 0;
              if (pA !== pB) return pB - pA;
              return adapter.distanceTo(a) - adapter.distanceTo(b);
            });

            const bestOrePos = exposedOres[0];
            const bestOreBlock = adapter.getBlockAt(bestOrePos);
            if (bestOreBlock) {
              this._currentGoal = 'harvesting_opportunistic_ore';
              logger.info(`💎 [Ore Reflex] Spotted harvestable ore '${bestOreBlock.name}' at (${bestOrePos.x}, ${bestOrePos.y}, ${bestOrePos.z})! Harvesting vein immediately...`, 'AutonomousEngine');
              const mined = await dsl.mineConnectedVein(bestOrePos, [bestOreBlock.name, `deepslate_${bestOreBlock.name.replace('deepslate_', '')}`]);
              if (mined > 0) {
                await dsl.collectNearbyDrops(8);
                return;
              }
            }
          }
        }
      }

      // =========================================================================
      // 📦 MODE 5: 📦 Base Chest Storage Offload
      // =========================================================================
      if (this._cfg.base_storage !== false && rawBot && rawBot.inventory.emptySlotCount() < 4) {
        const chests = adapter.findBlocks({ matching: ['chest', 'trapped_chest', 'barrel'], maxDistance: 24, count: 1 });
        if (chests.length > 0) {
          this._currentGoal = 'offloading_to_chest';
          this.emitBanter('base_depot');
          await this.dispatchGoalToAI('กระเป๋าใกล้เต็ม ให้เดินไปที่กล่องเก็บของและเก็บไอเทมบล็อกดิน หิน ขยะส่วนเกินเข้ากล่อง');
          if (signal.aborted) return;
          return;
        }
      }

      // =========================================================================
      // 🕯️ MODE 6: 🕯️ Auto-Torch Lighting in Dark Areas / Underground
      // =========================================================================
      if (this._cfg.auto_torch !== false && adapter.hasItem('torch') && adapter.shouldPlaceTorch()) {
        const placed = await dsl.placeTorchIfDark();
        if (placed) {
          logger.info('🕯️ [Lighting] Auto-placed torch in dark area.', 'AutonomousEngine');
          if (signal.aborted) return;
        }
      }

      // =========================================================================
      // 🏆 MODE 7: 🏆 Perpetual Tech Tree Progression (Zero -> Diamond)
      // =========================================================================
      const logTypes = ['oak_log', 'birch_log', 'spruce_log', 'cherry_log', 'acacia_log', 'jungle_log', 'dark_oak_log', 'mangrove_log'];
      const plankTypes = ['oak_planks', 'birch_planks', 'spruce_planks', 'cherry_planks', 'acacia_planks'];

      let totalLogs = 0;
      for (const log of logTypes) totalLogs += adapter.countItem(log);

      let totalPlanks = 0;
      for (const p of plankTypes) totalPlanks += adapter.countItem(p);

      const hasCraftingTable = adapter.hasItem('crafting_table') || adapter.findBlocks({ matching: 'crafting_table', maxDistance: 12, count: 1 }).length > 0;
      const hasFurnace = adapter.hasItem('furnace') || adapter.findBlocks({ matching: 'furnace', maxDistance: 12, count: 1 }).length > 0;

      const hasWoodenPick = adapter.hasItem('wooden_pickaxe');
      const hasStonePick = adapter.hasItem('stone_pickaxe');
      const hasIronPick = adapter.hasItem('iron_pickaxe');
      const hasDiamondPick = adapter.hasItem('diamond_pickaxe');
      const hasAnyPickaxe = hasWoodenPick || hasStonePick || hasIronPick || hasDiamondPick;

      const hasWoodenAxe = adapter.hasItem('wooden_axe');
      const hasStoneAxe = adapter.hasItem('stone_axe');
      const hasIronAxe = adapter.hasItem('iron_axe');
      const hasDiamondAxe = adapter.hasItem('diamond_axe');
      const hasAnyAxe = hasWoodenAxe || hasStoneAxe || hasIronAxe || hasDiamondAxe;

      const cobblestoneCount = adapter.countItem('cobblestone') + adapter.countItem('cobbled_deepslate') + adapter.countItem('blackstone');
      const rawIronCount = adapter.countItem('raw_iron');
      const ironIngotCount = adapter.countItem('iron_ingot');
      const diamondCount = adapter.countItem('diamond');
      const coalCount = adapter.countItem('coal') + adapter.countItem('charcoal');

      const stickCount = adapter.countItem('stick');
      const hasWoodForSticks = stickCount >= 2 || totalPlanks >= 2 || totalLogs >= 1;
      const hasWoodForTable = (adapter.hasItem('crafting_table') || totalPlanks >= 4 || totalLogs >= 1);
      const hasWoodPrerequisites = hasWoodForSticks && hasWoodForTable;

      if (Math.random() < 0.2) {
        logger.info(`🎒 Inventory: ${adapter.getInventory().map(i => `${i.count}x ${i.name}`).join(', ') || 'empty'}`, 'AutonomousEngine');
      }

      // =========================================================================
      // 💎 STAGE 0: TOP PRIORITY — HIGH-TIER GEAR & ARMOR MASTERY
      // =========================================================================
      // 0. Auto-equip armor and shield if sitting in inventory
      await adapter.autoEquipArmor().catch(() => {});

      // A. If we have valuable Diamonds or Iron but lack Wood/Sticks for crafting:
      if ((diamondCount >= 2 || ironIngotCount >= 2) && (!hasWoodPrerequisites || !hasWoodForTable)) {
        this._currentGoal = 'gathering_wood_for_high_tier_gear';
        logger.info(`🪵 [Gear Prerequisite] Have ${diamondCount} diamonds / ${ironIngotCount} iron ingots! Gathering wood for sticks & table...`, 'AutonomousEngine');
        await this.dispatchGoalToAI('ตัดต้นไม้ 2 บล็อกเพื่อนำไม้มาคราฟต์ไม้แท่งและโต๊ะคราฟต์สำหรับทำอุปกรณ์');
        if (signal.aborted) return;
        return;
      }

      // B. 💎 DIAMOND GEAR MASTERY (Top Equipment Priority):
      if (hasWoodPrerequisites && diamondCount >= 3 && !hasDiamondPick) {
        this._currentGoal = 'crafting_diamond_pickaxe';
        this.emitBanter('diamond_gear_crafted');
        await this.dispatchGoalToAI('คราฟต์ที่ขุดเพชร Diamond Pickaxe จากเพชร 3 เม็ดและไม้แท่ง');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodPrerequisites && diamondCount >= 2 && !adapter.hasItem('diamond_sword')) {
        this._currentGoal = 'crafting_diamond_sword';
        await this.dispatchGoalToAI('คราฟต์ดาบเพชร Diamond Sword จากเพชร 2 เม็ด');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodForTable && diamondCount >= 8 && !adapter.hasItem('diamond_chestplate')) {
        this._currentGoal = 'crafting_diamond_chestplate';
        this.emitBanter('diamond_gear_crafted');
        await this.dispatchGoalToAI('คราฟต์เสื้อเกราะเพชร Diamond Chestplate จากเพชร 8 เม็ด');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodForTable && diamondCount >= 7 && !adapter.hasItem('diamond_leggings')) {
        this._currentGoal = 'crafting_diamond_leggings';
        await this.dispatchGoalToAI('คราฟต์กางเกงเกราะเพชร Diamond Leggings จากเพชร 7 เม็ด');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodForTable && diamondCount >= 4 && !adapter.hasItem('diamond_boots')) {
        this._currentGoal = 'crafting_diamond_boots';
        await this.dispatchGoalToAI('คราฟต์รองเท้าเกราะเพชร Diamond Boots จากเพชร 4 เม็ด');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodForTable && diamondCount >= 5 && !adapter.hasItem('diamond_helmet')) {
        this._currentGoal = 'crafting_diamond_helmet';
        await this.dispatchGoalToAI('คราฟต์หมวกเกราะเพชร Diamond Helmet จากเพชร 5 เม็ด');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodPrerequisites && diamondCount >= 3 && !adapter.hasItem('diamond_axe')) {
        this._currentGoal = 'crafting_diamond_axe';
        await this.dispatchGoalToAI('คราฟต์ขวานเพชร Diamond Axe จากเพชร 3 เม็ดและไม้แท่ง');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodPrerequisites && diamondCount >= 1 && !adapter.hasItem('diamond_shovel')) {
        this._currentGoal = 'crafting_diamond_shovel';
        await this.dispatchGoalToAI('คราฟต์พลั่วเพชร Diamond Shovel จากเพชร 1 เม็ดและไม้แท่ง');
        if (signal.aborted) return;
        return;
      }

      // C. ⛓️ IRON GEAR MASTERY:
      if (hasWoodPrerequisites && ironIngotCount >= 3 && !hasIronPick && !hasDiamondPick) {
        this._currentGoal = 'crafting_iron_pickaxe';
        await this.dispatchGoalToAI('คราฟต์ที่ขุดเหล็ก Iron Pickaxe จากแท่งเหล็ก 3 แท่งและไม้แท่ง');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodPrerequisites && ironIngotCount >= 2 && !adapter.hasItem('iron_sword') && !adapter.hasItem('diamond_sword')) {
        this._currentGoal = 'crafting_iron_sword';
        await this.dispatchGoalToAI('คราฟต์ดาบเหล็ก Iron Sword จากแท่งเหล็ก 2 แท่ง');
        if (signal.aborted) return;
        return;
      }

      if (ironIngotCount >= 1 && (totalPlanks >= 6 || totalLogs >= 2) && !adapter.hasItem('shield')) {
        this._currentGoal = 'crafting_shield';
        await this.dispatchGoalToAI('คราฟต์โล่ป้องกันตัว Shield จากแท่งเหล็กและไม้แปรรูป');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodForTable && ironIngotCount >= 8 && !adapter.hasItem('iron_chestplate') && !adapter.hasItem('diamond_chestplate')) {
        this._currentGoal = 'crafting_iron_chestplate';
        this.emitBanter('iron_gear_crafted');
        await this.dispatchGoalToAI('คราฟต์เสื้อเกราะเหล็ก Iron Chestplate จากแท่งเหล็ก 8 แท่ง');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodForTable && ironIngotCount >= 7 && !adapter.hasItem('iron_leggings') && !adapter.hasItem('diamond_leggings')) {
        this._currentGoal = 'crafting_iron_leggings';
        await this.dispatchGoalToAI('คราฟต์กางเกงเกราะเหล็ก Iron Leggings จากแท่งเหล็ก 7 แท่ง');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodForTable && ironIngotCount >= 4 && !adapter.hasItem('iron_boots') && !adapter.hasItem('diamond_boots')) {
        this._currentGoal = 'crafting_iron_boots';
        await this.dispatchGoalToAI('คราฟต์รองเท้าเกราะเหล็ก Iron Boots จากแท่งเหล็ก 4 แท่ง');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodForTable && ironIngotCount >= 5 && !adapter.hasItem('iron_helmet') && !adapter.hasItem('diamond_helmet')) {
        this._currentGoal = 'crafting_iron_helmet';
        await this.dispatchGoalToAI('คราฟต์หมวกเกราะเหล็ก Iron Helmet จากแท่งเหล็ก 5 แท่ง');
        if (signal.aborted) return;
        return;
      }

      // D. If we have an Iron/Diamond Pickaxe, IMMEDIATELY scan for local Diamonds within 24m and mine them!
      if (hasIronPick || hasDiamondPick) {
        const localDiamonds = adapter.findBlocks({ matching: ['diamond_ore', 'deepslate_diamond_ore'], maxDistance: 24, count: 5 });
        if (localDiamonds.length > 0) {
          this._currentGoal = 'mining_diamond';
          this.emitBanter('diamond_found');
          logger.info(`💎 [Diamond Priority] Detected ${localDiamonds.length} Diamond Ore blocks within reach! Mining immediately...`, 'AutonomousEngine');
          await this.dispatchGoalToAI('ขุดแร่เพชร Diamond Ore ด้วยที่ขุดเหล็กหรือที่ขุดเพชร');
          if (signal.aborted) return;
          return;
        }
      }

      // E. If Diamonds are spotted nearby but we LACK an Iron Pickaxe, RECORD & RUSH IRON PICKAXE!
      const nearbyDiamonds = adapter.findBlocks({ matching: ['diamond_ore', 'deepslate_diamond_ore'], maxDistance: 24, count: 5 });
      if (nearbyDiamonds.length > 0 && !hasIronPick && !hasDiamondPick) {
        const { worldMemory } = require('../memory/world_memory');
        if (worldMemory) {
          for (const dPos of nearbyDiamonds) {
            const b = adapter.getBlockAt(dPos);
            if (b) worldMemory.recordDiscoveredOre(null, b.name, dPos);
          }
        }
        logger.warn(`💎 [DIAMOND SPOTTED AT (${nearbyDiamonds[0].x}, ${nearbyDiamonds[0].y}, ${nearbyDiamonds[0].z})] Need Iron Pickaxe to harvest (have ${ironIngotCount} ingots, ${rawIronCount} raw iron). Rushing Iron Pickaxe...`, 'AutonomousEngine');

        if (rawIronCount > 0) {
          this._currentGoal = 'smelting_iron_for_diamond_pick';
          await this.dispatchGoalToAI(`นำแร่เหล็กดิบ Raw Iron จำนวน ${rawIronCount} ก้อนไปหลอมในเตาเผา Furnace เพื่อนำมาทำที่ขุดเหล็กไปขุดเพชร`);
          if (signal.aborted) return;
          return;
        }

        const localIron = adapter.findBlocks({ matching: ['iron_ore', 'deepslate_iron_ore'], maxDistance: 16, count: 1 });
        if (localIron.length > 0) {
          this._currentGoal = 'mining_iron_for_diamond_pick';
          await this.dispatchGoalToAI('ขุดแร่เหล็ก Iron Ore เพื่อนำมาหลอมทำที่ขุดเหล็กสำหรับขุดเพชรที่พบ');
          if (signal.aborted) return;
          return;
        }
      }

      // -------------------------------------------------------------------------
      // 🌲 7.1 STAGE 1: Wood Age (Logs & Basic Crafting Table & Wooden Tools)
      // -------------------------------------------------------------------------
      const isUnderground = adapter.getPosition().y < 55;

      // Critical Strategy: If underground without pickaxe OR without wood to craft tools, return to surface immediately!
      if (isUnderground && (!hasAnyPickaxe || (totalLogs === 0 && totalPlanks < 4 && !adapter.hasItem('crafting_table')))) {
        this._currentGoal = 'returning_to_surface_for_wood';
        logger.info('🌲 [Survival Strategy] Underground without tools/wood. Returning to surface to harvest wood and rebuild gear...', 'AutonomousEngine');
        await this.dispatchGoalToAI('เดินกลับขึ้นไปบนพื้นผิวโลกเพื่อตัดไม้และคราฟต์ที่ขุดหิน');
        if (signal.aborted) return;
        return;
      }

      // 1. Basic Wood Processing & Table (Recover nearby abandoned table or craft 1)
      if (!hasCraftingTable) {
        const nearbyTables = adapter.findBlocks({ matching: 'crafting_table', maxDistance: 16, count: 1 });
        if (nearbyTables.length > 0) {
          this._currentGoal = 'recovering_crafting_table';
          await this.dispatchGoalToAI('ขุดเก็บโต๊ะคราฟต์ที่วางอยู่ใกล้ๆ กลับเข้ากระเป๋า');
          if (signal.aborted) return;
          return;
        } else if (totalPlanks >= 4) {
          this._currentGoal = 'crafting_table';
          await this.dispatchGoalToAI('คราฟต์โต๊ะคราฟต์ Crafting Table จากไม้แปรรูป 4 แผ่น');
          if (signal.aborted) return;
          return;
        }
      }

      if (totalLogs > 0 && totalPlanks === 0) {
        this._currentGoal = 'crafting_planks';
        await this.dispatchGoalToAI('นำไม้ท่อนในตัวมาคราฟต์เป็นไม้แปรรูป Planks');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodPrerequisites && stickCount === 0 && totalPlanks >= 2) {
        this._currentGoal = 'crafting_sticks';
        await this.dispatchGoalToAI('คราฟต์ไม้แท่ง Stick ตุนไว้สำหรับทำอุปกรณ์');
        if (signal.aborted) return;
        return;
      }

      // 2. 🪓 EAGER TOOL UPGRADES (STONE AGE TOP PRIORITY)
      // Upgrade Pickaxe to Stone Pickaxe immediately when we have 3+ cobblestone!
      if (hasWoodPrerequisites && cobblestoneCount >= 3 && !hasStonePick && !hasIronPick && !hasDiamondPick) {
        this._currentGoal = 'crafting_stone_pickaxe';
        await this.dispatchGoalToAI('คราฟต์ที่ขุดหิน Stone Pickaxe จาก Cobblestone และไม้แท่ง');
        if (signal.aborted) return;
        return;
      }

      // Upgrade Axe to Stone Axe immediately when we have 3+ cobblestone!
      if (hasWoodPrerequisites && cobblestoneCount >= 3 && !hasStoneAxe && !hasIronAxe && !hasDiamondAxe) {
        this._currentGoal = 'crafting_stone_axe';
        await this.dispatchGoalToAI('คราฟต์ขวานหิน Stone Axe จาก Cobblestone และไม้แท่ง');
        if (signal.aborted) return;
        return;
      }

      // Craft Stone Sword for defense immediately when we have 2+ cobblestone!
      if (hasWoodPrerequisites && cobblestoneCount >= 2 && !adapter.hasItem('stone_sword') && !adapter.hasItem('iron_sword') && !adapter.hasItem('diamond_sword')) {
        this._currentGoal = 'crafting_stone_sword';
        await this.dispatchGoalToAI('คราฟต์ดาบหิน Stone Sword สำหรับป้องกันตัว');
        if (signal.aborted) return;
        return;
      }

      // 3. 🪓 BASIC WOODEN TOOLS (When no stone tools yet)
      if (!hasAnyPickaxe && hasWoodPrerequisites) {
        this._currentGoal = 'crafting_wooden_pickaxe';
        await this.dispatchGoalToAI('คราฟต์ที่ขุดไม้ Wooden Pickaxe');
        if (signal.aborted) return;
        return;
      }

      if (!hasAnyAxe && hasWoodPrerequisites && totalPlanks >= 3 && hasCraftingTable) {
        this._currentGoal = 'crafting_wooden_axe';
        await this.dispatchGoalToAI('คราฟต์ขวานไม้ Wooden Axe เพื่อเอาไว้ตัดไม้ให้เร็วขึ้น');
        if (signal.aborted) return;
        return;
      }

      // 4. Initial Wood Gathering (Only if missing basic wood)
      if (!hasWoodPrerequisites && (!hasAnyPickaxe || (totalLogs === 0 && !isUnderground))) {
        this._currentGoal = 'chopping_wood';
        await this.dispatchGoalToAI('ค้นหาต้นไม้ใกล้เคียงและตัดไม้ 4 บล็อกเพื่อเอาไม้มาทำด้ามจับ Sticks และโต๊ะคราฟต์ Crafting Table');
        if (signal.aborted) return;
        return;
      }

      // 5. Stockpile Wood (Done WITH AXE)
      if (!isUnderground && totalLogs < 6 && totalPlanks < 12) {
        this._currentGoal = 'stockpiling_wood';
        await this.dispatchGoalToAI('ค้นหาต้นไม้และตัดไม้ตุนไว้ 6 บล็อกให้เพียงพอสำหรับอุปกรณ์และคบเพลิง');
        if (signal.aborted) return;
        return;
      }

      // -------------------------------------------------------------------------
      // 🪨 7.2 STAGE 2: Stone Age (Cobblestone, Furnace, Coal)
      // -------------------------------------------------------------------------
      if (hasAnyPickaxe && cobblestoneCount < 16 && (!hasStonePick && !hasIronPick && !hasDiamondPick)) {
        this._currentGoal = 'mining_stone';
        await this.dispatchGoalToAI('หาบล็อกหิน Stone ใกล้ๆ เคลียร์ดินที่บังออก และขุดหินด้วยที่ขุดให้ได้ Cobblestone');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodPrerequisites && !hasFurnace && cobblestoneCount >= 8) {
        this._currentGoal = 'crafting_furnace';
        await this.dispatchGoalToAI('คราฟต์เตาเผา Furnace จาก Cobblestone 8 ก้อน');
        if (signal.aborted) return;
        return;
      }

      // Torches Stockpiling: Ensure at least 16 torches in stock
      if (hasWoodPrerequisites && adapter.countItem('torch') < 16 && (coalCount > 0 || adapter.countItem('charcoal') > 0)) {
        this._currentGoal = 'crafting_torches';
        await this.dispatchGoalToAI('คราฟต์คบเพลิง Torch ตุนไว้ 16 อันเพื่อใช้ส่องสว่างในเหมือง');
        if (signal.aborted) return;
        return;
      }

      if (hasAnyPickaxe && coalCount < 8) {
        const exposedCoal = dsl.findNearbyExposedOres(14).filter(bPos => {
          const b = adapter.getBlockAt(bPos);
          return b && b.name.includes('coal');
        });
        if (exposedCoal.length > 0) {
          this._currentGoal = 'mining_coal';
          await this.dispatchGoalToAI('ขุดแร่ถ่านหิน Coal Ore ด้วยที่ขุดเพื่อเอาถ่านมาทำคบเพลิงและเป็นเชื้อเพลิง');
          if (signal.aborted) return;
          return;
        }
      }

      if (coalCount > 0 && adapter.countItem('torch') < 12) {
        this._currentGoal = 'crafting_torches';
        await this.dispatchGoalToAI('คราฟต์คบเพลิง Torch จากถ่านหินและไม้แท่ง');
        if (signal.aborted) return;
        return;
      }

      // -------------------------------------------------------------------------
      // -------------------------------------------------------------------------
      // ⛓️ 7.3 STAGE 3: Iron Age (Immediate Pickaxe Upgrade & Diamond Harvest Priority)
      // -------------------------------------------------------------------------
      // 1. Tool Upgrade Priority #1: Craft Iron Pickaxe immediately if we have 3 ingots!
      if (hasWoodPrerequisites && ironIngotCount >= 3 && !hasIronPick && !hasDiamondPick) {
        this._currentGoal = 'crafting_iron_pickaxe';
        await this.dispatchGoalToAI('คราฟต์ที่ขุดเหล็ก Iron Pickaxe จากแท่งเหล็ก 3 แท่งและไม้แท่ง');
        if (signal.aborted) return;
        return;
      }

      // 2. DIAMOND HARVEST TOP PRIORITY: If we have an Iron Pickaxe and remember a diamond vein, GO HARVEST IT IMMEDIATELY!
      if (hasIronPick || hasDiamondPick) {
        const { worldMemory } = require('../memory/world_memory');
        const rememberedOres = worldMemory ? worldMemory.getDiscoveredOres() : {};
        const diamondVein = Object.values(rememberedOres).find(o => o && o.name.includes('diamond'));
        if (diamondVein) {
          this._currentGoal = 'returning_to_remembered_diamonds';
          logger.info(`💎 [Diamond Priority] Navigating directly to remembered Diamond Vein at (${diamondVein.coords.x}, ${diamondVein.coords.y}, ${diamondVein.coords.z})...`, 'AutonomousEngine');
          await this.dispatchGoalToAI(`เดินทางกลับไปขุดแร่เพชรที่เคยบันทึกไว้ในความทรงจำที่พิกัด X=${diamondVein.coords.x}, Y=${diamondVein.coords.y}, Z=${diamondVein.coords.z}`);
          if (signal.aborted) return;
          return;
        }
      }

      // 3. Immediate Smelting: If we have Raw Iron and furnace
      if (rawIronCount > 0 && (hasFurnace || cobblestoneCount >= 8)) {
        this._currentGoal = 'smelting_iron';
        await this.dispatchGoalToAI(`นำแร่เหล็กดิบ Raw Iron จำนวน ${rawIronCount} ก้อนไปหลอมในเตาเผา Furnace ให้เป็นแท่งเหล็ก`);
        if (signal.aborted) return;
        return;
      }

      // 4. Equipment Upgrades (Sword & Shield):
      if (hasWoodPrerequisites && ironIngotCount >= 2 && !adapter.hasItem('iron_sword') && !adapter.hasItem('diamond_sword')) {
        this._currentGoal = 'crafting_iron_sword';
        await this.dispatchGoalToAI('คราฟต์ดาบเหล็ก Iron Sword จากแท่งเหล็ก 2 แท่ง');
        if (signal.aborted) return;
        return;
      }

      if (ironIngotCount >= 1 && (totalPlanks >= 6 || totalLogs >= 2) && !adapter.hasItem('shield')) {
        this._currentGoal = 'crafting_shield';
        await this.dispatchGoalToAI('คราฟต์โล่ป้องกันตัว Shield จากแท่งเหล็กและไม้แปรรูป');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodForTable && ironIngotCount >= 8 && !adapter.hasItem('iron_chestplate') && !adapter.hasItem('diamond_chestplate')) {
        this._currentGoal = 'crafting_iron_chestplate';
        this.emitBanter('iron_gear_crafted');
        await this.dispatchGoalToAI('คราฟต์เสื้อเกราะเหล็ก Iron Chestplate จากแท่งเหล็ก 8 แท่ง');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodForTable && ironIngotCount >= 7 && !adapter.hasItem('iron_leggings') && !adapter.hasItem('diamond_leggings')) {
        this._currentGoal = 'crafting_iron_leggings';
        await this.dispatchGoalToAI('คราฟต์กางเกงเกราะเหล็ก Iron Leggings จากแท่งเหล็ก 7 แท่ง');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodForTable && ironIngotCount >= 4 && !adapter.hasItem('iron_boots') && !adapter.hasItem('diamond_boots')) {
        this._currentGoal = 'crafting_iron_boots';
        await this.dispatchGoalToAI('คราฟต์รองเท้าเกราะเหล็ก Iron Boots จากแท่งเหล็ก 4 แท่ง');
        if (signal.aborted) return;
        return;
      }

      if (hasWoodForTable && ironIngotCount >= 5 && !adapter.hasItem('iron_helmet') && !adapter.hasItem('diamond_helmet')) {
        this._currentGoal = 'crafting_iron_helmet';
        await this.dispatchGoalToAI('คราฟต์หมวกเกราะเหล็ก Iron Helmet จากแท่งเหล็ก 5 แท่ง');
        if (signal.aborted) return;
        return;
      }

      // 3. Mine More Iron / Spelunk Caves if needed for full set
      const totalIron = ironIngotCount + rawIronCount;
      if ((hasStonePick || hasIronPick || hasDiamondPick) && totalIron < 24) {
        const exposedOres = dsl.findNearbyExposedOres(16);
        if (exposedOres.length >= 2 && botPos.y < 60) {
          this._currentGoal = 'spelunking_cave';
          await this.dispatchGoalToAI('สำรวจถ้ำใต้ดิน เดินสำรวจทางถ้ำ ปักคบเพลิง และเก็บแร่ตามผนังถ้ำทั้งหมด');
          if (signal.aborted) return;
          return;
        }

        const exposedIron = exposedOres.filter(bPos => {
          const b = adapter.getBlockAt(bPos);
          return b && b.name.includes('iron');
        });
        if (exposedIron.length > 0) {
          this._currentGoal = 'mining_iron';
          await this.dispatchGoalToAI('ขุดแร่เหล็ก Iron Ore ด้วยที่ขุดหินหรือที่ขุดเหล็ก');
          if (signal.aborted) return;
          return;
        } else if (botPos.y > 16) {
          this._currentGoal = 'staircase_mining_iron';
          await this.dispatchGoalToAI('ขุดบันไดลงใต้ดิน Staircase Mining สู่ระดับ Y=16 เพื่อค้นหาแร่เหล็ก Iron Ore');
          if (signal.aborted) return;
          return;
        } else {
          if (Math.random() < 0.6) {
            this._currentGoal = 'strip_mining_iron';
            await this.dispatchGoalToAI('ขุดอุโมงค์ทางตรง 1x2 Strip Mining ที่ระดับ Y=16 เพื่อค้นหาแร่เหล็ก Iron Ore');
          } else {
            this._currentGoal = 'branch_mining_iron';
            await this.dispatchGoalToAI('ขุดเหมืองแบบก้างปลา Fishbone Mining ที่ระดับ Y=16 เพื่อค้นหาแร่เหล็ก Iron Ore');
          }
          if (signal.aborted) return;
          return;
        }
      }

      // -------------------------------------------------------------------------
      // 💎 7.4 STAGE 4: Diamond Age (Deep Mining, Diamond Gear & Armor Mastery)
      // -------------------------------------------------------------------------
      // 1. Immediate Diamond Gear Upgrades:
      if (diamondCount >= 3 && !hasDiamondPick) {
        this._currentGoal = 'crafting_diamond_pickaxe';
        await this.dispatchGoalToAI('คราฟต์ที่ขุดเพชร Diamond Pickaxe จากเพชร 3 เม็ดและไม้แท่ง');
        if (signal.aborted) return;
        return;
      }

      if (diamondCount >= 2 && !adapter.hasItem('diamond_sword')) {
        this._currentGoal = 'crafting_diamond_sword';
        await this.dispatchGoalToAI('คราฟต์ดาบเพชร Diamond Sword จากเพชร 2 เม็ด');
        if (signal.aborted) return;
        return;
      }

      if (diamondCount >= 8 && !adapter.hasItem('diamond_chestplate')) {
        this._currentGoal = 'crafting_diamond_chestplate';
        this.emitBanter('diamond_gear_crafted');
        await this.dispatchGoalToAI('คราฟต์เสื้อเกราะเพชร Diamond Chestplate จากเพชร 8 เม็ด');
        if (signal.aborted) return;
        return;
      }

      // 2. Deep Mining for Diamonds & Returning to Remembered Ore Veins:
      if (hasIronPick || hasDiamondPick) {
        // A. Check if high-tier ores are in current visual range
        const diamondBlocks = adapter.findBlocks({ matching: ['diamond_ore', 'deepslate_diamond_ore'], maxDistance: 16, count: 1 });
        if (diamondBlocks.length > 0) {
          this._currentGoal = 'mining_diamond';
          this.emitBanter('diamond_found');
          await this.dispatchGoalToAI('ขุดแร่เพชร Diamond Ore ด้วยที่ขุดเหล็กหรือที่ขุดเพชร');
          if (signal.aborted) return;
          return;
        }

        // B. Check if we remembered unmined diamond veins from earlier!
        const { worldMemory } = require('../memory/world_memory');
        const rememberedOres = worldMemory ? worldMemory.getDiscoveredOres() : {};
        const diamondVein = Object.values(rememberedOres).find(o => o && o.name.includes('diamond'));
        if (diamondVein) {
          this._currentGoal = 'returning_to_remembered_diamonds';
          logger.info(`💎 [WorldMemory Return] Returning to remembered Diamond Vein at (${diamondVein.coords.x}, ${diamondVein.coords.y}, ${diamondVein.coords.z})...`, 'AutonomousEngine');
          await this.dispatchGoalToAI(`เดินทางกลับไปขุดแร่เพชรที่เคยบันทึกไว้ในความทรงจำที่พิกัด X=${diamondVein.coords.x}, Y=${diamondVein.coords.y}, Z=${diamondVein.coords.z}`);
          if (signal.aborted) return;
          return;
        }
      }

      // 3. Deep Ore Mining (Explore Deepslate Caves, Staircase down, or Fishbone at bottom):
      if (hasAnyPickaxe) {
        const deepOres = dsl.findNearbyExposedOres(16);
        if (deepOres.length >= 2 && botPos.y < 30) {
          this._currentGoal = 'spelunking_deep_cave';
          await this.dispatchGoalToAI('สำรวจถ้ำใต้ดินลึก เดินสำรวจทางถ้ำ ปักคบเพลิง และเก็บแร่ตามผนังถ้ำทั้งหมด');
          if (signal.aborted) return;
          return;
        }

        if (botPos.y > -53) {
          this._currentGoal = 'staircase_mining_down';
          await this.dispatchGoalToAI('ขุดบันไดเฉียง 1x2 ลงลึกไปที่ระดับ Y=-54 เพื่อค้นหาแร่เหล็กและเพชร');
          if (signal.aborted) return;
          return;
        } else {
          this._currentGoal = 'branch_mining_diamonds';
          await this.dispatchGoalToAI('ขุดเหมืองแบบก้างปลา Fishbone Mining ที่ระดับ Y=-54 เพื่อค้นหาแร่เพชร');
          if (signal.aborted) return;
          return;
        }
      }

      // =========================================================================
      // 👥 MODE 9: 👥 Companion Presence, Gift Sharing & Following
      // =========================================================================
      const nearbyPlayer = adapter.findEntity({ type: 'player', maxDistance: 12 });
      if (nearbyPlayer) {
        const distToPlayer = adapter.distanceTo(nearbyPlayer.position);
        if (distToPlayer > 4.5 && distToPlayer < 10.0) {
          this._currentGoal = 'following_player';
          await this.dispatchGoalToAI(`เดินตามผู้เล่น ${nearbyPlayer.name} เพื่อไปเป็นเพื่อน`);
          if (signal.aborted) return;
          return;
        }
      }

      // =========================================================================
      // 🗺️ MODE 10: 🗺️ Purposeful Terrain Exploration
      // =========================================================================
      this._currentGoal = 'exploring';
      const origin = this._spawnPos || botPos;
      const radius = this._cfg.explore_radius || 24;
      const targetX = Math.round(origin.x + (Math.random() * (radius * 2) - radius));
      const targetZ = Math.round(origin.z + (Math.random() * (radius * 2) - radius));

      await this.dispatchGoalToAI(`เดินสำรวจพื้นที่รอบๆ ไปที่พิกัด X: ${targetX}, Z: ${targetZ}`);
    } catch (err) {
      if (!signal.aborted) {
        logger.debug(`[Agent Loop] Tick note: ${err.message}`, 'AutonomousEngine');
      }
    } finally {
      this.isBusy = false;
      this._busyStartTime = 0;
      this._lastMeaningfulActionTime = Date.now();
    }
  }
}

module.exports = {
  AutonomousEngine,
};
