/**
 * Self-Healing Error Debugger for Agent 2.
 * Catches runtime exceptions and performs 1-Shot Automatic Code Repair via qwen2.5-coder:3b.
 */

const axios = require('axios');
const { config } = require('../config/loader');
const { logger } = require('../bot/logger');
const { sandbox } = require('./sandbox');
const { SYSTEM_PROMPT } = require('./agent');

class SelfHealingDebugger {
  constructor(customConfig = null) {
    this.cfg = customConfig || config.aiprovider.ollama;
    this.baseUrl = this.cfg.base_url || 'http://127.0.0.1:11434';
    this.model = this.cfg.model || 'qwen2.5-coder:3b';
    this.numCtx = this.cfg.num_ctx || 16384;
    this.temperature = 0.1; // Slightly lower temperature for deterministic repair
    this.timeoutMs = this.cfg.timeout_ms || 25000;
  }

  /**
   * Attempts 1-Shot repair and re-execution of failed code.
   */
  async repairAndExecute({ failedCode, error, taskDescription, worldState, dsl, args = {} }) {
    logger.warn(`🔧 Initiating 1-Shot Self-Healing Debugger for error: "${error.message}"`, 'Debugger');

    const debugPrompt = `${SYSTEM_PROMPT}

The previous JavaScript code failed with a runtime exception during execution in Minecraft.

Task: ${taskDescription}
Arguments: ${JSON.stringify(args)}

Failed Code:
\`\`\`javascript
${failedCode}
\`\`\`

Runtime Error Message:
${error.message}

Current World State:
- Position: (${worldState.position.x}, ${worldState.position.y}, ${worldState.position.z})
- Health: ${worldState.health}/20, Food: ${worldState.food}/20
- Inventory: ${JSON.stringify(worldState.inventory || [])}
- Nearby Blocks: ${JSON.stringify(worldState.nearby_blocks || {})}

Analyze the error reason and write the corrected JavaScript code to complete the task safely:`;

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/generate`,
        {
          model: this.model,
          prompt: debugPrompt,
          stream: false,
          options: {
            num_ctx: this.numCtx,
            temperature: this.temperature,
            stop: ['```\n\n', '</code>'],
          },
        },
        { timeout: this.timeoutMs }
      );

      const repairedRawCode = response.data?.response || '';
      logger.info('⚡ Self-Healing Debugger generated repaired code. Testing in Sandbox...', 'Debugger');

      const executionResult = await sandbox.execute(repairedRawCode, {
        dsl,
        world: worldState,
        args,
      });

      return {
        success: true,
        healed: true,
        result: executionResult.result,
        original_error: error.message,
        repaired_code: executionResult.executed_code,
      };
    } catch (healError) {
      logger.error(`Self-Healing repair attempt failed: ${healError.message}`, 'Debugger');
      throw new Error(`Execution failed and could not be self-healed: ${healError.message} (Original: ${error.message})`);
    }
  }
}

const debuggerInstance = new SelfHealingDebugger();

module.exports = {
  SelfHealingDebugger,
  debuggerInstance,
};
