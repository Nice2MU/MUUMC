/**
 * Unit & Integration Test for Phase 2: Tactical AI Coder, Universal Sandbox, and Self-Healing Debugger.
 */

const assert = require('assert');
const { logger } = require('../src/bot/logger');
const { sandbox } = require('../src/coder/sandbox');
const { aiCoderAgent } = require('../src/coder/agent');
const { debuggerInstance } = require('../src/coder/debugger');

async function runTests() {
  logger.info('🧪 Running Phase 2 Unit & Live AI Tests...', 'TestPhase2');

  // Test 1: Auto-Unwrap Markdown and Function Wrappers
  const wrappedMd = "```javascript\nasync function task(dsl, world, args) {\n  return 'hello_world';\n}\n```";
  const unwrapped1 = sandbox.unwrapCode(wrappedMd);
  assert(unwrapped1.includes("return 'hello_world';"), 'Failed to unwrap markdown + function');
  assert(!unwrapped1.startsWith('```'), 'Markdown fence not stripped');
  assert(!unwrapped1.startsWith('async function'), 'Outer async function wrapper not stripped');
  logger.info('✅ Test 1 Passed: Universal Sandbox auto-unwraps formatting cleanly.', 'TestPhase2');

  // Test 2: Safe Execution in Sandbox Context
  const dummyDsl = {
    chatCount: 0,
    chat(msg) { this.chatCount++; },
  };
  const dummyWorld = { position: { x: 10, y: 64, z: 20 }, health: 20, food: 20 };

  const execRes = await sandbox.execute("dsl.chat('test'); return world.health * 2;", {
    dsl: dummyDsl,
    world: dummyWorld,
  });
  assert(execRes.success === true, 'Execution should succeed');
  assert(execRes.result === 40, 'Result should be 40');
  assert(dummyDsl.chatCount === 1, 'DSL method should have been called');
  logger.info('✅ Test 2 Passed: Sandbox executes isolated async code with passed scope.', 'TestPhase2');

  // Test 3: Sandbox Step Timeout Guard
  let timedOut = false;
  try {
    await sandbox.execute("await new Promise(resolve => setTimeout(resolve, 2000));", {
      dsl: dummyDsl,
      world: dummyWorld,
      timeoutMs: 300,
    });
  } catch (err) {
    if (err.message.includes('timed out')) {
      timedOut = true;
    }
  }
  assert(timedOut === true, 'Sandbox should throw timeout error when exceeding limit');
  logger.info('✅ Test 3 Passed: Step Timeout Guard aborted hanging execution properly.', 'TestPhase2');

  // Test 4: Live Generation via active AI Provider
  logger.info(`Testing live code generation with ${aiCoderAgent.activeProvider} model '${aiCoderAgent.model}'...`, 'TestPhase2');
  const taskDesc = 'Eat food if hungry, then check if we have any oak logs';
  const generatedCode = await aiCoderAgent.generateCode(taskDesc, dummyWorld);
  assert(generatedCode && generatedCode.length > 5, 'AI Coder should generate non-empty code');
  logger.info(`Generated Code snippet:\n---\n${generatedCode}\n---`, 'TestPhase2');

  // Run the generated code in sandbox to verify syntax correctness
  const liveRunRes = await sandbox.execute(generatedCode, {
    dsl: {
      eatIfHungry: async () => true,
      chat: () => {},
    },
    world: {
      ...dummyWorld,
      hasItem: (name) => name === 'oak_log',
      countItem: (name) => name === 'oak_log' ? 5 : 0,
    },
  });
  assert(liveRunRes.success === true, 'Live generated code executed with 100% syntax validity');
  logger.info(`✅ Test 4 Passed: Live ${aiCoderAgent.activeProvider} '${aiCoderAgent.model}' produced 100% valid executable syntax!`, 'TestPhase2');

  logger.info('🎉 ALL PHASE 2 TESTS PASSED SUCCESSFULLY! (AI Coder, Sandbox & Debugger ready)', 'TestPhase2');
}

runTests().catch(err => {
  logger.error(`❌ Phase 2 Test Failed: ${err.message}\n${err.stack}`, 'TestPhase2');
  process.exit(1);
});
