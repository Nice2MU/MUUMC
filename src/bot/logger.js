/**
 * Centralized Stdio-Isolated Rotating Logger for muu-mc MCP Subsystem.
 * Strictly routes all log output to process.stderr and rotating file logs (5 MB max, 3 backups).
 * STDOUT is 100% reserved for JSON-RPC MCP Protocol.
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.resolve(__dirname, '../../logs');
const LOG_FILE = path.join(LOGS_DIR, 'muu_mc.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_BACKUPS = 3;

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
    this._checkRotation();
    this.logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    this._currentSize = 0;
    try {
      if (fs.existsSync(LOG_FILE)) {
        this._currentSize = fs.statSync(LOG_FILE).size;
      }
    } catch (_) {}
  }

  _checkRotation() {
    try {
      if (!fs.existsSync(LOG_FILE)) return;
      const stats = fs.statSync(LOG_FILE);
      if (stats.size >= MAX_LOG_SIZE) {
        if (this.logStream) {
          try { this.logStream.end(); } catch (_) {}
        }
        for (let i = MAX_BACKUPS - 1; i >= 1; i--) {
          const oldFile = `${LOG_FILE}.${i}`;
          const nextFile = `${LOG_FILE}.${i + 1}`;
          if (fs.existsSync(oldFile)) {
            try { fs.renameSync(oldFile, nextFile); } catch (_) {}
          }
        }
        try { fs.renameSync(LOG_FILE, `${LOG_FILE}.1`); } catch (_) {}
        this.logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
        this._currentSize = 0;
      }
    } catch (_) {}
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

    // 1. Write to stderr (with ANSI colors, safe from EPIPE)
    try {
      const terminalMsg = `${Colors.dim}${time}${Colors.reset} ${color}[${level}]${Colors.reset} ${Colors.cyan}${tagFormatted}${Colors.reset} ${message}\n`;
      process.stderr.write(terminalMsg);
    } catch (_) {}

    // 2. Write to log file (plain text) with rotation check
    try {
      const fileMsg = `${full} [${level}] ${tagFormatted} ${message}\n`;
      this._currentSize += Buffer.byteLength(fileMsg, 'utf8');
      if (this._currentSize >= MAX_LOG_SIZE) {
        this._checkRotation();
      }
      if (this.logStream && !this.logStream.destroyed) {
        this.logStream.write(fileMsg);
      }
    } catch (_) {}
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
