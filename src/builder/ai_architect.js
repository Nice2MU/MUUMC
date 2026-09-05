/**
 * AI Architect Subsystem for MuumiuLLM
 * Generates custom, creative, and structurally sound 3D Minecraft blueprints using LLM or procedural architecture.
 * Automatically saves into data/blueprints/<name>.json ready for StructureBuilder.
 */

const axios = require('axios');
const path = require('path');
const { config } = require('../config/loader');
const { logger } = require('../bot/logger');
const { blueprintLoader } = require('./blueprint_loader');

const ARCHITECT_SYSTEM_PROMPT = `You are Muumiu's Master Architect AI in Minecraft.
Your job is to design an original, creative, and structurally sound 3D Minecraft building blueprint.

Requirements:
1. Building Dimensions: Small to medium structure (Width X: 5-7, Length Z: 5-7, Height Y: 4-6).
2. MANDATORY ACCESSIBLE ENTRANCE & DOOR:
   - Every building MUST have an entrance doorway with an "oak_door" so players and bots can enter!
   - On Layer 1 (ground floor walls, Y=1), the front exterior wall (z=0) MUST have an "oak_door" at the center (e.g. x=2 for a 5-wide wall).
   - On Layer 2 (upper walls, Y=2), directly above the door (same x and z), MUST be "air" or "oak_door" for headroom!
   - NEVER seal all walls completely with solid blocks or glass. A building without an entrance door is invalid.
3. Structure Layers (Y is vertical height, 0 to N-1):
   - Layer 0 (Foundation floor Y=0, offset=-1): Solid floor made of wood, stone, cobblestone, or bricks.
   - Layer 1 (Lower walls Y=1): Solid corner pillars (e.g. "oak_log"), wall blocks ("oak_planks", "spruce_planks", "stone_bricks"), an "oak_door" on the front wall (z=0), hollow interior with furniture ("crafting_table", "chest", "red_bed").
   - Layer 2 (Upper walls Y=2): Windows ("glass_pane" or "glass"), wall blocks, torches ("torch"), hollow interior, and "air" directly above the door.
   - Layer 3+ (Roof/Ceiling): Solid roof or overhanging eaves made of planks or stone_bricks.
4. Use realistic standard Minecraft blocks:
   - Structure: "oak_planks", "oak_log", "cobblestone", "stone_bricks", "spruce_planks", "birch_planks"
   - Windows/Lighting: "glass", "glass_pane", "torch", "lantern"
   - Furniture/Interior: "oak_door", "chest", "crafting_table", "bookshelf", "red_bed"
   - Empty air space: "air"
5. Output MUST be ONLY valid JSON matching this schema:
{
  "name": "creative_snake_case_name",
  "description": "Short description of the architectural style and purpose",
  "offset": -1,
  "blocks": [
    // 3D Array: blocks[y][z][x]
    // Layer 0: Solid foundation floor
    [
      ["cobblestone", "cobblestone", "cobblestone", "cobblestone", "cobblestone"],
      ["cobblestone", "oak_planks", "oak_planks", "oak_planks", "cobblestone"],
      ["cobblestone", "oak_planks", "oak_planks", "oak_planks", "cobblestone"],
      ["cobblestone", "oak_planks", "oak_planks", "oak_planks", "cobblestone"],
      ["cobblestone", "cobblestone", "cobblestone", "cobblestone", "cobblestone"]
    ],
    // Layer 1: Lower walls, front entrance door at (z=0, x=2), furniture inside
    [
      ["oak_log", "oak_planks", "oak_door", "oak_planks", "oak_log"],
      ["oak_planks", "chest", "air", "crafting_table", "oak_planks"],
      ["oak_planks", "air", "air", "air", "oak_planks"],
      ["oak_planks", "air", "air", "red_bed", "oak_planks"],
      ["oak_log", "oak_planks", "oak_planks", "oak_planks", "oak_log"]
    ],
    // Layer 2: Upper walls, windows, air above door for doorway
    [
      ["oak_log", "oak_planks", "air", "oak_planks", "oak_log"],
      ["glass_pane", "air", "air", "air", "glass_pane"],
      ["glass_pane", "air", "torch", "air", "glass_pane"],
      ["glass_pane", "air", "air", "air", "glass_pane"],
      ["oak_log", "oak_planks", "glass_pane", "oak_planks", "oak_log"]
    ],
    // Layer 3: Solid roof
    [
      ["oak_planks", "oak_planks", "oak_planks", "oak_planks", "oak_planks"],
      ["oak_planks", "oak_planks", "oak_planks", "oak_planks", "oak_planks"],
      ["oak_planks", "oak_planks", "oak_planks", "oak_planks", "oak_planks"],
      ["oak_planks", "oak_planks", "oak_planks", "oak_planks", "oak_planks"],
      ["oak_planks", "oak_planks", "oak_planks", "oak_planks", "oak_planks"]
    ]
  ]
}

CRITICAL: Return ONLY valid JSON. No conversational text, no markdown formatting outside JSON.`;

class AIArchitect {
  constructor() {
    this.aiproviderCfg = config.aiprovider || {};
    this.activeProvider = this.aiproviderCfg.active_provider || 'ollama';
    this.cfg = this.activeProvider === 'openrouter' ? this.aiproviderCfg.openrouter : this.aiproviderCfg.ollama;
    this.baseUrl = this.cfg?.base_url || 'http://127.0.0.1:11434';
    this.model = this.cfg?.model || 'gemma4:cloud';
    this.timeoutMs = this.cfg?.timeout_ms || 45000;
  }

  /**
   * Designs a new blueprint using LLM or intelligent procedural fallback.
   * @param {string|null} themePrompt - Optional theme description (e.g. "Japanese Pavilion", "Stone Watchtower")
   * @param {Object} options
   */
  async designBlueprint(themePrompt = null, options = {}) {
    const theme = themePrompt || this._selectRandomTheme();
    logger.info(`🎨 [AI Architect] Muumiu is conceptualizing new 3D blueprint for theme: "${theme}"...`, 'AIArchitect');

    let rawDesign = null;

    // 1. Try LLM Generation
    try {
      rawDesign = await this._queryLLM(theme, options);
    } catch (err) {
      logger.warn(`[AI Architect] LLM generation failed or timed out: ${err.message}. Using procedural architect...`, 'AIArchitect');
    }

    // 2. Parse & Validate or use Procedural Fallback
    let blueprintData = null;
    if (rawDesign) {
      blueprintData = this._parseAndNormalize(rawDesign);
    }

    if (!blueprintData || !blueprintData.blocks || blueprintData.blocks.length === 0) {
      logger.info(`🎨 [AI Architect] Synthesizing procedural architectural design for '${theme}'...`, 'AIArchitect');
      blueprintData = this._generateProceduralDesign(theme);
    }

    // 3. Save Blueprint to library
    const saved = blueprintLoader.saveBlueprint(blueprintData.name, blueprintData);
    const loaded = await blueprintLoader.load(blueprintData.name);

    logger.info(`✅ [AI Architect] Blueprint '${loaded.name}' created successfully! Dimensions: ${loaded.dimensions.x}x${loaded.dimensions.y}x${loaded.dimensions.z}, Total blocks: ${loaded.totalBlocks}`, 'AIArchitect');
    logger.info(`📋 Bill of Materials: ${JSON.stringify(loaded.bom)}`, 'AIArchitect');

    return {
      name: loaded.name,
      description: loaded.description,
      blueprint: loaded,
      filePath: saved.filePath,
      bom: loaded.bom,
      dimensions: loaded.dimensions,
    };
  }

  /**
   * Queries LLM for 3D blueprint JSON.
   */
  async _queryLLM(theme, options = {}) {
    const userPrompt = `Design a unique, beautiful Minecraft structure based on this concept: "${theme}".
MANDATORY: You MUST include an "oak_door" at the front exterior wall (z=0, center x) on Layer 1 so players and bots can enter! On Layer 2 directly above the door, put "air" or "oak_door".
Output strictly valid JSON with keys: name, description, offset (-1), blocks (3D array [y][z][x]).`;

    const startTime = Date.now();

    if (this.activeProvider === 'openrouter') {
      const res = await axios.post(
        `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          model: this.model,
          messages: [
            { role: 'system', content: ARCHITECT_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 1500,
        },
        {
          headers: {
            Authorization: `Bearer ${this.cfg?.api_key || ''}`,
            'Content-Type': 'application/json',
          },
          timeout: this.timeoutMs,
        }
      );
      const text = res.data?.choices?.[0]?.message?.content || '';
      logger.info(`⚡ [AI Architect] LLM response received in ${((Date.now() - startTime) / 1000).toFixed(1)}s`, 'AIArchitect');
      return text;
    } else {
      // Ollama
      const res = await axios.post(
        `${this.baseUrl}/api/generate`,
        {
          model: this.model,
          prompt: `${ARCHITECT_SYSTEM_PROMPT}\n\n${userPrompt}`,
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: 1500,
          },
        },
        { timeout: this.timeoutMs }
      );
      const text = res.data?.response || '';
      logger.info(`⚡ [AI Architect] LLM response received in ${((Date.now() - startTime) / 1000).toFixed(1)}s`, 'AIArchitect');
      return text;
    }
  }

  /**
   * Parses LLM text into normalized blueprint data.
   */
  _parseAndNormalize(rawText) {
    if (!rawText) return null;

    try {
      // Strip markdown backticks if present
      let clean = rawText.trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (!match) return null;

      const parsed = JSON.parse(match[0]);
      if (!parsed.name || !parsed.blocks) return null;

      const safeName = parsed.name
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || `custom_${Date.now()}`;

      let blocks3D = [];

      // Case A: 3D Array [y][z][x]
      if (Array.isArray(parsed.blocks) && Array.isArray(parsed.blocks[0]) && Array.isArray(parsed.blocks[0][0])) {
        blocks3D = parsed.blocks;
      }
      // Case B: Coordinate list [{ x, y, z, block }]
      else if (Array.isArray(parsed.blocks) && parsed.blocks[0] && typeof parsed.blocks[0] === 'object' && 'x' in parsed.blocks[0]) {
        blocks3D = this._coordListTo3D(parsed.blocks);
      } else {
        return null;
      }

      // Pad ragged rows to ensure uniform dimensions
      blocks3D = this._rectify3DArray(blocks3D);

      // Programmatic Doorway Guarantee: Ensure there is an accessible door
      blocks3D = this._ensureDoorway(blocks3D);

      return {
        name: safeName.startsWith('ai_') ? safeName : `ai_${safeName}`,
        description: parsed.description || `AI Designed: ${parsed.name}`,
        offset: parsed.offset !== undefined ? parsed.offset : -1,
        blocks: blocks3D,
      };
    } catch (e) {
      logger.debug(`[AI Architect] JSON parse error: ${e.message}`, 'AIArchitect');
      return null;
    }
  }

  /**
   * Ensures that the blueprint has an accessible entrance door.
   * If no door exists in any layer, automatically carves a doorway and places an oak_door.
   * Also ensures headroom above any door on Layer 2 is open (air or oak_door).
   */
  _ensureDoorway(blocks3D) {
    if (!blocks3D || blocks3D.length < 2) return blocks3D;

    // Check if any door already exists
    let hasDoor = false;
    for (let y = 0; y < blocks3D.length; y++) {
      for (let z = 0; z < blocks3D[y].length; z++) {
        for (let x = 0; x < blocks3D[y][z].length; x++) {
          const b = blocks3D[y][z][x];
          if (typeof b === 'string' && b.includes('door') && !b.includes('trapdoor')) {
            hasDoor = true;
            // Ensure headroom above the door on Layer 2
            if (y === 1 && blocks3D.length > 2 && blocks3D[2][z]) {
              const above = blocks3D[2][z][x];
              if (above !== 'air' && !above.includes('door')) {
                blocks3D[2][z][x] = 'air';
              }
            }
            // Ensure solid floor underneath on Layer 0
            if (y === 1 && blocks3D[0] && blocks3D[0][z]) {
              const below = blocks3D[0][z][x];
              if (!below || below === 'air') {
                blocks3D[0][z][x] = 'oak_planks';
              }
            }
          }
        }
      }
    }

    if (hasDoor) return blocks3D;

    // No door found! Programmatically carve entrance doorway with oak_door
    logger.warn('⚠️ [AI Architect] No door found in blueprint! Automatically carving an entrance doorway with oak_door...', 'AIArchitect');

    const layer1 = blocks3D[1];
    const sizeZ = layer1.length;
    const sizeX = layer1[0].length;

    // Front wall facing staging chest is z = 0
    const frontZ = 0;
    const midX = Math.floor(sizeX / 2);

    // 1. Ensure solid floor beneath door (Layer 0)
    if (blocks3D[0] && blocks3D[0][frontZ]) {
      const under = blocks3D[0][frontZ][midX];
      if (!under || under === 'air') {
        blocks3D[0][frontZ][midX] = 'oak_planks';
      }
    }

    // 2. Place oak_door at front wall center (Layer 1)
    blocks3D[1][frontZ][midX] = 'oak_door';

    // 3. Ensure Layer 2 above door is air for player clearance
    if (blocks3D.length > 2 && blocks3D[2][frontZ]) {
      blocks3D[2][frontZ][midX] = 'air';
    }

    // 4. Ensure interior path inside door is not blocked by a solid wall
    if (sizeZ > 2 && blocks3D[1][frontZ + 1]) {
      const insideBlock = blocks3D[1][frontZ + 1][midX];
      if (insideBlock !== 'air' && !['crafting_table', 'chest', 'furnace', 'bed', 'red_bed'].some(item => insideBlock.includes(item))) {
        blocks3D[1][frontZ + 1][midX] = 'air';
      }
    }

    logger.info(`🚪 [AI Architect] Entrance door added successfully at Layer 1 (z=${frontZ}, x=${midX}) facing staging chest`, 'AIArchitect');
    return blocks3D;
  }

  /**
   * Converts coordinate list [{ x, y, z, block }] into standard 3D array [y][z][x].
   */
  _coordListTo3D(list) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const item of list) {
      minX = Math.min(minX, item.x);
      maxX = Math.max(maxX, item.x);
      minY = Math.min(minY, item.y);
      maxY = Math.max(maxY, item.y);
      minZ = Math.min(minZ, item.z);
      maxZ = Math.max(maxZ, item.z);
    }

    const sizeY = maxY - minY + 1;
    const sizeZ = maxZ - minZ + 1;
    const sizeX = maxX - minX + 1;

    // Allocate 3D grid with 'air'
    const grid = [];
    for (let y = 0; y < sizeY; y++) {
      const layer = [];
      for (let z = 0; z < sizeZ; z++) {
        layer.push(new Array(sizeX).fill('air'));
      }
      grid.push(layer);
    }

    // Populate blocks
    for (const item of list) {
      const bName = item.block || item.name || 'oak_planks';
      const norm = blueprintLoader.normalizeBlockName(bName);
      grid[item.y - minY][item.z - minZ][item.x - minX] = norm;
    }

    return grid;
  }

  /**
   * Ensures all rows in all layers have consistent rectangular dimensions.
   */
  _rectify3DArray(blocks3D) {
    let maxZ = 0;
    let maxX = 0;

    for (const layer of blocks3D) {
      if (!Array.isArray(layer)) continue;
      maxZ = Math.max(maxZ, layer.length);
      for (const row of layer) {
        if (Array.isArray(row)) {
          maxX = Math.max(maxX, row.length);
        }
      }
    }

    const rectified = [];
    for (let y = 0; y < blocks3D.length; y++) {
      const layer = blocks3D[y] || [];
      const newLayer = [];
      for (let z = 0; z < maxZ; z++) {
        const row = layer[z] || [];
        const newRow = [];
        for (let x = 0; x < maxX; x++) {
          const val = row[x] || 'air';
          newRow.push(typeof val === 'string' && val ? blueprintLoader.normalizeBlockName(val) : 'air');
        }
        newLayer.push(newRow);
      }
      rectified.push(newLayer);
    }

    return rectified;
  }

  /**
   * Generates a high-quality procedural architectural design.
   */
  _generateProceduralDesign(theme) {
    const timestamp = Date.now().toString().slice(-4);

    if (theme.includes('stone') || theme.includes('tower') || theme.includes('หอ')) {
      // 5x5 Stone Watchtower
      return {
        name: `ai_stone_watchtower_${timestamp}`,
        description: 'หอคอยสังเกตการณ์หินโบราณ พร้อมเสาหินและคบเพลิงส่องสว่าง',
        offset: -1,
        blocks: [
          // Y=0: Foundation
          [
            ['cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', 'cobblestone'],
            ['cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', 'cobblestone'],
            ['cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', 'cobblestone'],
            ['cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', 'cobblestone'],
            ['cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', 'cobblestone'],
          ],
          // Y=1: Lower walls & door
          [
            ['cobblestone', 'stone_bricks', 'stone_bricks', 'stone_bricks', 'cobblestone'],
            ['stone_bricks', 'chest', 'air', 'crafting_table', 'stone_bricks'],
            ['stone_bricks', 'air', 'air', 'air', 'stone_bricks'],
            ['stone_bricks', 'air', 'air', 'air', 'stone_bricks'],
            ['cobblestone', 'stone_bricks', 'oak_door', 'stone_bricks', 'cobblestone'],
          ],
          // Y=2: Upper walls & window slits
          [
            ['cobblestone', 'stone_bricks', 'glass', 'stone_bricks', 'cobblestone'],
            ['stone_bricks', 'air', 'air', 'air', 'stone_bricks'],
            ['glass', 'air', 'air', 'air', 'glass'],
            ['stone_bricks', 'air', 'air', 'air', 'stone_bricks'],
            ['cobblestone', 'stone_bricks', 'oak_door', 'stone_bricks', 'cobblestone'],
          ],
          // Y=3: Battlements & Torches
          [
            ['cobblestone', 'air', 'torch', 'air', 'cobblestone'],
            ['air', 'stone_bricks', 'stone_bricks', 'stone_bricks', 'air'],
            ['torch', 'stone_bricks', 'air', 'stone_bricks', 'torch'],
            ['air', 'stone_bricks', 'stone_bricks', 'stone_bricks', 'air'],
            ['cobblestone', 'air', 'torch', 'air', 'cobblestone'],
          ],
        ],
      };
    } else if (theme.includes('glass') || theme.includes('modern') || theme.includes('โมเดิร์น')) {
      // 5x5 Modern Glass Cabin
      return {
        name: `ai_modern_glass_villa_${timestamp}`,
        description: 'บ้านพักโมเดิร์นผนังกระจกโปร่งใส พื้นไม้โอ๊คอบอุ่น',
        offset: -1,
        blocks: [
          // Y=0: Floor
          [
            ['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'],
            ['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'],
            ['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'],
            ['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'],
            ['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'],
          ],
          // Y=1: Glass walls & door
          [
            ['oak_log', 'glass', 'glass', 'glass', 'oak_log'],
            ['glass', 'chest', 'red_bed', 'air', 'glass'],
            ['glass', 'air', 'red_bed', 'air', 'glass'],
            ['glass', 'air', 'air', 'crafting_table', 'glass'],
            ['oak_log', 'oak_planks', 'oak_door', 'oak_planks', 'oak_log'],
          ],
          // Y=2: Upper glass & lighting
          [
            ['oak_log', 'glass', 'glass', 'glass', 'oak_log'],
            ['glass', 'air', 'air', 'air', 'glass'],
            ['glass', 'air', 'air', 'air', 'glass'],
            ['glass', 'air', 'air', 'air', 'glass'],
            ['oak_log', 'oak_planks', 'oak_door', 'oak_planks', 'oak_log'],
          ],
          // Y=3: Flat stylish wooden roof
          [
            ['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'],
            ['oak_planks', 'glass', 'glass', 'glass', 'oak_planks'],
            ['oak_planks', 'glass', 'torch', 'glass', 'oak_planks'],
            ['oak_planks', 'glass', 'glass', 'glass', 'oak_planks'],
            ['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'],
          ],
        ],
      };
    } else {
      // 5x5 Garden Pavilion / Sakura Gazebo
      return {
        name: `ai_garden_pavilion_${timestamp}`,
        description: 'ศาลากลางสวนบรรยากาศอบอุ่น เสาไม้โอ๊คและหลังคาโปร่งรับลม',
        offset: -1,
        blocks: [
          // Y=0: Floor
          [
            ['cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', 'cobblestone'],
            ['cobblestone', 'oak_planks', 'oak_planks', 'oak_planks', 'cobblestone'],
            ['cobblestone', 'oak_planks', 'oak_planks', 'oak_planks', 'cobblestone'],
            ['cobblestone', 'oak_planks', 'oak_planks', 'oak_planks', 'cobblestone'],
            ['cobblestone', 'cobblestone', 'cobblestone', 'cobblestone', 'cobblestone'],
          ],
          // Y=1: 4 Pillars & Interior Seating
          [
            ['oak_log', 'air', 'air', 'air', 'oak_log'],
            ['air', 'chest', 'air', 'crafting_table', 'air'],
            ['air', 'air', 'red_bed', 'air', 'air'],
            ['air', 'air', 'red_bed', 'air', 'air'],
            ['oak_log', 'air', 'air', 'air', 'oak_log'],
          ],
          // Y=2: Elevated Pillars & Torches
          [
            ['oak_log', 'oak_planks', 'torch', 'oak_planks', 'oak_log'],
            ['oak_planks', 'air', 'air', 'air', 'oak_planks'],
            ['torch', 'air', 'air', 'air', 'torch'],
            ['oak_planks', 'air', 'air', 'air', 'oak_planks'],
            ['oak_log', 'oak_planks', 'torch', 'oak_planks', 'oak_log'],
          ],
          // Y=3: Pyramidal Wood Roof
          [
            ['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'],
            ['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'],
            ['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'],
            ['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'],
            ['oak_planks', 'oak_planks', 'oak_planks', 'oak_planks', 'oak_planks'],
          ],
        ],
      };
    }
  }

  _selectRandomTheme() {
    const themes = [
      'บ้านพักตากอากาศกลางสวนสไตล์ญี่ปุ่น (Japanese Garden Pavilion)',
      'หอคอยสังเกตการณ์หินโบราณ (Medieval Stone Watchtower)',
      'บ้านพักโมเดิร์นผนังกระจก (Modern Glass Cabin)',
      'กระท่อมไม้อบอุ่นกลางป่า (Cozy Forest Cabin)',
    ];
    return themes[Math.floor(Math.random() * themes.length)];
  }
}

const aiArchitect = new AIArchitect();

module.exports = {
  AIArchitect,
  aiArchitect,
  ARCHITECT_SYSTEM_PROMPT,
};
