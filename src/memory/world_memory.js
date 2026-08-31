/**
 * World Memory Manager for muu-mc (Atomic Storage & Strict Server Keying).
 * Stores landmarks (house, mine, bed) and chest item registries per server world.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../bot/logger');

class WorldMemoryManager {
  constructor(baseDataDir = path.resolve(__dirname, '../../data')) {
    this.baseDataDir = baseDataDir;
  }

  _resolveServerKey(serverKey) {
    if (serverKey) return serverKey;
    try {
      const { config } = require('../config/loader');
      const host = config.minecraft?.host || '127.0.0.1';
      const port = config.minecraft?.port || 25565;
      return `${host}_${port}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    } catch (_) {
      return 'default_world';
    }
  }

  _getWorldDir(serverKey) {
    const key = this._resolveServerKey(serverKey);
    const dir = path.join(this.baseDataDir, 'worlds', key);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  _readAtomicJson(filePath, defaultValue = {}) {
    if (!fs.existsSync(filePath)) return defaultValue;
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      logger.error(`Failed to read atomic JSON '${filePath}': ${e.message}`, 'WorldMemory');
      return defaultValue;
    }
  }

  _writeAtomicJson(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (e) {
      if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
      }
      logger.error(`Failed atomic write to '${filePath}': ${e.message}`, 'WorldMemory');
      throw e;
    }
  }

  // --- Landmarks Management ---

  getLandmarks(serverKey) {
    const filePath = path.join(this._getWorldDir(serverKey), 'landmarks.json');
    return this._readAtomicJson(filePath, {});
  }

  saveLandmark(serverKey, name, coords, description = '') {
    const filePath = path.join(this._getWorldDir(serverKey), 'landmarks.json');
    const landmarks = this.getLandmarks(serverKey);
    landmarks[name] = {
      name,
      coords: {
        x: Math.round(coords.x * 10) / 10,
        y: Math.round(coords.y * 10) / 10,
        z: Math.round(coords.z * 10) / 10,
      },
      description,
      updated_at: new Date().toISOString(),
    };
    this._writeAtomicJson(filePath, landmarks);
    logger.info(`📍 Saved landmark '${name}' at (${landmarks[name].coords.x}, ${landmarks[name].coords.y}, ${landmarks[name].coords.z}) for server [${serverKey}]`, 'WorldMemory');
    return landmarks[name];
  }

  deleteLandmark(serverKey, name) {
    const filePath = path.join(this._getWorldDir(serverKey), 'landmarks.json');
    const landmarks = this.getLandmarks(serverKey);
    if (landmarks[name]) {
      delete landmarks[name];
      this._writeAtomicJson(filePath, landmarks);
      return true;
    }
    return false;
  }

  // --- Chests Registry ---

  getChests(serverKey) {
    const filePath = path.join(this._getWorldDir(serverKey), 'chests.json');
    return this._readAtomicJson(filePath, {});
  }

  updateChest(serverKey, coords, items, label = '') {
    const key = `${coords.x}_${coords.y}_${coords.z}`;
    const filePath = path.join(this._getWorldDir(serverKey), 'chests.json');
    const chests = this.getChests(serverKey);
    chests[key] = {
      coords,
      label,
      items,
      updated_at: new Date().toISOString(),
    };
    this._writeAtomicJson(filePath, chests);
    logger.info(`📦 Updated chest registry at (${coords.x}, ${coords.y}, ${coords.z}) with ${items.length} item types.`, 'WorldMemory');
    return chests[key];
  }

  // --- High-Value Discovered Ores Registry ---

  getDiscoveredOres(serverKey) {
    const filePath = path.join(this._getWorldDir(serverKey), 'discovered_ores.json');
    return this._readAtomicJson(filePath, {});
  }

  recordDiscoveredOre(serverKey, oreName, coords) {
    const key = `${Math.floor(coords.x)}_${Math.floor(coords.y)}_${Math.floor(coords.z)}`;
    const filePath = path.join(this._getWorldDir(serverKey), 'discovered_ores.json');
    const ores = this.getDiscoveredOres(serverKey);
    if (!ores[key]) {
      ores[key] = {
        name: oreName,
        coords: {
          x: Math.floor(coords.x),
          y: Math.floor(coords.y),
          z: Math.floor(coords.z),
        },
        discovered_at: new Date().toISOString(),
      };
      this._writeAtomicJson(filePath, ores);
      logger.info(`💎 [WorldMemory] Recorded discovered high-tier ore vein '${oreName}' at (${ores[key].coords.x}, ${ores[key].coords.y}, ${ores[key].coords.z}) for server [${this._resolveServerKey(serverKey)}]`, 'WorldMemory');
    }
    return ores[key];
  }

  removeDiscoveredOre(serverKey, coords) {
    const key = `${Math.floor(coords.x)}_${Math.floor(coords.y)}_${Math.floor(coords.z)}`;
    const filePath = path.join(this._getWorldDir(serverKey), 'discovered_ores.json');
    const ores = this.getDiscoveredOres(serverKey);
    if (ores[key]) {
      delete ores[key];
      this._writeAtomicJson(filePath, ores);
      logger.info(`💎 [WorldMemory] Harvested and removed ore vein at (${coords.x}, ${coords.y}, ${coords.z}) from memory.`, 'WorldMemory');
      return true;
    }
    return false;
  }
}

const worldMemory = new WorldMemoryManager();

module.exports = {
  WorldMemoryManager,
  worldMemory,
};
