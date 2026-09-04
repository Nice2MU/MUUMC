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
const { voiceManager } = require('../voice/voice_manager');
const { voiceBridgeClient } = require('../voice/voice_client');

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
        action: {
          type: 'string',
          description: 'Optional direct skill name (e.g. "craft_item", "chop_tree", "mine_ore", "staircase_mine")',
        },
        params: {
          type: 'object',
          description: 'Optional parameters for the direct action or skill',
        },
        context_hint: {
          type: 'string',
          description: 'Optional additional context or instructions.',
        },
      },
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
          enum: ['follow', 'stop', 'pause', 'resume', 'look_at', 'jump', 'come_here'],
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
    description: 'Manages player profile, spatial landmarks, chest registry, and adventure diary for the Minecraft world.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'get_landmarks',
            'save_landmark',
            'delete_landmark',
            'get_chests',
            'get_ores',
            'get_diary',
            'record_diary',
            'get_player_profile',
            'update_player_profile',
            'get_reflections',
          ],
          description: 'Action to perform',
        },
        name: { type: 'string', description: 'Landmark name or profile key' },
        coords: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
          description: '3D coordinate position',
        },
        description: { type: 'string', description: 'Landmark description' },
        title: { type: 'string', description: 'Diary entry title' },
        content: { type: 'string', description: 'Diary entry content' },
        emotion: { type: 'string', description: 'Diary entry emotion tag (happy, star_eye, love_eye, etc.)' },
        username: { type: 'string', description: 'Player username' },
        data: { type: 'object', description: 'Profile data updates' },
      },
      required: ['action'],
    },
  },
  {
    name: 'muu_mc_get_recent_voice_chats',
    description: 'Retrieves recent in-game voice chat utterances captured by Simple Voice Chat near Muumiu, including player names and distances.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of recent voice events to return (default 5)',
          default: 5,
        },
      },
    },
  },
  {
    name: 'muu_mc_play_tts_voice',
    description: 'Plays Muumiu TTS voice directly through the in-game Simple Voice Chat microphone in 3D spatial directional audio.',
    inputSchema: {
      type: 'object',
      properties: {
        audio_base64: {
          type: 'string',
          description: 'Base64-encoded WAV audio data (48,000 Hz 16-bit mono PCM).',
        },
      },
      required: ['audio_base64'],
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
        case 'muu_mc_play_tts_voice':
          return await this._handlePlayTtsVoice(args);
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
        case 'muu_mc_get_recent_voice_chats':
          return await this._handleGetRecentVoiceChats(args);
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
    const directAction = args.action || args.skill_name;
    const isCustomTask = directAction === 'custom_task';
    const customDesc = args.params?.task_description || args.task_description;
    const task = isCustomTask && customDesc ? customDesc : (args.task || (directAction ? `Execute ${directAction}` : ''));
    if (!task && !directAction) throw new Error('Task description or action is required.');

    const dsl = botClient.dsl;
    const adapter = botClient.adapter;
    const stateScanner = botClient.stateScanner;

    if (!adapter || !dsl) {
      logger.info(`Bot is in standby / connecting. Task accepted: "${task}"`, 'MCPTools');
      return {
        status: 'mock_success',
        source: 'standby',
        task,
        message: `Task '${task}' processed (bot standby).`,
      };
    }

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

    // 1. Direct Skill Execution (from LLM Cognitive Planner - 0ms regex overhead)
    if (directAction) {
      const directSkill = skillManager.getSkill(directAction);
      if (directSkill) {
        logger.info(`⚡ Direct Action Dispatch: '${directAction}' (Zero Regex Overhead)`, 'MCPTools');
        try {
          const directArgs = { ...(args.params || {}), ...(args.parameters || {}) };
          const result = await sandbox.execute(directSkill.code, {
            dsl,
            world,
            adapter,
            args: directArgs,
          });
          if (result.result && result.result.success === false) {
            return {
              status: 'error',
              source: 'direct_skill',
              skill_name: directAction,
              error: result.result.error || 'Direct skill execution failed',
            };
          }
          return {
            status: 'success',
            source: 'direct_skill',
            skill_name: directAction,
            result: result.result,
          };
        } catch (err) {
          if (err.message && (err.message.includes('missing ingredients') || err.message.includes('not in inventory') || err.message.includes('Cannot craft'))) {
            logger.warn(`⚡ Direct skill '${directAction}' could not proceed: ${err.message}. Returning error to planner...`, 'MCPTools');
            return {
              status: 'error',
              source: 'direct_skill',
              skill_name: directAction,
              error: err.message,
            };
          }
          logger.warn(`Direct skill execution '${directAction}' error: ${err.message}. Falling back to AI Coder...`, 'MCPTools');
        }
      }
    }

    // 2. Skill Cache Check via natural language (<0.1s execution) - only if no direct action was dispatched
    const cacheMatch = (!isCustomTask && !directAction && task) ? skillManager.matchSkill(task) : null;
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
          if (result.result && result.result.success === false) {
            return {
              status: 'error',
              source: 'skill_cache',
              skill_name: cacheMatch.skill_name,
              error: result.result.error || 'Skill execution failed',
            };
          }
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
      case 'pause':
        adapter.stopMovement();
        if (botClient.autonomousEngine) {
          botClient.autonomousEngine.stop();
        }
        return { status: 'success', action, message: 'หยุดการเคลื่อนที่และหยุดเล่นอัตโนมัติแล้วค่ะ' };
      case 'resume':
      case 'play':
        if (botClient.autonomousEngine) {
          botClient.autonomousEngine.start();
        }
        return { status: 'success', action, message: 'เริ่มเล่นอัตโนมัติอีกครั้งแล้วค่ะ' };
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
      case 'save_landmark':
        if (!args.name || !args.coords) throw new Error('name and coords are required for save_landmark');
        return { status: 'success', landmark: worldMemory.saveLandmark(serverKey, args.name, args.coords, args.description || '') };
      case 'delete_landmark':
        return { status: 'success', deleted: worldMemory.deleteLandmark(serverKey, args.name) };
      case 'get_chests':
        return { status: 'success', chests: worldMemory.getChests(serverKey) };
      case 'get_ores':
        return { status: 'success', ores: worldMemory.getDiscoveredOres(serverKey) };
      case 'get_diary':
        return { status: 'success', diary: worldMemory.getDiary(serverKey) };
      case 'record_diary':
        if (!args.title || !args.content) throw new Error('title and content are required for record_diary');
        return { status: 'success', entry: worldMemory.recordDiaryEvent(serverKey, args.title, args.content, args.emotion || 'happy') };
      case 'get_player_profile':
        return { status: 'success', profile: worldMemory.getPlayerProfile(args.username) };
      case 'update_player_profile':
        return { status: 'success', profile: worldMemory.updatePlayerProfile(args.username, args.data || {}) };
      case 'get_reflections':
        return { status: 'success', reflections: reflectionManager.getReflections() };
      default:
        throw new Error(`Unknown memory action: ${args.action}`);
    }
  }

  static async _handleGetRecentVoiceChats(args) {
    const limit = args.limit || 5;
    const events = voiceManager.getRecentEvents(limit);
    return {
      status: 'success',
      total_events: events.length,
      voice_chats: events.map(e => ({
        id: e.id,
        player_name: e.player ? e.player.name : 'Unknown',
        player_uuid: e.player ? e.player.uuid : null,
        distance_meters: e.player ? e.player.distance : null,
        duration_sec: e.duration_sec,
        world: e.player ? e.player.world : null,
        timestamp: e.timestamp,
        received_at: e.received_at,
      })),
    };
  }

  static async _handlePlayTtsVoice(args) {
    const audioBase64 = args.audio_base64;
    if (!audioBase64) {
      return { status: 'error', error: 'audio_base64 parameter is required' };
    }
    const success = voiceBridgeClient.sendVoice(audioBase64);
    return {
      status: success ? 'success' : 'failed',
      dispatched: success,
      message: success
        ? 'Voice successfully transmitted to in-game Simple Voice Chat'
        : 'Voice Bridge is not connected to server',
    };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  MCPToolHandler,
};
