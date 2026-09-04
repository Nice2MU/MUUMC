/**
 * Real-time Game State Scanner for muu-mc.
 * Extracts structured telemetry (coords, HP, food, inventory, nearby blocks & entities).
 */

const { Vec3 } = require('vec3');

class GameStateScanner {
  constructor(adapter, resolver, watchdog) {
    this.adapter = adapter;
    this.resolver = resolver;
    this.watchdog = watchdog;
  }

  getBotStatus(detailLevel = 'summary') {
    const pos = this.adapter.getPosition();
    const hp = this.adapter.getHealth();
    const food = this.adapter.getFood();
    const bot = this.adapter.rawBot;

    const baseState = {
      is_ready: this.adapter.isReady(),
      position: {
        x: Math.round(pos.x * 10) / 10,
        y: Math.round(pos.y * 10) / 10,
        z: Math.round(pos.z * 10) / 10,
      },
      health: hp,
      food: food,
      is_dead: this.adapter.isDead(),
      is_sleeping: bot?.isSleeping || false,
      is_raining: bot?.isRaining || false,
      time_of_day: bot?.time?.timeOfDay || 0,
      is_night: bot?.time?.isNight || false,
      current_activity: this.getRealtimeActivity(),
    };

    if (detailLevel === 'inventory_only' || detailLevel === 'full') {
      baseState.inventory = this.adapter.getInventory();
      baseState.free_slots = this.watchdog.getFreeSlots();
      baseState.held_item = this.adapter.getHeldItem()?.name || null;
    }

    if (detailLevel === 'nearby_blocks' || detailLevel === 'full') {
      baseState.nearby_blocks = this._scanNearbyBlocks();
      baseState.nearby_entities = this._scanNearbyEntities();
    }

    return baseState;
  }

  _scanNearbyBlocks(radius = 24, maxDistanceY = 6) {
    const interestingTypes = [
      'crafting_table',
      'chest',
      'furnace',
      'oak_log',
      'birch_log',
      'spruce_log',
      'iron_ore',
      'coal_ore',
      'diamond_ore',
      'gold_ore',
      'white_bed',
      'red_bed',
    ];

    const results = {};
    for (const name of interestingTypes) {
      const blocks = this.adapter.findBlocks({ matching: name, maxDistance: radius, maxDistanceY, count: 5 });
      if (blocks.length > 0) {
        results[name] = blocks.map(b => ({ x: b.x, y: b.y, z: b.z }));
      }
    }
    return results;
  }

  _scanNearbyEntities(maxDistance = 16, maxDistanceY = 6) {
    if (!this.adapter.rawBot || !this.adapter.rawBot.entities) return [];
    const bot = this.adapter.rawBot;
    const currentPos = this.adapter.getPosition();
    const entities = [];

    for (const id in bot.entities) {
      const e = bot.entities[id];
      if (!e || e === bot.entity || !e.position) continue;
      const dist = this.adapter.distanceTo(e.position);
      const dy = Math.abs(e.position.y - currentPos.y);
      if (dist <= maxDistance && dy <= maxDistanceY) {
        entities.push({
          id: e.id,
          name: e.name || e.username || 'unknown',
          type: e.type,
          distance: Math.round(dist * 10) / 10,
          position: {
            x: Math.round(e.position.x * 10) / 10,
            y: Math.round(e.position.y * 10) / 10,
            z: Math.round(e.position.z * 10) / 10,
          },
        });
      }
    }
    entities.sort((a, b) => a.distance - b.distance);
    return entities.slice(0, 15);
  }

  /**
   * Evaluates the bot's TRUE physical real-time activity in the Minecraft world.
   * Grounded directly in Mineflayer physical states, not theoretical planning loops.
   */
  getRealtimeActivity() {
    const rawBot = this.adapter?.rawBot;
    if (!rawBot) return 'กำลังยืนพัก';

    const pos = this.adapter.getPosition();
    const isUnderground = pos.y < 55;

    // 1. Physically swinging tool to dig a block right now
    const digBlock = rawBot.targetDigBlock;
    if (digBlock && digBlock.name) {
      const bName = digBlock.name.toLowerCase();
      if (bName.includes('log') || bName.includes('wood') || bName.includes('stem')) return 'กำลังตัดไม้';
      if (bName.includes('diamond')) return 'กำลังขุดแร่เพชร';
      if (bName.includes('iron')) return 'กำลังขุดแร่เหล็ก';
      if (bName.includes('coal')) return 'กำลังขุดแร่ถ่าน';
      if (bName.includes('gold')) return 'กำลังขุดแร่ทอง';
      if (bName.includes('redstone') || bName.includes('lapis') || bName.includes('copper')) return 'กำลังขุดแร่';
      if (bName.includes('diorite') || bName.includes('granite') || bName.includes('andesite') || bName.includes('tuff')) return 'กำลังขุดหินในเหมือง';
      if (bName.includes('deepslate') || bName.includes('stone') || bName.includes('cobblestone')) return 'กำลังขุดหินทำทาง/หาแร่';
      if (bName.includes('dirt') || bName.includes('gravel') || bName.includes('sand')) return 'กำลังขุดดิน/เคลียร์ทาง';
      return `กำลังขุดบล็อก ${bName}`;
    }

    // 2. Eating food
    if (rawBot.entity?.isEating) return 'กำลังกินอาหาร';

    // 3. Combat
    if (this.adapter.isInCombat && this.adapter.isInCombat()) return 'กำลังต่อสู้กับมอนสเตอร์';

    // 4. Actively pathfinding/walking
    if (rawBot.pathfinder?.isMoving()) {
      if (isUnderground) return 'กำลังเดินสำรวจในเหมืองใต้ดิน';
      return 'กำลังเดินสำรวจรอบๆ';
    }

    // 5. Standing underground vs surface
    if (isUnderground) {
      return 'กำลังลงเหมืองหาแร่อยู่ใต้ดิน';
    }

    // 6. Surface idle / exploration
    return 'กำลังเดินสำรวจรอบๆ';
  }
}

module.exports = {
  GameStateScanner,
};
