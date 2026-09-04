/**
 * Unit Test for Ore Mining Tool Tier Guard (Gold/Diamond requires Iron Pickaxe).
 */

const { logger } = require('../src/bot/logger');
const { DriverAdapter } = require('../src/driver/adapter');
const { RegistryResolver } = require('../src/driver/registry_resolver');
const { GameWatchdog } = require('../src/bot/watchdog');
const { SafeDSL } = require('../src/coder/dsl');
const { AutonomousEngine } = require('../src/bot/autonomous_engine');
const { Vec3 } = require('vec3');

async function runOreTierGuardTest() {
  logger.info('🧪 Running Ore Tool Tier Guard Test (Gold/Diamond vs Stone/Iron Pickaxe)...', 'TestOreTierGuard');

  const resolver = new RegistryResolver('1.20.4');

  // 1. Mock Inventory with only Stone Pickaxe (Tier 3)
  let mockInventory = [
    { name: 'stone_pickaxe', count: 1, type: resolver.getItemByName('stone_pickaxe').id, maxDurability: 131, durabilityUsed: 10 },
    { name: 'torch', count: 16, type: 50 },
  ];

  let blockDug = false;
  const mockBot = {
    entity: { position: new Vec3(0, 60, 0), isValid: true },
    inventory: {
      items: () => mockInventory,
      emptySlotCount: () => 30,
    },
    blockAt: (pos) => ({
      name: 'gold_ore',
      type: resolver.getBlockByName('gold_ore').id,
      position: pos,
      boundingBox: 'block',
      diggable: true,
      hardness: 3.0,
      material: 'rock',
      digTime: () => 1200,
    }),
    canSeeBlock: () => true,
    clearControlStates: () => {},
    lookAt: async () => {},
    findBlocks: () => [],
    equip: async (item, dest) => {
      mockBot.heldItem = item;
    },
    dig: async (block) => {
      blockDug = true;
      logger.info(`[MockBot] Digging block ${block.name}`, 'MockBot');
    },
    stopDigging: () => {},
    on: () => {},
  };

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

  // Test 1: RegistryResolver identifies minimum tool requirements correctly
  logger.info('Test 1: Verifying RegistryResolver identifies minimum tools...', 'TestOreTierGuard');
  const goldMinTool = resolver.getMinimumToolRequired('gold_ore');
  const diamondMinTool = resolver.getMinimumToolRequired('diamond_ore');
  const ironMinTool = resolver.getMinimumToolRequired('iron_ore');
  const coalMinTool = resolver.getMinimumToolRequired('coal_ore');

  if (goldMinTool !== 'iron_pickaxe' || diamondMinTool !== 'iron_pickaxe') {
    throw new Error(`RegistryResolver failed: gold=${goldMinTool}, diamond=${diamondMinTool} (expected iron_pickaxe)`);
  }
  if (ironMinTool !== 'stone_pickaxe') {
    throw new Error(`RegistryResolver failed: iron=${ironMinTool} (expected stone_pickaxe)`);
  }
  if (coalMinTool !== 'wooden_pickaxe') {
    throw new Error(`RegistryResolver failed: coal=${coalMinTool} (expected wooden_pickaxe)`);
  }
  logger.info(`✅ RegistryResolver correctly resolved: gold -> ${goldMinTool}, diamond -> ${diamondMinTool}, iron -> ${ironMinTool}, coal -> ${coalMinTool}`, 'TestOreTierGuard');

  // Test 2: Watchdog reports harvest capabilities & locked ores
  logger.info('Test 2: Verifying Watchdog tier capabilities...', 'TestOreTierGuard');
  const pickStatus = watchdog.getToolStatus('pickaxe');
  if (pickStatus.tier !== 'stone') {
    throw new Error(`Watchdog tier expected 'stone', got '${pickStatus.tier}'`);
  }
  if (!pickStatus.harvestable_ores.includes('iron') || pickStatus.harvestable_ores.includes('gold')) {
    throw new Error(`Watchdog harvestable_ores incorrect for stone pickaxe: ${JSON.stringify(pickStatus.harvestable_ores)}`);
  }
  logger.info(`✅ Watchdog for Stone Pickaxe: harvestable=[${pickStatus.harvestable_ores.join(', ')}], locked=[${pickStatus.locked_ores.join(', ')}]`, 'TestOreTierGuard');

  // Test 3: Attempting to dig gold_ore with Stone Pickaxe throws ToolTierInsufficient
  logger.info('Test 3: Attempting to dig gold_ore with Stone Pickaxe...', 'TestOreTierGuard');
  let threwInsufficient = false;
  try {
    const goldBlock = mockBot.blockAt(new Vec3(0, 60, 1));
    await adapter.digBlock(goldBlock);
  } catch (e) {
    if (e.message && e.message.includes('ToolTierInsufficient')) {
      threwInsufficient = true;
      logger.info(`✅ Intercepted with ToolTierInsufficient: ${e.message}`, 'TestOreTierGuard');
    }
  }
  if (!threwInsufficient) {
    throw new Error('Adapter failed: Did not throw ToolTierInsufficient when mining gold_ore with Stone Pickaxe!');
  }
  if (blockDug) {
    throw new Error('Adapter failed: MockBot.dig was called on gold_ore with Stone Pickaxe!');
  }

  // Test 4: SafeDSL handles ToolTierInsufficient and notifies AutonomousEngine
  logger.info('Test 4: SafeDSL handling ToolTierInsufficient...', 'TestOreTierGuard');
  const goldBlock2 = mockBot.blockAt(new Vec3(0, 60, 1));
  const result = await dsl.safeDigBlock(goldBlock2);
  if (result !== false) {
    throw new Error('SafeDSL should have returned false for gold_ore with stone pickaxe!');
  }
  const snapshot = engine._buildPerceptionSnapshot();
  if (!snapshot.status.critical_tool_alert || !snapshot.status.critical_tool_alert.includes('gold_ore')) {
    throw new Error(`AutonomousEngine perception snapshot missing gold_ore alert: ${snapshot.status.critical_tool_alert}`);
  }
  logger.info(`✅ Perception Snapshot received critical alert: "${snapshot.status.critical_tool_alert}"`, 'TestOreTierGuard');

  // Test 5: Upgrade inventory with Iron Pickaxe and verify digging gold_ore is now permitted
  logger.info('Test 5: Upgrading to Iron Pickaxe...', 'TestOreTierGuard');
  mockInventory.push({
    name: 'iron_pickaxe',
    count: 1,
    type: resolver.getItemByName('iron_pickaxe').id,
    maxDurability: 250,
    durabilityUsed: 0,
  });

  const goldBlock3 = mockBot.blockAt(new Vec3(0, 60, 1));
  const digSuccess = await dsl.safeDigBlock(goldBlock3);
  if (!digSuccess) {
    throw new Error('SafeDSL should have succeeded digging gold_ore with Iron Pickaxe!');
  }
  logger.info('✅ Successfully mined gold_ore with Iron Pickaxe!', 'TestOreTierGuard');

  logger.info('🎉 ALL ORE TOOL TIER GUARD TESTS PASSED 100%!', 'TestOreTierGuard');
}

runOreTierGuardTest().catch(err => {
  logger.error(`❌ Test failed: ${err.message}\n${err.stack}`, 'TestOreTierGuard');
  process.exit(1);
});
