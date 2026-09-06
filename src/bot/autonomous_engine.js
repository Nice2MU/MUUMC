/**
 * Autonomous Gamer Brain for MuumiuLLM (muu-mc Minecraft Java Companion AI).
 * 
 * 🎮 Architecture:
 *    - "ไม่ใช่บอทเล่นเกม แต่เป็น AI คุมบอทเล่นตามสั่ง"
 *    - AI Pilot (Agent 1) reads Living Survival Playbook (data/playbook/survival_guide.yaml).
 *    - Manages Multi-Step Sequential Plans (Step 1 -> 2 -> 3) persisted in active_plan.json.
 *    - SituationEvaluator verifies "พอรึยัง?" locally before advancing steps (zero token waste, zero ADHD).
 *    - Master Order Preemption: Immediately pauses personal chores when Master Nice2MU speaks/chats.
 *    - HomeBase Neighbor Anchor: Establishes base 24-64 blocks from Nice2MU, centers all storage/beds/furnaces.
 *    - Fast-Path Reflex Layer: Physical survival (<50ms: water clutch, creeper retreat, auto-eat).
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const axios = require('axios');
const { Vec3 } = require('vec3');
const { logger } = require('./logger');
const { config } = require('../config/loader');
const { goalPlanManager } = require('./planner/goal_plan');
const { SituationEvaluator } = require('./planner/situation_evaluator');
const { worldMemory } = require('../memory/world_memory');

class AutonomousEngine {
  constructor(client) {
    this.client = client;
    this.isRunning = false;
    this.isBusy = false;
    this.isPausedForMaster = false;
    this._loopInterval = null;
    this._watchdogInterval = null;

    this._cfg = (client?.config?.autonomous) || config.minecraft?.autonomous || {
      enabled: true,
      idle_timeout_ms: 6000,
      explore_radius: 24,
      auto_eat: true,
      auto_sleep: true,
      self_defense: true,
      auto_armor: true,
      auto_torch: true,
    };
    this._idleTimeoutMs = Math.max(4000, this._cfg.idle_timeout_ms || 6000);
    this._lastTaskTime = 0;
    this._spawnPos = null;
    this._currentGoal = 'idle';
    this._lastBanterTime = {};
    this._recentActions = [];
    this._preemptController = new AbortController();
    this._isPlanning = false;
    this._criticalToolAlert = null;

    // Planner & Situation Evaluator
    this.goalPlanManager = goalPlanManager;
    this.situationEvaluator = new SituationEvaluator(client);
    this.playbook = this._loadPlaybook();

    // Anti-Stall Watchdog
    this._lastMeaningfulActionTime = Date.now();
    this._busyStartTime = 0;
    this._lastWatchdogPos = null;
    this._lastWatchdogMoveTime = Date.now();
  }

  _loadPlaybook() {
    const playbookPath = path.resolve(__dirname, '../../data/playbook/survival_guide.yaml');
    try {
      if (fs.existsSync(playbookPath)) {
        const raw = fs.readFileSync(playbookPath, 'utf8');
        const parsed = yaml.parse(raw);
        logger.info(`📖 [Playbook] Loaded Survival Guide (v${parsed.version}) with ${Object.keys(parsed.phases || {}).length} phases.`, 'AutonomousEngine');
        return parsed;
      }
    } catch (err) {
      logger.warn(`Failed to load survival_guide.yaml: ${err.message}`, 'AutonomousEngine');
    }
    return { phases: {} };
  }

  get serverKey() {
    return this.client?.getServerIdentifier ? this.client.getServerIdentifier() : null;
  }

  start() {
    if (this.isRunning) return;
    if (this._cfg && this._cfg.enabled === false) {
      return;
    }
    this.isRunning = true;
    this._lastTaskTime = 0;
    this._lastMeaningfulActionTime = Date.now();
    logger.info('🧠 [AI Gamer Brain] Autonomous Engine Started (Multi-Step Plan + Situation Evaluator Active)!', 'AutonomousEngine');

    if (this.client?.adapter?.getPosition) {
      const p = this.client.adapter.getPosition();
      const isUnder = this.client.adapter.isUnderground ? this.client.adapter.isUnderground() : false;
      if (p && !isUnder) {
        this._spawnPos = p.clone();
        if (worldMemory) {
          worldMemory.setLandmark('SurfaceSpawn', p.x, p.y, p.z, 'จุดเกิดเริ่มต้นบนผิวดิน', this.serverKey);
        }
      }
    }

    // Cognitive / Execution Loop Tick (Evaluates reflexes, targets, planner)
    this._loopInterval = setInterval(() => {
      this._tick();
    }, 2000);

    // Dedicated 1-Second Anti-Stall Watchdog
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
    logger.info('🛑 [AI Gamer Brain] Autonomous Engine Stopped.', 'AutonomousEngine');
  }

  notifyTaskStarted() {
    this._isTaskActive = true;
    this._lastTaskTime = Date.now();
    this.preempt();
  }

  notifyTaskCompleted() {
    this._isTaskActive = false;
    this._lastTaskTime = Date.now();
    if (this.isPausedForMaster) {
      this.resumeFromMaster();
    } else {
      logger.info('✨ Task completed. Resuming gamer plan...', 'AutonomousEngine');
    }
  }

  preempt() {
    if (this.isBusy) {
      logger.info('⚡ Preempting execution for higher priority directive...', 'AutonomousEngine');
      this._preemptController.abort();
      this._preemptController = new AbortController();
      this.isBusy = false;
      if (this.client?.adapter) {
        this.client.adapter.stopMovement();
      }
    }
  }

  // =========================================================================
  // 👑 MASTER ORDER PREEMPTION (Nice2MU Directives)
  // =========================================================================

  pauseForMaster(playerName = 'Nice2MU', taskDescription = '') {
    logger.info(`👑 [Master Preemption] Master <${playerName}> commanded: "${taskDescription}". Pausing survival plan!`, 'AutonomousEngine');
    this.isPausedForMaster = true;
    this.preempt();
    this.goalPlanManager.pauseForMaster(this.serverKey, playerName, taskDescription);
  }

  resumeFromMaster() {
    logger.info(`👑 [Master Preemption] Master directive completed. Resuming autonomous survival plan...`, 'AutonomousEngine');
    this.isPausedForMaster = false;
    this.goalPlanManager.resumeFromMaster(this.serverKey);
    this._lastTaskTime = Date.now();
  }

  reportToolDepleted(toolType = 'pickaxe') {
    logger.warn(`⚠️ [Tool Alert] ${toolType} depleted! Halting current task for recovery...`, 'AutonomousEngine');
    this._criticalToolAlert = {
      tool: toolType,
      message: `อุปกรณ์ ${toolType} พังหรือไม่มีในตัว`,
      timestamp: Date.now(),
    };
    this.preempt();
  }

  reportToolTierInsufficient(blockName, requiredTool = 'iron_pickaxe') {
    logger.warn(`🚫 [Tool Tier Alert] '${blockName}' requires '${requiredTool}'. Halting mining.`, 'AutonomousEngine');
    this._criticalToolAlert = {
      tool: requiredTool,
      message: `ต้องการ '${requiredTool}' ในการขุด '${blockName}'`,
      timestamp: Date.now(),
    };
    this.preempt();
  }

  emitBanter(text, isEmergencyOrDiscovery = false) {
    if (!text) return;
    const clean = text.replace(/\[\w+\]\s*/g, '').trim();
    if (!clean) return;

    const urgentKeywords = [
      'เพชร', 'diamond', 'เนเธอไรต์', 'netherite',
      'ดันเจี้ยน', 'dungeon', 'หมู่บ้าน', 'village', 'สปอเนอร์', 'spawner',
      'ช่วยด้วย', 'อันตราย', 'ไฟไหม้', 'ลาวา', 'lava', 'creeper', 'ครีปเปอร์',
      'จมน้ำ', 'จะตาย', 'ระเบิด'
    ];
    const isUrgent = isEmergencyOrDiscovery || urgentKeywords.some(kw => clean.toLowerCase().includes(kw));

    if (isUrgent) {
      const now = Date.now();
      if (this._lastBanterTime['urgent'] && now - this._lastBanterTime['urgent'] < 10000) return;
      this._lastBanterTime['urgent'] = now;
      if (this.client?.adapter) {
        this.client.adapter.chat(clean);
        logger.info(`🚨 [Muumiu Game Alert]: ${clean}`, 'AutonomousEngine');
      }
    } else {
      logger.info(`💬 [Muumiu Internal]: ${clean}`, 'AutonomousEngine');
    }
  }

  // =========================================================================
  // ⚡ FAST-PATH REFLEX LAYER (<50ms Real-Time Survival)
  // =========================================================================
  async _evaluateReflexes(adapter, dsl, rawBot) {
    if (!rawBot || !adapter) return false;
    if (adapter.getHealth() <= 0) return false;
    const botPos = adapter.getPosition();

    // 1. Auto-Equip Armor & Shield
    if (this._cfg.auto_armor !== false) {
      await adapter.autoEquipArmor().catch(() => {});
    }

    // 2. Submerged Underwater / Drowning Reflex
    const headPos = new Vec3(Math.floor(botPos.x), Math.floor(botPos.y + 1.6), Math.floor(botPos.z));
    const blockHead = adapter.getBlockAt(headPos);
    if (blockHead && (blockHead.name === 'water' || blockHead.name === 'flowing_water')) {
      this._currentGoal = 'emergency_swimming';
      logger.warn('🫧 [Reflex] Submerged! Swimming to surface...', 'AutonomousEngine');
      this.emitBanter('จมน้ำอยู่! ขอดำน้ำขึ้นไปหายใจก่อนนะ!', true);
      await adapter.emergencySwimAndBreathe();
      return true;
    }

    // 3. Fire / Lava Reflex & Water Bucket Clutch
    const blockIn = adapter.getBlockAt(botPos);
    const isOnFire = rawBot.entity?.isOnFire || (blockIn && (blockIn.name === 'fire' || blockIn.name === 'lava' || blockIn.name === 'flowing_lava'));
    if (isOnFire) {
      this._currentGoal = 'extinguishing_fire';
      logger.warn('🔥 [Reflex] On fire! Extinguishing...', 'AutonomousEngine');
      this.emitBanter('ว้าย! ตัวติดไฟแล้ว ช่วยด้วย!', true);
      if (adapter.hasItem('water_bucket')) {
        const clutched = await dsl.useWaterBucketClutch().catch(() => false);
        if (clutched) return true;
      }
      const nearbyWater = adapter.findBlocks({ matching: ['water', 'flowing_water'], maxDistance: 16, count: 1 });
      if (nearbyWater.length > 0) {
        await adapter.goto(nearbyWater[0].x, nearbyWater[0].y, nearbyWater[0].z, 1.0, 3000).catch(() => {});
        return true;
      }
      await adapter.moveAway(12);
      return true;
    }

    // 4. Critical Low HP Evasion (< 8 HP)
    if (adapter.getHealth() < 8) {
      const hostiles = adapter.findHostiles(10);
      if (hostiles.length > 0) {
        this._currentGoal = 'fleeing_danger';
        logger.warn(`🏃 [Reflex] Critical Low HP (${adapter.getHealth()})! Evading...`, 'AutonomousEngine');
        this.emitBanter(`เลือดเหลือ ${adapter.getHealth()} เอง! ขอถอยตั้งหลักก่อนนะคะ!`, true);
        await adapter.moveAway(16);
        return true;
      }
    }

    // 5. Hostile Mob Combat & Creeper Evasion
    if (this._cfg.self_defense !== false) {
      const hostiles = adapter.findHostiles(10);
      if (hostiles.length >= 2) {
        this._currentGoal = 'evading_mob_group';
        logger.warn(`🛡️ [Reflex] Mob group (${hostiles.length})! Backing off...`, 'AutonomousEngine');
        await adapter.moveAway(16);
        return true;
      } else if (hostiles.length === 1) {
        const enemy = hostiles[0];
        if (enemy.name === 'creeper') {
          this._currentGoal = 'fighting_creeper';
          this.emitBanter('ครีปเปอร์มา! ถอยก่อนเดี๋ยวระเบิด!', true);
          await adapter.fightCreeper(enemy);
          return true;
        }
        this._currentGoal = 'defending_self';
        await adapter.equipHighestAttackWeapon();
        await adapter.attackEntity(enemy);
        return true;
      }
    }

    // 6. Auto-Eat Reflex
    if (this._cfg.auto_eat && (adapter.getFood() < 14 || (adapter.getHealth() < 16 && adapter.getFood() < 20))) {
      const ate = await adapter.eatFood().catch(() => false);
      if (ate) {
        logger.info(`🍖 [Reflex] Ate food (HP: ${adapter.getHealth()}, Food: ${adapter.getFood()})`, 'AutonomousEngine');
        return true;
      }
    }

    // 7. Auto-Torch in dark areas
    if (this._cfg.auto_torch !== false && adapter.hasItem('torch') && adapter.shouldPlaceTorch()) {
      const placed = await dsl.placeTorchIfDark().catch(() => false);
      if (placed) return true;
    }

    return false;
  }

  // =========================================================================
  // 🎯 PLANNER & SITUATION EVALUATION CYCLE
  // =========================================================================

  /**
   * Deterministically determines which progression phase to adopt from the playbook.
   */
  _determineNextPhase() {
    const adapter = this.client.adapter;
    const inv = adapter ? adapter.getInventory() : [];
    const serverKey = this.serverKey;
    const homeBase = worldMemory ? worldMemory.getHomeBase(serverKey) : null;
    const hasPick = inv.some(i => i.name.endsWith('_pickaxe'));
    const hasStonePick = inv.some(i => i.name.includes('stone_pickaxe') || i.name.includes('iron_pickaxe') || i.name.includes('diamond_pickaxe'));
    const hasIronPick = inv.some(i => i.name.includes('iron_pickaxe') || i.name.includes('diamond_pickaxe'));
    const phases = this.playbook.phases || {};

    // Phase 0: If no tools or basic tools
    if (!hasPick || !hasStonePick) {
      return phases.phase_0 || null;
    }

    // Phase 1: If has stone tools but HomeBase is not yet established
    if (!homeBase) {
      return phases.phase_1 || null;
    }

    // Phase 2: If HomeBase is established but no Iron Pickaxe
    if (!hasIronPick) {
      return phases.phase_2 || null;
    }

    // Phase 3: If has Iron Pickaxe and HomeBase, but no MainHouse
    const landmarks = worldMemory ? worldMemory.getLandmarks(serverKey) : {};
    if (!landmarks['MainHouse']) {
      return phases.phase_3 || null;
    }

    // Phase 4: Deep Mining & Diamonds
    return phases.phase_4 || phases.phase_0;
  }

  async _executeActiveStep(step) {
    if (this.isBusy || !step) return;
    this.isBusy = true;
    this._busyStartTime = Date.now();

    let action = step.action;
    let params = { ...(step.params || {}) };

    // Dynamic resolution for multi-item crafting steps: craft whichever required item is currently missing!
    if (action === 'craft_item' && step.target_condition?.type === 'has_items') {
      const items = Array.isArray(step.target_condition.items) ? step.target_condition.items : [step.target_condition.items];
      const missing = items.find(item => !this.client?.adapter?.hasItem(item));
      if (missing) {
        params.item_name = missing;
      }
    }

    this._currentGoal = action;
    logger.info(`🚀 [AI Gamer Brain] Executing Step: "${step.title}" (Action: '${action}', params: ${JSON.stringify(params)})`, 'AutonomousEngine');

    try {
      const { MCPToolHandler } = require('../mcp/tools');
      const result = await MCPToolHandler.handleToolCall(
        'muu_mc_execute_task',
        {
          action: action,
          params: params,
          task: step.title,
        },
        true
      );

      const record = {
        action: step.action,
        params: step.params,
        title: step.title,
        status: (result?.status === 'error' || result?.isError) ? 'error' : 'success',
        timestamp: Date.now(),
      };
      this._recentActions.push(record);
      if (this._recentActions.length > 5) this._recentActions.shift();

      if (record.status === 'error') {
        this.goalPlanManager.recordStepFailure(this.serverKey, result?.error || 'Execution failed');
      }

      this._lastMeaningfulActionTime = Date.now();
    } catch (err) {
      logger.error(`[Step Execution Error]: ${err.message}`, 'AutonomousEngine');
      this.goalPlanManager.recordStepFailure(this.serverKey, err.message);
    } finally {
      this.isBusy = false;
      this._busyStartTime = 0;
      this._lastTaskTime = Date.now();
    }
  }

  async _tick() {
    if (!this.isRunning || this.isBusy || this._isPlanning || this._isTaskActive) return;
    if (this.isPausedForMaster) return; // Master order preemption is active!
    if (!this.client?.isConnected || !this.client?.isSpawned) return;

    const adapter = this.client.adapter;
    const dsl = this.client.dsl;
    const rawBot = adapter?.rawBot;
    if (!adapter || !dsl || !rawBot) return;

    if (adapter.getHealth() <= 0 || (rawBot.entity && rawBot.entity.isValid === false)) {
      return;
    }

    // 1. Fast-Path Reflex Layer (<50ms)
    const reflexTriggered = await this._evaluateReflexes(adapter, dsl, rawBot);
    if (reflexTriggered) {
      this._lastMeaningfulActionTime = Date.now();
      return;
    }

    // 2. Sun Clock & Night Sleeping Check
    const sunClock = this.situationEvaluator.evaluateSunClock();
    if (sunClock.shouldSleep) {
      const isNight = rawBot.time?.isNight || false;
      if (isNight && adapter.hasItem && (adapter.hasItem('white_bed') || adapter.hasItem('red_bed') || dsl.findNearbyBed())) {
        logger.info(`🌙 [SunClock] ${sunClock.advice}. Executing sleep_bed...`, 'AutonomousEngine');
        this.isBusy = true;
        await dsl.goToBed().catch(() => {});
        this.isBusy = false;
        this._lastTaskTime = Date.now();
        return;
      }
    }

    // 3. Active Goal Plan Check ("พอรึยัง?")
    let activePlan = this.goalPlanManager.loadPlan(this.serverKey);

    // If no active plan or previous plan is complete, adopt next phase plan!
    if (!activePlan || activePlan.status === 'completed') {
      const nextPhase = this._determineNextPhase();
      if (nextPhase) {
        activePlan = this.goalPlanManager.createPlanFromPhase(this.serverKey, nextPhase);
      }
    }

    if (!activePlan || activePlan.status === 'paused_for_master') {
      return;
    }

    const currentStep = this.goalPlanManager.getCurrentStep();
    if (!currentStep) {
      return;
    }

    // 4. Situation Evaluator: Evaluate "พอรึยัง?" on current step
    const targetCheck = this.situationEvaluator.evaluateStepTarget(currentStep);

    if (targetCheck.met) {
      // 🎯 Target is satisfied! Advance to the next step!
      logger.info(`🎯 [SituationEvaluator] Target Met! ${targetCheck.summary}. Advancing step...`, 'AutonomousEngine');
      this.goalPlanManager.advanceStep(this.serverKey, targetCheck.summary);

      // Check if there is a next step
      const nextStep = this.goalPlanManager.getCurrentStep();
      if (nextStep) {
        await this._executeActiveStep(nextStep);
      }
      return;
    }

    // 5. Target is NOT yet met ("ยังไม่พอ!"): Continue executing step action!
    // Check idle timeout to prevent spinning too fast
    const idleDuration = Date.now() - this._lastTaskTime;
    if (idleDuration < this._idleTimeoutMs) {
      return;
    }

    // Safeguard 1: Tool Depletion Recovery - If mining is required but pickaxe broke, craft a replacement first!
    const isMining = ['mine_stone', 'mine_ore', 'staircase_mine', 'branch_mine'].includes(currentStep.action);
    const hasPick = adapter.getInventory().some(i => i.name.endsWith('_pickaxe'));
    if (isMining && !hasPick) {
      const cobble = adapter.countItem('cobblestone') + adapter.countItem('cobbled_deepslate');
      const sticks = adapter.countItem('stick');
      const wood = adapter.getInventory().some(i => i.name.endsWith('_log') || i.name.endsWith('_planks'));

      if (cobble >= 3 && (sticks >= 2 || wood)) {
        logger.warn('⚠️ [Tool Recovery] Pickaxe broken during mining! Crafting stone_pickaxe replacement...', 'AutonomousEngine');
        await this._executeActiveStep({ action: 'craft_item', params: { item_name: 'stone_pickaxe', count: 1 }, title: 'คราฟต์ที่ขุดหินทดแทน' });
        return;
      } else if (wood) {
        logger.warn('⚠️ [Tool Recovery] Pickaxe broken during mining! Crafting wooden_pickaxe replacement...', 'AutonomousEngine');
        await this._executeActiveStep({ action: 'craft_item', params: { item_name: 'wooden_pickaxe', count: 1 }, title: 'คราฟต์ที่ขุดไม้ทดแทน' });
        return;
      }
    }

    // Safeguard 2: Inventory Congestion - If inventory is completely full, deposit surplus first!
    const freeSlots = adapter.countFreeSlots ? adapter.countFreeSlots() : (rawBot?.inventory?.emptySlotCount() || 0);
    const isGathering = ['chop_tree', 'mine_stone', 'mine_ore', 'collect_drops'].includes(currentStep.action);
    if (isGathering && freeSlots <= 1) {
      logger.warn(`📦 [Storage Safeguard] Inventory congested (${freeSlots} free slots). Depositing surplus before gathering...`, 'AutonomousEngine');
      await this._executeActiveStep({ action: 'deposit_chest', params: {}, title: 'เก็บของส่วนเกินเข้าหีบ' });
      return;
    }

    logger.info(`⏳ [SituationEvaluator] Working on: "${currentStep.title}" (${targetCheck.summary})`, 'AutonomousEngine');
    await this._executeActiveStep(currentStep);
  }

  // =========================================================================
  // 🚨 ANTI-STALL & LIVENESS WATCHDOG
  // =========================================================================
  async _runWatchdog() {
    if (!this.isRunning || this._isTaskActive || this.isPausedForMaster) return;
    if (!this.client?.isConnected || !this.client?.isSpawned) return;

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

    if (this._isPlanning || adapter._isDigging) {
      this._lastWatchdogMoveTime = Date.now();
      this._lastMeaningfulActionTime = Date.now();
      return;
    }

    // Stuck Lock Release Guard (>45s without movement while busy)
    const timeWithoutMovement = Date.now() - (this._lastWatchdogMoveTime || Date.now());
    if (this.isBusy && timeWithoutMovement > 45000) {
      logger.warn(`🚨 [Watchdog] Stalled for ${(timeWithoutMovement / 1000).toFixed(1)}s! Forcing unstuck hop...`, 'AutonomousEngine');
      this.preempt();
      this.isBusy = false;
      this._busyStartTime = 0;
      this._lastMeaningfulActionTime = Date.now();
      this._lastWatchdogMoveTime = Date.now();
      await adapter.moveAway(3).catch(() => {});
      return;
    }
  }
}

module.exports = {
  AutonomousEngine,
};
