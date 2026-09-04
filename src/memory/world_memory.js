/**
 * World Memory Manager for muu-mc (Two-Tier Memory System).
 * Manages Server-Specific World Data (Landmarks, Chest Inventories, Discovered Ores, Adventure Diary)
 * and Global Player Profiles & Conversational History with Strict Server Keying and Atomic Storage.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../bot/logger');

class WorldMemoryManager {
  constructor(baseDataDir = path.resolve(__dirname, '../../data')) {
    this.baseDataDir = baseDataDir;
    this.globalMemoryDir = this._resolveGlobalMemoryDir();
  }

  _resolveGlobalMemoryDir() {
    const candidatePaths = [
      path.resolve(__dirname, '../../../../data/memory/minecraft'),
      path.resolve(process.cwd(), 'data/memory/minecraft'),
      path.resolve(this.baseDataDir, 'minecraft'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) return p;
    }
    return candidatePaths[0];
  }

  _resolveServerKey(serverKey) {
    if (serverKey) {
      return String(serverKey).replace(/[^a-zA-Z0-9.-]/g, '_');
    }
    try {
      const { config } = require('../config/loader');
      const srv = config.minecraft?.server || config.minecraft || {};
      const host = (srv.host || '127.0.0.1').replace(/[^a-zA-Z0-9.-]/g, '_');
      const port = srv.port || 25565;
      return `${host}_${port}`;
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

  _getGlobalDir() {
    if (!fs.existsSync(this.globalMemoryDir)) {
      fs.mkdirSync(this.globalMemoryDir, { recursive: true });
    }
    return this.globalMemoryDir;
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
    const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
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

  // =========================================================================
  // 📍 1. Landmarks Management
  // =========================================================================

  getLandmarks(serverKey) {
    const filePath = path.join(this._getWorldDir(serverKey), 'landmarks.json');
    return this._readAtomicJson(filePath, {});
  }

  saveLandmark(serverKey, name, coords, description = '') {
    const resolvedKey = this._resolveServerKey(serverKey);
    const filePath = path.join(this._getWorldDir(resolvedKey), 'landmarks.json');
    const landmarks = this.getLandmarks(resolvedKey);
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
    logger.info(`📍 Saved landmark '${name}' at (${landmarks[name].coords.x}, ${landmarks[name].coords.y}, ${landmarks[name].coords.z}) for server [${resolvedKey}]`, 'WorldMemory');
    return landmarks[name];
  }

  /**
   * Convenience alias accepting individual coordinates: setLandmark(name, x, y, z, desc, serverKey)
   */
  setLandmark(name, x, y, z, description = '', serverKey = null) {
    return this.saveLandmark(serverKey, name, { x, y, z }, description);
  }

  deleteLandmark(serverKey, name) {
    const resolvedKey = this._resolveServerKey(serverKey);
    const filePath = path.join(this._getWorldDir(resolvedKey), 'landmarks.json');
    const landmarks = this.getLandmarks(resolvedKey);
    if (landmarks[name]) {
      delete landmarks[name];
      this._writeAtomicJson(filePath, landmarks);
      logger.info(`🗑️ Deleted landmark '${name}' from server [${resolvedKey}]`, 'WorldMemory');
      return true;
    }
    return false;
  }

  findNearestLandmark(serverKey, coords) {
    if (!coords) return null;
    const landmarks = Object.values(this.getLandmarks(serverKey));
    if (landmarks.length === 0) return null;

    let nearest = null;
    let minDistance = Infinity;

    for (const lm of landmarks) {
      const dist = Math.hypot(lm.coords.x - coords.x, lm.coords.z - coords.z);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = { ...lm, distance: Math.round(dist * 10) / 10 };
      }
    }
    return nearest;
  }

  // =========================================================================
  // 📦 2. Chests Registry
  // =========================================================================

  getChests(serverKey) {
    const filePath = path.join(this._getWorldDir(serverKey), 'chests.json');
    return this._readAtomicJson(filePath, {});
  }

  updateChest(serverKey, coords, items = [], label = '') {
    const resolvedKey = this._resolveServerKey(serverKey);
    const key = `${Math.floor(coords.x)}_${Math.floor(coords.y)}_${Math.floor(coords.z)}`;
    const filePath = path.join(this._getWorldDir(resolvedKey), 'chests.json');
    const chests = this.getChests(resolvedKey);
    chests[key] = {
      coords: {
        x: Math.floor(coords.x),
        y: Math.floor(coords.y),
        z: Math.floor(coords.z),
      },
      label: label || (chests[key]?.label || 'Storage Chest'),
      items: items.map(i => ({ name: i.name, count: i.count })),
      updated_at: new Date().toISOString(),
    };
    this._writeAtomicJson(filePath, chests);
    logger.info(`📦 Updated chest at (${coords.x}, ${coords.y}, ${coords.z}) with ${items.length} item types in server [${resolvedKey}]`, 'WorldMemory');
    return chests[key];
  }

  findNearestChest(serverKey, coords) {
    if (!coords) return null;
    const chests = Object.values(this.getChests(serverKey));
    if (chests.length === 0) return null;

    let nearest = null;
    let minDistance = Infinity;

    for (const chest of chests) {
      const dist = Math.hypot(chest.coords.x - coords.x, chest.coords.z - coords.z);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = { ...chest, distance: Math.round(dist * 10) / 10 };
      }
    }
    return nearest;
  }

  // =========================================================================
  // 💎 3. High-Value Discovered Ores Registry
  // =========================================================================

  getDiscoveredOres(serverKey) {
    const filePath = path.join(this._getWorldDir(serverKey), 'discovered_ores.json');
    return this._readAtomicJson(filePath, {});
  }

  recordDiscoveredOre(serverKey, oreName, coords) {
    const resolvedKey = this._resolveServerKey(serverKey);
    const key = `${Math.floor(coords.x)}_${Math.floor(coords.y)}_${Math.floor(coords.z)}`;
    const filePath = path.join(this._getWorldDir(resolvedKey), 'discovered_ores.json');
    const ores = this.getDiscoveredOres(resolvedKey);
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
      logger.info(`💎 [WorldMemory] Recorded discovered high-tier ore vein '${oreName}' at (${ores[key].coords.x}, ${ores[key].coords.y}, ${ores[key].coords.z}) for server [${resolvedKey}]`, 'WorldMemory');
    }
    return ores[key];
  }

  removeDiscoveredOre(serverKey, coords) {
    const resolvedKey = this._resolveServerKey(serverKey);
    const key = `${Math.floor(coords.x)}_${Math.floor(coords.y)}_${Math.floor(coords.z)}`;
    const filePath = path.join(this._getWorldDir(resolvedKey), 'discovered_ores.json');
    const ores = this.getDiscoveredOres(resolvedKey);
    if (ores[key]) {
      delete ores[key];
      this._writeAtomicJson(filePath, ores);
      logger.info(`💎 [WorldMemory] Harvested and removed ore vein at (${coords.x}, ${coords.y}, ${coords.z}) from memory.`, 'WorldMemory');
      return true;
    }
    return false;
  }

  // =========================================================================
  // 📖 4. Episodic Adventure Diary
  // =========================================================================

  getDiary(serverKey) {
    const resolvedKey = this._resolveServerKey(serverKey);
    const localDiaryPath = path.join(this._getWorldDir(resolvedKey), 'adventure_diary.json');
    const localDiary = this._readAtomicJson(localDiaryPath, null);
    if (Array.isArray(localDiary) && localDiary.length > 0) {
      return localDiary;
    }

    // Fallback to global adventure diary
    const globalDiaryPath = path.join(this._getGlobalDir(), 'adventure_diary.json');
    return this._readAtomicJson(globalDiaryPath, []);
  }

  recordDiaryEvent(serverKey, title, content, emotion = 'happy') {
    const resolvedKey = this._resolveServerKey(serverKey);
    const entry = {
      id: `diary_${Date.now()}`,
      timestamp: new Date().toISOString(),
      server: resolvedKey,
      title,
      content,
      emotion,
    };

    // 1. Write to local server diary
    const localDiaryPath = path.join(this._getWorldDir(resolvedKey), 'adventure_diary.json');
    const localDiary = this._readAtomicJson(localDiaryPath, []);
    localDiary.unshift(entry);
    const trimmedLocal = localDiary.slice(0, 50);
    this._writeAtomicJson(localDiaryPath, trimmedLocal);

    // 2. Write to global adventure diary for desktop app sync
    try {
      const globalDiaryPath = path.join(this._getGlobalDir(), 'adventure_diary.json');
      const globalDiary = this._readAtomicJson(globalDiaryPath, []);
      globalDiary.unshift(entry);
      const trimmedGlobal = globalDiary.slice(0, 50);
      this._writeAtomicJson(globalDiaryPath, trimmedGlobal);
    } catch (err) {
      logger.debug(`Notice writing global diary: ${err.message}`, 'WorldMemory');
    }

    logger.info(`📖 [AdventureDiary] Recorded milestone: "${title}" (${emotion})`, 'WorldMemory');
    return entry;
  }

  // =========================================================================
  // 👤 5. Player Profiles & Conversational Memory
  // =========================================================================

  _getPlayerProfilesFile() {
    const globalPath = path.join(this._getGlobalDir(), 'player_profiles.json');
    if (fs.existsSync(globalPath)) return globalPath;
    const localPath = path.join(this.baseDataDir, 'player_profiles.json');
    return localPath;
  }

  getPlayerProfiles() {
    const filePath = this._getPlayerProfilesFile();
    return this._readAtomicJson(filePath, {
      player_name: 'ไนท์ทูมู',
      preferred_call: 'คุณไนท์ทูมู',
      game_style: 'Builder & Adventurer',
      favorite_items: ['diamond', 'cherry_wood', 'elytra'],
      notes: 'ชอบสร้างบ้านสวยงามและสำรวจโลกกับมูมิว เป็นเพื่อนสนิทที่มูมิวรักที่สุด',
      updated_at: new Date().toISOString(),
      players: {},
    });
  }

  getPlayerProfile(username) {
    const profiles = this.getPlayerProfiles();
    const cleanUser = (username || '').trim();
    const lowerUser = cleanUser.toLowerCase();

    // Check if this is the master user Nice2MU (case-insensitive)
    const isMaster = lowerUser === 'nice2mu' || cleanUser === 'ไนท์ทูมู' || cleanUser === 'คุณไนท์ทูมู' || !cleanUser;

    if (isMaster) {
      const playerRecord = profiles.players?.nice2mu || {};
      return {
        player_name: profiles.player_name || 'ไนท์ทูมู',
        preferred_call: profiles.preferred_call || 'คุณไนท์ทูมู',
        is_master_user: true,
        game_style: profiles.game_style || 'Builder & Adventurer',
        favorite_items: profiles.favorite_items || ['diamond', 'cherry_wood', 'elytra'],
        notes: profiles.notes || 'ชอบสร้างบ้านสวยงามและสำรวจโลกกับมูมิว',
        relationship: 'เพื่อนสนิทที่ไว้ใจได้ที่สุด',
        trust: 100,
        chat_history: playerRecord.chat_history || [],
      };
    }

    // Other player profile
    const existing = profiles.players?.[lowerUser];
    if (existing) {
      return {
        player_name: existing.player_name || cleanUser,
        preferred_call: existing.preferred_call || `คุณ ${cleanUser}`,
        is_master_user: false,
        game_style: existing.game_style || 'Explorer',
        favorite_items: existing.favorite_items || [],
        notes: existing.notes || 'ผู้เล่นในเซิร์ฟเวอร์ Minecraft',
        relationship: existing.relationship || 'เพื่อนร่วมเซิร์ฟเวอร์',
        trust: existing.trust || 60,
        chat_history: existing.chat_history || [],
      };
    }

    // Default new player profile
    return {
      player_name: cleanUser,
      preferred_call: `คุณ ${cleanUser}`,
      is_master_user: false,
      game_style: 'Explorer',
      favorite_items: [],
      notes: 'ผู้เล่นใหม่ในเซิร์ฟเวอร์ Minecraft',
      relationship: 'เพื่อนร่วมเซิร์ฟเวอร์',
      trust: 50,
      chat_history: [],
    };
  }

  updatePlayerProfile(username, data = {}) {
    const filePath = this._getPlayerProfilesFile();
    const profiles = this.getPlayerProfiles();
    const cleanUser = (username || '').trim();
    const lowerUser = cleanUser.toLowerCase();
    const isMaster = lowerUser === 'nice2mu' || cleanUser === 'ไนท์ทูมู' || !cleanUser;

    if (!profiles.players) profiles.players = {};

    if (isMaster) {
      if (data.player_name) profiles.player_name = data.player_name;
      if (data.preferred_call) profiles.preferred_call = data.preferred_call;
      if (data.game_style) profiles.game_style = data.game_style;
      if (data.favorite_items) profiles.favorite_items = data.favorite_items;
      if (data.notes) profiles.notes = data.notes;
      profiles.updated_at = new Date().toISOString();

      profiles.players.nice2mu = {
        ...(profiles.players.nice2mu || {}),
        ...data,
        player_name: profiles.player_name,
        preferred_call: profiles.preferred_call,
        updated_at: new Date().toISOString(),
      };
    } else {
      profiles.players[lowerUser] = {
        ...(profiles.players[lowerUser] || {}),
        ...data,
        player_name: cleanUser,
        updated_at: new Date().toISOString(),
      };
    }

    this._writeAtomicJson(filePath, profiles);
    logger.info(`👤 Updated player profile for '${cleanUser}'`, 'WorldMemory');
    return this.getPlayerProfile(username);
  }

  recordPlayerChat(username, role, message) {
    if (!message || !message.trim()) return;
    const filePath = this._getPlayerProfilesFile();
    const profiles = this.getPlayerProfiles();
    const cleanUser = (username || '').trim() || 'Nice2MU';
    const lowerUser = cleanUser.toLowerCase();

    if (!profiles.players) profiles.players = {};
    const key = lowerUser === 'nice2mu' || cleanUser === 'ไนท์ทูมู' ? 'nice2mu' : lowerUser;

    if (!profiles.players[key]) {
      profiles.players[key] = {
        player_name: cleanUser,
        chat_history: [],
      };
    }

    if (!Array.isArray(profiles.players[key].chat_history)) {
      profiles.players[key].chat_history = [];
    }

    profiles.players[key].chat_history.push({
      role,
      message: message.trim(),
      timestamp: new Date().toISOString(),
    });

    // Keep last 10 turns of dialogue
    if (profiles.players[key].chat_history.length > 10) {
      profiles.players[key].chat_history = profiles.players[key].chat_history.slice(-10);
    }

    profiles.updated_at = new Date().toISOString();
    this._writeAtomicJson(filePath, profiles);
  }
}

const worldMemory = new WorldMemoryManager();

module.exports = {
  WorldMemoryManager,
  worldMemory,
};
