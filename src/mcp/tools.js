/**
 * MCP Tools Suite (7 Tools) for muu-mc Subsystem.
 * Exposes Minecraft automation capabilities to MuumiuLLM (Agent 1).
 */

const { logger } = require('../bot/logger');
const { botClient } = require('../bot/client');
const { aiCoderAgent } = require('../coder/agent');
const { sandbox } = require('../coder/sandbox');
const { debuggerInstance } = require('../coder/debugger');
const { skillManager } = require('../memory/skill_manager');
const { worldMemory } = require('../memory/world_memory');
const { reflectionManager } = require('../memory/reflection_manager');

const TOOL_DEFINITIONS = [
  {
    name: 'muu_mc_execute_task',
    description: 'Instructs the Minecraft bot to execute an autonomous task. Uses Skill Cache or writes new code with Tactical AI Coder & Self-Healing Debugger.',
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The task description in Thai or English (e.g., "ตัดไม้โอ๊ค 5 บล็อก", "คราฟต์ดาบหิน", "เดินตาม Nice2MU")',
        },
        context_hint: {
          type: 'string',
          description: 'Optional additional context or instructions.',
        },
      },
      required: ['task'],
    },
  },
  {
    name: 'muu_mc_quick_action',
    description: 'Executes an instant basic action (<0.1s) without calling AI Coder. Actions: "follow", "stop", "look_at", "jump", "come_here".',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['follow', 'stop', 'look_at', 'jump', 'come_here'],
          description: 'The instant action to perform',
        },
        target_player: {
          type: 'string',
          description: 'Target player username (for follow / look_at)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'muu_mc_get_game_state',
    description: 'Retrieves real-time Minecraft telemetry (coordinates, HP, food, 36-slot inventory, nearby blocks and mobs).',
    inputSchema: {
      type: 'object',
      properties: {
        detail_level: {
          type: 'string',
          enum: ['summary', 'full', 'inventory_only', 'nearby_blocks'],
          description: 'Detail level of information to retrieve',
          default: 'summary',
        },
      },
    },
  },
  {
    name: 'muu_mc_chat_in_game',
    description: 'Sends a message to the Minecraft in-game chat box for other players to see.',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The chat message to broadcast in-game',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'muu_mc_save_landmark',
    description: 'Saves the current bot position or custom coordinates as a named landmark (e.g., "บ้าน", "เหมือง", "ฟาร์ม") in world memory.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the landmark (e.g., "บ้านหลัก", "เหมืองเหล็ก")',
        },
        description: {
          type: 'string',
          description: 'Description or notes about this location',
        },
        coords: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          description: 'Optional custom coordinates. If omitted, uses current bot position.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'muu_mc_list_skills',
    description: 'Lists all available technical JavaScript skills in the library.',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Optional category filter (e.g. "movement", "crafting", "gathering", "combat")',
        },
      },
    },
  },
  {
    name: 'muu_mc_manage_memory',
    description: 'Manages player profile and adventure memories for the Minecraft world.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get_landmarks', 'get_chests', 'get_reflections'],
          description: 'Action to perform',
        },
      },
      required: ['action'],
    },
  },
];

class MCPToolHandler {
  static async handleToolCall(name, args, isAutonomous = false) {
    logger.info(`⚡ Handling MCP Tool: '${name}' with args: ${JSON.stringify(args)}`, 'MCPTools');

    if (!isAutonomous && botClient.autonomousEngine) {
      botClient.autonomousEngine.notifyTaskStarted();
    }

    try {
      switch (name) {
        case 'muu_mc_execute_task':
          return await this._handleExecuteTask(args);
        case 'muu_mc_quick_action':
          return await this._handleQuickAction(args);
        case 'muu_mc_get_game_state':
          return await this._handleGetGameState(args);
        case 'muu_mc_chat_in_game':
          return await this._handleChatInGame(args);
        case 'muu_mc_save_landmark':
          return await this._handleSaveLandmark(args);
        case 'muu_mc_list_skills':
          return await this._handleListSkills(args);
        case 'muu_mc_manage_memory':
          return await this._handleManageMemory(args);
        default:
          throw new Error(`Unknown MCP Tool: ${name}`);
      }
    } finally {
      if (!isAutonomous && botClient.autonomousEngine) {
        botClient.autonomousEngine.notifyTaskCompleted();
      }
    }
  }

  static async _handleExecuteTask(args) {
    const task = args.task;
    if (!task) throw new Error('Task description is required.');

    const dsl = botClient.dsl;
    const adapter = botClient.adapter;
    const stateScanner = botClient.stateScanner;

    const rawState = stateScanner ? stateScanner.getBotStatus('full') : { position: { x: 0, y: 0, z: 0 }, health: 20, food: 20 };
    const world = {
      ...rawState,
      getY: () => adapter ? adapter.getPosition().y : (rawState.position?.y || 64),
      getPosition: () => adapter ? adapter.getPosition() : rawState.position,
      hasItem: (name) => adapter ? adapter.hasItem(name) : false,
      countItem: (name) => adapter ? adapter.countItem(name) : 0,
      findBlocks: (opt) => adapter ? adapter.findBlocks(opt) : [],
      findEntity: (opt) => adapter ? adapter.findEntity(opt) : null,
      findAnimals: (maxDist) => adapter ? adapter.findAnimals(maxDist) : [],
      findHostiles: (maxDist) => adapter ? adapter.findHostiles(maxDist) : [],
      getBlockAt: (pos) => adapter ? adapter.getBlockAt(pos) : null,
    };

    // 1. Skill Cache Check (<0.1s execution)
    const cacheMatch = skillManager.matchSkill(task);
    if (cacheMatch) {
      logger.info(`⚡ Cache Hit! Executing matching skill: '${cacheMatch.skill_name}' in 0.1s`, 'MCPTools');
      const skill = skillManager.getSkill(cacheMatch.skill_name);
      if (skill) {
        try {
          const result = await sandbox.execute(skill.code, {
            dsl,
            world,
            adapter,
            args: { ...(cacheMatch.args || {}), ...(args.parameters || {}) },
          });
          return {
            status: 'success',
            source: 'skill_cache',
            skill_name: cacheMatch.skill_name,
            result: result.result,
          };
        } catch (err) {
          if (err.message && (err.message.includes('missing ingredients') || err.message.includes('not in inventory') || err.message.includes('Cannot craft'))) {
            logger.warn(`⚡ Cache skill '${cacheMatch.skill_name}' could not proceed: ${err.message}. Returning error status immediately to Agent 1 planner...`, 'MCPTools');
            return {
              status: 'error',
              source: 'skill_cache',
              error: err.message,
            };
          }
          logger.warn(`Cache execution encountered error: ${err.message}. Falling back to AI Coder...`, 'MCPTools');
        }
      }
    }

    // 2. Cache Miss / Dynamic Task -> Agent 2 Coder
    logger.info(`🤖 Dispatching task to Agent 2 (qwen2.5-coder:3b): "${task}"`, 'MCPTools');
    const generatedCode = await aiCoderAgent.generateCode(task, rawState, args);

    try {
      const result = await sandbox.execute(generatedCode, {
        dsl,
        world,
        adapter,
        args,
      });
      return {
        status: 'success',
        source: 'ai_coder',
        task,
        result: result.result,
      };
    } catch (err) {
      // 3. Runtime Error -> Self-Healing Debugger 1-Shot Repair
      logger.warn(`Execution failed. Triggering 1-Shot Self-Healing Debugger...`, 'MCPTools');
      const healedResult = await debuggerInstance.repairAndExecute({
        failedCode: err.code || generatedCode,
        error: err,
        taskDescription: task,
        worldState: rawState,
        dsl,
        world,
        adapter,
        args,
      });

      // Record reflection
      reflectionManager.recordReflection({
        errorSignature: err.message,
        taskPattern: task,
        failedCode: err.code || generatedCode,
        fixSummary: 'Self-healed 1-shot repair',
        repairedCode: healedResult.repaired_code,
      });

      return {
        status: 'success',
        source: 'self_healed',
        task,
        result: healedResult.result,
        original_error: err.message,
      };
    }
  }

  static async _handleQuickAction(args) {
    const action = args.action;
    const targetPlayer = args.target_player;
    const adapter = botClient.adapter;

    if (!adapter) {
      return { status: 'mock_success', action, message: `Quick action ${action} processed (bot standby).` };
    }

    switch (action) {
      case 'follow':
      case 'come_here':
        await adapter.followPlayer(targetPlayer || 'Nice2MU', 2.0);
        return { status: 'success', action, message: `กำลังเดินตาม ${targetPlayer || 'คุณ'} ค่ะ` };
      case 'stop':
        adapter.stopMovement();
        return { status: 'success', action, message: 'หยุดการเคลื่อนที่ทั้งหมดแล้วค่ะ' };
      case 'look_at':
        if (targetPlayer) {
          const p = adapter.findEntity({ name: targetPlayer, type: 'player' });
          if (p) await adapter.lookAt(p.position);
        }
        return { status: 'success', action, message: 'หันหน้ามองแล้วค่ะ' };
      case 'jump':
        if (adapter.rawBot) adapter.rawBot.setControlState('jump', true);
        setTimeout(() => adapter.rawBot && adapter.rawBot.setControlState('jump', false), 350);
        return { status: 'success', action, message: 'กระโดดแล้วค่า!' };
      default:
        throw new Error(`Unknown quick action: ${action}`);
    }
  }

  static async _handleGetGameState(args) {
    const detailLevel = args.detail_level || 'summary';
    const stateScanner = botClient.stateScanner;
    if (!stateScanner) {
      return {
        status: 'standby',
        message: 'Bot is currently in standby/disconnected state.',
        position: { x: 0, y: 64, z: 0 },
        health: 20,
        food: 20,
      };
    }
    const state = stateScanner.getBotStatus(detailLevel);
    return {
      status: 'success',
      server: botClient.getServerIdentifier(),
      ...state,
    };
  }

  static async _handleChatInGame(args) {
    const msg = args.message;
    if (!msg) throw new Error('Message is required');
    if (botClient.adapter) {
      botClient.adapter.chat(msg);
    }
    return { status: 'sent', message: msg };
  }

  static async _handleSaveLandmark(args) {
    const serverKey = botClient.getServerIdentifier();
    let coords = args.coords;
    if (!coords && botClient.adapter) {
      const pos = botClient.adapter.getPosition();
      coords = { x: pos.x, y: pos.y, z: pos.z };
    } else if (!coords) {
      coords = { x: 0, y: 64, z: 0 };
    }

    const landmark = worldMemory.saveLandmark(serverKey, args.name, coords, args.description || '');
    return {
      status: 'saved',
      server: serverKey,
      landmark,
    };
  }

  static async _handleListSkills(args) {
    let skills = skillManager.listSkills();
    if (args.category) {
      skills = skills.filter(s => s.category === args.category);
    }
    return {
      status: 'success',
      total_skills: skills.length,
      skills,
    };
  }

  static async _handleManageMemory(args) {
    const serverKey = botClient.getServerIdentifier();
    switch (args.action) {
      case 'get_landmarks':
        return { status: 'success', landmarks: worldMemory.getLandmarks(serverKey) };
      case 'get_chests':
        return { status: 'success', chests: worldMemory.getChests(serverKey) };
      case 'get_reflections':
        return { status: 'success', reflections: reflectionManager.getReflections() };
      default:
        throw new Error(`Unknown memory action: ${args.action}`);
    }
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  MCPToolHandler,
};
