/**
 * Unit Test for Tool Lifecycle, Tool Guard, and Depletion Alerting.
 */

const { logger } = require('../src/bot/logger');
const { DriverAdapter } = require('../src/driver/adapter');
const { GameWatchdog } = require('../src/bot/watchdog');
const { SafeDSL } = require('../src/coder/dsl');
const { AutonomousEngine } = require('../src/bot/autonomous_engine');
const { Vec3 } = require('vec3');

async function runToolLifecycleTest() {
  logger.info('🧪 Running Tool Lifecycle & Durability Guard Test...', 'TestToolLifecycle');

  // 1. Mock Inventory without Pickaxe
  let mockInventory = [
    { name: 'cobblestone', count: 4, type: 4 },
    { name: 'stick', count: 2, type: 280 },
    { name: 'torch', count: 16, type: 50 },
  ];

  const mockBot = {
    entity: { position: new Vec3(0, 60, 0), isValid: true },
    inventory: {
      items: () => mockInventory,
      emptySlotCount: () => 30,
    },
    blockAt: (pos) => ({
      name: 'stone',
      position: pos,
      boundingBox: 'block',
      diggable: true,
      hardness: 1.5,
      material: 'rock',
      digTime: () => 7800, // 7.8s bare-hand punch
    }),
    canSeeBlock: () => true,
    clearControlStates: () => {},
    lookAt: async () => {},
    findBlocks: () => [],
    equip: async (item, dest) => {
      logger.info(`[MockBot] Equipping ${item.name} to ${dest}`, 'MockBot');
    },
    dig: async (block) => {
      logger.info(`[MockBot] Digging block ${block.name}`, 'MockBot');
    },
    stopDigging: () => {},
    on: () => {},
    recipesAll: (itemId) => [{
      result: { id: itemId, count: 1 },
      delta: [
        { id: 'cobblestone', count: -3 },
        { id: 'stick', count: -2 },
      ],
      requiresTable: false,
    }],
    recipesFor: (itemId) => [{
      result: { id: itemId, count: 1 },
      delta: [
        { id: 'cobblestone', count: -3 },
        { id: 'stick', count: -2 },
      ],
      requiresTable: false,
    }],
    craft: async () => {
      mockInventory = mockInventory.filter(i => i.name !== 'cobblestone' && i.name !== 'stick');
      mockInventory.push({
        name: 'stone_pickaxe',
        count: 1,
        maxDurability: 131,
        durabilityUsed: 0,
      });
      logger.info('[MockBot] Crafted stone_pickaxe successfully!', 'MockBot');
    },
  };

  const { RegistryResolver } = require('../src/driver/registry_resolver');
  const resolver = new RegistryResolver('1.20.4');

  const adapter = new DriverAdapter(mockBot, resolver);
  const watchdog = new GameWatchdog(adapter, resolver);
  const dsl = new SafeDSL(adapter, resolver, watchdog);
  const mockClient = {
    adapter,
    watchdog,
    dsl,
    getServerIdentifier: () => 'test_server',
    worldMemory: null,
  };
  const engine = new AutonomousEngine(mockClient);
  mockClient.autonomousEngine = engine;
  adapter.botClient = mockClient;

  // Test 1: Hard Pickaxe Guard throws ToolDepleted when trying to dig stone with no pickaxe
  logger.info('Test 1: Verifying Hard Tool Guard throws ToolDepleted for stone without pickaxe...', 'TestToolLifecycle');
  let threwToolDepleted = false;
  try {
    const stoneBlock = mockBot.blockAt(new Vec3(0, 60, 1));
    await adapter.digBlock(stoneBlock);
  } catch (err) {
    if (err.message && err.message.includes('ToolDepleted')) {
      threwToolDepleted = true;
      logger.info(`✅ Successfully intercepted with ToolDepleted: ${err.message}`, 'TestToolLifecycle');
    }
  }
  if (!threwToolDepleted) {
    throw new Error('Hard tool guard failed: Adapter did not throw ToolDepleted when digging stone without pickaxe!');
  }

  // Test 2: SafeDSL handles ToolDepleted and auto-crafts stone pickaxe from cobble + sticks
  logger.info('Test 2: Verifying SafeDSL Reflex Auto-Crafting...', 'TestToolLifecycle');
  const stoneBlock2 = mockBot.blockAt(new Vec3(0, 60, 1));
  const digSuccess = await dsl.safeDigBlock(stoneBlock2);
  if (!digSuccess) {
    throw new Error('SafeDSL auto-crafting reflex failed to craft and dig!');
  }
  logger.info(`✅ SafeDSL reflex auto-crafted pickaxe and successfully completed dig!`, 'TestToolLifecycle');

  // Test 3: Deplete pickaxe again and verify preemption & alert when no materials remain
  logger.info('Test 3: Verifying preemption & alert when tool is depleted and no materials remain...', 'TestToolLifecycle');
  mockInventory = mockInventory.filter(i => !i.name.includes('pickaxe')); // remove crafted pickaxe
  const stoneBlock3 = mockBot.blockAt(new Vec3(0, 60, 2));
  const digFailResult = await dsl.safeDigBlock(stoneBlock3);
  if (digFailResult !== false) {
    throw new Error('SafeDSL should have returned false when no pickaxe and no materials!');
  }

  const perception = engine._buildPerceptionSnapshot();
  if (!perception.status.critical_tool_alert) {
    throw new Error('AutonomousEngine perception snapshot missing critical_tool_alert!');
  }
  logger.info(`✅ Perception Snapshot received critical tool alert: "${perception.status.critical_tool_alert}"`, 'TestToolLifecycle');
  logger.info(`✅ Tools Status: ${JSON.stringify(perception.status.tools_status.pickaxe)}`, 'TestToolLifecycle');

  logger.info('🎉 ALL TOOL LIFECYCLE TESTS PASSED 100%!', 'TestToolLifecycle');
}

runToolLifecycleTest().catch(err => {
  logger.error(`❌ Test failed: ${err.message}\n${err.stack}`, 'TestToolLifecycle');
  process.exit(1);
});
