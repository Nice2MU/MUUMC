/**
 * Config Loader for muu-mc MCP Subsystem.
 * Reads and parses YAML configuration files.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { logger } = require('../bot/logger');

class ConfigLoader {
  constructor(configDir = path.resolve(__dirname, '../../config')) {
    this.configDir = configDir;
    this.minecraft = this._loadYaml('minecraft.yaml', {
      server: { host: '127.0.0.1', port: 25565, version: false, auth: 'offline' },
      bot: { username: 'Muumiu', view_distance: 'far' },
      viewer: { enabled: true, port: 3007, first_person: true },
      auto_reconnect: { enabled: true, max_retries: 10, retry_delay_ms: 5000 },
    });

    // Agent 2 (Tactical AI Coder): Local Ollama / OpenRouter for code generation & self-healing
    this.aiprovider = this._loadYaml('aiprovider.yaml', {
      active_provider: 'ollama',
      ollama: {
        base_url: 'http://127.0.0.1:11434',
        model: 'qwen2.5-coder:3b',
        num_ctx: 16384,
        temperature: 0.2,
        timeout_ms: 60000,
      },
      openrouter: {
        api_key: process.env.OPENROUTER_API_KEY || '',
        base_url: 'https://openrouter.ai/api/v1',
        model: 'minimax/minimax-m3:free',
        temperature: 0.2,
        max_tokens: 500,
        timeout_ms: 60000,
      },
      sandbox: { step_timeout_ms: 60000, auto_unwrap: true, max_self_healing_attempts: 1 },
      cache: { enabled: true, similarity_threshold: 0.85 },
    });

    // Agent 1 (Supreme Director / Brain): Main App AI Provider for strategic planning, perception, & chat
    this.mainAiprovider = this._loadMainAppAiProvider();
    this.agent1Provider = this.mainAiprovider || this.aiprovider;
    this.agent2Provider = this.aiprovider;

    // Auto-resolve parent MuumiuLLM openrouter api key if available and not set locally
    if (!this.aiprovider.openrouter.api_key) {
      if (process.env.OPENROUTER_API_KEY) {
        this.aiprovider.openrouter.api_key = process.env.OPENROUTER_API_KEY;
      } else if (this.mainAiprovider?.openrouter?.api_key) {
        this.aiprovider.openrouter.api_key = this.mainAiprovider.openrouter.api_key;
      }
    }

    const a1Prov = this.agent1Provider.active_provider || 'ollama';
    const a1Model = (a1Prov === 'openrouter' ? this.agent1Provider.openrouter?.model : this.agent1Provider.ollama?.model) || 'unknown';
    const a2Prov = this.agent2Provider.active_provider || 'ollama';
    const a2Model = (a2Prov === 'openrouter' ? this.agent2Provider.openrouter?.model : this.agent2Provider.ollama?.model) || 'unknown';
    logger.info(`👑 Agent 1 (Strategic Director / Brain): ${a1Prov} (${a1Model})`, 'ConfigLoader');
    logger.info(`🛠️ Agent 2 (Tactical AI Coder): ${a2Prov} (${a2Model})`, 'ConfigLoader');
  }

  _findMainAppAiProviderPath() {
    let curr = __dirname;
    for (let i = 0; i < 6; i++) {
      const candidate = path.join(curr, 'config', 'aiprovider', 'aiprovider.yaml');
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
    const cwdCandidate = path.resolve(process.cwd(), 'config', 'aiprovider', 'aiprovider.yaml');
    if (fs.existsSync(cwdCandidate)) return cwdCandidate;
    return null;
  }

  _loadMainAppAiProvider() {
    const mainCfgPath = this._findMainAppAiProviderPath();
    if (!mainCfgPath) {
      logger.warn('Main App AI Provider config not found. Falling back to muu-mc aiprovider.yaml for Agent 1.', 'ConfigLoader');
      return null;
    }
    try {
      const content = fs.readFileSync(mainCfgPath, 'utf8');
      const parsed = yaml.parse(content);
      if (parsed && (parsed.active_provider || parsed.ollama || parsed.openrouter)) {
        logger.info(`Loaded Main App AI Provider (Agent 1) from: ${mainCfgPath}`, 'ConfigLoader');
        return parsed;
      }
    } catch (err) {
      logger.warn(`Failed reading main AI provider config at ${mainCfgPath}: ${err.message}`, 'ConfigLoader');
    }
    return null;
  }

  _loadYaml(filename, defaults) {
    const filePath = path.join(this.configDir, filename);
    if (!fs.existsSync(filePath)) {
      logger.warn(`Config file '${filename}' not found. Using defaults.`, 'ConfigLoader');
      return defaults;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = yaml.parse(content);
      return { ...defaults, ...(parsed || {}) };
    } catch (e) {
      logger.error(`Error parsing YAML '${filename}': ${e.message}`, 'ConfigLoader');
      return defaults;
    }
  }

  reload() {
    this.minecraft = this._loadYaml('minecraft.yaml', this.minecraft);
    this.aiprovider = this._loadYaml('aiprovider.yaml', this.aiprovider);
    this.mainAiprovider = this._loadMainAppAiProvider();
    this.agent1Provider = this.mainAiprovider || this.aiprovider;
    this.agent2Provider = this.aiprovider;
    logger.info('Reloaded all configurations.', 'ConfigLoader');
  }
}

const config = new ConfigLoader();

module.exports = {
  config,
  ConfigLoader,
};
