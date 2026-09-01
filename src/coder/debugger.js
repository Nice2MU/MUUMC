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
    this.aiproviderCfg = config.aiprovider || {};
    this.activeProvider = this.aiproviderCfg.active_provider || 'ollama';
    this.cfg = customConfig || (this.activeProvider === 'openrouter' ? this.aiproviderCfg.openrouter : this.aiproviderCfg.ollama);
    this.baseUrl = this.cfg.base_url || (this.activeProvider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'http://127.0.0.1:11434');
    this.model = this.cfg.model || (this.activeProvider === 'openrouter' ? 'minimax/minimax-m3:free' : 'qwen2.5-coder:3b');
    this.apiKey = this.cfg.api_key || '';
    this.numCtx = this.cfg.num_ctx || 16384;
    this.temperature = 0.1; // Slightly lower temperature for deterministic repair
    this.timeoutMs = this.cfg.timeout_ms || 60000;
  }

  /**
   * Attempts 1-Shot repair and re-execution of failed code.
   */
  async repairAndExecute({ failedCode, error, taskDescription, worldState, dsl, args = {} }) {
    logger.warn(`🔧 Initiating 1-Shot Self-Healing Debugger for error: "${error.message}" (${this.activeProvider})`, 'Debugger');

    const userDebugPrompt = `The previous JavaScript code failed with a runtime exception during execution in Minecraft.

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

Analyze the error reason and write ONLY the corrected executable Safe DSL JavaScript code:`;

    try {
      let repairedRawCode = '';

      if (this.activeProvider === 'openrouter') {
        const response = await axios.post(
          `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`,
          {
            model: this.model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userDebugPrompt },
            ],
            temperature: this.temperature,
            max_tokens: 400,
          },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'HTTP-Referer': 'https://github.com/Nice2MU/MuumiuLLM',
              'X-Title': 'MuumiuLLM Self-Healing Debugger',
              'Content-Type': 'application/json',
            },
            timeout: this.timeoutMs,
          }
        );
        repairedRawCode = response.data?.choices?.[0]?.message?.content || '';
      } else {
        const fullPrompt = `${SYSTEM_PROMPT}\n\n${userDebugPrompt}`;
        const response = await axios.post(
          `${this.baseUrl}/api/generate`,
          {
            model: this.model,
            prompt: fullPrompt,
            stream: false,
            options: {
              num_ctx: this.numCtx,
              temperature: this.temperature,
              stop: ['```\n\n', '</code>'],
            },
          },
          { timeout: this.timeoutMs }
        );
        repairedRawCode = response.data?.response || '';
      }

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
