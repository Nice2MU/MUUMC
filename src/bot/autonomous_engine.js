/**
 * Hierarchical Cognitive Agent for Muumiu (Minecraft Java Companion AI).
 * 
 * 🧠 Slow-Path Conscious Brain (LLM Cognitive Planner):
 *    - Periodically builds a comprehensive Perception Snapshot of the Minecraft world
 *      (vitals, categorized inventory, nearby points of interest, hostiles, landmarks, recent actions).
 *    - Prompts configured LLM (OpenRouter / Ollama) to reason, plan, and choose optimal actions.
 *    - Produces structured JSON: { thought, speech, action, params }.
 *    - Dispatches directly to registered skill or tactical AI Coder without brittle regex.
 * 
 * ⚡ Fast-Path Subconscious Reflex Layer (<50ms Real-Time Survival):
 *    - Runs every tick on physical engine without waiting for LLM latency.
 *    - Handles immediate life-preservation: water bucket clutch, emergency swim, creeper retreat,
 *      critical HP evasion, eating when starving, and unstuck maneuvers.
 */

const axios = require('axios');
const { Vec3 } = require('vec3');
const { logger } = require('./logger');
const { config } = require('../config/loader');

const PLANNER_SYSTEM_PROMPT = `You are Muumiu (มูมิว), an autonomous, clever, and cute anime girl playing Minecraft Java!
You observe your live in-game situation and decide your next strategic gameplay action.

Goals hierarchy:
1. Survival: Avoid starving, sleep during night if bed nearby, stay healthy.
2. Tech Progression: Wood -> Crafting Table -> Wooden Pickaxe -> Stone Tools & Furnace -> Iron Tools & Armor -> Diamond Gear.
3. Resource Gathering & Smelting: Chop trees for wood/sticks, mine stone/coal/iron, smelt raw ores in furnace, mine diamonds at Y=-54.
4. Companion Presence: Accompany nearby players if present and not busy with critical gear progression.
5. Exploration: Spelunk caves, explore terrain, build shelter when ready.

AVAILABLE ACTIONS:
- "chop_tree": { "count": 2-4 } (Gathers logs, replants saplings)
- "craft_item": { "item_name": "oak_planks"|"stick"|"crafting_table"|"wooden_pickaxe"|"wooden_axe"|"stone_pickaxe"|"stone_axe"|"stone_sword"|"furnace"|"torch"|"iron_pickaxe"|"iron_sword"|"shield"|"iron_chestplate"|"diamond_pickaxe"|..., "count": 1 }
- "mine_stone": { "count": 4-8 } (Mines stone for cobblestone)
- "mine_ore": { "ore_type": "coal"|"iron"|"gold"|"diamond", "count": 2-4 } (Mines target ore vein)
- "smelt_item": { "item_name": "raw_iron"|"raw_copper"|"raw_gold"|"raw_beef", "count": 1-4 } (Smelts in furnace)
- "staircase_mine": { "target_y": 16|-54 } (Digs a safe 1x2 diagonal staircase down to target Y level)
- "branch_mine": { "length": 15 } (Fishbone mining at current deep level)
- "explore_cave": { "duration_sec": 60 } (Spelunks nearby cave, torches dark spots, harvests exposed ores)
- "go_surface": {} (Climbs back to surface Y >= 64 if low on wood/supplies)
- "mine_remembered_ore": { "x": number, "y": number, "z": number } (Navigates to remembered diamond/ore vein)
- "collect_drops": { "radius": 16 } (Vacuums up dropped items nearby)
- "eat_food": {} (Eats available food from inventory)
- "sleep_bed": {} (Sleeps in nearby bed during night)
- "hunt_animal": { "animal_type": "chicken"|"cow"|"pig"|"sheep" } (Hunts nearby passive animal for meat and leather, collects drops)
- "navigate_landmark": { "landmark_name": "SurfaceSpawn"|"MineEntrance"|"HomeBed"|"LastDeathPoint" } (Navigates to known landmark from memory)
- "deposit_chest": {} (Deposits surplus junk and blocks into nearest memory storage chest)
- "follow_player": { "target_player": "username", "range": 3 } (Walks near player)
- "explore_terrain": { "radius": 24 } (Explores surrounding land)
- "custom_task": { "task_description": "..." } (For any unique creative task that Agent 2 will code)

CRITICAL RULES:
1. GOAL FOCUS & PERSISTENCE: Maintain your "strategic_objective" across turns! For example, if your objective is "ล่าสัตว์หาอาหารก่อนลงเหมือง", do not switch to chopping wood or exploring after just 1 animal unless you have collected enough food. Stick with your objective until completed or forced to change by immediate danger.
2. TOOL LIFECYCLE & CRITICAL DURABILITY (MANDATORY):
   - Always inspect "status.tools_status" and "status.critical_tool_alert" before selecting an action!
   - If "critical_tool_alert" is present OR pickaxe has_tool is false OR pickaxe durability_percent <= 5%:
     * YOU CANNOT MINE! DO NOT choose "mine_stone", "mine_ore", "branch_mine", or "staircase_mine".
     * If you have cobblestone/cobbled_deepslate >= 3 and sticks/wood, choose "craft_item": { "item_name": "stone_pickaxe", "count": 1 }.
     * If you have wood logs or planks, craft planks/sticks and choose "craft_item": { "item_name": "wooden_pickaxe", "count": 1 }.
     * If you have NO wood/cobblestone and are underground (is_underground: true), choose "go_surface" to gather wood!
     * If you are on the surface (is_underground: false) and have no wood, choose "chop_tree" to gather wood first!
     * Alternatively, pivot your strategic objective to smelting ores, cooking food, storing items in chests, or companion exploration.
3. ORE MINING TOOL TIER HIERARCHY (ABSOLUTE MINECRAFT LAW - DO NOT BREAK):
   - Wooden Pickaxe: Coal Ore, Stone. (CANNOT harvest Iron Ore!)
   - Stone Pickaxe: Iron Ore, Copper Ore, Lapis Lazuli Ore, Coal Ore, Stone.
     WARNING: Stone Pickaxe CANNOT HARVEST Gold Ore, Diamond Ore, Redstone Ore, or Emerald Ore! If you mine Gold or Diamonds with a Stone Pickaxe, they drop NOTHING (0 items) and the ore is destroyed forever!
   - Iron Pickaxe: Gold Ore, Diamond Ore, Redstone Ore, Emerald Ore, Iron Ore, Coal Ore.
   - Diamond Pickaxe: Obsidian, Ancient Debris, plus all ores.
   
   TECH PROGRESSION RULE:
   - Check "status.tools_status.pickaxe.tier"!
   - If your tier is "stone": NEVER choose "mine_ore" for "gold" or "diamond", and NEVER choose "mine_remembered_ore" for gold/diamond!
   - Follow this tech progression strictly:
     1. Mine Iron Ore ("mine_ore": { "ore_type": "iron" })
     2. Smelt Iron in Furnace ("smelt_item": { "item_name": "raw_iron" })
     3. Craft Iron Pickaxe ("craft_item": { "item_name": "iron_pickaxe" })
     4. ONLY AFTER you possess an Iron Pickaxe can you mine Gold or Diamonds!
4. LONG-TERM SPATIAL MEMORY: You have access to spatial landmarks and chest registries in "memory". If your inventory is cluttered with cobblestone/dirt (>16 blocks), use "deposit_chest". If night falls and you need shelter, navigate to "HomeBed". If lost deep underground, navigate to "MineEntrance" or "SurfaceSpawn".
5. Always check your inventory before crafting! (all_items shows all items you carry). Do you have required ingredients? If not, gather or craft prerequisites first!
6. Do not repeat an action if it just failed in recent_actions. Choose an alternative or gather prerequisites.
7. Keep "thought" concise (1-2 sentences in Thai explaining your strategy).
8. If "LastDeathPoint" appears in landmarks and you have few tools, you can travel towards it to recover your items!
9. If inventory has no food and passive animals (chicken, cow, pig) are nearby within 20m, use "hunt_animal" to secure food before going into deep caves!
10. CHAT ETIQUETTE (CRITICAL): Do NOT chat for routine gameplay actions (chopping wood, mining regular stone, walking, crafting tools, eating). Keep "speech": null!
ONLY set "speech" when:
- Finding something genuinely rare or valuable (e.g. diamonds, netherite, dungeon, temple, village).
- Critical danger or emergency alert (e.g. creeper ambush, on fire, drowning, critical low HP).
Otherwise, "speech" MUST be null so you don't spam public server chat!
11. Respond ONLY with a valid JSON object. No explanations, no markdown fences.

OUTPUT JSON FORMAT:
{
  "strategic_objective": "Current high-level goal (e.g. 'ล่าสัตว์หาอาหารก่อนลงเหมือง', 'ขุดเหมืองหาหินและแร่เหล็ก', 'ตัดไม้ทำเตียงและที่พัก')",
  "thought": "Brief Thai reasoning why you chose this action for this specific step",
  "speech": "Alert or discovery Thai message (ONLY if finding rare loot or in critical danger, otherwise null)",
  "action": "action_name_from_list",
  "params": { ... }
}`;

class AutonomousEngine {
  constructor(client) {
    this.client = client;
    this.isRunning = false;
    this.isBusy = false;
    this._loopInterval = null;
    this._cfg = config.minecraft?.autonomous || {
      enabled: true,
      idle_timeout_ms: 6000,
      explore_radius: 24,
      auto_eat: true,
      auto_sleep: true,
      self_defense: true,
      auto_armor: true,
      auto_torch: true,
    };
    this._idleTimeoutMs = Math.max(5000, this._cfg.idle_timeout_ms || 6000);
    this._lastTaskTime = 0;
    this._spawnPos = null;
    this._currentGoal = 'idle';
    this._lastBanterTime = {};
    this._goalCooldowns = {};
    this._recentActions = [];
    this._preemptController = new AbortController();
    this._isPlanning = false;
    this._currentStrategicObjective = 'เอาชีวิตรอดและรวบรวมทรัพยากรเบื้องต้น';
    this._objectiveSteps = 0;
    this._criticalToolAlert = null;

    // Anti-Stall Watchdog
    this._lastMeaningfulActionTime = Date.now();
    this._busyStartTime = 0;
    this._watchdogInterval = null;
    this._lastWatchdogPos = null;
    this._lastWatchdogMoveTime = Date.now();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._lastTaskTime = 0;
    this._lastMeaningfulActionTime = Date.now();
    logger.info('🧠 Hierarchical LLM Cognitive Agent started (Conscious LLM Planner + Fast Reflex Layer Active)!', 'AutonomousEngine');

    if (this.client && this.client.adapter && typeof this.client.adapter.getPosition === 'function') {
      const p = this.client.adapter.getPosition();
      if (p && p.y >= 55) {
        this._spawnPos = p.clone();
        if (this.client.worldMemory && typeof this.client.worldMemory.setLandmark === 'function') {
          this.client.worldMemory.setLandmark('SurfaceSpawn', p.x, p.y, p.z);
        }
      }
    }

    // Cognitive Loop Tick (Evaluates reflexes, triggers planner when idle)
    this._loopInterval = setInterval(() => {
      this._tick();
    }, 2000);

    // Dedicated 1-Second Anti-Stall & Liveness Watchdog Heartbeat
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
    logger.info('Autonomous Cognitive Agent stopped.', 'AutonomousEngine');
  }

  notifyTaskStarted() {
    this._lastTaskTime = Date.now();
    this.preempt();
  }

  notifyTaskCompleted() {
    this._lastTaskTime = Date.now();
    logger.info('✨ Task completed. Muumiu resuming autonomous Cognitive Agent loop...', 'AutonomousEngine');
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

  /**
   * Reports that a tool broke or is depleted during physical execution.
   * Interrupts physical actions immediately and flags the conscious planner for re-planning.
   * @param {string} toolType
   */
  reportToolDepleted(toolType = 'pickaxe') {
    logger.warn(`⚠️ [Tool Depleted Alert] ${toolType} broke or unavailable during execution! Interrupted for AI re-planning.`, 'AutonomousEngine');
    this._criticalToolAlert = {
      tool: toolType,
      message: `อุปกรณ์ ${toolType} พังหรือไม่มีในตัว! บอทหยุดขุดทันที กรุณาคราฟใหม่ รวบรวมไม้ หรือเปลี่ยนเป้าหมาย`,
      timestamp: Date.now(),
    };

    // Clear cooldown on tool crafting and wood gathering so AI can immediately execute recovery
    for (const key of Object.keys(this._goalCooldowns)) {
      if (key.includes('craft_item') || key.includes(toolType) || key.includes('chop_tree') || key.includes('go_surface')) {
        delete this._goalCooldowns[key];
      }
    }

    // Add failure status to recent actions history so LLM Planner sees the cause
    this._recentActions.push({
      action: this._currentGoal || 'mining',
      params: {},
      thought: `อุปกรณ์ ${toolType} พังหรือหมดสภาพ`,
      status: 'tool_depleted',
      timestamp: Date.now(),
    });
    if (this._recentActions.length > 5) this._recentActions.shift();

    // Immediately stop current physical task
    this.preempt();
  }

  /**
   * Reports that an ore/block cannot be harvested because current pickaxe tier is insufficient.
   * Interrupts physical actions immediately and flags the conscious planner for tech progression.
   * @param {string} blockName
   * @param {string} requiredTool
   */
  reportToolTierInsufficient(blockName, requiredTool = 'iron_pickaxe') {
    logger.warn(`🚫 [Tool Tier Insufficient Alert] Cannot harvest '${blockName}'! Requires at least '${requiredTool}'.`, 'AutonomousEngine');
    this._criticalToolAlert = {
      tool: requiredTool,
      message: `แร่ '${blockName}' ต้องใช้ '${requiredTool}' ขึ้นไปถึงจะได้ของ! ตอนนี้ที่ขุดในตัวระดับไม่ถึง หากขุดจะเสียแร่ฟรี (0 drops) ต้องคราฟ '${requiredTool}' ก่อน`,
      timestamp: Date.now(),
    };

    // Add failure record so Planner sees why it was aborted
    this._recentActions.push({
      action: this._currentGoal || 'mining',
      params: {},
      thought: `ขุด '${blockName}' ไม่ได้เพราะระดับอุปกรณ์ต่ำกว่า ${requiredTool}`,
      status: 'tool_tier_insufficient',
      timestamp: Date.now(),
    });
    if (this._recentActions.length > 5) this._recentActions.shift();

    this.preempt();
  }

  getCurrentGoal() {
    return this._currentGoal;
  }

  emitBanter(text, isEmergencyOrDiscovery = false) {
    if (!text) return;
    const clean = text.replace(/\[\w+\]\s*/g, '').trim();
    if (!clean) return;

    // Strict filter: Only send to public in-game chat if it is a genuine discovery or critical emergency alert
    const urgentKeywords = [
      'เพชร', 'diamond', 'เนเธอไรต์', 'netherite',
      'ดันเจี้ยน', 'dungeon', 'หมู่บ้าน', 'village', 'สปอเนอร์', 'spawner', 'วิหาร', 'temple',
      'ช่วยด้วย', 'อันตราย', 'ไฟไหม้', 'ลาวา', 'lava', 'creeper', 'ครีปเปอร์',
      'จมน้ำ', 'drown', 'จะตาย', 'ใกล้ตาย', 'ระเบิด'
    ];
    const isUrgent = isEmergencyOrDiscovery || urgentKeywords.some(kw => clean.toLowerCase().includes(kw));

    if (isUrgent) {
      const now = Date.now();
      if (this._lastBanterTime['urgent'] && now - this._lastBanterTime['urgent'] < 10000) {
        return;
      }
      this._lastBanterTime['urgent'] = now;
      if (this.client.adapter) {
        this.client.adapter.chat(clean);
        logger.info(`🚨 [Muumiu In-Game Alert/Discovery]: ${clean}`, 'AutonomousEngine');
      }
    } else {
      // Routine banter is kept internal (logged only, NOT typed in game chat to avoid spam)
      logger.info(`💬 [Muumiu Internal Thought]: ${clean}`, 'AutonomousEngine');
    }
  }

  // =========================================================================
  // ⚡ FAST-PATH REFLEX LAYER (<50ms Real-Time Physical Survival)
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
      logger.warn('🫧 [Reflex] Submerged underwater! Executing emergency surface swim...', 'AutonomousEngine');
      this.emitBanter('จมน้ำอยู่! ขอดำน้ำขึ้นไปหายใจก่อนนะ!', true);
      await adapter.emergencySwimAndBreathe();
      return true;
    }

    // 3. Fire / Lava Reflex & Water Bucket Clutch
    const blockIn = adapter.getBlockAt(botPos);
    const isOnFire = rawBot.entity?.isOnFire || (blockIn && (blockIn.name === 'fire' || blockIn.name === 'lava' || blockIn.name === 'flowing_lava'));
    if (isOnFire) {
      this._currentGoal = 'extinguishing_fire';
      logger.warn('🔥 [Reflex] Bot on fire! Deploying water clutch or searching water...', 'AutonomousEngine');
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
      const hostiles = adapter.findHostiles(12);
      if (hostiles.length > 0) {
        this._currentGoal = 'fleeing_danger';
        logger.warn(`🏃 [Reflex] Critical Low HP (${adapter.getHealth()})! Retreating from ${hostiles[0].name}...`, 'AutonomousEngine');
        this.emitBanter(`เลือดเหลือ ${adapter.getHealth()} เอง! ขอถอยตั้งหลักก่อนนะคะ!`, true);
        await adapter.moveAway(16);
        return true;
      }
    }

    // 5. Hostile Mob Combat & Creeper Evasion
    if (this._cfg.self_defense !== false) {
      const hostiles = adapter.findHostiles(12);
      if (hostiles.length >= 2) {
        this._currentGoal = 'evading_mob_group';
        logger.warn(`🛡️ [Reflex] Hostile group detected (${hostiles.length})! Backing off...`, 'AutonomousEngine');
        this.emitBanter('มอนสเตอร์มารุมเยอะเกินไป! ถอยก่อนดีกว่า!', true);
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

    // 6. Auto-Eat Reflex when hunger or health depleted
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
  // 🧠 SLOW-PATH CONSCIOUS BRAIN (LLM Cognitive Planner: 8-12s)
  // =========================================================================
  _buildPerceptionSnapshot() {
    const adapter = this.client.adapter;
    const rawBot = adapter?.rawBot;
    const pos = adapter.getPosition();
    const inv = adapter.getInventory();

    const inventorySummary = {
      all_items: inv.map(i => `${i.count}x ${i.name}`),
      tools: inv.filter(i => i.name.endsWith('_pickaxe') || i.name.endsWith('_axe') || i.name.endsWith('_sword') || i.name.endsWith('_shovel') || i.name === 'shield').map(i => i.name),
      armor: inv.filter(i => i.name.includes('helmet') || i.name.includes('chestplate') || i.name.includes('leggings') || i.name.includes('boots')).map(i => i.name),
      materials: {},
      food_items: inv.filter(i => this.client.resolver?.isFood(i)).map(i => `${i.count}x ${i.name}`),
      free_slots: rawBot?.inventory ? rawBot.inventory.emptySlotCount() : 36 - inv.length,
    };

    const importantMats = ['oak_log', 'birch_log', 'spruce_log', 'oak_planks', 'stick', 'crafting_table', 'cobblestone', 'cobbled_deepslate', 'coal', 'charcoal', 'raw_iron', 'iron_ingot', 'diamond', 'furnace', 'torch', 'water_bucket'];
    for (const mat of importantMats) {
      const c = adapter.countItem(mat);
      if (c > 0) inventorySummary.materials[mat] = c;
    }

    const nearby = {
      crafting_table_nearby: adapter.findBlocks({ matching: 'crafting_table', maxDistance: 12, count: 1 }).length > 0,
      furnace_nearby: adapter.findBlocks({ matching: 'furnace', maxDistance: 12, count: 1 }).length > 0,
      chests_nearby: adapter.findBlocks({ matching: ['chest', 'barrel'], maxDistance: 16, count: 1 }).length > 0,
      beds_nearby: adapter.findBlocks({ matching: ['white_bed', 'red_bed', 'blue_bed', 'black_bed', 'yellow_bed', 'green_bed', 'purple_bed', 'orange_bed', 'cyan_bed', 'light_blue_bed', 'magenta_bed', 'pink_bed', 'brown_bed', 'gray_bed', 'light_gray_bed', 'lime_bed'], maxDistance: 24, count: 1 }).length > 0,
      exposed_ores: this.client.dsl ? this.client.dsl.findNearbyExposedOres(12).map(p => adapter.getBlockAt(p)?.name).filter(Boolean) : [],
    };

    const hostiles = adapter.findHostiles(14).map(e => ({ name: e.name, distance: Math.round(adapter.distanceTo(e.position) * 10) / 10 }));
    const animals = adapter.findAnimals(14).map(e => ({ name: e.name, distance: Math.round(adapter.distanceTo(e.position) * 10) / 10 }));
    const players = Object.values(rawBot?.players || {}).filter(p => p.username !== rawBot.username && p.entity).map(p => ({
      username: p.username,
      distance: Math.round(adapter.distanceTo(p.entity.position) * 10) / 10,
    }));

    const { worldMemory } = require('../memory/world_memory');
    const serverKey = this.client.getServerIdentifier();
    const rawLandmarks = worldMemory ? worldMemory.getLandmarks(serverKey) : {};
    const formattedLandmarks = Object.values(rawLandmarks).map(lm => {
      const dist = pos ? Math.round(Math.hypot(lm.coords.x - pos.x, lm.coords.z - pos.z) * 10) / 10 : null;
      return {
        name: lm.name,
        coords: lm.coords,
        distance: dist,
        desc: lm.description || '',
      };
    });

    const rawChests = worldMemory ? worldMemory.getChests(serverKey) : {};
    const formattedChests = Object.values(rawChests).map(c => {
      const dist = pos ? Math.round(Math.hypot(c.coords.x - pos.x, c.coords.z - pos.z) * 10) / 10 : null;
      return {
        label: c.label || 'Chest',
        coords: c.coords,
        distance: dist,
        items: (c.items || []).slice(0, 5).map(i => `${i.count}x ${i.name}`).join(', '),
      };
    });

    const rememberedOres = worldMemory ? Object.values(worldMemory.getDiscoveredOres(serverKey) || {}) : [];
    const recentDiary = worldMemory ? (worldMemory.getDiary(serverKey) || []).slice(0, 2) : [];

    // Evaluate tool health and durability
    let toolsStatus = null;
    if (this.client.watchdog && typeof this.client.watchdog.getAllToolsStatus === 'function') {
      toolsStatus = this.client.watchdog.getAllToolsStatus();
    } else {
      const hasPick = adapter.hasPickaxe ? adapter.hasPickaxe() : adapter.getInventory().some(i => i.name.endsWith('_pickaxe'));
      const hasAxe = adapter.hasAxe ? adapter.hasAxe() : adapter.getInventory().some(i => i.name.endsWith('_axe') && !i.name.includes('pickaxe'));
      const hasSword = adapter.getInventory().some(i => i.name.endsWith('_sword'));
      toolsStatus = {
        pickaxe: { has_tool: hasPick, count: hasPick ? 1 : 0, is_critical: !hasPick },
        axe: { has_tool: hasAxe, count: hasAxe ? 1 : 0, is_critical: !hasAxe },
        sword: { has_tool: hasSword, count: hasSword ? 1 : 0, is_critical: !hasSword },
      };
    }

    // Auto-clear or populate critical tool alert
    let criticalAlert = this._criticalToolAlert;
    const pickStatus = toolsStatus?.pickaxe;
    if (pickStatus && !pickStatus.has_tool) {
      if (!criticalAlert) {
        criticalAlert = {
          tool: 'pickaxe',
          message: 'ไม่มีที่ขุด (Pickaxe) อยู่ในกระเป๋า! ห้ามขุดหินหรือแร่เด็ดขาด ต้องคราฟใหม่หรือหาไม้ก่อน',
        };
      }
    } else if (pickStatus && pickStatus.has_tool && (pickStatus.durability_percent === null || pickStatus.durability_percent > 10)) {
      if (criticalAlert && criticalAlert.tool === 'iron_pickaxe') {
        if (['iron', 'diamond', 'netherite'].includes(pickStatus.tier)) {
          this._criticalToolAlert = null;
          criticalAlert = null;
        }
      } else if (criticalAlert && criticalAlert.tool === 'diamond_pickaxe') {
        if (['diamond', 'netherite'].includes(pickStatus.tier)) {
          this._criticalToolAlert = null;
          criticalAlert = null;
        }
      } else {
        this._criticalToolAlert = null;
        criticalAlert = null;
      }
    }

    return {
      current_strategic_objective: this._currentStrategicObjective || 'เอาชีวิตรอดและรวบรวมทรัพยากรเบื้องต้น',
      steps_on_current_objective: this._objectiveSteps,
      status: {
        health: adapter.getHealth(),
        food: adapter.getFood(),
        position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
        is_underground: pos.y < 55,
        is_night: rawBot?.time?.isNight || false,
        is_raining: rawBot?.isRaining || false,
        tools_status: toolsStatus,
        critical_tool_alert: criticalAlert ? criticalAlert.message : null,
      },
      inventory: inventorySummary,
      nearby: nearby,
      entities: {
        hostiles: hostiles,
        animals: animals,
        players: players,
      },
      memory: {
        landmarks: formattedLandmarks,
        chests: formattedChests,
        recent_milestones: recentDiary.map(d => `[${d.timestamp ? d.timestamp.split('T')[0] : ''}] ${d.title}: ${d.content}`),
        remembered_valuable_ores: rememberedOres.map(o => `${o.name} at (${o.coords.x},${o.coords.y},${o.coords.z})`),
      },
      recent_actions: this._recentActions.slice(-3),
    };
  }

  async _callPlannerLLM(perceptionJson) {
    const aiproviderCfg = config.aiprovider || {};
    const activeProvider = aiproviderCfg.active_provider || 'openrouter';
    const cfg = activeProvider === 'openrouter' ? aiproviderCfg.openrouter : aiproviderCfg.ollama;
    const baseUrl = cfg.base_url || (activeProvider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'http://127.0.0.1:11434');
    const model = cfg.model || (activeProvider === 'openrouter' ? 'minimax/minimax-m3:free' : 'qwen2.5-coder:3b');
    const apiKey = cfg.api_key || '';
    const timeoutMs = cfg.timeout_ms || 30000;

    const userPrompt = `LIVE GAME SITUATION TELEMETRY:
${JSON.stringify(perceptionJson, null, 2)}

Analyze your inventory, surroundings, and recent actions. Choose your next strategic action. Output ONLY the JSON decision:`;

    let rawOutput = '';
    const startTime = Date.now();

    try {
      if (activeProvider === 'openrouter') {
        const resp = await axios.post(
          `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
          {
            model,
            messages: [
              { role: 'system', content: PLANNER_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            max_tokens: 600,
          },
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'HTTP-Referer': 'https://github.com/Nice2MU/MuumiuLLM',
              'X-Title': 'MuumiuLLM Minecraft Cognitive Planner',
              'Content-Type': 'application/json',
            },
            timeout: timeoutMs,
          }
        );
        rawOutput = resp.data?.choices?.[0]?.message?.content || '';
      } else {
        const fullPrompt = `${PLANNER_SYSTEM_PROMPT}\n\n${userPrompt}`;
        const resp = await axios.post(
          `${baseUrl}/api/generate`,
          {
            model,
            prompt: fullPrompt,
            stream: false,
            options: {
              num_ctx: 4096,
              num_predict: 450,
              temperature: 0.3,
            },
          },
          { timeout: timeoutMs }
        );
        rawOutput = resp.data?.response || '';
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`⚡ [LLM Planner] Received decision via ${activeProvider} (${model}) in ${elapsed}s`, 'AutonomousEngine');

      // Unwrap JSON
      let cleaned = rawOutput.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      const mdMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (mdMatch) cleaned = mdMatch[1].trim();

      const jsonStart = cleaned.indexOf('{');
      const jsonEnd = cleaned.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
      }

      const parsed = JSON.parse(cleaned);
      if (parsed && (parsed.action || parsed.thought)) {
        return parsed;
      }
    } catch (e) {
      logger.warn(`[LLM Planner] Generation notice (${activeProvider}): ${e.message}`, 'AutonomousEngine');
    }

    return null;
  }

  async _runCognitiveCycle() {
    const adapter = this.client.adapter;
    const dsl = this.client.dsl;
    const rawBot = adapter?.rawBot;
    if (!adapter || !dsl || !rawBot) return;

    if (this._isPlanning || this.isBusy) return;
    this._isPlanning = true;
    this.isBusy = true;
    this._busyStartTime = Date.now();
    const signal = this._preemptController.signal;

    try {
      const snapshot = this._buildPerceptionSnapshot();

      // 1. Ask LLM Cognitive Planner for next strategic move
      logger.info('🧠 [LLM Planner] Formulating next strategic gameplay goal...', 'AutonomousEngine');
      const decision = await this._callPlannerLLM(snapshot);
      this._isPlanning = false;

      if (signal.aborted) {
        logger.info('🛑 Cognitive cycle aborted before action dispatch.', 'AutonomousEngine');
        return;
      }

      if (decision?.strategic_objective) {
        if (this._currentStrategicObjective !== decision.strategic_objective) {
          logger.info(`🎯 [Strategic Shift] '${this._currentStrategicObjective}' ➔ '${decision.strategic_objective}'`, 'AutonomousEngine');
          this._currentStrategicObjective = decision.strategic_objective;
          this._objectiveSteps = 1;
        } else {
          this._objectiveSteps++;
        }
      }

      let action = decision?.action;
      let params = decision?.params || {};
      let thought = decision?.thought || 'กำลังสำรวจและเอาชีวิตรอด';
      let speech = decision?.speech;

      // 2. Intelligent Fallback if LLM was unavailable
      const hasPick = adapter.hasPickaxe ? adapter.hasPickaxe() : (adapter.hasItem('wooden_pickaxe') || adapter.hasItem('stone_pickaxe') || adapter.hasItem('iron_pickaxe') || adapter.hasItem('diamond_pickaxe'));
      const pos = adapter.getPosition();
      const woodLogs = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log'];
      const woodPlanks = ['oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks'];
      const hasWood = woodLogs.some(w => adapter.countItem(w) > 0) || woodPlanks.some(p => adapter.countItem(p) > 0);
      const cobbleCount = adapter.countItem('cobblestone') + adapter.countItem('cobbled_deepslate');
      const hasCobble = cobbleCount >= 3;

      if (!action) {
        if (!hasPick) {
          if (hasCobble && (hasWood || adapter.countItem('stick') >= 2)) {
            action = 'craft_item';
            params = { item_name: 'stone_pickaxe', count: 1 };
            thought = 'ไม่มีที่ขุด แต่มีหินกับไม้ คราฟ Stone Pickaxe ใหม่';
          } else if (hasWood) {
            action = 'craft_item';
            params = { item_name: 'wooden_pickaxe', count: 1 };
            thought = 'ไม่มีที่ขุด คราฟ Wooden Pickaxe เพื่อขุดหิน';
          } else if (pos.y < 55) {
            action = 'go_surface';
            thought = 'ที่ขุดพังและไม่มีไม้ใต้ดิน ต้องกลับขึ้นพื้นผิวเพื่อหาไม้';
          } else {
            action = 'chop_tree';
            params = { count: 3 };
            thought = 'ที่ขุดพัง ต้องตัดไม้มาทำที่ขุดใหม่';
          }
        } else if (!hasWood && pos.y >= 55) {
          action = 'chop_tree';
          params = { count: 3 };
          thought = 'เริ่มหาไม้สำหรับทำอุปกรณ์';
        } else {
          action = 'explore_terrain';
          params = { radius: 18 };
          thought = 'เดินสำรวจสภาพแวดล้อม';
        }
      } else {
        // Defensive Action Guard: If LLM chose a mining action but bot has no pickaxe
        const isMiningAction = ['mine_stone', 'mine_ore', 'branch_mine', 'staircase_mine'].includes(action);
        if (isMiningAction && !hasPick) {
          logger.warn(`🚫 [Action Guard] LLM attempted mining ('${action}') without a pickaxe! Safely redirecting action...`, 'AutonomousEngine');
          if (hasCobble && (hasWood || adapter.countItem('stick') >= 2)) {
            action = 'craft_item';
            params = { item_name: 'stone_pickaxe', count: 1 };
            thought = 'ไม่มีที่ขุดสำหรับงานเหมือง ขอคราฟ Stone Pickaxe ก่อน';
          } else if (hasWood) {
            action = 'craft_item';
            params = { item_name: 'wooden_pickaxe', count: 1 };
            thought = 'ไม่มีที่ขุดสำหรับงานเหมือง ขอคราฟ Wooden Pickaxe ก่อน';
          } else if (pos.y < 55) {
            action = 'go_surface';
            params = {};
            thought = 'ที่ขุดพังและไม่มีไม้ใต้ดิน ต้องกลับขึ้นพื้นผิวไปหาไม้';
          } else {
            action = 'chop_tree';
            params = { count: 3 };
            thought = 'ที่ขุดพังและไม่มีไม้ ต้องตัดไม้ทำที่ขุดใหม่';
          }
        }

        // Defensive Action Guard 2: If LLM chose to mine high-tier ores (gold, diamond, redstone, emerald) without Iron Pickaxe
        const pickaxeTier = this.client.watchdog?.getToolStatus('pickaxe')?.tier || (adapter.hasItem('diamond_pickaxe') ? 'diamond' : adapter.hasItem('iron_pickaxe') ? 'iron' : adapter.hasItem('stone_pickaxe') ? 'stone' : adapter.hasItem('wooden_pickaxe') ? 'wooden' : null);
        const isIronOrHigher = ['iron', 'diamond', 'netherite'].includes(pickaxeTier);

        const oreTarget = (params.ore_type || '').toLowerCase();
        const isHighTierOreMining = (action === 'mine_ore' && ['gold', 'diamond', 'redstone', 'emerald'].includes(oreTarget));
        
        let isHighTierRememberedOre = false;
        if (action === 'mine_remembered_ore' && params.x !== undefined) {
          const { worldMemory } = require('../memory/world_memory');
          const serverKey = this.client.getServerIdentifier();
          const rememberedOres = worldMemory ? worldMemory.getDiscoveredOres(serverKey) : {};
          const key = `${params.x}_${params.y}_${params.z}`;
          const targetOre = rememberedOres[key];
          if (targetOre && (targetOre.name.includes('gold') || targetOre.name.includes('diamond') || targetOre.name.includes('redstone') || targetOre.name.includes('emerald'))) {
            isHighTierRememberedOre = true;
          }
        }

        if ((isHighTierOreMining || isHighTierRememberedOre) && !isIronOrHigher) {
          logger.warn(`🚫 [Action Guard] LLM attempted to mine high-tier ore without an Iron Pickaxe! (Current tier: '${pickaxeTier}'). Redirecting to Iron tech progression...`, 'AutonomousEngine');
          
          const ironIngots = adapter.countItem('iron_ingot');
          const rawIron = adapter.countItem('raw_iron');
          const sticks = adapter.countItem('stick');
          const cobble = adapter.countItem('cobblestone') + adapter.countItem('cobbled_deepslate');
          const hasFurnace = adapter.countItem('furnace') > 0 || adapter.findBlocks({ matching: 'furnace', maxDistance: 12, count: 1 }).length > 0;

          if (ironIngots >= 3 && (sticks >= 2 || hasWood)) {
            action = 'craft_item';
            params = { item_name: 'iron_pickaxe', count: 1 };
            thought = 'มีเหล็กแท่งครบ 3 แท่งแล้ว คราฟ Iron Pickaxe ก่อน เพื่อให้ขุดทองและเพชรได้';
          } else if (rawIron >= 3 && hasFurnace) {
            action = 'smelt_item';
            params = { item_name: 'raw_iron', count: Math.min(rawIron, 4) };
            thought = 'มีแร่เหล็กดิบ เผาเหล็กในเตาเผาเพื่อนำไปทำ Iron Pickaxe';
          } else if (rawIron >= 3 && !hasFurnace && cobble >= 8) {
            action = 'craft_item';
            params = { item_name: 'furnace', count: 1 };
            thought = 'คราฟเตาเผาเพื่อนำมาหลอมแร่เหล็กดิบ';
          } else {
            action = 'mine_ore';
            params = { ore_type: 'iron', count: 3 };
            thought = `ที่ขุดปัจจุบันเป็นระดับ ${pickaxeTier || 'ไม่มี'} ยังขุดทอง/เพชรไม่ได้ ต้องขุดแร่เหล็กมาทำที่ขุดเหล็กก่อน`;
          }
        }
      }

      // Check action cooldown
      const actionKey = `${action}:${params.item_name || params.ore_type || ''}`;
      if (this._goalCooldowns[actionKey] && Date.now() < this._goalCooldowns[actionKey]) {
        logger.info(`⏳ Action '${actionKey}' is on cooldown. Exploring surroundings instead...`, 'AutonomousEngine');
        action = 'explore_terrain';
        params = { radius: 16 };
      }

      this._currentGoal = action;
      logger.info(`🎯 [LLM Goal]: ${action} (${thought})`, 'AutonomousEngine');

      // Emit cute in-character speech if LLM generated one
      if (speech) {
        this.emitBanter(speech);
      }

      // 3. Dispatch action directly (Zero Regex Overhead)
      const { MCPToolHandler } = require('../mcp/tools');
      const result = await MCPToolHandler.handleToolCall(
        'muu_mc_execute_task',
        {
          action: action,
          params: params,
          task: thought,
        },
        true
      );

      // Record in recent actions history
      const record = {
        action,
        params,
        thought,
        status: (result?.status === 'error' || result?.isError) ? 'error' : 'success',
        timestamp: Date.now(),
      };
      this._recentActions.push(record);
      if (this._recentActions.length > 5) this._recentActions.shift();

      if (record.status === 'error') {
        this._goalCooldowns[actionKey] = Date.now() + 20000;
        logger.warn(`Goal '${actionKey}' failed. Backing off for 20s...`, 'AutonomousEngine');
      } else {
        delete this._goalCooldowns[actionKey];
      }

      this._lastMeaningfulActionTime = Date.now();
    } catch (err) {
      if (!signal.aborted) {
        logger.debug(`[Cognitive Loop] Exception: ${err.message}`, 'AutonomousEngine');
      }
    } finally {
      this._isPlanning = false;
      this.isBusy = false;
      this._busyStartTime = 0;
      this._lastTaskTime = Date.now();
    }
  }

  async _tick() {
    if (!this.isRunning || this.isBusy || this._isPlanning) return;
    if (!this.client.isConnected || !this.client.isSpawned) return;

    const adapter = this.client.adapter;
    const dsl = this.client.dsl;
    const rawBot = adapter?.rawBot;
    if (!adapter || !dsl || !rawBot) return;

    if (adapter.getHealth() <= 0 || (rawBot.entity && rawBot.entity.isValid === false)) {
      return;
    }

    if (!this._spawnPos) {
      this._spawnPos = adapter.getPosition();
    }

    // Step 1: Fast-Path Reflex Layer (Immediate survival < 50ms)
    const reflexTriggered = await this._evaluateReflexes(adapter, dsl, rawBot);
    if (reflexTriggered) {
      this._lastMeaningfulActionTime = Date.now();
      return;
    }

    // Step 2: Check Idle Timeout before triggering Slow-Path Cognitive Loop
    const idleDuration = Date.now() - this._lastTaskTime;
    if (idleDuration < this._idleTimeoutMs) return;

    // Step 3: Trigger Slow-Path Conscious Brain
    await this._runCognitiveCycle();
  }

  // =========================================================================
  // 🚨 ANTI-STALL & LIVENESS WATCHDOG
  // =========================================================================
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

    if (this._isPlanning) {
      this._lastWatchdogMoveTime = Date.now();
      this._lastMeaningfulActionTime = Date.now();
      return;
    }

    if (adapter._isDigging) {
      this._lastWatchdogMoveTime = Date.now();
      this._lastMeaningfulActionTime = Date.now();
      return;
    }

    // Stuck Lock Release Guard (>45s without movement while busy)
    const timeWithoutMovement = Date.now() - (this._lastWatchdogMoveTime || Date.now());
    if (this.isBusy && timeWithoutMovement > 45000) {
      logger.warn(`🚨 [Anti-Stall Watchdog] Stalled for ${(timeWithoutMovement / 1000).toFixed(1)}s! Forcing abort & unstuck hop...`, 'AutonomousEngine');
      this.preempt();
      this.isBusy = false;
      this._busyStartTime = 0;
      this._lastMeaningfulActionTime = Date.now();
      this._lastWatchdogMoveTime = Date.now();
      await adapter.moveAway(3).catch(() => {});
      return;
    }

    // Proactive Anti-Sleep Kickstart (>8s inactivity when not busy)
    const inactiveDuration = Date.now() - this._lastMeaningfulActionTime;
    if (!this.isBusy && inactiveDuration > 8000) {
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
      const headBlock = adapter.getBlockAt(botPos.offset(0, 1.6, 0));
      if (headBlock && headBlock.name !== 'air' && headBlock.name !== 'cave_air' && headBlock.name !== 'water') {
        logger.info(`🚨 [Anti-Stall] Clearing head obstruction '${headBlock.name}'...`, 'AutonomousEngine');
        await dsl.safeDigBlock(headBlock);
      } else {
        await adapter.exploreTerrain(16).catch(() => {});
      }
    } catch (_) {
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
