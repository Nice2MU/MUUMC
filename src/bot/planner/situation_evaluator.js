/**
 * Situation Evaluator ("พอรึยัง?") for MuumiuLLM Minecraft Autonomous Gamer Brain.
 * Local deterministic evaluation of targets, EDC readiness, Sun Clock, and inventory state.
 * Prevents ADHD task-flipping and eliminates wasteful LLM cognitive polling.
 */

const { logger } = require('../logger');

class SituationEvaluator {
  constructor(client) {
    this.client = client;
  }

  get adapter() {
    return this.client?.adapter;
  }

  get worldMemory() {
    return this.client?.worldMemory;
  }

  get serverKey() {
    return this.client?.getServerIdentifier ? this.client.getServerIdentifier() : null;
  }

  // =========================================================================
  // ⚖️ 1. Step Target Evaluator ("พอรึยัง?")
  // =========================================================================

  /**
   * Evaluates if current step target condition has been satisfied.
   * @param {Object} step - The active step from GoalPlan
   * @returns {{ met: boolean, current: any, target: any, summary: string }}
   */
  evaluateStepTarget(step) {
    if (!step || !step.target_condition) {
      // If no explicit target condition, assume step must be physically dispatched
      return { met: false, current: 0, target: 1, summary: 'No target condition defined' };
    }

    const tc = step.target_condition;
    const adapter = this.adapter;
    if (!adapter) {
      return { met: false, current: 0, target: 1, summary: 'Adapter not ready' };
    }

    switch (tc.type) {
      case 'item_count': {
        const count = this._countItemOrGroup(tc.item || tc.item_group);
        const target = tc.target_count || 1;
        const met = count >= target;
        return {
          met,
          current: count,
          target,
          summary: `${tc.item || tc.item_group}: ${count}/${target} (${met ? 'พอแล้ว! ✅' : 'ยังไม่พอ ⏳'})`,
        };
      }

      case 'has_items': {
        const items = Array.isArray(tc.items) ? tc.items : [tc.items];
        const missing = items.filter(item => !adapter.hasItem(item));
        const met = missing.length === 0;
        return {
          met,
          current: items.length - missing.length,
          target: items.length,
          summary: met
            ? `มีอุปกรณ์ครบแล้ว: [${items.join(', ')}] ✅`
            : `ยังขาดอุปกรณ์: [${missing.join(', ')}] ⏳`,
        };
      }

      case 'landmark_exists': {
        const landmarks = this.worldMemory ? this.worldMemory.getLandmarks(this.serverKey) : {};
        const exists = !!landmarks[tc.landmark];
        return {
          met: exists,
          current: exists ? 1 : 0,
          target: 1,
          summary: exists ? `แลนด์มาร์ก '${tc.landmark}' มีอยู่แล้ว ✅` : `ยังไม่มีแลนด์มาร์ก '${tc.landmark}' ⏳`,
        };
      }

      case 'position_y': {
        const pos = adapter.getPosition();
        const y = pos ? pos.y : 64;
        const targetY = tc.target_y;
        let met = false;
        if (tc.operator === '<=' || !tc.operator) met = y <= targetY;
        else if (tc.operator === '>=') met = y >= targetY;
        else if (tc.operator === '==') met = Math.abs(y - targetY) < 1.0;

        return {
          met,
          current: Math.round(y),
          target: targetY,
          summary: `ระดับความสูง Y: ${Math.round(y)}/${targetY} (${met ? 'ถึงเป้าหมายแล้ว ✅' : 'ยังไม่ถึง ⏳'})`,
        };
      }

      case 'free_slots': {
        const freeSlots = adapter.countFreeSlots ? adapter.countFreeSlots() : (adapter.rawBot?.inventory?.emptySlotCount() || 0);
        const minFree = tc.min_free_slots || 10;
        const met = freeSlots >= minFree;
        return {
          met,
          current: freeSlots,
          target: minFree,
          summary: `ช่องว่างในกระเป๋า: ${freeSlots}/${minFree} (${met ? 'พอแล้ว ✅' : 'ยังไม่พอ ⏳'})`,
        };
      }

      default:
        return { met: false, current: 0, target: 1, summary: `Unknown condition type: ${tc.type}` };
    }
  }

  _countItemOrGroup(target) {
    const adapter = this.adapter;
    if (!adapter) return 0;
    if (!target) return 0;

    // Direct item count
    if (adapter.hasItem(target)) {
      return adapter.countItem(target);
    }

    const inv = adapter.getInventory() || [];

    // Group counts
    if (target === 'wood_logs') {
      const logNames = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log', 'stripped_oak_log', 'stripped_birch_log', 'stripped_spruce_log'];
      return inv.filter(i => logNames.includes(i.name)).reduce((sum, i) => sum + i.count, 0);
    }

    if (target === 'cobblestone_group') {
      return adapter.countItem('cobblestone') + adapter.countItem('cobbled_deepslate') + adapter.countItem('stone');
    }

    if (target === 'iron_ores_or_ingots') {
      return adapter.countItem('raw_iron') + adapter.countItem('iron_ingot') + adapter.countItem('iron_ore') + adapter.countItem('deepslate_iron_ore');
    }

    if (target === 'solid_building_blocks') {
      const woodLogs = this._countItemOrGroup('wood_logs');
      const planks = inv.filter(i => i.name.endsWith('_planks')).reduce((sum, i) => sum + i.count, 0);
      const stone = this._countItemOrGroup('cobblestone_group');
      const dirt = adapter.countItem('dirt');
      return (woodLogs * 4) + planks + stone + dirt;
    }

    return adapter.countItem(target);
  }

  // =========================================================================
  // 🎒 2. Expedition Readiness Checklist (EDC Check)
  // =========================================================================

  /**
   * Checks if bot has required tools, torches, food, and space before leaving base.
   */
  checkExpeditionReadiness() {
    const adapter = this.adapter;
    if (!adapter) return { ready: true, missing: [] };

    const missing = [];

    // 1. Pickaxe Check (at least 2 pickaxes or cobble+sticks to craft)
    const pickaxes = adapter.getInventory().filter(i => i.name.endsWith('_pickaxe'));
    const totalPicks = pickaxes.reduce((sum, i) => sum + i.count, 0);
    const hasMaterials = this._countItemOrGroup('cobblestone_group') >= 3 && (adapter.countItem('stick') >= 2 || this._countItemOrGroup('wood_logs') >= 1);
    if (totalPicks === 0 && !hasMaterials) {
      missing.push('ไม่มีที่ขุด (Pickaxe) และไม่มีวัตถุดิบคราฟต์');
    }

    // 2. Torches Check (>= 8 torches)
    const torches = adapter.countItem('torch');
    if (torches < 8) {
      missing.push(`คบไฟน้อยเกินไป (${torches}/8)`);
    }

    // 3. Food Check (>= 8 food items)
    const foodItems = adapter.getInventory().filter(i => this.client.resolver?.isFood(i));
    const totalFood = foodItems.reduce((sum, i) => sum + i.count, 0);
    if (totalFood < 8) {
      missing.push(`เสบียงอาหารน้อยเกินไป (${totalFood}/8)`);
    }

    // 4. Free Slots Check (>= 8 free slots)
    const freeSlots = adapter.countFreeSlots ? adapter.countFreeSlots() : (adapter.rawBot?.inventory?.emptySlotCount() || 0);
    if (freeSlots < 8) {
      missing.push(`กระเป๋าใกล้เต็ม (เหลือที่ว่าง ${freeSlots} ช่อง)`);
    }

    const ready = missing.length === 0;
    return {
      ready,
      missing,
      summary: ready ? '🎒 พร้อมเดินทาง (EDC Check Passed) ✅' : `🎒 ยังไม่พร้อมออกเดินทาง: ${missing.join(', ')} ⏳`,
    };
  }

  // =========================================================================
  // ⏰ 3. Sun Clock & Travel Budget (Time Awareness)
  // =========================================================================

  /**
   * Evaluates time of day and returns travel advice.
   */
  evaluateSunClock() {
    const rawBot = this.adapter?.rawBot;
    const timeOfDay = rawBot?.time?.timeOfDay || 0;
    const isNight = rawBot?.time?.isNight || false;

    // Time budget ranges:
    // 0 - 6000: Morning to Noon (Great for long expeditions)
    // 6000 - 9000: Afternoon (Complete local tasks)
    // 9000 - 12000: Late Afternoon / Sunset approaching (Head back to HomeBase)
    // 12000+: Dusk / Night (Sleep immediately)
    if (isNight || timeOfDay >= 12542) {
      return {
        phase: 'night',
        timeOfDay,
        canTravelFar: false,
        shouldSleep: true,
        shouldReturnHome: true,
        advice: 'ค่ำแล้ว! อันตรายจากมอนสเตอร์ ต้องกลับไปนอนที่เตียงทันที',
      };
    }

    if (timeOfDay >= 9000) {
      return {
        phase: 'sunset_approaching',
        timeOfDay,
        canTravelFar: false,
        shouldSleep: false,
        shouldReturnHome: true,
        advice: 'ใกล้ค่ำแล้ว! ห้ามออกสำรวจระยะไกล รีบกลับแคมป์ HomeBase และเคลียร์ของ',
      };
    }

    if (timeOfDay < 6000) {
      return {
        phase: 'morning',
        timeOfDay,
        canTravelFar: true,
        shouldSleep: false,
        shouldReturnHome: false,
        advice: 'ช่วงเช้าตรู่-เที่ยง ปลอดภัยสำหรับการออกสำรวจ ฟาร์ม หรือลงเหมือง',
      };
    }

    return {
      phase: 'afternoon',
      timeOfDay,
      canTravelFar: true,
      shouldSleep: false,
      shouldReturnHome: false,
      advice: 'ช่วงบ่าย ทำภารกิจใกล้เคียงและเตรียมตัวก่อนแดดร่มลมตก',
    };
  }
}

module.exports = {
  SituationEvaluator,
};
