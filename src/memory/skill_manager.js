/**
 * Skill Manager & Skill Cache Matcher for Agent 2.
 * Manages parameterized JavaScript skill library with ultra-fast Cache-Hit (<0.1s).
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../bot/logger');
const { sandbox } = require('../coder/sandbox');

class SkillManager {
  constructor(dataDir = path.resolve(__dirname, '../../data')) {
    this.dataDir = dataDir;
    this.skillsDir = path.join(dataDir, 'skills');
    this.registryFile = path.join(dataDir, 'skills_registry.json');
    this._ensureDirectories();
  }

  _ensureDirectories() {
    if (!fs.existsSync(this.skillsDir)) {
      fs.mkdirSync(this.skillsDir, { recursive: true });
    }
  }

  getRegistry() {
    if (!fs.existsSync(this.registryFile)) return {};
    try {
      return JSON.parse(fs.readFileSync(this.registryFile, 'utf8'));
    } catch (e) {
      logger.error(`Error loading skills registry: ${e.message}`, 'SkillManager');
      return {};
    }
  }

  _saveRegistry(registry) {
    const tmp = `${this.registryFile}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), 'utf8');
    fs.renameSync(tmp, this.registryFile);
  }

  getSkill(name) {
    const registry = this.getRegistry();
    const meta = registry[name];
    if (!meta) return null;

    const skillPath = path.join(this.skillsDir, meta.file || `${name}.js`);
    if (!fs.existsSync(skillPath)) return null;

    const code = fs.readFileSync(skillPath, 'utf8');
    return {
      ...meta,
      code,
    };
  }

  /**
   * Fast Skill Cache Matcher (<0.1s).
   * Determines if a task description matches an existing parameterized skill.
   */
  matchSkill(taskDescription) {
    if (!taskDescription) return null;
    const desc = taskDescription.trim();

    // 1. Follow Player
    if (/follow|ตาม|เดินตาม|มานี่/i.test(desc)) {
      const match = desc.match(/(?:follow|ตาม|เดินตาม)\s+([a-zA-Z0-9_\u0E00-\u0E7F]+)/i);
      const target = match ? match[1] : null;
      return {
        skill_name: 'follow_player',
        args: { target_player: target, range: 2.0 },
      };
    }

    // 2. Collect Drops / Loot
    if (desc.includes('collect') || desc.includes('เก็บของ') || desc.includes('เก็บไอเทม') || desc.includes('loot') || desc.includes('เก็บดรอป')) {
      return {
        skill_name: 'collect_drops',
        args: { radius: 16 },
      };
    }

    // 3. Sleep in Bed
    if (desc.includes('sleep') || desc.includes('นอน') || desc.includes('ไปนอน') || desc.includes('หาเตียง')) {
      return {
        skill_name: 'sleep_bed',
        args: {},
      };
    }

    // 4. Defend Area / Guard
    if (desc.includes('defend') || desc.includes('คุ้มกัน') || desc.includes('ป้องกัน') || desc.includes('ดูแล')) {
      return {
        skill_name: 'defend_area',
        args: { radius: 16 },
      };
    }

    return null;
  }

  /**
   * Saves a newly verified skill to the persistent library.
   */
  registerSkill(name, meta, code) {
    const filename = `${name}.js`;
    const skillPath = path.join(this.skillsDir, filename);

    // Save skill file
    fs.writeFileSync(skillPath, code, 'utf8');

    // Update registry
    const registry = this.getRegistry();
    registry[name] = {
      name,
      description: meta.description || '',
      category: meta.category || 'general',
      parameters: meta.parameters || {},
      file: filename,
      created_at: new Date().toISOString(),
    };
    this._saveRegistry(registry);

    logger.info(`✨ Registered new skill '${name}' to library.`, 'SkillManager');
    return registry[name];
  }

  listSkills() {
    const registry = this.getRegistry();
    return Object.values(registry);
  }
}

const skillManager = new SkillManager();

module.exports = {
  SkillManager,
  skillManager,
};
