const assert = require('assert');
const { Vec3 } = require('vec3');
const { DriverAdapter } = require('../src/driver/adapter');
const { GameStateScanner } = require('../src/bot/state');
const { RegistryResolver } = require('../src/driver/registry_resolver');
const { SafeDSL } = require('../src/coder/dsl');
const { AutonomousEngine } = require('../src/bot/autonomous_engine');

function createMockBot(botPos = new Vec3(100, 64, 200)) {
  const entities = {};
  const blocks = {};

  return {
    entity: {
      position: botPos.clone(),
    },

    entities,
    version: '1.20.4',
    findBlocks: (options) => {
      const results = [];
      const currentPos = botPos;
      for (const key in blocks) {
        const b = blocks[key];
        const dist = Math.sqrt(
          (b.position.x - currentPos.x) ** 2 +
          (b.position.y - currentPos.y) ** 2 +
          (b.position.z - currentPos.z) ** 2
        );
        if (dist > (options.maxDistance || 32)) continue;
        if (options.useExtraInfo && !options.useExtraInfo(b)) continue;

        let match = false;
        if (typeof options.matching === 'function') {
          match = options.matching(b);
        } else if (Array.isArray(options.matching)) {
          match = options.matching.includes(b.name);
        } else if (options.matching === b.name) {
          match = true;
        }

        if (match) {
          results.push(b.position);
        }
      }
      return results;
    },
    blockAt: (pos) => {
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      return blocks[key] || { name: 'air', position: pos, type: 0 };
    },
    clearControlStates: () => {},
    physics: {},
  };
}

async function runYAxisUnitTests() {
  console.log('🧪 Running Comprehensive Y-Axis Scan Clamping Unit Tests...');

  const botPos = new Vec3(100, 64, 200);
  const mockBot = createMockBot(botPos);

  const mockResolver = new RegistryResolver('1.20.4');

  const adapter = new DriverAdapter(mockBot, mockResolver);
  const stateScanner = new GameStateScanner(adapter, mockResolver, null);
  const dsl = new SafeDSL(adapter, mockResolver, null);

  // Setup Mock Entities at different Y levels
  // Bot is at Y = 64
  // Within Y limit (abs(dy) <= 6):
  // 1. Zombie at Y = 66 (dy = +2) -> should be detected
  // 2. Cow at Y = 59 (dy = -5) -> should be detected
  // 3. Dropped item at Y = 64 (dy = 0) -> should be detected
  // 4. Villager at Y = 70 (dy = +6) -> exactly boundary -> should be detected

  // Outside Y limit (abs(dy) > 6):
  // 5. Zombie at Y = 71 (dy = +7) -> should be EXCLUDED
  // 6. Skeleton at Y = 50 (dy = -14) -> should be EXCLUDED (in cave below)
  // 7. Sheep at Y = 75 (dy = +11) -> should be EXCLUDED (on cliff above)
  // 8. Dropped item at Y = 56 (dy = -8) -> should be EXCLUDED

  mockBot.entities = {
    1: { id: 1, name: 'zombie', type: 'hostile', position: new Vec3(102, 66, 200) }, // dist=2.8, dy=+2 (IN)
    2: { id: 2, name: 'cow', type: 'animal', position: new Vec3(105, 59, 200) }, // dist=7.0, dy=-5 (IN)
    3: {
      id: 3,
      name: 'item',
      displayName: 'Item',
      type: 'object',
      position: new Vec3(101, 64, 200), // dist=1.0, dy=0 (IN)
      getDroppedItem: () => ({ name: 'iron_ingot', count: 1 }),
    },
    4: { id: 4, name: 'villager', displayName: 'Villager', position: new Vec3(104, 70, 200) }, // dist=7.2, dy=+6 (IN, boundary)
    5: { id: 5, name: 'zombie', type: 'hostile', position: new Vec3(101, 71, 200) }, // dist=7.07, dy=+7 (OUT)
    6: { id: 6, name: 'skeleton', type: 'hostile', position: new Vec3(102, 50, 200) }, // dist=14.1, dy=-14 (OUT)
    7: { id: 7, name: 'sheep', type: 'animal', position: new Vec3(102, 75, 200) }, // dist=11.1, dy=+11 (OUT)
    8: {
      id: 8,
      name: 'item',
      displayName: 'Item',
      type: 'object',
      position: new Vec3(101, 56, 200), // dist=8.0, dy=-8 (OUT)
      getDroppedItem: () => ({ name: 'diamond', count: 1 }),
    },
  };

  // Test 1: findHostiles (maxDistance = 10, maxDistanceY = 6)
  const hostiles = adapter.findHostiles(10, 6);
  assert.strictEqual(hostiles.length, 1, `Expected 1 hostile within dy <= 6, found ${hostiles.length}`);
  assert.strictEqual(hostiles[0].id, 1, 'Expected zombie at Y=66 to be found');
  console.log('✅ Test 1 Passed: findHostiles correctly filtered out hostiles at Y=71 (dy=+7) and Y=50 (dy=-14)');

  // Test 2: findAnimals (maxDistance = 16, maxDistanceY = 6)
  const animals = adapter.findAnimals(16, 6);
  assert.strictEqual(animals.length, 1, `Expected 1 animal within dy <= 6, found ${animals.length}`);
  assert.strictEqual(animals[0].id, 2, 'Expected cow at Y=59 to be found');
  console.log('✅ Test 2 Passed: findAnimals correctly filtered out sheep at Y=75 (dy=+11)');

  // Test 3: findDroppedItems (maxDistance = 6, maxDistanceY = 6)
  const items = adapter.findDroppedItems(6, 6);
  assert.strictEqual(items.length, 1, `Expected 1 dropped item within dy <= 6, found ${items.length}`);
  assert.strictEqual(items[0].id, 3, 'Expected iron_ingot at Y=64 to be found');
  console.log('✅ Test 3 Passed: findDroppedItems correctly filtered out dropped item at Y=56 (dy=-8)');

  // Test 4: findVillagers (maxDistance = 16, maxDistanceY = 6)
  const villagers = adapter.findVillagers(16, 6);
  assert.strictEqual(villagers.length, 1, `Expected 1 villager within dy <= 6, found ${villagers.length}`);
  assert.strictEqual(villagers[0].id, 4, 'Expected villager at Y=70 (dy=+6 exact boundary) to be found');
  console.log('✅ Test 4 Passed: findVillagers boundary test passed (dy=+6 included)');

  // Test 5: GameStateScanner _scanNearbyEntities (maxDistance = 16, maxDistanceY = 6)
  const scannedEntities = stateScanner._scanNearbyEntities(16, 6);
  const scannedIds = scannedEntities.map(e => e.id);
  assert.deepStrictEqual(scannedIds.sort(), [1, 2, 3, 4], `Expected entities [1,2,3,4], got ${JSON.stringify(scannedIds)}`);
  console.log('✅ Test 5 Passed: GameStateScanner._scanNearbyEntities strictly includes only dy <= 6 entities');

  // Test 6: findBlocks with maxDistanceY = 6
  // Setup Mock Blocks in mockBot
  const craftingTableNear = { name: 'crafting_table', position: new Vec3(103, 67, 200) }; // dy = +3 (IN)
  const craftingTableFarY = { name: 'crafting_table', position: new Vec3(103, 72, 200) }; // dy = +8 (OUT)
  const chestNear = { name: 'chest', position: new Vec3(101, 60, 200) }; // dy = -4 (IN)
  const chestFarY = { name: 'chest', position: new Vec3(101, 40, 200) }; // dy = -24 (OUT, cave)

  mockBot.blockAt = (pos) => {
    if (pos.x === 103 && pos.y === 67) return craftingTableNear;
    if (pos.x === 103 && pos.y === 72) return craftingTableFarY;
    if (pos.x === 101 && pos.y === 60) return chestNear;
    if (pos.x === 101 && pos.y === 40) return chestFarY;
    return { name: 'stone', position: pos };
  };

  // Mock findBlocks implementation that has both near and farY blocks
  mockBot.findBlocks = (options) => {
    const list = [
      craftingTableNear.position,
      craftingTableFarY.position,
      chestNear.position,
      chestFarY.position,
    ];
    return list.filter(pos => {
      const block = mockBot.blockAt(pos);
      if (options.useExtraInfo && !options.useExtraInfo(block)) return false;
      if (typeof options.matching === 'function') return options.matching(block);
      if (Array.isArray(options.matching)) return options.matching.includes(block.name);
      return options.matching === block.name;
    });
  };

  const foundCrafting = adapter.findBlocks({ matching: 'crafting_table', maxDistance: 24, maxDistanceY: 6 });
  assert.strictEqual(foundCrafting.length, 1, `Expected 1 crafting table within dy <= 6, got ${foundCrafting.length}`);
  assert.strictEqual(foundCrafting[0].y, 67, 'Expected crafting table at Y=67');

  const foundChests = adapter.findBlocks({ matching: ['chest', 'barrel'], maxDistance: 24, maxDistanceY: 6 });
  assert.strictEqual(foundChests.length, 1, `Expected 1 chest within dy <= 6, got ${foundChests.length}`);
  assert.strictEqual(foundChests[0].y, 60, 'Expected chest at Y=60');
  console.log('✅ Test 6 Passed: adapter.findBlocks strictly excludes blocks at Y=72 (dy=+8) and Y=40 (dy=-24)');

  // Test 7: AutonomousEngine Perception Snapshot
  const mockClient = {
    adapter,
    dsl,
    rawBot: mockBot,
    stateScanner,
    getServerIdentifier: () => 'localhost_25565',
    worldMemory: { getNearestLandmark: () => null },
  };
  const engine = new AutonomousEngine(mockClient);
  const snapshot = engine._buildPerceptionSnapshot();

  assert.strictEqual(snapshot.nearby.crafting_table_nearby, true, 'crafting_table_nearby should be true');
  assert.strictEqual(snapshot.nearby.chests_nearby, true, 'chests_nearby should be true');
  assert.strictEqual(snapshot.entities.hostiles.length, 1, `Hostiles in snapshot should be 1, got ${snapshot.entities.hostiles.length}`);
  assert.strictEqual(snapshot.entities.animals.length, 1, `Animals in snapshot should be 1, got ${snapshot.entities.animals.length}`);
  console.log('✅ Test 7 Passed: AutonomousEngine._buildPerceptionSnapshot integrates dy <= 6 correctly');

  console.log('\n🎉 ALL Y-AXIS CLAMPING UNIT TESTS PASSED WITH 100% MATHEMATICAL PRECISION!\n');
}

runYAxisUnitTests().catch(err => {
  console.error('❌ Y-Axis unit test failed:', err);
  process.exit(1);
});
