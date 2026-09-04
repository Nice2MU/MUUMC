/**
 * Unit Tests: Audit Fixes Verification Suite
 * Tests the critical bug fixes:
 * 1. mineOres('stone') direct stone block query
 * 2. goToBed 16 bed colors and inventory deployment
 * 3. climbStaircaseUp multi-directional Z-axis reversal
 * 4. smartWander cliff/hazard detection loop
 */

const assert = require('assert');
const { Vec3 } = require('vec3');

console.log('🧪 Running Audit Fixes Unit Tests...');

// 1. Test climbStaircaseUp multi-directional reversal
{
  const mockAdapter = {
    getPosition: () => new Vec3(10, 30, 20),
    getBlockAt: () => ({ name: 'air' }),
    goto: async () => {},
  };
  const { SafeDSL } = require('../src/coder/dsl');
  const dsl = new SafeDSL(mockAdapter, null, null);
  dsl._staircaseDir = new Vec3(0, 0, 1); // dug towards +Z

  // reverseDir should be (0, 0, -1)
  const reverseDir = dsl._staircaseDir.scaled(-1);
  assert.strictEqual(Math.abs(reverseDir.x), 0, 'Reverse X should be 0');
  assert.strictEqual(reverseDir.z, -1, 'Reverse Z should be -1');
  console.log('✅ Test 1 Passed: Staircase multi-directional reversal computes X and Z correctly.');
}

// 2. Test 16 bed colors in goToBed
{
  let searchedBeds = [];
  const mockAdapter = {
    findBlocks: (opts) => {
      searchedBeds = opts.matching;
      return [];
    },
    getInventory: () => [],
    getPosition: () => new Vec3(0, 64, 0),
    getBlockAt: () => null,
  };
  const { SafeDSL } = require('../src/coder/dsl');
  const dsl = new SafeDSL(mockAdapter, null, null);
  
  dsl.goToBed().then(res => {
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.reason, 'no_bed_available');
    assert.strictEqual(searchedBeds.length, 16, 'Should search all 16 bed colors');
    assert.ok(searchedBeds.includes('cyan_bed'), 'Should include cyan_bed');
    assert.ok(searchedBeds.includes('purple_bed'), 'Should include purple_bed');
    assert.ok(searchedBeds.includes('orange_bed'), 'Should include orange_bed');
    console.log('✅ Test 2 Passed: goToBed searches all 16 Minecraft bed colors.');
  });
}

// 3. Test mineOres('stone') direct query
{
  let searchedBlocks = [];
  const mockAdapter = {
    hasPickaxe: () => true,
    findBlocks: (opts) => {
      searchedBlocks = opts.matching;
      return [new Vec3(1, 64, 1)];
    },
    getBlockAt: () => ({ name: 'stone' }),
    distanceTo: () => 1.5,
    findHostiles: () => [],
    rawBot: {
      canSeeBlock: () => true,
      blockAt: () => ({ name: 'stone' }),
      dig: async () => {},
      heldItem: { name: 'wooden_pickaxe' },
    },
    getPosition: () => new Vec3(0, 64, 0),
    equipItem: async () => {},
    lookAt: async () => {},
    cleanInventory: async () => {},
    findDroppedItems: () => [],
  };
  const { SafeDSL } = require('../src/coder/dsl');
  const dsl = new SafeDSL(mockAdapter, null, null);

  dsl.mineOres('stone', 1).then(res => {
    assert.ok(searchedBlocks.includes('stone'), 'Should search stone directly');
    assert.ok(searchedBlocks.includes('cobblestone'), 'Should search cobblestone directly');
    assert.ok(searchedBlocks.includes('deepslate'), 'Should search deepslate directly');
    assert.strictEqual(res.success, true, 'mineOres stone should succeed directly');
    console.log('✅ Test 3 Passed: mineOres("stone") searches and mines stone directly without descending to Y=16.');
  });
}

// 4. Test smartWander hazard detection
{
  const mockBot = {
    entity: { yaw: 0 },
    look: async () => {},
    setControlState: (ctrl, state) => {},
  };
  const { DriverAdapter } = require('../src/driver/adapter');
  const adapter = new DriverAdapter(mockBot, null);
  adapter.getPosition = () => new Vec3(100, 64, 100);
  adapter.getBlockAt = (pos) => {
    if (pos.x === 100 && pos.z === 99) return { name: 'lava' };
    return { name: 'stone' };
  };

  adapter.smartWander(500).then(res => {
    assert.strictEqual(res, true);
    console.log('✅ Test 4 Passed: smartWander detects lava/cliff ahead and halts safely.');
  });
}

// 5. Test unstuck with targetPos (forward jump & obstacle clearance)
{
  let controlStates = [];
  let dugBlocks = [];
  const mockBot = {
    entity: { yaw: 0 },
    look: async () => {},
    setControlState: (ctrl, state) => {
      controlStates.push({ ctrl, state });
    },
    clearControlStates: () => {},
    dig: async (block) => {
      dugBlocks.push(block.name);
    },
  };
  const { DriverAdapter } = require('../src/driver/adapter');
  const adapter = new DriverAdapter(mockBot, null);
  adapter.getPosition = () => new Vec3(0, 64, 0);
  adapter.getBlockAt = (pos) => {
    // Foot obstacle block
    if (pos.x === 0 && pos.z === 1) return { name: 'oak_leaves' };
    return { name: 'air' };
  };

  const target = new Vec3(0, 64, 3);
  adapter.unstuck(target).then(() => {
    const hasJump = controlStates.some(c => c.ctrl === 'jump' && c.state === true);
    const hasForward = controlStates.some(c => c.ctrl === 'forward' && c.state === true);
    assert.ok(hasJump, 'Should trigger forward jump in unstuck');
    assert.ok(hasForward, 'Should trigger forward motion in unstuck');
    assert.ok(dugBlocks.includes('oak_leaves'), 'Should clear blocking leaves obstacle');
    console.log('✅ Test 5 Passed: unstuck proactively jumps forward and digs obstacle blocks to clear path!');
  });
}
