/**
 * Tactical AI Coder (Agent 2) Brain.
 * Connects to Local Ollama qwen2.5-coder:3b (num_ctx: 16384, temp: 0.2).
 * Converts natural language task descriptions into executable Safe DSL JavaScript.
 */

const axios = require('axios');
const { config } = require('../config/loader');
const { logger } = require('../bot/logger');

const SYSTEM_PROMPT = `You are the Tactical AI Coder (Agent 2) for Muumiu Minecraft Companion.
Your sole job is to write safe, efficient, and robust JavaScript code to accomplish the player's task in Minecraft.

Available DSL APIs (via 'dsl' parameter):
- await dsl.navigate(x, y, z, range = 1) : Walk safely to coordinates
- await dsl.safeDigBlock(targetBlock, options) : Approach <= 2m, check tool, look at block, and dig safely
- await dsl.safePlaceBlock(referenceBlock, faceVector, itemToPlace) : Approach <= 2m, equip item, look at block, and place
- await dsl.chopTree({ count: 1 }) : Finds nearby logs, chops tree upwards, and replants sapling
- await dsl.craftItem(itemName, count = 1) : Crafts item (automatically deploys and picks up crafting table if needed)
- await dsl.defendPlayer(playerName) : Defends player from hostile mobs
- await dsl.eatIfHungry() : Eats food if hunger is below threshold
- dsl.chat(message) : Silent log for debugging (does not spam game chat)

Available World APIs (via 'world' parameter):
- world.position : { x, y, z } Current position
- world.health : Number (0-20)
- world.food : Number (0-20)
- world.inventory : Array of items [{ name, count, slot }]
- world.hasItem(name) : Boolean
- world.countItem(name) : Number
- world.findBlocks(options) : Array of Vec3 positions
- world.findEntity(options) : Entity object or null
- world.getBlockAt(pos) : Block object at coordinate

CRITICAL RULES:
1. Write ONLY clean JavaScript code. No explanations, no markdown intro.
2. Use 'await' on all async DSL and Adapter calls.
3. Check world.hasItem(...) before attempting to craft or place items.
4. Keep the code concise, direct, and deterministic.
`;

class AICoderAgent {
  constructor(customConfig = null) {
    this.cfg = customConfig || config.aiprovider.ollama;
    this.baseUrl = this.cfg.base_url || 'http://127.0.0.1:11434';
    this.model = this.cfg.model || 'qwen2.5-coder:3b';
    this.numCtx = this.cfg.num_ctx || 16384;
    this.temperature = this.cfg.temperature || 0.2;
    this.timeoutMs = this.cfg.timeout_ms || 25000;
  }

  async generateCode(taskDescription, worldState, args = {}) {
    logger.info(`🤖 Agent 2 analyzing task: "${taskDescription}" with model '${this.model}'...`, 'AICoder');

    const prompt = `${SYSTEM_PROMPT}

Current World State:
- Position: (${worldState.position.x}, ${worldState.position.y}, ${worldState.position.z})
- Health: ${worldState.health}/20, Food: ${worldState.food}/20
- Inventory: ${JSON.stringify(worldState.inventory || [])}
- Nearby Blocks: ${JSON.stringify(worldState.nearby_blocks || {})}
- Nearby Entities: ${JSON.stringify(worldState.nearby_entities || [])}

Task: ${taskDescription}
Arguments: ${JSON.stringify(args)}

Write the JavaScript code:`;

    const startTime = Date.now();
    try {
      const response = await axios.post(
        `${this.baseUrl}/api/generate`,
        {
          model: this.model,
          prompt: prompt,
          stream: false,
          options: {
            num_ctx: this.numCtx,
            temperature: this.temperature,
            stop: ['```\n\n', '</code>'],
          },
        },
        { timeout: this.timeoutMs }
      );

      const latency = ((Date.now() - startTime) / 1000).toFixed(2);
      const rawCode = response.data?.response || '';
      logger.info(`⚡ Agent 2 code generated in ${latency}s (${rawCode.length} chars)`, 'AICoder');
      return rawCode;
    } catch (e) {
      logger.error(`Ollama code generation failed: ${e.message}`, 'AICoder');
      throw new Error(`AI Coder generation error: ${e.message}`);
    }
  }
}

const aiCoderAgent = new AICoderAgent();

module.exports = {
  AICoderAgent,
  aiCoderAgent,
  SYSTEM_PROMPT,
};
