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

    // 0. Smelting / Cooking in Furnace (Evaluated when not an explicit mining task)
    if ((desc.includes('หลอม') || desc.includes('smelt') || desc.includes('เผาแร่') || desc.includes('เผา')) && !desc.startsWith('ขุด') && !desc.includes('ขุดแร่') && !desc.includes('คราฟต์เตาเผา') && !desc.includes('ทำเตาเผา')) {
      let item = 'raw_iron';
      if (desc.includes('ทองแดง') || desc.includes('copper')) item = 'raw_copper';
      else if (desc.includes('ทอง') || desc.includes('gold')) item = 'raw_gold';
      else if (desc.includes('เนื้อ') || desc.includes('beef') || desc.includes('pork') || desc.includes('mutton') || desc.includes('chicken')) item = 'raw_beef';
      const countMatch = desc.match(/(\d+)\s*(?:ก้อน|ชิ้น|อัน)?/);
      const count = countMatch ? parseInt(countMatch[1]) : 4;
      return {
        skill_name: 'smelt_item',
        args: { item_name: item, count },
      };
    }

    // 0.2 Return to Surface & Stock Up on Wood/Tools
    if (desc.includes('พื้นผิว') || desc.includes('ขึ้นบก') || desc.includes('surface') || desc.includes('กลับขึ้นไป') || desc.includes('กลับไปตัดไม้')) {
      return {
        skill_name: 'go_surface',
        args: {},
      };
    }

    // 0.3 Return to Remembered Ore Vein
    if (desc.includes('เคยพบ') || desc.includes('เคยบันทึก') || desc.includes('ความทรงจำ') || (desc.includes('พิกัด') && desc.includes('X='))) {
      const matchX = desc.match(/X\s*=\s*(-?\d+)/i);
      const matchY = desc.match(/Y\s*=\s*(-?\d+)/i);
      const matchZ = desc.match(/Z\s*=\s*(-?\d+)/i);
      if (matchX && matchY && matchZ) {
        return {
          skill_name: 'mine_remembered_ore',
          args: { x: parseInt(matchX[1]), y: parseInt(matchY[1]), z: parseInt(matchZ[1]) },
        };
      }
    }

    const isExplicitMining = desc.startsWith('ขุด') || desc.startsWith('mine') || desc.startsWith('dig') || desc.startsWith('ตัด') || desc.startsWith('chop') || desc.includes('ขุดแร่') || desc.includes('ขุดเจาะ');
    const isExplicitCrafting = (desc.startsWith('คราฟต์') || desc.startsWith('craft') || desc.startsWith('ทำ') || desc.startsWith('สร้าง') || desc.includes('คราฟต์')) && !isExplicitMining;

    // 1. Crafting Items (Prioritized when crafting is the main verb)
    if (isExplicitCrafting) {
      if (desc.includes('iron_pickaxe') || desc.includes('ที่ขุดเหล็ก')) return { skill_name: 'craft_item', args: { item_name: 'iron_pickaxe', count: 1 } };
      if (desc.includes('diamond_pickaxe') || desc.includes('ที่ขุดเพชร')) return { skill_name: 'craft_item', args: { item_name: 'diamond_pickaxe', count: 1 } };
      if (desc.includes('stone_pickaxe') || desc.includes('ที่ขุดหิน')) return { skill_name: 'craft_item', args: { item_name: 'stone_pickaxe', count: 1 } };
      if (desc.includes('wooden_pickaxe') || desc.includes('ที่ขุดไม้')) return { skill_name: 'craft_item', args: { item_name: 'wooden_pickaxe', count: 1 } };
      if (desc.includes('iron_sword') || desc.includes('ดาบเหล็ก')) return { skill_name: 'craft_item', args: { item_name: 'iron_sword', count: 1 } };
      if (desc.includes('diamond_sword') || desc.includes('ดาบเพชร')) return { skill_name: 'craft_item', args: { item_name: 'diamond_sword', count: 1 } };
      if (desc.includes('stone_sword') || desc.includes('ดาบหิน')) return { skill_name: 'craft_item', args: { item_name: 'stone_sword', count: 1 } };
      if (desc.includes('iron_axe') || desc.includes('ขวานเหล็ก')) return { skill_name: 'craft_item', args: { item_name: 'iron_axe', count: 1 } };
      if (desc.includes('stone_axe') || desc.includes('ขวานหิน')) return { skill_name: 'craft_item', args: { item_name: 'stone_axe', count: 1 } };
      if (desc.includes('wooden_axe') || desc.includes('ขวานไม้')) return { skill_name: 'craft_item', args: { item_name: 'wooden_axe', count: 1 } };
      if (desc.includes('shield') || desc.includes('โล่')) return { skill_name: 'craft_item', args: { item_name: 'shield', count: 1 } };
      if (desc.includes('iron_chestplate') || desc.includes('เสื้อเกราะเหล็ก')) return { skill_name: 'craft_item', args: { item_name: 'iron_chestplate', count: 1 } };
      if (desc.includes('iron_leggings') || desc.includes('กางเกงเกราะเหล็ก')) return { skill_name: 'craft_item', args: { item_name: 'iron_leggings', count: 1 } };
      if (desc.includes('iron_boots') || desc.includes('รองเท้าเกราะเหล็ก')) return { skill_name: 'craft_item', args: { item_name: 'iron_boots', count: 1 } };
      if (desc.includes('iron_helmet') || desc.includes('หมวกเกราะเหล็ก')) return { skill_name: 'craft_item', args: { item_name: 'iron_helmet', count: 1 } };
      if (desc.includes('diamond_chestplate') || desc.includes('เสื้อเกราะเพชร')) return { skill_name: 'craft_item', args: { item_name: 'diamond_chestplate', count: 1 } };
      if (desc.includes('furnace') || desc.includes('เตาเผา')) return { skill_name: 'craft_item', args: { item_name: 'furnace', count: 1 } };
      if (desc.includes('table') || desc.includes('โต๊ะคราฟต์') || desc.includes('crafting_table')) return { skill_name: 'craft_item', args: { item_name: 'crafting_table', count: 1 } };
      if (desc.includes('torch') || desc.includes('คบเพลิง')) return { skill_name: 'craft_item', args: { item_name: 'torch', count: 4 } };
      if (desc.includes('stick') || desc.includes('ไม้แท่ง')) return { skill_name: 'craft_item', args: { item_name: 'stick', count: 4 } };
      if (desc.includes('plank') || desc.includes('ไม้แปรรูป')) return { skill_name: 'craft_item', args: { item_name: 'oak_planks', count: 1 } };
    }

    // 2. Mining / Harvesting Tasks
    if (isExplicitMining) {
      if (desc.includes('coal') || desc.includes('ถ่าน')) return { skill_name: 'mine_ore', args: { ore_type: 'coal', count: 4 } };
      if (desc.includes('iron') || desc.includes('เหล็ก')) return { skill_name: 'mine_ore', args: { ore_type: 'iron', count: 4 } };
      if (desc.includes('gold') || desc.includes('ทอง')) return { skill_name: 'mine_ore', args: { ore_type: 'gold', count: 2 } };
      if (desc.includes('diamond') || desc.includes('เพชร')) return { skill_name: 'mine_ore', args: { ore_type: 'diamond', count: 2 } };
      if (desc.includes('wood') || desc.includes('log') || desc.includes('ไม้') || desc.includes('ตัดไม้')) return { skill_name: 'chop_tree', args: { count: 4 } };
      if (desc.includes('cobble') || desc.includes('stone') || desc.includes('หิน')) return { skill_name: 'mine_stone', args: { count: 6 } };
      return { skill_name: 'mine_stone', args: { count: 4 } };
    }

    // 2. Follow Player
    if (/follow|ตาม|เดินตาม|มานี่/i.test(desc)) {
      const match = desc.match(/(?:follow|ตาม|เดินตาม)\s+([a-zA-Z0-9_\u0E00-\u0E7F]+)/i);
      const target = match ? match[1] : null;
      return {
        skill_name: 'follow_player',
        args: { target_player: target, range: 2.0 },
      };
    }

    // 3. Collect Drops / Loot
    if (desc.includes('collect') || desc.includes('เก็บของ') || desc.includes('เก็บไอเทม') || desc.includes('loot') || desc.includes('เก็บดรอป')) {
      return {
        skill_name: 'collect_drops',
        args: { radius: 16 },
      };
    }

    // 4. Sleep in Bed
    if (desc.includes('sleep') || desc.includes('นอน') || desc.includes('ไปนอน') || desc.includes('หาเตียง')) {
      return {
        skill_name: 'sleep_bed',
        args: {},
      };
    }

    // 5. Eat Food
    if (desc.includes('กินอาหาร') || desc.includes('กินข้าว') || desc.includes('eat food') || desc.includes('หิว')) {
      return {
        skill_name: 'eat_food',
        args: {},
      };
    }

    // 6. Chop Tree
    if (desc.includes('ตัดไม้') || desc.includes('chop tree') || desc.includes('harvest wood') || desc.includes('หาไม้')) {
      const match = desc.match(/(\d+)\s*(?:บล็อก|ต้น|ท่อน)/);
      const count = match ? parseInt(match[1]) : 2;
      return {
        skill_name: 'chop_tree',
        args: { count },
      };
    }

    // 7. Mine Stone (Exclude 'ที่ขุด' tool crafting keywords)
    if (!desc.includes('ที่ขุด') && !desc.includes('คราฟต์') && (desc.includes('ขุดหิน') || desc.includes('mine stone') || desc.includes('cobblestone'))) {
      const match = desc.match(/(\d+)\s*(?:ก้อน|บล็อก)/);
      const count = match ? parseInt(match[1]) : 4;
      return {
        skill_name: 'mine_stone',
        args: { count },
      };
    }

    // 8. Mine Ores (Iron, Coal, Diamond, Copper, Gold)
    if (!desc.includes('คราฟต์') && (desc.includes('ขุดแร่') || desc.includes('iron ore') || desc.includes('coal ore') || desc.includes('diamond') || desc.includes('แร่เหล็ก') || desc.includes('ถ่านหิน') || desc.includes('เพชร'))) {
      let oreType = 'iron';
      if (desc.includes('ถ่าน') || desc.includes('coal')) oreType = 'coal';
      else if (desc.includes('เพชร') || desc.includes('diamond')) oreType = 'diamond';
      else if (desc.includes('ทอง') || desc.includes('gold')) oreType = 'gold';
      else if (desc.includes('ทองแดง') || desc.includes('copper')) oreType = 'copper';

      return {
        skill_name: 'mine_ore',
        args: { ore_type: oreType, count: 4 },
      };
    }

    // 9. Smelt Items (Furnace)
    if (desc.includes('หลอม') || desc.includes('smelt') || desc.includes('เผาแร่') || desc.includes('เตาเผา')) {
      return {
        skill_name: 'smelt_item',
        args: { item_name: 'raw_iron', count: 1 },
      };
    }

    // 10. Staircase Mining Down
    if (desc.includes('ขุดบันได') || desc.includes('staircase') || desc.includes('ลงใต้ดิน')) {
      const match = desc.match(/Y\s*=\s*(-?\d+)/i);
      const targetY = match ? parseInt(match[1]) : 16;
      return {
        skill_name: 'staircase_mine',
        args: { target_y: targetY },
      };
    }

    // 11. Go to Surface
    if (desc.includes('พื้นผิว') || desc.includes('ขึ้นบก') || desc.includes('surface')) {
      return {
        skill_name: 'go_surface',
        args: {},
      };
    }

    // 12. Swim Up & Breathe / Air Pocket
    if (desc.includes('ว่ายน้ำ') || desc.includes('จมน้ำ') || desc.includes('swim') || desc.includes('หายใจ') || desc.includes('เหนือน้ำ')) {
      return {
        skill_name: 'swim_up',
        args: {},
      };
    }

    // 13. Defend Area / Guard
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
