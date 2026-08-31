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

  _scanNearbyBlocks(radius = 16) {
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
      const blocks = this.adapter.findBlocks({ matching: name, maxDistance: radius, count: 5 });
      if (blocks.length > 0) {
        results[name] = blocks.map(b => ({ x: b.x, y: b.y, z: b.z }));
      }
    }
    return results;
  }

  _scanNearbyEntities(maxDistance = 24) {
    if (!this.adapter.rawBot || !this.adapter.rawBot.entities) return [];
    const bot = this.adapter.rawBot;
    const entities = [];

    for (const id in bot.entities) {
      const e = bot.entities[id];
      if (!e || e === bot.entity) continue;
      const dist = this.adapter.distanceTo(e.position);
      if (dist <= maxDistance) {
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
}

module.exports = {
  GameStateScanner,
};
