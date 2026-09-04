/**
 * MCP Resources for muu-mc Subsystem.
 * Exposes readable game state and memory URIs.
 */

const { botClient } = require('../bot/client');
const { skillManager } = require('../memory/skill_manager');
const { worldMemory } = require('../memory/world_memory');

const RESOURCE_DEFINITIONS = [
  {
    uri: 'minecraft://status',
    name: 'Minecraft Bot Real-time Status',
    description: 'Current health, food, position, and status of the Minecraft bot.',
    mimeType: 'application/json',
  },
  {
    uri: 'minecraft://skills',
    name: 'Registered Skills Library',
    description: 'List of all parameterized JavaScript skills in the local library.',
    mimeType: 'application/json',
  },
  {
    uri: 'minecraft://landmarks',
    name: 'World Landmarks Registry',
    description: 'Saved points of interest for the current world.',
    mimeType: 'application/json',
  },
  {
    uri: 'minecraft://chests',
    name: 'Chests Inventory Registry',
    description: 'Tracked storage chests and their contents for the current world.',
    mimeType: 'application/json',
  },
  {
    uri: 'minecraft://diary',
    name: 'Adventure Diary Entries',
    description: 'Chronological adventure journal milestones.',
    mimeType: 'application/json',
  },
  {
    uri: 'minecraft://player_profile',
    name: 'Primary Player Profile',
    description: 'Player profile and relationship memory with Muumiu.',
    mimeType: 'application/json',
  },
];

class MCPResourceHandler {
  static async readResource(uri) {
    const serverKey = botClient.getServerIdentifier();

    switch (uri) {
      case 'minecraft://status': {
        const state = botClient.stateScanner ? botClient.stateScanner.getBotStatus('full') : { status: 'offline' };
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(state, null, 2),
            },
          ],
        };
      }
      case 'minecraft://skills': {
        const skills = skillManager.listSkills();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(skills, null, 2),
            },
          ],
        };
      }
      case 'minecraft://landmarks': {
        const landmarks = worldMemory.getLandmarks(serverKey);
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(landmarks, null, 2),
            },
          ],
        };
      }
      case 'minecraft://chests': {
        const chests = worldMemory.getChests(serverKey);
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(chests, null, 2),
            },
          ],
        };
      }
      case 'minecraft://diary': {
        const diary = worldMemory.getDiary(serverKey);
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(diary, null, 2),
            },
          ],
        };
      }
      case 'minecraft://player_profile': {
        const profile = worldMemory.getPlayerProfile('nice2mu');
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(profile, null, 2),
            },
          ],
        };
      }
      default:
        throw new Error(`Resource not found: ${uri}`);
    }
  }
}

module.exports = {
  RESOURCE_DEFINITIONS,
  MCPResourceHandler,
};
