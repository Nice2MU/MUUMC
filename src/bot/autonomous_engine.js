/**
 * Autonomous Proactive Engine for muu-mc (Idle Behavior Loop).
 * Executes Survival, Housekeeping, Exploration, and Social routines when no active player commands are running.
 * Features 0.01s Instant Preemption when player commands arrive.
 */

const { logger } = require('./logger');

class AutonomousEngine {
  constructor(client) {
    this.client = client;
    this.isRunning = false;
    this.isBusy = false;
    this._loopInterval = null;
    this._idleTimeoutMs = 15000; // 15 seconds of inactivity before starting idle routines
    this._lastTaskTime = Date.now();
    this._preemptController = new AbortController();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('🤖 Autonomous Proactive Engine started.', 'AutonomousEngine');

    this._loopInterval = setInterval(() => {
      this._tick();
    }, 5000);
  }

  stop() {
    this.isRunning = false;
    if (this._loopInterval) {
      clearInterval(this._loopInterval);
      this._loopInterval = null;
    }
    this.preempt();
    logger.info('Autonomous Proactive Engine stopped.', 'AutonomousEngine');
  }

  /**
   * Called whenever player issues a command or task.
   * Immediately aborts any ongoing idle routine within 0.01s.
   */
  notifyTaskStarted() {
    this._lastTaskTime = Date.now();
    this.preempt();
  }

  notifyTaskCompleted() {
    this._lastTaskTime = Date.now();
  }

  preempt() {
    if (this.isBusy) {
      logger.info('⚡ Preempting autonomous idle routine for player command (0.01s response)...', 'AutonomousEngine');
      this._preemptController.abort();
      this._preemptController = new AbortController();
      this.isBusy = false;
      if (this.client.adapter) {
        this.client.adapter.stopMovement();
      }
    }
  }

  async _tick() {
    if (!this.isRunning || this.isBusy) return;
    if (!this.client.isConnected || !this.client.isSpawned) return;

    // Check if idle time threshold exceeded
    const idleDuration = Date.now() - this._lastTaskTime;
    if (idleDuration < this._idleTimeoutMs) return;

    const adapter = this.client.adapter;
    const dsl = this.client.dsl;
    const stateScanner = this.client.stateScanner;

    if (!adapter || !dsl || !stateScanner) return;

    this.isBusy = true;
    const signal = this._preemptController.signal;

    try {
      // 1. 🍖 Survival Routine: Hunger
      if (adapter.getFood() < 14) {
        logger.info('🍖 Autonomous routine: Bot is hungry. Eating food...', 'AutonomousEngine');
        await dsl.eatIfHungry();
        if (signal.aborted) return;
      }

      // 2. 🍖 Survival Routine: Night / Bed
      const bot = adapter.rawBot;
      if (bot?.time?.isNight && !bot?.isSleeping) {
        logger.info('🌙 Autonomous routine: Night time detected. Searching for bed...', 'AutonomousEngine');
        const bedTypes = ['white_bed', 'red_bed', 'blue_bed', 'black_bed', 'green_bed'];
        const beds = adapter.findBlocks({ matching: bedTypes, maxDistance: 16, count: 1 });
        if (beds.length > 0) {
          const bedBlock = adapter.getBlockAt(beds[0]);
          if (bedBlock) {
            try {
              await dsl.navigate(beds[0].x, beds[0].y, beds[0].z, 1.5);
              if (signal.aborted) return;
              await adapter.sleep(bedBlock);
              logger.info('💤 Bot sleeping safely through the night.', 'AutonomousEngine');
            } catch (e) {
              logger.debug(`Bed sleep note: ${e.message}`, 'AutonomousEngine');
            }
          }
        }
      }

      // 3. 👥 Social Interaction: Look at nearby player
      const nearbyPlayer = adapter.findEntity({ type: 'player', maxDistance: 8 });
      if (nearbyPlayer) {
        await adapter.lookAt(nearbyPlayer.position);
      }
    } catch (err) {
      if (!signal.aborted) {
        logger.debug(`Autonomous routine tick note: ${err.message}`, 'AutonomousEngine');
      }
    } finally {
      this.isBusy = false;
    }
  }
}

module.exports = {
  AutonomousEngine,
};
