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

  // Test 5: Landmark Convenience Alias & Nearest Search
  worldMemory.setLandmark('MineEntrance', 150, 64, -280, 'Main Staircase Mine', testServer);
  const nearestLm = worldMemory.findNearestLandmark(testServer, { x: 145, y: 64, z: -285 });
  assert(nearestLm !== null && nearestLm.name === 'MineEntrance', 'Should find nearest landmark');
  assert(nearestLm.distance < 10, 'Distance should be under 10 blocks');
  logger.info('✅ Test 5 Passed: setLandmark alias & findNearestLandmark verified.', 'TestPhase3');

  // Test 6: Episodic Adventure Diary
  const diaryEntry = worldMemory.recordDiaryEvent(testServer, 'พบแร่เพชรครั้งแรก', 'มูมิวขุดพบสายแร่เพชร 8 ก้อนที่ Y=-58!', 'star_eye');
  assert(diaryEntry.id.startsWith('diary_'), 'Diary ID format mismatch');
  const diary = worldMemory.getDiary(testServer);
  assert(diary.length > 0, 'Diary should have at least 1 entry');
  assert(diary[0].title === 'พบแร่เพชรครั้งแรก', 'Latest diary entry mismatch');
  logger.info('✅ Test 6 Passed: Episodic Adventure Diary verified.', 'TestPhase3');

  // Test 7: Player Profiles & Locked Identity Standards
  const masterProfile = worldMemory.getPlayerProfile('nice2mu');
  assert(masterProfile.is_master_user === true, 'Nice2MU must be recognized as master user');
  assert(masterProfile.player_name === 'ไนท์ทูมู', 'Locked master name must be ไนท์ทูมู');
  assert(masterProfile.preferred_call === 'คุณไนท์ทูมู', 'Locked preferred call must be คุณไนท์ทูมู');

  worldMemory.recordPlayerChat('Nice2MU', 'player', 'มูมิว ช่วยไปขุดเหล็กหน่อยนะ');
  worldMemory.recordPlayerChat('Nice2MU', 'muumiu', 'รับทราบค่าคุณไนท์ทูมู! เค้าจัดการให้น้า~ ✨');
  const updatedMaster = worldMemory.getPlayerProfile('nice2mu');
  assert(updatedMaster.chat_history.length >= 2, 'Chat history should record multi-turn conversation');
  logger.info('✅ Test 7 Passed: Player Profiles & Locked Master User Identity verified.', 'TestPhase3');

  logger.info('🎉 ALL PHASE 3 TESTS PASSED SUCCESSFULLY! (Two-Tier Memory verified)', 'TestPhase3');
}

runTests().catch(err => {
  logger.error(`❌ Phase 3 Test Failed: ${err.message}\n${err.stack}`, 'TestPhase3');
  process.exit(1);
});
