/**
 * StageManager — stage-level orchestration for Competition → Stage → Round architecture.
 *
 * Responsibilities:
 *   - Track current stage context (which stage, type, configuration)
 *   - Manage stage lifecycle state transitions (WAITING → RUNNING → FINISHED)
 *   - Coordinate movement between stages (transitionToNextStage)
 *   - Provide stage-aware context to GameOrchestrator
 *
 * Does NOT:
 *   - Handle round-level state (ROUND_ACTIVE, ROUND_FINISHED, etc.) — that's RoundManager's job
 *   - Handle puzzle/gameplay logic (round-level concern)
 *   - Manage round engines (RoundManager will delegate to engines)
 *   - Perform scoring or timer operations (service-level concern)
 *
 * Architecture:
 *   GameOrchestrator (top-level coordinator)
 *     ├── StageManager (stage-level orchestration)
 *     └── RoundManager (round-level orchestration, created later)
 *
 * Database access: Prisma Client via getPrisma() (consistent with GameOrchestrator)
 */

const { StageError } = require('./errors');
const { getPrisma } = require('../db/prisma');

// ─── Stage Types ───────────────────────────────────────────────

const StageType = Object.freeze({
  INDIVIDUAL: 'INDIVIDUAL',
  TEAM: 'TEAM',
  PK: 'PK', // Prepared but not implemented yet
});

// ─── Stage Lifecycle States ───────────────────────────────────

const StageState = Object.freeze({
  WAITING: 'WAITING',
  RUNNING: 'RUNNING',
  FINISHED: 'FINISHED',
});

class StageManager {
  /**
   * @param {import('../state/StateRepository')} state — StateRepository (Memory or Redis)
   * @param {import('../ws/EmissionBus')} bus — EmissionBus for stage-level events
   */
  constructor(state, bus) {
    this.state = state;
    this.bus = bus;

    // Current stage context (populated by loadStageContext)
    this._context = null;
  }

  // ─── Prisma access ────────────────────────────────────────────

  /** @private Shorthand for getPrisma() */
  get _prisma() {
    return getPrisma();
  }

  // ─── Context Management ──────────────────────────────────────

  /**
   * Load stage context from database.
   * Populates internal state with stage configuration and round list.
   *
   * @param {string} competitionId
   * @param {string} stageId
   * @returns {Promise<Object>} stage context
   * @throws {StageError} if stage not found
   */
  async loadStageContext(competitionId, stageId) {
    let stage;
    try {
      stage = await this._prisma.competition_stages.findUnique({
        where: { id: stageId, competition_id: competitionId },
        include: {
          rounds: {
            orderBy: { order_number: 'asc' },
          },
        },
      });
    } catch (_) {
      throw new StageError('Stage not found');
    }

    if (!stage) {
      throw new StageError('Stage not found');
    }

    this._context = {
      competitionId,
      stageId: stage.id,
      stageType: stage.type,
      stageOrder: stage.order_number,
      stageStatus: stage.status,
      rounds: stage.rounds.map(r => ({
        id: r.id,
        name: r.name,
        type: r.type,
        orderNumber: r.order_number,
        durationSeconds: r.duration_seconds,
        status: r.status,
      })),
      currentRoundIndex: -1, // Not started yet
    };

    return this._context;
  }

  /**
   * Get current stage context.
   * @returns {Object|null} stage context or null if not loaded
   */
  getContext() {
    return this._context;
  }

  /**
   * Get current stage type.
   * @returns {string|null} stage type (INDIVIDUAL|TEAM|PK) or null
   */
  getStageType() {
    return this._context?.stageType || null;
  }

  /**
   * Get current stage status.
   * @returns {string|null} stage status or null
   */
  getStageStatus() {
    return this._context?.stageStatus || null;
  }

  /**
   * Get total number of rounds in current stage.
   * @returns {number}
   */
  getTotalRounds() {
    return this._context?.rounds.length || 0;
  }

  /**
   * Get all rounds in current stage.
   * @returns {Array} rounds array
   */
  getRounds() {
    return this._context?.rounds || [];
  }

  // ─── Stage Lifecycle (implemented) ───────────────────────────

  /**
   * Start a stage.
   * Validates stage exists and is in WAITING state, then transitions to RUNNING.
   *
   * @param {string} competitionId
   * @param {string} stageId
   * @returns {Promise<{result: Object, emissions: Array}>}
   * @throws {StageError} if stage cannot be started
   */
  async startStage(competitionId, stageId) {
    // Load context if not already loaded
    if (!this._context || this._context.stageId !== stageId) {
      await this.loadStageContext(competitionId, stageId);
    }

    // Validate stage state
    if (this._context.stageStatus !== StageState.WAITING) {
      throw new StageError(`Cannot start stage: current status is ${this._context.stageStatus}`);
    }

    // Atomic DB status transition: WAITING → RUNNING (prevents double-start)
    const updateResult = await this._prisma.competition_stages.updateMany({
      where: { id: stageId, status: StageState.WAITING },
      data: { status: StageState.RUNNING },
    });
    if (updateResult.count === 0) {
      throw new StageError('Stage cannot be started (already started or state changed)');
    }

    // Update local context
    this._context.stageStatus = StageState.RUNNING;

    const result = {
      stageId,
      competitionId,
      status: StageState.RUNNING,
      totalRounds: this.getTotalRounds(),
    };

    const emissions = [{
      target: 'competition',
      targetId: competitionId,
      event: 'STAGE_STARTED',
      payload: {
        stageId,
        stageType: this.getStageType(),
        stageOrder: this._context.stageOrder,
        totalRounds: this.getTotalRounds(),
      },
    }];

    return { result, emissions };
  }

  /**
   * Finish the current stage.
   * Validates all rounds are FINISHED, then transitions stage to FINISHED.
   *
   * @returns {Promise<{result: Object, emissions: Array}>}
   * @throws {StageError} if stage cannot be finished
   */
  async finishStage() {
    if (!this._context) {
      throw new StageError('No stage context loaded');
    }

    // Validate stage state
    if (this._context.stageStatus !== StageState.RUNNING) {
      throw new StageError(`Cannot finish stage: current status is ${this._context.stageStatus}`);
    }

    // Validate all rounds are finished
    const unfinishedRounds = await this._prisma.rounds.findMany({
      where: {
        stage_id: this._context.stageId,
        status: { not: 'FINISHED' },
      },
    });

    if (unfinishedRounds.length > 0) {
      throw new StageError(`Cannot finish stage: ${unfinishedRounds.length} rounds are not finished`);
    }

    // Atomic DB status transition: RUNNING → FINISHED (prevents double-finish)
    const updateResult = await this._prisma.competition_stages.updateMany({
      where: { id: this._context.stageId, status: StageState.RUNNING },
      data: { status: StageState.FINISHED },
    });
    if (updateResult.count === 0) {
      throw new StageError('Stage cannot be finished (already finished or state changed)');
    }

    // Update local context
    this._context.stageStatus = StageState.FINISHED;

    const result = {
      stageId: this._context.stageId,
      competitionId: this._context.competitionId,
      status: StageState.FINISHED,
      totalRounds: this.getTotalRounds(),
    };

    const emissions = [{
      target: 'competition',
      targetId: this._context.competitionId,
      event: 'STAGE_FINISHED',
      payload: {
        stageId: this._context.stageId,
        stageType: this.getStageType(),
        stageOrder: this._context.stageOrder,
      },
    }];

    return { result, emissions };
  }

  /**
   * Transition to the next stage in the competition.
   * Finds the next stage by order_number and returns its ID.
   * Does NOT start the next stage (caller should call startStage separately).
   *
   * @returns {Promise<{result: Object, emissions: Array}>}
   * @throws {StageError} if no next stage exists
   */
  async transitionToNextStage() {
    if (!this._context) {
      throw new StageError('No stage context loaded');
    }

    // Query next stage
    const nextStage = await this._prisma.competition_stages.findFirst({
      where: {
        competition_id: this._context.competitionId,
        order_number: { gt: this._context.stageOrder },
      },
      orderBy: { order_number: 'asc' },
    });

    if (!nextStage) {
      throw new StageError('No next stage in competition');
    }

    const result = {
      fromStageId: this._context.stageId,
      toStageId: nextStage.id,
      toStageType: nextStage.type,
      toStageOrder: nextStage.order_number,
    };

    const emissions = [{
      target: 'competition',
      targetId: this._context.competitionId,
      event: 'STAGE_TRANSITION',
      payload: {
        fromStageId: this._context.stageId,
        fromStageType: this.getStageType(),
        toStageId: nextStage.id,
        toStageType: nextStage.type,
        toStageOrder: nextStage.order_number,
      },
    }];

    return { result, emissions };
  }

  // ─── State Persistence ──────────────────────────────────────

  /**
   * Save current stage context to StateRepository.
   * Persists context for reconnect scenarios and distributed state.
   */
  async saveContext() {
    if (!this._context) return;
    await this.state.setStageContext(this._context.competitionId, this._context);
  }

  /**
   * Restore stage context from StateRepository.
   * Useful for server restart or reconnect.
   *
   * @param {string} competitionId
   * @returns {Promise<Object|null>} restored context or null
   */
  async restoreContext(competitionId) {
    const ctx = await this.state.getStageContext(competitionId);
    if (ctx) this._context = ctx;
    return ctx;
  }

  /**
   * Clear stage context.
   * Called when competition ends or stage is abandoned.
   */
  async clearContext() {
    if (!this._context) return;
    await this.state.deleteStageContext(this._context.competitionId);
    this._context = null;
  }

  // ─── Query Helpers ───────────────────────────────────────────

  /**
   * Load all stages for a competition (ordered).
   * @param {string} competitionId
   * @returns {Promise<Array>} stages array
   */
  async loadAllStages(competitionId) {
    return this._prisma.competition_stages.findMany({
      where: { competition_id: competitionId },
      include: {
        rounds: {
          orderBy: { order_number: 'asc' },
        },
      },
      orderBy: { order_number: 'asc' },
    });
  }

  /**
   * Find the first stage for a competition.
   * @param {string} competitionId
   * @returns {Promise<Object|null>} first stage or null
   */
  async findFirstStage(competitionId) {
    return this._prisma.competition_stages.findFirst({
      where: { competition_id: competitionId },
      orderBy: { order_number: 'asc' },
    });
  }

  /**
   * Find stage by ID.
   * @param {string} stageId
   * @returns {Promise<Object|null>} stage or null
   */
  async findStage(stageId) {
    return this._prisma.competition_stages.findUnique({
      where: { id: stageId },
      include: {
        rounds: {
          orderBy: { order_number: 'asc' },
        },
      },
    });
  }

  /**
   * Check if a stage type is supported.
   * @param {string} stageType
   * @returns {boolean}
   */
  isStageTypeSupported(stageType) {
    return Object.values(StageType).includes(stageType);
  }

  /**
   * Check if a stage has gameplay implementation.
   * PK stage is defined but not implemented yet.
   * @param {string} stageType
   * @returns {boolean}
   */
  isStageTypeImplemented(stageType) {
    // PK is prepared but not implemented
    return stageType === StageType.INDIVIDUAL || stageType === StageType.TEAM;
  }
}

module.exports = {
  StageManager,
  StageType,
  StageState,
};
