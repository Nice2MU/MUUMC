/**
 * Error Reflection Manager for Agent 2.
 * Stores and recalls troubleshooting lessons learned from runtime exceptions.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../bot/logger');

class ReflectionManager {
  constructor(dataDir = path.resolve(__dirname, '../../data')) {
    this.filePath = path.join(dataDir, 'error_reflection.json');
    this._ensureFile();
  }

  _ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      const initial = [];
      fs.writeFileSync(this.filePath, JSON.stringify(initial, null, 2), 'utf8');
    }
  }

  getReflections() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch (e) {
      logger.error(`Error reading reflections: ${e.message}`, 'ReflectionManager');
      return [];
    }
  }

  recordReflection({ errorSignature, taskPattern, failedCode, fixSummary, repairedCode }) {
    const reflections = this.getReflections();
    const entry = {
      id: `err_${Date.now()}`,
      error_signature: errorSignature,
      task_pattern: taskPattern,
      failed_code: failedCode,
      fix_summary: fixSummary,
      repaired_code: repairedCode,
      timestamp: new Date().toISOString(),
    };
    reflections.push(entry);

    // Keep last 50 reflections
    const trimmed = reflections.slice(-50);
    const tmp = `${this.filePath}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);

    logger.info(`📝 Recorded error reflection for signature: "${errorSignature.slice(0, 40)}..."`, 'ReflectionManager');
    return entry;
  }

  findMatchingReflection(errorMessage) {
    if (!errorMessage) return null;
    const reflections = this.getReflections();
    const cleanErr = errorMessage.toLowerCase();

    return reflections.find(r => cleanErr.includes(r.error_signature.toLowerCase())) || null;
  }
}

const reflectionManager = new ReflectionManager();

module.exports = {
  ReflectionManager,
  reflectionManager,
};
