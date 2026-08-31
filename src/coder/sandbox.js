/**
 * Universal Sandbox Runner for Agent 2.
 * Auto-unwraps markdown fences, function declarations, enforces Step Timeout (15s),
 * and provides safe isolated execution.
 */

const { logger } = require('../bot/logger');
const { config } = require('../config/loader');

class UniversalSandbox {
  constructor(customConfig = null) {
    this.cfg = customConfig || config.aiprovider.sandbox;
    this.stepTimeoutMs = this.cfg.step_timeout_ms || 15000;
  }

  /**
   * Cleans and auto-unwraps any formatting (markdown fences, function wrappers)
   * returning clean executable JavaScript code.
   */
  unwrapCode(rawCode) {
    if (!rawCode || typeof rawCode !== 'string') return '';
    let code = rawCode.trim();

    // 1. Strip Markdown Code Blocks
    const mdMatch = code.match(/```(?:javascript|js)?\s*([\s\S]*?)```/i);
    if (mdMatch) {
      code = mdMatch[1].trim();
    }

    // 2. Unwrap named/anonymous outer async function if whole code is wrapped in it
    // e.g. async function task(dsl, world, args) { ... } OR async function main(...) { ... }
    const funcMatch = code.match(/^\s*(?:export\s+default\s+)?async\s+function\s*(?:\w+)?\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
    if (funcMatch) {
      code = funcMatch[1].trim();
    }

    // 3. Unwrap arrow function wrapper: const task = async (...) => { ... }
    const arrowMatch = code.match(/^\s*(?:const|let|var)\s+\w+\s*=\s*async\s*\([^)]*\)\s*=>\s*\{([\s\S]*)\};?\s*$/);
    if (arrowMatch) {
      code = arrowMatch[1].trim();
    }

    // 4. Strip module.exports = ...
    code = code.replace(/^\s*module\.exports\s*=\s*/, '').trim();

    return code;
  }

  /**
   * Executes code safely in an isolated async context with Timeout & AbortController.
   */
  async execute(rawCode, { dsl, world, args = {}, timeoutMs = null }) {
    const code = this.unwrapCode(rawCode);
    const timeout = timeoutMs || this.stepTimeoutMs;

    logger.info(`🔒 Executing code in Universal Sandbox (timeout: ${timeout / 1000}s)...`, 'Sandbox');

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeout);

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

    try {
      const { Vec3 } = require('vec3');
      // Create isolated sandbox function with strict parameter scope
      const sandboxFn = new AsyncFunction('dsl', 'world', 'args', 'signal', 'Vec3', 'logger', `
        if (signal.aborted) throw new Error('Execution aborted prior to start');
        ${code}
      `);

      const executionPromise = sandboxFn(dsl, world, args, controller.signal, Vec3, logger);
      
      const timeoutPromise = new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error(`Sandbox execution timed out after ${timeout}ms`));
        });
      });

      const result = await Promise.race([executionPromise, timeoutPromise]);
      clearTimeout(timer);

      logger.info('✅ Sandbox execution completed successfully.', 'Sandbox');
      return {
        success: true,
        result: result !== undefined ? result : 'OK',
        executed_code: code,
      };
    } catch (err) {
      clearTimeout(timer);
      logger.error(`Sandbox execution error: ${err.message}`, 'Sandbox');
      throw {
        message: err.message,
        stack: err.stack,
        code: code,
        raw: rawCode,
      };
    }
  }
}

const sandbox = new UniversalSandbox();

module.exports = {
  UniversalSandbox,
  sandbox,
};
