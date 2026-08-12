/**
 * RoundManager — round-level orchestration within a stage.
 *
 * Responsibilities:
 *   - Track round lifecycle: PREPARATION → ROUND_ACTIVE → ROUND_FINISHED
 *   - Navigate rounds within a stage (startNextRound, getCurrentRound, hasNextRound)
 *   - Coordinate round engine setup/teardown
 *   - Manage round timer lifecycle (start, pause, resume, cleanup)
 *   - Provide round-aware context to GameOrchestrator
 *
 * Does NOT:
 *   - Handle stage-level lifecycle (WAITING, STAGE_STARTED, STAGE_FINISHED) — that's StageManager's job
 *   - Handle competition-level lifecycle (DRAFT, RUNNING, FINISHED) — that's GameOrchestrator's job
 *   - Contain puzzle/gameplay logic (delegated to round engines)
 *   - Perform scoring calculations (delegated to ScoringService)
 *   - Manage socket emissions directly (returns emission descriptors)
 *
 * Architecture:
 *   GameOrchestrator (top-level coordinator)
 *     ├── StageManager (stage-level orchestration)
 *     └── RoundManager (round-level orchestration)
 *           └── RoundEngines (Round1Engine, Round2Engine, Round3Engine)
 *
 * Database access: Prisma Client via getPrisma() (consistent with GameOrchestrator)
 */

const { RoundError } = require('./errors');
const { getPrisma } = require('../db/prisma');
const { isValidRoundType } = require('./RoundTypes');

// ─── Round Lifecycle States ─────────────────────────────────────

const RoundLifecycleState = Object.freeze({
  PREPARATION: 'PREPARATION',
  ROUND_ACTIVE: 'ROUND_ACTIVE',
  ROUND_FINISHED: 'ROUND_FINISHED',
});

// ─── Round DB Statuses (maps to rounds.status column) ──────────

const RoundStatus = Object.freeze({
  WAITING: 'WAITING',
  IN_PROGRESS: 'IN_PROGRESS',
  PAUSED: 'PAUSED',
  FINISHED: 'FINISHED',
});

class RoundManager {
  /**
   * @param {import('../state/StateRepository')} state — StateRepository (Memory or Redis)
   * @param {import('../ws/EmissionBus')} bus — EmissionBus for round-level events
   * @param {import('./TimerService')} timer — TimerService for round timers
   */
  constructor(state, bus, timer) {
    this.state = state;
    this.bus = bus;
    this.timer = timer;

    // Current round context (populated by prepareRound)
    this._context = null;
  }

  // ─── Prisma access ────────────────────────────────────────────

  /** @private Shorthand for getPrisma() */
  get _prisma() {
    return getPrisma();
  }

  // ─── Context Management ──────────────────────────────────────

  /**
   * Prepare a round for execution.
   * Loads round data and sets the internal lifecycle to PREPARATION.
   *
   * @param {string} competitionId
   * @param {string} stageId
   * @param {string} roundId
   * @returns {Promise<Object>} round context
   * @throws {RoundError} if round not found
   */
  async prepareRound(competitionId, stageId, roundId) {
    let round;
    try {
      round = await this._prisma.rounds.findUnique({
        where: { id: roundId, stage_id: stageId },
        include: {
          competition_stages: { select: { competition_id: true } },
          round_puzzles: {
            include: { puzzles: true },
            orderBy: { order_number: 'asc' },
          },
        },
      });
    } catch (_) {
      throw new RoundError('Round not found');
    }

    if (!round) {
      throw new RoundError('Round not found');
    }

    if (round.competition_stages.competition_id !== competitionId) {
      throw new RoundError('Round does not belong to this competition');
    }

    this._context = {
      competitionId,
      stageId,
      roundId: round.id,
      roundName: round.name,
      roundType: round.type,
      orderNumber: round.order_number,
      durationSeconds: round.duration_seconds,
      preparationSeconds: round.preparation_seconds,
      dbStatus: round.status,
      lifecycleState: RoundLifecycleState.PREPARATION,
      puzzles: round.round_puzzles.map(rp => ({
        id: rp.puzzle_id,
        puzzleId: rp.puzzle_id,
        type: rp.puzzles.type,
        initialGrid: rp.puzzles.initial_grid,
        solutionGrid: rp.puzzles.solution_grid,
        score: rp.score,
        orderNumber: rp.order_number,
      })),
      totalPuzzles: round.round_puzzles.length,
    };

    return this._context;
  }

  /**
   * Get current round context.
   * @returns {Object|null} round context or null if not loaded
   */
  getContext() {
    return this._context;
  }

  /**
   * Get current round lifecycle state.
   * @returns {string|null} PREPARATION, ROUND_ACTIVE, or ROUND_FINISHED
   */
  getLifecycleState() {
    return this._context?.lifecycleState || null;
  }

  /**
   * Get current round DB status.
   * @returns {string|null} WAITING, IN_PROGRESS, PAUSED, or FINISHED
   */
  getDbStatus() {
    return this._context?.dbStatus || null;
  }

  /**
   * Get current round type.
   * @returns {string|null} ROUND1_NINE_ONE, ROUND2_RELAY, ROUND3_COLLABORATE
   */
  getRoundType() {
    return this._context?.roundType || null;
  }

  /**
   * Get current round ID.
   * @returns {string|null}
   */
  getRoundId() {
    return this._context?.roundId || null;
  }

  /**
   * Get all puzzles for current round.
   * @returns {Array} puzzles array
   */
  getPuzzles() {
    return this._context?.puzzles || [];
  }

  /**
   * Get total number of puzzles in current round.
   * @returns {number}
   */
  getTotalPuzzles() {
    return this._context?.totalPuzzles || 0;
  }

  // ─── Round Lifecycle ─────────────────────────────────────────

  /**
   * Start preparation phase for the current round.
   * Begins countdown timer and emits ROUND_PREPARATION_STARTED event.
   *
   * @param {string} competitionId
   * @param {function} onPreparationEnd - Callback when preparation countdown ends
   * @returns {Promise<{result: Object, emissions: Array}>}
   * @throws {RoundError} if not in PREPARATION state
   */
  async startPreparation(competitionId, onPreparationEnd) {
    if (!this._context) {
      throw new RoundError('No round context loaded');
    }

    if (this._context.lifecycleState !== RoundLifecycleState.PREPARATION) {
      throw new RoundError(
        `Cannot start preparation: current lifecycle state is ${this._context.lifecycleState}`
      );
    }

    // Start preparation countdown timer
    const { turnEndsAt } = await this.timer.start(
      `prep_${this._context.roundId}`,
      this._context.preparationSeconds
    );

    // Start timer ticks for preparation phase
    this.timer.startTickInterval(
      `prep_${this._context.roundId}`,
      this._context.preparationSeconds,
      (remaining, timerState, shouldBroadcast) => {
        if (shouldBroadcast) {
          this.bus.emitImmediate({
            target: 'competition',
            targetId: competitionId,
            event: 'TIMER_TICK',
            payload: {
              roundId: this._context.roundId,
              phase: 'preparation',
              remainingSeconds: remaining,
              totalSeconds: this._context.preparationSeconds,
              turnEndsAt: timerState?.turnEndsAt || 0,
            },
          });
        }
      },
      () => {
        // Preparation time expired
        if (onPreparationEnd) {
          onPreparationEnd();
        }
      }
    );

    const result = {
      roundId: this._context.roundId,
      competitionId,
      status: 'PREPARING',
      preparationSeconds: this._context.preparationSeconds,
      turnEndsAt,
    };

    const emissions = [{
      target: 'competition',
      targetId: competitionId,
      event: 'ROUND_PREPARATION_STARTED',
      payload: {
        roundId: this._context.roundId,
        roundNumber: this._context.orderNumber,
        roundName: this._context.roundName,
        roundType: this._context.roundType,
        preparationSeconds: this._context.preparationSeconds,
        turnEndsAt,
      },
    }];

    return { result, emissions };
  }

  /**
   * Clear preparation timer.
   */
  clearPreparationTimer() {
    if (!this._context) return;
    this.timer.clearTickInterval(`prep_${this._context.roundId}`);
  }

  /**
   * Activate a round (start gameplay phase).
   * Transitions from PREPARATION → ROUND_ACTIVE.
   * Updates DB status to IN_PROGRESS, and emits ROUND_STARTED.
   *
   * @returns {Promise<{result: Object, emissions: Array}>}
   * @throws {RoundError} if not in PREPARATION state
   */
  async activateRound() {
    if (!this._context) {
      throw new RoundError('No round context loaded');
    }

    if (this._context.lifecycleState !== RoundLifecycleState.PREPARATION) {
      throw new RoundError(
        `Cannot activate round: current lifecycle state is ${this._context.lifecycleState}`
      );
    }

    // Clean up preparation timer
    await this.timer.cleanup(`prep_${this._context.roundId}`);

    // Update DB status
    await this._prisma.rounds.update({
      where: { id: this._context.roundId },
      data: { status: RoundStatus.IN_PROGRESS, started_at: new Date() },
    });

    // Update local context
    this._context.dbStatus = RoundStatus.IN_PROGRESS;
    this._context.lifecycleState = RoundLifecycleState.ROUND_ACTIVE;

    const result = {
      roundId: this._context.roundId,
      competitionId: this._context.competitionId,
      stageId: this._context.stageId,
      roundType: this._context.roundType,
      roundName: this._context.roundName,
      orderNumber: this._context.orderNumber,
      status: RoundStatus.IN_PROGRESS,
      durationSeconds: this._context.durationSeconds,
    };

    const emissions = [{
      target: 'competition',
      targetId: this._context.competitionId,
      event: 'ROUND_STARTED',
      payload: {
        roundId: this._context.roundId,
        roundNumber: this._context.orderNumber,
        roundName: this._context.roundName,
        roundType: this._context.roundType,
        durationSeconds: this._context.durationSeconds,
      },
    }];

    return { result, emissions };
  }

  /**
   * Start the gameplay timer for the active round.
   * Call this after activateRound() and engine.setup().
   *
   * @param {string} competitionId
   * @param {function} onTimerExpire - Callback when gameplay timer expires
   * @returns {Promise<{turnEndsAt: number}>}
   */
  async startGameplayTimer(competitionId, onTimerExpire) {
    if (!this._context) {
      throw new RoundError('No round context loaded');
    }

    if (this._context.lifecycleState !== RoundLifecycleState.ROUND_ACTIVE) {
      throw new RoundError(
        `Cannot start gameplay timer: current lifecycle state is ${this._context.lifecycleState}`
      );
    }

    // Start gameplay timer
    const { turnEndsAt } = await this.timer.start(
      this._context.roundId,
      this._context.durationSeconds
    );

    // Start timer ticks for gameplay phase
    this.startTimerTick(competitionId, onTimerExpire);

    return { turnEndsAt };
  }

  /**
   * Finish the current round.
   * Transitions from ROUND_ACTIVE → ROUND_FINISHED.
   * Updates DB status to FINISHED, cleans up timer, emits ROUND_FINISHED.
   *
   * @returns {Promise<{result: Object, emissions: Array}>}
   * @throws {RoundError} if not in ROUND_ACTIVE state
   */
  async finishRound() {
    if (!this._context) {
      throw new RoundError('No round context loaded');
    }

    if (this._context.lifecycleState !== RoundLifecycleState.ROUND_ACTIVE) {
      throw new RoundError(
        `Cannot finish round: current lifecycle state is ${this._context.lifecycleState}`
      );
    }

    // Get remaining seconds before cleanup
    const remainingSeconds = await this.timer.getRemainingSeconds(this._context.roundId);

    // Clean up timer
    await this.timer.cleanup(this._context.roundId);

    // Update DB status
    await this._prisma.rounds.update({
      where: { id: this._context.roundId },
      data: { status: RoundStatus.FINISHED, ended_at: new Date() },
    });

    // Update local context
    this._context.dbStatus = RoundStatus.FINISHED;
    this._context.lifecycleState = RoundLifecycleState.ROUND_FINISHED;

    const result = {
      roundId: this._context.roundId,
      competitionId: this._context.competitionId,
      stageId: this._context.stageId,
      roundType: this._context.roundType,
      roundName: this._context.roundName,
      orderNumber: this._context.orderNumber,
      status: RoundStatus.FINISHED,
      remainingSecondsAtEnd: remainingSeconds,
    };

    const emissions = [{
      target: 'competition',
      targetId: this._context.competitionId,
      event: 'ROUND_FINISHED',
      payload: {
        roundId: this._context.roundId,
        roundNumber: this._context.orderNumber,
        roundName: this._context.roundName,
        roundType: this._context.roundType,
      },
    }];

    return { result, emissions };
  }

  /**
   * Pause the current round.
   * Only valid in ROUND_ACTIVE state. DB status → PAUSED.
   *
   * @returns {Promise<{result: Object, emissions: Array}>}
   * @throws {RoundError} if not in ROUND_ACTIVE state
   */
  async pauseRound() {
    if (!this._context) {
      throw new RoundError('No round context loaded');
    }

    if (this._context.lifecycleState !== RoundLifecycleState.ROUND_ACTIVE) {
      throw new RoundError(
        `Cannot pause round: current lifecycle state is ${this._context.lifecycleState}`
      );
    }

    // Pause timer
    const remainingSeconds = await this.timer.pause(this._context.roundId);

    // Update DB
    await this._prisma.rounds.update({
      where: { id: this._context.roundId },
      data: { status: RoundStatus.PAUSED, waiting_seconds: remainingSeconds },
    });

    this._context.dbStatus = RoundStatus.PAUSED;

    const result = {
      roundId: this._context.roundId,
      competitionId: this._context.competitionId,
      status: RoundStatus.PAUSED,
      remainingSeconds,
    };

    const emissions = [{
      target: 'competition',
      targetId: this._context.competitionId,
      event: 'ROUND_PAUSED',
      payload: {
        roundId: this._context.roundId,
        roundNumber: this._context.orderNumber,
        remainingSeconds,
      },
    }];

    return { result, emissions };
  }

  /**
   * Resume a paused round.
   * DB status → IN_PROGRESS, timer recalculated.
   *
   * @returns {Promise<{result: Object, emissions: Array}>}
   * @throws {RoundError} if not paused
   */
  async resumeRound() {
    if (!this._context) {
      throw new RoundError('No round context loaded');
    }

    if (this._context.dbStatus !== RoundStatus.PAUSED) {
      throw new RoundError(
        `Cannot resume round: current DB status is ${this._context.dbStatus}`
      );
    }

    // Resume timer
    const timerResult = await this.timer.resume(this._context.roundId);

    // Update DB
    await this._prisma.rounds.update({
      where: { id: this._context.roundId },
      data: { status: RoundStatus.IN_PROGRESS },
    });

    this._context.dbStatus = RoundStatus.IN_PROGRESS;

    const result = {
      roundId: this._context.roundId,
      competitionId: this._context.competitionId,
      status: RoundStatus.IN_PROGRESS,
      turnEndsAt: timerResult?.turnEndsAt,
      durationSeconds: timerResult?.durationSeconds,
    };

    const emissions = [{
      target: 'competition',
      targetId: this._context.competitionId,
      event: 'ROUND_RESUMED',
      payload: {
        roundId: this._context.roundId,
        roundNumber: this._context.orderNumber,
        turnEndsAt: timerResult?.turnEndsAt,
        durationSeconds: timerResult?.durationSeconds || this._context.durationSeconds,
      },
    }];

    return { result, emissions };
  }

  // ─── Round Navigation ────────────────────────────────────────

  /**
   * Get the next round in the stage after the current round.
   * @returns {Promise<Object|null>} next round record or null
   */
  async getNextRound() {
    if (!this._context) return null;

    return this._prisma.rounds.findFirst({
      where: {
        stage_id: this._context.stageId,
        order_number: { gt: this._context.orderNumber },
      },
      orderBy: { order_number: 'asc' },
    });
  }

  /**
   * Check if there is a next round after the current one.
   * @returns {Promise<boolean>}
   */
  async hasNextRound() {
    const next = await this.getNextRound();
    return next !== null;
  }

  /**
   * Get the first round in a stage.
   * @param {string} stageId
   * @returns {Promise<Object|null>} first round or null
   */
  async findFirstRound(stageId) {
    return this._prisma.rounds.findFirst({
      where: { stage_id: stageId },
      orderBy: { order_number: 'asc' },
    });
  }

  /**
   * Get all rounds in a stage (ordered).
   * @param {string} stageId
   * @returns {Promise<Array>} rounds array
   */
  async loadAllRounds(stageId) {
    return this._prisma.rounds.findMany({
      where: { stage_id: stageId },
      orderBy: { order_number: 'asc' },
    });
  }

  /**
   * Find the currently active round (IN_PROGRESS) for a competition.
   * @param {string} competitionId
   * @returns {Promise<Object|null>} active round or null
   */
  async findActiveRound(competitionId) {
    return this._prisma.rounds.findFirst({
      where: {
        competition_stages: { competition_id: competitionId },
        status: RoundStatus.IN_PROGRESS,
      },
    });
  }

  /**
   * Find the currently paused round for a competition.
   * @param {string} competitionId
   * @returns {Promise<Object|null>} paused round or null
   */
  async findPausedRound(competitionId) {
    return this._prisma.rounds.findFirst({
      where: {
        competition_stages: { competition_id: competitionId },
        status: RoundStatus.PAUSED,
      },
    });
  }

  /**
   * Find round by ID.
   * @param {string} roundId
   * @returns {Promise<Object|null>} round or null
   */
  async findRound(roundId) {
    return this._prisma.rounds.findUnique({
      where: { id: roundId },
      include: {
        competition_stages: { select: { competition_id: true } },
        round_puzzles: {
          include: { puzzles: true },
          orderBy: { order_number: 'asc' },
        },
      },
    });
  }

  // ─── Timer Tick Management ────────────────────────────────────

  /**
   * Start a timer tick interval for the current round.
   * Broadcasts TIMER_TICK every ~10s for client recalibration.
   * Calls onExpire() when timer runs out.
   *
   * @param {string} competitionId
   * @param {(competitionId: string, roundId: string) => void} onExpire
   */
  startTimerTick(competitionId, onExpire) {
    if (!this._context) return;

    this.timer.startTickInterval(
      this._context.roundId,
      this._context.durationSeconds,
      (remaining, timerState, shouldBroadcast) => {
        if (shouldBroadcast) {
          this.bus.emitImmediate({
            target: 'competition',
            targetId: competitionId,
            event: 'TIMER_TICK',
            payload: {
              roundId: this._context.roundId,
              remainingSeconds: remaining,
              totalSeconds: timerState?.durationSeconds || this._context.durationSeconds,
              turnEndsAt: timerState?.turnEndsAt || 0,
            },
          });
        }
      },
      async () => {
        try {
          await onExpire(competitionId, this._context.roundId);
        } catch (e) {
          console.error('[RoundManager] Timer expiry callback failed:', e.message);
        }
      }
    );
  }

  /**
   * Clear the timer tick interval for the current round.
   */
  clearTimerTick() {
    if (!this._context) return;
    this.timer.clearTickInterval(this._context.roundId);
  }

  // ─── Puzzle Data Helpers ─────────────────────────────────────

  /**
   * Get puzzles mapped for round engine consumption.
   * Maps new schema field names to what round engines expect.
   *
   * @returns {Array} puzzles in engine-expected format
   */
  getPuzzlesForEngine() {
    if (!this._context) return [];

    return this._context.puzzles.map(p => ({
      ...p,
      order_in_round: p.orderNumber,
      points: p.score,
      puzzle_type: p.type,
      initial_grid: typeof p.initialGrid === 'string'
        ? p.initialGrid : JSON.stringify(p.initialGrid),
      solution: typeof p.solutionGrid === 'string'
        ? p.solutionGrid : JSON.stringify(p.solutionGrid),
    }));
  }

  // ─── State Persistence (future) ──────────────────────────────

  /**
   * Save current round context to StateRepository.
   */
  async saveContext() {
    if (!this._context) return;
    // Future: await this.state.setRoundContext(this._context.competitionId, this._context);
  }

  /**
   * Restore round context from StateRepository.
   * @param {string} competitionId
   * @returns {Promise<Object|null>}
   */
  async restoreContext(competitionId) {
    // Future: const ctx = await this.state.getRoundContext(competitionId);
    // if (ctx) this._context = ctx;
    // return ctx;
    return null;
  }

  /**
   * Clear round context.
   */
  async clearContext() {
    if (!this._context) return;
    // Future: await this.state.deleteRoundContext(this._context.competitionId);
    this._context = null;
  }

  // ─── Validation Helpers ──────────────────────────────────────

  /**
   * Check if a round type is supported.
   * @param {string} roundType
   * @returns {boolean}
   */
  isRoundTypeSupported(roundType) {
    return isValidRoundType(roundType);
  }
}

module.exports = {
  RoundManager,
  RoundLifecycleState,
  RoundStatus,
};
