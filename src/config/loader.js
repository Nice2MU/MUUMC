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
    this.aiprovider = this._loadYaml('aiprovider.yaml', {
      ollama: {
        base_url: 'http://127.0.0.1:11434',
        model: 'qwen2.5-coder:3b',
        num_ctx: 16384,
        temperature: 0.2,
        timeout_ms: 25000,
      },
      sandbox: { step_timeout_ms: 15000, auto_unwrap: true, max_self_healing_attempts: 1 },
      cache: { enabled: true, similarity_threshold: 0.85 },
    });
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
    logger.info('Reloaded all configurations.', 'ConfigLoader');
  }
}

const config = new ConfigLoader();

module.exports = {
  config,
  ConfigLoader,
};
