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
      default:
        throw new Error(`Resource not found: ${uri}`);
    }
  }
}

module.exports = {
  RESOURCE_DEFINITIONS,
  MCPResourceHandler,
};
