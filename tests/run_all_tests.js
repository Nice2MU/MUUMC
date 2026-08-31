/**
 * Master Test Runner for muu-mc MCP Subsystem.
 * Runs all unit and integration test suites sequentially.
 */

const { spawn } = require('child_process');
const path = require('path');
const { logger } = require('../src/bot/logger');

const TEST_FILES = [
  'tests/test_phase1.js',
  'tests/test_phase2.js',
  'tests/test_phase3.js',
  'tests/test_phase5.js',
];

function runTest(testFile) {
  return new Promise((resolve, reject) => {
    const filePath = path.resolve(__dirname, '..', testFile);
    logger.info(`=======================================================`, 'TestRunner');
    logger.info(`▶️ Running Suite: ${testFile}`, 'TestRunner');
    logger.info(`=======================================================`, 'TestRunner');

    const proc = spawn('node', [filePath], { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Test ${testFile} failed with exit code ${code}`));
      }
    });
  });
}

async function runAll() {
  const startTime = Date.now();
  logger.info('🏁 Starting muu-mc Master Test Suite...', 'TestRunner');

  for (const file of TEST_FILES) {
    await runTest(file);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  logger.info('=======================================================', 'TestRunner');
  logger.info(`🏆 ALL 4 TEST SUITES PASSED 100% IN ${duration}s!`, 'TestRunner');
  logger.info('=======================================================', 'TestRunner');
}

runAll().catch((err) => {
  logger.error(`❌ Test Suite Failure: ${err.message}`, 'TestRunner');
  process.exit(1);
});
