/**
 * Tactical AI Coder (Agent 2) Brain.
 * Connects to Local Ollama qwen2.5-coder:3b (num_ctx: 16384, temp: 0.2).
 * Converts natural language task descriptions into executable Safe DSL JavaScript.
 */

const axios = require('axios');
const { config } = require('../config/loader');
const { logger } = require('../bot/logger');

const SYSTEM_PROMPT = `You are the Tactical AI Coder (Agent 2) for Muumiu Minecraft Companion.
Your sole job is to write safe, efficient, and robust JavaScript code to accomplish the player's or Agent 1's task in Minecraft.

Available DSL APIs (via 'dsl' parameter):
- await dsl.navigateXZ(x, z, range = 1) : Walk safely to 2D coordinates
- await dsl.safeDigBlock(targetBlock, options) : Approach <= 2m, check tool, clear obstructions, look at block, and dig safely
- await dsl.safePlaceBlock(referenceBlock, faceVector, itemToPlace) : Approach <= 2m, equip item, look at block, and place
- await dsl.chopTree({ count: 1 }) : Finds nearby logs, chops tree upwards, and replants saplings
- await dsl.craftItem(itemName, count = 1) : Crafts item (auto-deploys and picks up crafting table if needed)
- await dsl.smeltItem(itemName, count = 1) : Smelts raw ore in furnace with auto-fueling
- await dsl.mineOres(oreType, count = 1) : Finds and mines target ores safely with required tool tier
- await dsl.staircaseMineDown(targetY) : Safely digs a diagonal 1x2 staircase down to target Y level (e.g. -54)
- await dsl.goToSurface() : Navigates safely back to the surface level (Y >= 64)
- await dsl.digDown(distance = 10) : Safely digs down vertically with lava/hazard detection
- await dsl.pickupNearbyItems(maxDistance = 12) : Collects dropped items on the ground
- await dsl.avoidEnemies(distance = 16) : Evades nearby hostile monsters to a safe distance
- await dsl.tillAndSow(x, y, z, seedType) : Tills dirt with hoe and sows seeds
- await dsl.useDoor(doorPos) : Interacts with door to step through safely
- await dsl.goToBed() : Sleeps in nearest bed during nighttime
- await dsl.activateNearestBlock(blockType) : Toggles levers, buttons, or trapdoors
- await dsl.useToolOn(toolName, targetName) : Uses an item/tool on a target entity or block (e.g. water_bucket on lava, shears on sheep)
- await dsl.tradeWithVillager(villagerId, tradeIndex, count) : Executes trades with villagers
- await dsl.buildStructure(blueprint, originPos) : Constructs 3D multi-level buildings from blueprints
- await dsl.harvestAndReplantCrops() : Harvests mature crops and replants seeds
- await dsl.giveGiftToPlayer(playerName, itemName, count = 1) : Approaches player and tosses gift item
- await dsl.collectItem(itemEntity) : Approaches dropped item and excavates any trapping block
- await dsl.pillarUp(height = 1, blockName = null) : Jump and place blocks under feet (1x1 tower) with microsecond physics synchronization
- await dsl.placeTorchIfDark() : Automatically places a torch if current area is dark (light <= 7)
- await dsl.eatIfHungry() : Eats food if hunger is below threshold
- dsl.chat(message) : Silent log for debugging

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
1. Write ONLY clean JavaScript code. No markdown explanations, no triple backticks.
2. For crafting tasks, call ONLY 'await dsl.craftItem(itemName, count);'. DO NOT navigate to random coordinates.
3. For navigation, always use real coordinates from world.position or world.findBlocks. Never invent random coordinates.
4. Use 'await' on all async DSL and Adapter calls.
5. Check world.hasItem(...) before attempting to craft or place items.
6. Keep the code concise, direct, and deterministic.
`;

class AICoderAgent {
  constructor(customConfig = null) {
    this.aiproviderCfg = config.aiprovider || {};
    this.activeProvider = this.aiproviderCfg.active_provider || 'ollama';
    this.cfg = customConfig || (this.activeProvider === 'openrouter' ? this.aiproviderCfg.openrouter : this.aiproviderCfg.ollama);
    this.baseUrl = this.cfg.base_url || (this.activeProvider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'http://127.0.0.1:11434');
    this.model = this.cfg.model || (this.activeProvider === 'openrouter' ? 'minimax/minimax-m3:free' : 'qwen2.5-coder:3b');
    this.apiKey = this.cfg.api_key || '';
    this.numCtx = this.cfg.num_ctx || 2048;
    this.temperature = this.cfg.temperature || 0.1;
    this.timeoutMs = this.cfg.timeout_ms || 60000;
  }

  async generateCode(taskDescription, worldState, args = {}) {
    logger.info(`🤖 Agent 2 analyzing task: "${taskDescription}" with provider '${this.activeProvider}' model '${this.model}'...`, 'AICoder');

    const userPrompt = `Current World State:
- Position: (${worldState.position.x}, ${worldState.position.y}, ${worldState.position.z})
- Health: ${worldState.health}/20, Food: ${worldState.food}/20
- Inventory: ${JSON.stringify(worldState.inventory || [])}
- Nearby Blocks: ${JSON.stringify(worldState.nearby_blocks || {})}
- Nearby Entities: ${JSON.stringify(worldState.nearby_entities || [])}

Task: ${taskDescription}
Arguments: ${JSON.stringify(args)}

Write ONLY the executable Safe DSL JavaScript code:`;

    const startTime = Date.now();
    try {
      let rawCode = '';

      if (this.activeProvider === 'openrouter') {
        const response = await axios.post(
          `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`,
          {
            model: this.model,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: this.temperature,
            max_tokens: 300,
          },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'HTTP-Referer': 'https://github.com/Nice2MU/MuumiuLLM',
              'X-Title': 'MuumiuLLM Agent 2',
              'Content-Type': 'application/json',
            },
            timeout: this.timeoutMs,
          }
        );
        rawCode = response.data?.choices?.[0]?.message?.content || '';
      } else {
        const fullPrompt = `${SYSTEM_PROMPT}\n\n${userPrompt}`;
        const response = await axios.post(
          `${this.baseUrl}/api/generate`,
          {
            model: this.model,
            prompt: fullPrompt,
            stream: false,
            options: {
              num_ctx: this.numCtx,
              num_predict: 128,
              temperature: this.temperature,
              stop: ['```\n\n', '</code>'],
            },
          },
          { timeout: this.timeoutMs }
        );
        rawCode = response.data?.response || '';
      }

      const latency = ((Date.now() - startTime) / 1000).toFixed(2);
      logger.info(`⚡ Agent 2 code generated via ${this.activeProvider} in ${latency}s (${rawCode.length} chars)`, 'AICoder');
      return rawCode;
    } catch (e) {
      logger.error(`AI Coder generation failed (${this.activeProvider}): ${e.message}`, 'AICoder');
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
