const assert = require('assert');
const { Vec3 } = require('vec3');
const { DriverAdapter } = require('../src/driver/adapter');

async function runReachTests() {
  console.log('🧪 Running Human Reach Distance Unit Tests...');

  // Mock bot entity
  const mockBot = {
    entity: {
      position: new Vec3(10, 64, 10),
      height: 1.62,
    },
    blockAt: (pos) => {
      return {
        name: 'stone',
        diggable: true,
        position: new Vec3(pos.x, pos.y, pos.z)
      };
    },
    _pathfinderLoaded: true,
    pathfinder: {
      isMoving: () => false,
      stop: () => {},
      goto: async () => true,
    },
    _goals: {
      GoalNear: class { constructor(x, y, z, range) { this.x = x; this.y = y; this.z = z; this.range = range; } },
      GoalNearXZ: class { constructor(x, z, range) { this.x = x; this.z = z; this.range = range; } },
    },
    clearControlStates: () => {},
    lookAt: async () => {},
    heldItem: { name: 'iron_pickaxe' },
    inventory: {
      items: () => [{ name: 'iron_pickaxe' }],
      slots: [],
    },
    digTime: () => 100,
    dig: async () => {},
  };

  const adapter = new DriverAdapter(mockBot);

  // Test 1: eyeDistanceTo accuracy
  // Bot standing at (10, 64, 10), eyes at (10, 65.62, 10)
  // Block at (13, 65, 10) -> center is (13.5, 65.5, 10.5)
  // dx = 3.5, dy = -0.12, dz = 0.5
  // dist = sqrt(3.5^2 + 0.12^2 + 0.5^2) = sqrt(12.25 + 0.0144 + 0.25) = sqrt(12.5144) = ~3.537m
  const blockPos3m = new Vec3(13, 65, 10);
  const eyeDist3m = adapter.eyeDistanceTo(blockPos3m);
  assert(Math.abs(eyeDist3m - 3.537) < 0.05, `eyeDistanceTo should be ~3.54m, got: ${eyeDist3m}`);
  console.log(`✅ Test 1 Passed: eyeDistanceTo correctly measures 3D distance from eyes to block center (${eyeDist3m.toFixed(2)}m)`);

  // Test 2: Block at 4 blocks away horizontally: (14, 65, 10)
  // center is (14.5, 65.5, 10.5), dx = 4.5, dy = -0.12, dz = 0.5
  // dist = sqrt(4.5^2 + 0.0144 + 0.25) = sqrt(20.25 + 0.2644) = ~4.53m
  const blockPos4m = new Vec3(14, 65, 10);
  const eyeDist4m = adapter.eyeDistanceTo(blockPos4m);
  assert(eyeDist4m <= 4.6, `Block at depth 4 should be within 4.6m, got: ${eyeDist4m}`);
  console.log(`✅ Test 2 Passed: 4-block horizontal distance is within human reach (${eyeDist4m.toFixed(2)}m <= 4.6m)`);

  // Test 3: Verify digBlock does NOT trigger unnecessary goto if block is within 4.2m
  let gotoCalled = false;
  adapter.goto = async () => {
    gotoCalled = true;
    return true;
  };

  await adapter.digBlock(mockBot.blockAt(blockPos3m));
  assert(!gotoCalled, 'digBlock should NOT approach if block is already within 4.2m reach!');
  console.log('✅ Test 3 Passed: digBlock stays standing in place if target is within natural 4.2m arm reach!');

  // Test 4: Verify digBlock DOES approach if block is far (>4.2m)
  const farBlock = new Vec3(20, 65, 10);
  await adapter.digBlock(mockBot.blockAt(farBlock));
  assert(gotoCalled, 'digBlock should approach if target is far away (>4.2m)!');
  console.log('✅ Test 4 Passed: digBlock approaches target when beyond natural 4.2m arm reach');

  console.log('🎉 ALL REACH DISTANCE TESTS PASSED 100%!');
}

runReachTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
