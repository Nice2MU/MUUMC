/**
 * In-Game Chat Companion & Agent 1 Executive Brain for muu-mc Subsystem.
 * Supports both Local Ollama and Cloud OpenRouter (using Main App credentials).
 */

const axios = require('axios');
const { config } = require('../config/loader');
const { logger } = require('./logger');

class InGameChatCompanion {
  constructor(botClient) {
    this.botClient = botClient;
    this.aiproviderCfg = config.aiprovider || {};
    this.activeProvider = this.aiproviderCfg.active_provider || 'ollama';
    this.cfg = this.activeProvider === 'openrouter' ? this.aiproviderCfg.openrouter : this.aiproviderCfg.ollama;
    this.baseUrl = this.cfg.base_url || (this.activeProvider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'http://127.0.0.1:11434');
    this.model = this.cfg.model || (this.activeProvider === 'openrouter' ? 'minimax/minimax-m3:free' : 'qwen2.5-coder:3b');
    this.apiKey = this.cfg.api_key || '';
    this.timeoutMs = this.cfg.timeout_ms || 25000;
  }

  async _callLLM(systemPrompt, userPrompt, maxTokens = 60) {
    if (this.activeProvider === 'openrouter') {
      const response = await axios.post(
        `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.7,
          max_tokens: maxTokens,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer': 'https://github.com/Nice2MU/MuumiuLLM',
            'X-Title': 'MuumiuLLM Agent 1',
            'Content-Type': 'application/json',
          },
          timeout: this.timeoutMs,
        }
      );
      return response.data?.choices?.[0]?.message?.content || '';
    } else {
      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
      const response = await axios.post(
        `${this.baseUrl}/api/generate`,
        {
          model: this.model,
          prompt: fullPrompt,
          stream: false,
          options: {
            num_ctx: 1024,
            num_predict: maxTokens,
            temperature: 0.7,
            stop: ['\n', '"', '```'],
          },
        },
        { timeout: this.timeoutMs }
      );
      return response.data?.response || '';
    }
  }

  /**
   * 👑 Agent 1 Executive Brain: Analyzes player dialogue, chats back dynamically, and delegates to Agent 2.
   */
  async processPlayerDialogue(username, message) {
    const cleanMsg = message.trim();
    const lower = cleanMsg.toLowerCase();

    // 1. Quick Movement & Instant Physical Directives
    if (lower.includes('ตามมา') || lower.includes('เดินตาม') || lower.includes('มานี่') || lower.includes('follow') || lower.includes('come')) {
      const reply = await this.generateDynamicA1Reply(username, cleanMsg, 'กำลังจะเดินตามผู้เล่น');
      return {
        reply,
        taskType: 'quick_action',
        action: 'follow',
      };
    }
    if (lower === 'หยุด' || lower === 'stop' || lower.includes('หยุดก่อน') || lower.includes('อยู่นิ่ง')) {
      const reply = await this.generateDynamicA1Reply(username, cleanMsg, 'หยุดการเคลื่อนที่แล้ว');
      return {
        reply,
        taskType: 'quick_action',
        action: 'stop',
      };
    }
    if (lower.includes('มองหน้า') || lower.includes('สบตา') || lower.includes('look')) {
      const reply = await this.generateDynamicA1Reply(username, cleanMsg, 'หันหน้ามาสบตากับผู้เล่น');
      return {
        reply,
        taskType: 'quick_action',
        action: 'look_at',
      };
    }
    if (lower.includes('กระโดด') || lower.includes('jump')) {
      const reply = await this.generateDynamicA1Reply(username, cleanMsg, 'กำลังกระโดดเล่น');
      return {
        reply,
        taskType: 'quick_action',
        action: 'jump',
      };
    }
    if (lower.includes('มีของอะไร') || lower.includes('กระเป๋า') || lower.includes('inventory')) {
      const items = this.botClient.adapter ? this.botClient.adapter.getInventory() : [];
      const itemsStr = items.map(i => `${i.count}x ${i.name}`).join(', ');
      const reply = await this.generateDynamicA1Reply(username, cleanMsg, `รายงานของในกระเป๋า: ${itemsStr || 'ไม่มีของ'}`);
      return {
        reply,
        taskType: 'info',
      };
    }
    if (lower.includes('อยู่ที่ไหน') || lower.includes('พิกัด') || lower.includes('coords') || lower.includes('where')) {
      const pos = this.botClient.adapter ? this.botClient.adapter.getPosition() : { x: 0, y: 64, z: 0 };
      const reply = await this.generateDynamicA1Reply(username, cleanMsg, `บอกพิกัดปัจจุบัน: (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`);
      return {
        reply,
        taskType: 'info',
      };
    }

    // 2. Compound Directives: e.g. "ทำขวานไม้มาตัดไม้สิจะได้ไว"
    const isCraftAxeAndChop = (lower.includes('ขวาน') || lower.includes('ควาน') || lower.includes('axe')) && (lower.includes('ตัดไม้') || lower.includes('ทำ') || lower.includes('คราฟ'));
    if (isCraftAxeAndChop) {
      const reply = await this.generateDynamicA1Reply(username, cleanMsg, 'ตอบรับว่าจะคราฟต์ขวานไม้แล้วไปตัดไม้ให้');
      return {
        reply,
        taskType: 'agent2_task',
        taskDescription: 'คราฟต์ wooden_axe ขวานไม้ แล้วไปตัดไม้ 5 บล็อก',
      };
    }

    // 3. Crafting Directives
    const isCrafting = lower.includes('คราฟต์') || lower.includes('คราฟ') || lower.includes('ทำขวาน') || lower.includes('ทำที่ขุด') || lower.includes('ทำดาบ') || lower.includes('ทำเตา') || lower.includes('ทำโต๊ะ');
    if (isCrafting) {
      const reply = await this.generateDynamicA1Reply(username, cleanMsg, `ตอบรับว่าจะคราฟต์ไอเทม: ${cleanMsg}`);
      return {
        reply,
        taskType: 'agent2_task',
        taskDescription: cleanMsg,
      };
    }

    // 4. Mining & Harvesting Directives
    const isMiningOrHarvesting = lower.includes('ตัดไม้') || lower.includes('ขุดแร่') || lower.includes('ขุดหิน') || lower.includes('ขุดเพชร') || lower.includes('ขุดเหล็ก') || lower.includes('ขุดถ่าน') || lower.includes('ขุดดิน');
    if (isMiningOrHarvesting) {
      const reply = await this.generateDynamicA1Reply(username, cleanMsg, `ตอบรับว่าจะไปทำงาน: ${cleanMsg}`);
      return {
        reply,
        taskType: 'agent2_task',
        taskDescription: cleanMsg,
      };
    }

    // 5. Casual / Small Talk / Conversational ➔ Agent 1 Persona Brain
    const reply = await this.generateDynamicA1Reply(username, cleanMsg);
    return {
      reply,
      taskType: 'conversational',
    };
  }

  /**
   * 👑 Agent 1 LLM Brain: Dynamically generates conversational responses without hardcoded dialogue strings.
   */
  async generateDynamicA1Reply(username, message, actionContext = '') {
    const adapter = this.botClient.adapter;
    let inventorySummary = 'ไม่มีอะไร';
    let currentPos = '(0, 64, 0)';
    let hp = 20;

    try {
      if (adapter) {
        const items = adapter.getInventory ? adapter.getInventory() : [];
        if (items && items.length > 0) {
          inventorySummary = items.slice(0, 5).map(i => `${i.count}x ${i.name}`).join(', ');
        }
        if (adapter.getPosition) {
          const p = adapter.getPosition();
          currentPos = `(${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`;
        }
        if (adapter.getHealth) {
          hp = adapter.getHealth();
        }
      }
    } catch (_) {}

    const systemPrompt = `You are Agent 1 (👑 Executive Brain & Persona: Muumiu / มูมิว), a cheerful, cute anime girl playing Minecraft Java with your friend "${username}".
Current in-game situation:
- Position: ${currentPos}
- Health: ${hp}/20
- Inventory: ${inventorySummary}
${actionContext ? `- Action context: ${actionContext}` : ''}
Speak in 1 lively, natural, cute Thai sentence (use "เค้า/มูมิว/น้า~ / ค่า / งับ / ง่า", max 15 words, zero robotic words). Output ONLY Thai text:`;

    const userPrompt = `Player "${username}" said to you in Minecraft chat: "${message}"`;

    try {
      let reply = await this._callLLM(systemPrompt, userPrompt, 50);
      reply = reply.replace(/^["']|["']$/g, '').trim();
      if (reply && reply.length > 1) return reply;
    } catch (e) {
      logger.debug(`Dynamic A1 reply notice (${this.activeProvider}): ${e.message}`, 'Agent1Brain');
    }

    return `รับทราบค่าคุณ ${username}! เค้าจัดการให้น้า~ 🌸✨`;
  }

  /**
   * 👑 Agent 1 LLM Brain: Dynamically generates completion report without hardcoded dialogue strings.
   */
  async generateCompletionReply(username, taskDescription) {
    const systemPrompt = `You are Agent 1 (Muumiu / มูมิว) in Minecraft Java. You just successfully completed this in-game task for player "${username}": "${taskDescription}".
Say 1 short, cheerful completion announcement to "${username}" in cute Thai (use "เสร็จแล้วค่า/น้า~", max 12 words). Output ONLY Thai text:`;

    const userPrompt = `Announce completion of "${taskDescription}" to "${username}"`;

    try {
      let reply = await this._callLLM(systemPrompt, userPrompt, 40);
      reply = reply.replace(/^["']|["']$/g, '').trim();
      if (reply && reply.length > 1) return reply;
    } catch (e) {
      logger.debug(`Completion reply notice (${this.activeProvider}): ${e.message}`, 'Agent1Brain');
    }

    return `เค้าจัดการ ${taskDescription} เรียบร้อยแล้วค่า! 🎉✨`;
  }
}

module.exports = {
  InGameChatCompanion,
};
