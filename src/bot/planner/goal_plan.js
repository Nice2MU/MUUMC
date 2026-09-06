/**
 * Goal Plan Manager for MuumiuLLM Minecraft Autonomous Gamer Brain.
 * Manages multi-step sequential plans (Step 1 -> 2 -> 3) with quantitative targets.
 * Handles persistence, master preemption pause/resume, and step advancement.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../logger');

class GoalPlanManager {
  constructor(baseDataDir = path.resolve(__dirname, '../../../data')) {
    this.baseDataDir = baseDataDir;
    this.activePlan = null;
  }

  _resolveServerKey(serverKey) {
    if (serverKey) return String(serverKey).replace(/[^a-zA-Z0-9.-]/g, '_');
    try {
      const { config } = require('../../config/loader');
      const srv = config.minecraft?.server || {};
      const host = (srv.host || '127.0.0.1').replace(/[^a-zA-Z0-9.-]/g, '_');
      const port = srv.port || 25565;
      return `${host}_${port}`;
    } catch (_) {
      return 'default_world';
    }
  }

  _getPlanFilePath(serverKey) {
    const key = this._resolveServerKey(serverKey);
    const dir = path.join(this.baseDataDir, 'worlds', key);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, 'active_plan.json');
  }

  loadPlan(serverKey) {
    const filePath = this._getPlanFilePath(serverKey);
    if (!fs.existsSync(filePath)) {
      this.activePlan = null;
      return null;
    }
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.activePlan = data;
      return data;
    } catch (e) {
      logger.error(`Failed to load active plan: ${e.message}`, 'GoalPlan');
      this.activePlan = null;
      return null;
    }
  }

  savePlan(serverKey, plan = null) {
    const data = plan || this.activePlan;
    if (!data) return;
    const filePath = this._getPlanFilePath(serverKey);
    const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);
      this.activePlan = data;
    } catch (e) {
      if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch (_) {}
      }
      logger.error(`Failed to save active plan: ${e.message}`, 'GoalPlan');
    }
  }

  createPlanFromPhase(serverKey, phaseConfig, masterPlayer = 'Nice2MU') {
    const plan = {
      plan_id: phaseConfig.id || `phase_${Date.now()}`,
      phase_name: phaseConfig.title || 'เอาชีวิตรอด',
      description: phaseConfig.description || '',
      master_player: masterPlayer,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      current_step_index: 0,
      status: 'in_progress', // 'in_progress' | 'paused_for_master' | 'completed' | 'failed'
      steps: (phaseConfig.steps || []).map((s, idx) => ({
        step_id: s.step_id || idx + 1,
        title: s.title,
        action: s.action,
        params: s.params || {},
        target_condition: s.target_condition || null,
        status: idx === 0 ? 'in_progress' : 'pending',
        retries: 0,
        started_at: idx === 0 ? new Date().toISOString() : null,
        completed_at: null,
      })),
      paused_state: null,
    };

    this.activePlan = plan;
    this.savePlan(serverKey, plan);
    logger.info(`📋 [GoalPlan] Created new Multi-Step Plan: "${plan.phase_name}" (${plan.steps.length} steps)`, 'GoalPlan');
    return plan;
  }

  getCurrentStep() {
    if (!this.activePlan || !Array.isArray(this.activePlan.steps)) return null;
    if (this.activePlan.status === 'completed' || this.activePlan.status === 'paused_for_master') {
      return null;
    }
    const idx = this.activePlan.current_step_index || 0;
    if (idx >= this.activePlan.steps.length) return null;
    return this.activePlan.steps[idx];
  }

  advanceStep(serverKey, summary = '') {
    if (!this.activePlan || !Array.isArray(this.activePlan.steps)) return null;
    const idx = this.activePlan.current_step_index || 0;
    const current = this.activePlan.steps[idx];
    if (current) {
      current.status = 'completed';
      current.completed_at = new Date().toISOString();
      current.progress_summary = summary || 'Completed';
      logger.info(`✅ [GoalPlan] Step ${idx + 1}/${this.activePlan.steps.length} Finished: "${current.title}"!`, 'GoalPlan');
    }

    const nextIdx = idx + 1;
    this.activePlan.current_step_index = nextIdx;
    this.activePlan.updated_at = new Date().toISOString();

    if (nextIdx >= this.activePlan.steps.length) {
      this.activePlan.status = 'completed';
      logger.info(`🎉 [GoalPlan] Plan "${this.activePlan.phase_name}" 100% COMPLETED!`, 'GoalPlan');
    } else {
      this.activePlan.steps[nextIdx].status = 'in_progress';
      this.activePlan.steps[nextIdx].started_at = new Date().toISOString();
      logger.info(`🎯 [GoalPlan] Advancing to Step ${nextIdx + 1}/${this.activePlan.steps.length}: "${this.activePlan.steps[nextIdx].title}"`, 'GoalPlan');
    }

    this.savePlan(serverKey);
    return this.activePlan;
  }

  pauseForMaster(serverKey, masterPlayer, taskDescription) {
    if (!this.activePlan) return null;
    if (this.activePlan.status === 'paused_for_master') return this.activePlan;

    this.activePlan.paused_state = {
      paused_at: new Date().toISOString(),
      previous_status: this.activePlan.status,
      step_index: this.activePlan.current_step_index,
      master_order: taskDescription,
      master_player: masterPlayer,
    };
    this.activePlan.status = 'paused_for_master';
    this.activePlan.updated_at = new Date().toISOString();
    this.savePlan(serverKey);

    logger.info(`⏸️ [GoalPlan] Plan "${this.activePlan.phase_name}" PAUSED for Master <${masterPlayer}>: "${taskDescription}"`, 'GoalPlan');
    return this.activePlan;
  }

  resumeFromMaster(serverKey) {
    if (!this.activePlan || this.activePlan.status !== 'paused_for_master') return null;

    const previousStatus = this.activePlan.paused_state?.previous_status || 'in_progress';
    this.activePlan.status = previousStatus;
    this.activePlan.paused_state = null;
    this.activePlan.updated_at = new Date().toISOString();
    this.savePlan(serverKey);

    const step = this.getCurrentStep();
    logger.info(`▶️ [GoalPlan] Resumed plan "${this.activePlan.phase_name}". Current step: "${step?.title || 'None'}"`, 'GoalPlan');
    return this.activePlan;
  }

  recordStepFailure(serverKey, errorReason) {
    if (!this.activePlan) return;
    const idx = this.activePlan.current_step_index || 0;
    const current = this.activePlan.steps?.[idx];
    if (current) {
      current.retries = (current.retries || 0) + 1;
      current.last_error = errorReason;
      logger.warn(`⚠️ [GoalPlan] Step ${idx + 1} retry #${current.retries}: ${errorReason}`, 'GoalPlan');
      this.savePlan(serverKey);
    }
  }

  isPlanComplete() {
    return !this.activePlan || this.activePlan.status === 'completed';
  }

  clearPlan(serverKey) {
    const filePath = this._getPlanFilePath(serverKey);
    this.activePlan = null;
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        logger.info('🗑️ [GoalPlan] Cleared active plan.', 'GoalPlan');
      } catch (_) {}
    }
  }
}

const goalPlanManager = new GoalPlanManager();

module.exports = {
  GoalPlanManager,
  goalPlanManager,
};
