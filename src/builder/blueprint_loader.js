/**
 * Blueprint & Schematic Loader for Minecraft Autonomous Construction.
 * Supports:
 * - 3D JSON Blueprints (data/blueprints/*.json)
 * - WorldEdit & Sponge Schematics (.schem, .schematic via prismarine-schematic)
 * - Automated Bill of Materials (BOM) Calculation
 * - 3D Grid Rotation (0, 90, 180, 270 degrees)
 * - Shorthand to Modern Minecraft Block Name Resolution
 */

const fs = require('fs');
const path = require('path');
const { Vec3 } = require('vec3');
const { logger } = require('../bot/logger');

let SchematicClass = null;
try {
  const pSchem = require('prismarine-schematic');
  SchematicClass = pSchem.Schematic || pSchem;
} catch (e) {
  logger.warn(`prismarine-schematic load notice: ${e.message}`, 'BlueprintLoader');
}

const SHORTHAND_MAP = {
  planks: 'oak_planks',
  log: 'oak_log',
  wood: 'oak_wood',
  door: 'oak_door',
  bed: 'red_bed',
  leaves: 'oak_leaves',
  slab: 'oak_slab',
  stairs: 'oak_stairs',
  trapdoor: 'oak_trapdoor',
  fence: 'oak_fence',
  gate: 'oak_fence_gate',
  torch: 'torch',
  wall_torch: 'torch',
  glass_pane: 'glass_pane',
  chest: 'chest',
  furnace: 'furnace',
  crafting_table: 'crafting_table',
  stone_bricks: 'stone_bricks',
  cobblestone: 'cobblestone',
  dirt: 'dirt',
  glass: 'glass',
  wool: 'white_wool',
};

class BlueprintLoader {
  constructor(blueprintsDir = null, schematicsDir = null) {
    this.blueprintsDir = blueprintsDir || path.resolve(__dirname, '../../data/blueprints');
    this.schematicsDir = schematicsDir || path.resolve(__dirname, '../../data/schematics');

    if (!fs.existsSync(this.blueprintsDir)) {
      fs.mkdirSync(this.blueprintsDir, { recursive: true });
    }
    if (!fs.existsSync(this.schematicsDir)) {
      fs.mkdirSync(this.schematicsDir, { recursive: true });
    }
  }

  /**
   * Normalizes a block name from shorthand or namespaced format.
   */
  normalizeBlockName(rawName) {
    if (!rawName || typeof rawName !== 'string') return '';
    const clean = rawName.toLowerCase().trim().replace(/^minecraft:/, '');
    if (clean === '' || clean === 'air' || clean === 'cave_air' || clean === 'void_air') {
      return 'air';
    }
    return SHORTHAND_MAP[clean] || clean;
  }

  /**
   * Calculates Bill of Materials (BOM) from a 3D block array.
   */
  calculateBOM(blocks3D) {
    const bom = {};
    let totalBlocks = 0;

    for (let y = 0; y < blocks3D.length; y++) {
      const layer = blocks3D[y];
      for (let z = 0; z < layer.length; z++) {
        for (let x = 0; x < layer[z].length; x++) {
          const raw = layer[z][x];
          const name = this.normalizeBlockName(raw);
          if (!name || name === 'air') continue;

          bom[name] = (bom[name] || 0) + 1;
          totalBlocks++;
        }
      }
    }

    return { bom, totalBlocks };
  }

  /**
   * Loads a blueprint by name or direct file path.
   * Auto-detects JSON vs Schematic format.
   */
  async load(nameOrPath, options = {}) {
    const cleanName = path.basename(nameOrPath, path.extname(nameOrPath));
    const version = options.version || '1.20.4';

    // 1. Try JSON Blueprint
    const jsonPath = path.resolve(this.blueprintsDir, `${cleanName}.json`);
    if (fs.existsSync(jsonPath)) {
      return this._loadJSON(jsonPath, cleanName);
    }

    // Direct path check for JSON
    if (fs.existsSync(nameOrPath) && nameOrPath.endsWith('.json')) {
      return this._loadJSON(nameOrPath, cleanName);
    }

    // 2. Try Schematic (.schem or .schematic)
    const schemPath = path.resolve(this.schematicsDir, `${cleanName}.schem`);
    const schematicPath = path.resolve(this.schematicsDir, `${cleanName}.schematic`);
    const targetSchem = fs.existsSync(schemPath) ? schemPath : (fs.existsSync(schematicPath) ? schematicPath : null);

    if (targetSchem) {
      return await this._loadSchematic(targetSchem, cleanName, version);
    }

    if (fs.existsSync(nameOrPath) && (nameOrPath.endsWith('.schem') || nameOrPath.endsWith('.schematic'))) {
      return await this._loadSchematic(nameOrPath, cleanName, version);
    }

    throw new Error(`Blueprint or Schematic '${nameOrPath}' not found in data/blueprints/ or data/schematics/`);
  }

  _loadJSON(filePath, name) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const rawBlocks = raw.blocks || [];
    const height = rawBlocks.length;
    let length = 0;
    let width = 0;

    // Normalize block names in the 3D grid
    const normalizedBlocks = [];
    for (let y = 0; y < height; y++) {
      const layer = rawBlocks[y] || [];
      length = Math.max(length, layer.length);
      const newLayer = [];
      for (let z = 0; z < layer.length; z++) {
        const row = layer[z] || [];
        width = Math.max(width, row.length);
        const newRow = [];
        for (let x = 0; x < row.length; x++) {
          newRow.push(this.normalizeBlockName(row[x]));
        }
        newLayer.push(newRow);
      }
      normalizedBlocks.push(newLayer);
    }

    const { bom, totalBlocks } = this.calculateBOM(normalizedBlocks);

    return {
      name: raw.name || name,
      format: 'json',
      offset: raw.offset !== undefined ? raw.offset : 0,
      dimensions: {
        x: width,
        y: height,
        z: length,
      },
      blocks: normalizedBlocks,
      bom,
      totalBlocks,
      description: raw.description || `3D Blueprint ${name} (${width}x${height}x${length})`,
    };
  }

  async _loadSchematic(filePath, name, version = '1.20.4') {
    if (!SchematicClass) {
      throw new Error('prismarine-schematic library is not available.');
    }

    const buffer = fs.readFileSync(filePath);
    const schem = await SchematicClass.read(buffer, version);

    const start = schem.start();
    const end = schem.end();
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    const length = Math.abs(end.z - start.z);

    const blocks3D = [];
    for (let y = 0; y < height; y++) {
      const layer = [];
      for (let z = 0; z < length; z++) {
        const row = [];
        for (let x = 0; x < width; x++) {
          try {
            const block = schem.getBlock(new Vec3(x, y, z));
            row.push(block ? this.normalizeBlockName(block.name) : 'air');
          } catch (_) {
            row.push('air');
          }
        }
        layer.push(row);
      }
      blocks3D.push(layer);
    }

    const { bom, totalBlocks } = this.calculateBOM(blocks3D);

    return {
      name,
      format: filePath.endsWith('.schematic') ? 'schematic' : 'schem',
      offset: 0,
      dimensions: {
        x: width,
        y: height,
        z: length,
      },
      blocks: blocks3D,
      bom,
      totalBlocks,
      description: `Schematic ${name} (${width}x${height}x${length})`,
    };
  }

  /**
   * Rotates a 3D blueprint clockwise by 0, 90, 180, or 270 degrees around Y-axis.
   */
  rotate(blueprint, degrees = 0) {
    const deg = ((degrees % 360) + 360) % 360;
    if (deg === 0) return blueprint;

    const oldBlocks = blueprint.blocks;
    const oldH = oldBlocks.length;
    const oldL = oldBlocks[0]?.length || 0;
    const oldW = oldBlocks[0]?.[0]?.length || 0;

    let newBlocks = [];
    let newW = oldW;
    let newL = oldL;

    if (deg === 90) {
      // 90 deg clockwise: newX = oldZ, newZ = (oldW - 1 - oldX)
      newW = oldL;
      newL = oldW;
      for (let y = 0; y < oldH; y++) {
        const layer = [];
        for (let z = 0; z < newL; z++) {
          const row = [];
          for (let x = 0; x < newW; x++) {
            const oldZ = x;
            const oldX = oldW - 1 - z;
            row.push(oldBlocks[y]?.[oldZ]?.[oldX] || 'air');
          }
          layer.push(row);
        }
        newBlocks.push(layer);
      }
    } else if (deg === 180) {
      // 180 deg: newX = (oldW - 1 - oldX), newZ = (oldL - 1 - oldZ)
      for (let y = 0; y < oldH; y++) {
        const layer = [];
        for (let z = 0; z < newL; z++) {
          const row = [];
          for (let x = 0; x < newW; x++) {
            const oldX = oldW - 1 - x;
            const oldZ = oldL - 1 - z;
            row.push(oldBlocks[y]?.[oldZ]?.[oldX] || 'air');
          }
          layer.push(row);
        }
        newBlocks.push(layer);
      }
    } else if (deg === 270) {
      // 270 deg: newX = (oldL - 1 - oldZ), newZ = oldX
      newW = oldL;
      newL = oldW;
      for (let y = 0; y < oldH; y++) {
        const layer = [];
        for (let z = 0; z < newL; z++) {
          const row = [];
          for (let x = 0; x < newW; x++) {
            const oldZ = oldL - 1 - x;
            const oldX = z;
            row.push(oldBlocks[y]?.[oldZ]?.[oldX] || 'air');
          }
          layer.push(row);
        }
        newBlocks.push(layer);
      }
    }

    return {
      ...blueprint,
      dimensions: {
        x: newW,
        y: oldH,
        z: newL,
      },
      blocks: newBlocks,
      rotation: deg,
    };
  }

  /**
   * Lists all available blueprints and schematics with metadata.
   */
  async listAll() {
    const results = [];

    // Scan JSON Blueprints
    if (fs.existsSync(this.blueprintsDir)) {
      const files = fs.readdirSync(this.blueprintsDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const bp = this._loadJSON(path.join(this.blueprintsDir, file), path.basename(file, '.json'));
            results.push({
              name: bp.name,
              format: 'json',
              dimensions: bp.dimensions,
              totalBlocks: bp.totalBlocks,
              bom: bp.bom,
              description: bp.description,
            });
          } catch (e) {
            logger.debug(`Error reading blueprint ${file}: ${e.message}`, 'BlueprintLoader');
          }
        }
      }
    }

    // Scan Schematics
    if (fs.existsSync(this.schematicsDir)) {
      const files = fs.readdirSync(this.schematicsDir);
      for (const file of files) {
        if (file.endsWith('.schem') || file.endsWith('.schematic')) {
          try {
            const bp = await this._loadSchematic(path.join(this.schematicsDir, file), path.basename(file, path.extname(file)));
            results.push({
              name: bp.name,
              format: bp.format,
              dimensions: bp.dimensions,
              totalBlocks: bp.totalBlocks,
              bom: bp.bom,
              description: bp.description,
            });
          } catch (e) {
            logger.debug(`Error reading schematic ${file}: ${e.message}`, 'BlueprintLoader');
          }
        }
      }
    }

    return results;
  }

  /**
   * Saves a newly generated blueprint to data/blueprints/<name>.json.
   */
  saveBlueprint(name, blueprintData) {
    const clean = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const targetFile = path.resolve(this.blueprintsDir, `${clean}.json`);

    const dataToSave = {
      name: clean,
      offset: blueprintData.offset !== undefined ? blueprintData.offset : 0,
      description: blueprintData.description || `AI Designed Blueprint: ${name}`,
      blocks: blueprintData.blocks || [],
    };

    fs.writeFileSync(targetFile, JSON.stringify(dataToSave, null, 2), 'utf-8');
    logger.info(`💾 Saved new 3D blueprint to: ${targetFile}`, 'BlueprintLoader');
    return {
      success: true,
      name: clean,
      filePath: targetFile,
    };
  }
}

const blueprintLoader = new BlueprintLoader();

module.exports = {
  BlueprintLoader,
  blueprintLoader,
  SHORTHAND_MAP,
};
