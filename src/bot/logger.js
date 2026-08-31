/**
 * Centralized Stdio-Isolated Logger for muu-mc MCP Subsystem.
 * Strictly routes all log output to process.stderr and rotating file logs.
 * STDOUT is 100% reserved for JSON-RPC MCP Protocol.
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.resolve(__dirname, '../../logs');
const LOG_FILE = path.join(LOGS_DIR, 'muu_mc.log');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Colors for terminal (stderr)
const Colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

class McLogger {
  constructor() {
    this.logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  }

  _formatTime() {
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return { time, date, full: `${date} ${time}` };
  }

  _write(level, tag, message, color) {
    const { time, full } = this._formatTime();
    const tagFormatted = tag ? `[${tag}]` : '';

    // 1. Write to stderr (with ANSI colors)
    const terminalMsg = `${Colors.dim}${time}${Colors.reset} ${color}[${level}]${Colors.reset} ${Colors.cyan}${tagFormatted}${Colors.reset} ${message}\n`;
    process.stderr.write(terminalMsg);

    // 2. Write to log file (plain text)
    const fileMsg = `${full} [${level}] ${tagFormatted} ${message}\n`;
    this.logStream.write(fileMsg);
  }

  info(message, tag = 'MC') {
    this._write('INFO', tag, message, Colors.green);
  }

  warn(message, tag = 'MC') {
    this._write('WARN', tag, message, Colors.yellow);
  }

  error(message, tag = 'MC') {
    this._write('ERROR', tag, message, Colors.red);
  }

  debug(message, tag = 'MC') {
    this._write('DEBUG', tag, message, Colors.dim);
  }
}

const logger = new McLogger();

module.exports = {
  logger,
  McLogger,
};
