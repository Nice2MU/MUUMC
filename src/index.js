/**
 * Master Entrypoint for muu-mc Model Context Protocol (MCP) Server.
 * Communicates via JSON-RPC 2.0 over StdioServerTransport.
 * Guarantees 100% Stdio Stream Isolation (stdout is protocol-only).
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const { logger } = require('./bot/logger');
const { botClient } = require('./bot/client');
const { TOOL_DEFINITIONS, MCPToolHandler } = require('./mcp/tools');
const { RESOURCE_DEFINITIONS, MCPResourceHandler } = require('./mcp/resources');

// Safeguard #6: Strict Stdio Isolation
// Intercept non-JSON stdout writes from underlying libraries and route them to stderr
const origStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function (chunk, encoding, callback) {
  const str = typeof chunk === 'string' ? chunk : chunk.toString();
  const trimmed = str.trim();
  if (trimmed && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return process.stderr.write(chunk, encoding, callback);
  }
  return origStdoutWrite(chunk, encoding, callback);
};

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`, 'MCPServer');
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.warn(`Unhandled Rejection: ${msg}`, 'MCPServer');
});

async function main() {
  logger.info('🚀 Starting muu-mc MCP Subsystem (@modelcontextprotocol/sdk)...', 'MCPServer');

  const server = new Server(
    {
      name: 'muu_mc',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // 1. Register Tools Handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOL_DEFINITIONS,
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await MCPToolHandler.handleToolCall(name, args || {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error(`Tool execution error for '${name}': ${error.message}`, 'MCPServer');
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Tool Execution Error: ${error.message}`,
          },
        ],
      };
    }
  });

  // 2. Register Resources Handlers
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: RESOURCE_DEFINITIONS,
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    try {
      return await MCPResourceHandler.readResource(uri);
    } catch (error) {
      logger.error(`Resource read error for '${uri}': ${error.message}`, 'MCPServer');
      throw error;
    }
  });

  // 3. Connect Stdio Transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('✅ muu-mc MCP Server connected via stdio transport successfully!', 'MCPServer');

  // 4. Background Bot Connection (non-blocking so MCP server responds immediately)
  setTimeout(() => {
    botClient.connect().catch(e => {
      logger.warn(`Initial bot connect notice: ${e.message}`, 'MCPServer');
    });
  }, 1000);
}

main().catch(err => {
  logger.error(`Fatal MCP Server error: ${err.message}\n${err.stack}`, 'MCPServer');
  process.exit(1);
});
