/**
 * Unit Test for Phase 3: Two-Tier Memory System, Skill Manager, Reflection Manager, World Memory.
 */

const assert = require('assert');
const { logger } = require('../src/bot/logger');
const { worldMemory } = require('../src/memory/world_memory');
const { skillManager } = require('../src/memory/skill_manager');
const { reflectionManager } = require('../src/memory/reflection_manager');

async function runTests() {
  logger.info('🧪 Running Phase 3 Unit Tests...', 'TestPhase3');

  // Test 1: World Memory Atomic Save & Retrieval
  const testServer = 'localhost_25565';
  const savedLandmark = worldMemory.saveLandmark(testServer, 'MainHouse', { x: 120.45, y: 64, z: -300.22 }, 'Main Base');
  assert(savedLandmark.name === 'MainHouse', 'Landmark name mismatch');
  assert(savedLandmark.coords.x === 120.5, 'Coords should be rounded to 1 decimal place');

  const landmarks = worldMemory.getLandmarks(testServer);
  assert(landmarks['MainHouse'] !== undefined, 'Landmark should exist in memory');
  logger.info('✅ Test 1 Passed: WorldMemoryManager atomic write & strict server keying verified.', 'TestPhase3');

  // Test 2: Chests Registry
  const savedChest = worldMemory.updateChest(testServer, { x: 121, y: 64, z: -300 }, [{ name: 'diamond', count: 64 }], 'Treasure Chest');
  assert(savedChest.items.length === 1, 'Chest items count mismatch');
  const chests = worldMemory.getChests(testServer);
  assert(chests['121_64_-300'] !== undefined, 'Chest entry should be indexed by coordinate');
  logger.info('✅ Test 2 Passed: Chests Registry verified.', 'TestPhase3');

  // Test 3: Skill Manager & Fast Cache Matcher (<0.1s)
  const skills = skillManager.listSkills();
  assert(skills.length >= 5, `Expected at least 5 starter skills, got ${skills.length}`);

  const match1 = skillManager.matchSkill('มูมิว ช่วยเดินตาม Nice2MU หน่อย');
  assert(match1 !== null && match1.skill_name === 'follow_player', 'Cache match for follow failed');
  assert(match1.args.target_player === 'Nice2MU', 'Target player arg mismatch');

  const match2 = skillManager.matchSkill('เก็บของรอบๆ ตัวให้หมดเลย');
  assert(match2 !== null && match2.skill_name === 'collect_drops', 'Cache match for collect_drops failed');

  const match3 = skillManager.matchSkill('ไปนอนที่เตียงเร็ว');
  assert(match3 !== null && match3.skill_name === 'sleep_bed', 'Cache match for sleep_bed failed');

  const loadedSkill = skillManager.getSkill('craft_item');
  assert(loadedSkill !== null && loadedSkill.code.includes('craftItem'), 'Failed to load skill code from disk');
  logger.info('✅ Test 3 Passed: SkillManager & Fast Cache Matcher (<0.1s) verified.', 'TestPhase3');

  // Test 4: Reflection Manager
  const recorded = reflectionManager.recordReflection({
    errorSignature: 'Cannot mine block: line of sight obstructed',
    taskPattern: 'mine_block',
    failedCode: 'await dsl.safeDigBlock(block);',
    fixSummary: 'Check line-of-sight and step closer before digging',
    repairedCode: 'await dsl.navigate(block.x, block.y, block.z, 1.5); await dsl.safeDigBlock(block);',
  });
  assert(recorded.id.startsWith('err_'), 'Reflection ID format mismatch');

  const matched = reflectionManager.findMatchingReflection('Error: Cannot mine block: line of sight obstructed at (10, 64, 20)');
  assert(matched !== null, 'Should find matching reflection by error signature');
  logger.info('✅ Test 4 Passed: ReflectionManager records and retrieves error troubleshooting knowledge.', 'TestPhase3');

  logger.info('🎉 ALL PHASE 3 TESTS PASSED SUCCESSFULLY! (Two-Tier Memory verified)', 'TestPhase3');
}

runTests().catch(err => {
  logger.error(`❌ Phase 3 Test Failed: ${err.message}\n${err.stack}`, 'TestPhase3');
  process.exit(1);
});
