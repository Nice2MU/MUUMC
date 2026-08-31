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

  _getWorldDir(serverKey) {
    const dir = path.join(this.baseDataDir, 'worlds', serverKey);
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
}

const worldMemory = new WorldMemoryManager();

module.exports = {
  WorldMemoryManager,
  worldMemory,
};
