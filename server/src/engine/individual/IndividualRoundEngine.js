/**
 * IndividualRoundEngine — Solo speed-solving rounds (Individual Stage).
 *
 * Supports three round types:
 * - INDIVIDUAL_STANDARD: Classic Sudoku puzzles
 * - INDIVIDUAL_SHAPED: Sudoku with shaped regions
 * - INDIVIDUAL_MIXED: Mixed puzzle types
 *
 * Scoring: Completion-based via ScoringService.calculateCompletion()
 *   puzzleScore = Math.round(maxPoints * correctlyFilledCells / totalOriginallyEmptyCells)
 *
 * Auto-save: Player moves are tracked via WebSocket player_move events,
 * persisted to puzzle_answers on round-end before scoring.
 */

const RoundEngine = require('../RoundEngine');
const { getPrisma } = require('../../db/prisma');

class IndividualRoundEngine extends RoundEngine {
  /**
   * @param {import('../../db/index')} repos
   * @param {import('../../state/StateRepository')} state
   * @param {import('../ScoringService')} scoring
   */
  constructor(repos, state, scoring) {
    super(repos, state, scoring);
  }

  /** @private Shorthand for getPrisma() */
  get _prisma() {
    return getPrisma();
  }

  // ─── Setup ────────────────────────────────────────────────────

  async setup(competitionId, roundId, teams, puzzles) {
    const emissions = [];
    const prisma = this._prisma;

    // Get all players in this competition (not team-based)
    const players = await prisma.players.findMany({
      where: { competition_id: competitionId },
      include: { users: { select: { id: true, username: true } } },
    });

    // Create player sessions and puzzle assignments
    for (const player of players) {
      // Create or update player_round_session
      let session = await prisma.player_round_sessions.findUnique({
        where: {
          round_id_participant_id: {
            round_id: roundId,
            participant_id: player.id,
          },
        },
      });

      if (!session) {
        session = await prisma.player_round_sessions.create({
          data: {
            round_id: roundId,
            participant_id: player.id,
            status: 'PLAYING',
          },
        });
      } else {
        session = await prisma.player_round_sessions.update({
          where: { id: session.id },
          data: { status: 'PLAYING' },
        });
      }

      // Assign all puzzles to this player (individual mode)
      let puzzleOrder = 1;
      for (const puzzle of puzzles) {
        const initialGrid = typeof puzzle.initial_grid === 'string'
          ? JSON.parse(puzzle.initial_grid)
          : puzzle.initial_grid;

        // Create puzzle_answer entry using the actual session UUID
        await prisma.puzzle_answers.upsert({
          where: {
            session_id_puzzle_id: {
              session_id: session.id,
              puzzle_id: puzzle.id,
            },
          },
          create: {
            session_id: session.id,
            puzzle_id: puzzle.id,
            current_grid: initialGrid,
            correct_cells: 0,
            total_empty_cells: 0,
            progress_percentage: 0,
          },
          update: {
            current_grid: initialGrid,
            correct_cells: 0,
            progress_percentage: 0,
          },
        });

        puzzleOrder++;
      }

      // Build puzzle list for client
      const playerPuzzles = puzzles.map((p, idx) => {
        const initialGrid = typeof p.initial_grid === 'string'
          ? JSON.parse(p.initial_grid)
          : p.initial_grid;
        return {
          puzzleId: p.id,
          puzzleType: p.type || 'STANDARD',
          orderInRound: idx + 1,
          initialGrid,
          points: p.score || 100,
          difficulty: p.difficulty || 'MEDIUM',
        };
      });

      emissions.push(this._emitUser(player.user_id, 'PUZZLE_ASSIGN', {
        roundId,
        puzzles: playerPuzzles,
      }));
    }

    return { result: { roundId, setup: 'INDIVIDUAL' }, emissions };
  }

  // ─── Submit answer (server-authoritative scoring) ─────────────

  async submitAnswer(userId, competitionId, roundId, puzzleId, submissionType, data) {
    const emissions = [];
    const prisma = this._prisma;

    const round = await prisma.rounds.findUnique({
      where: { id: roundId },
    });
    if (!round || round.status !== 'IN_PROGRESS') {
      throw new Error('轮次未在进行中');
    }

    // Find player record
    const player = await prisma.players.findFirst({
      where: { competition_id: competitionId, user_id: userId },
    });
    if (!player) throw new Error('未找到参赛者记录');

    // Get puzzle
    const puzzle = await prisma.puzzles.findUnique({
      where: { id: puzzleId },
    });
    if (!puzzle) throw new Error('题目不存在');

    const solution = typeof puzzle.solution_grid === 'string'
      ? JSON.parse(puzzle.solution_grid)
      : puzzle.solution_grid;

    const initialGrid = typeof puzzle.initial_grid === 'string'
      ? JSON.parse(puzzle.initial_grid)
      : puzzle.initial_grid;

    // Get player's current grid from data or puzzle_answers
    let playerGrid = data.grid;
    if (!playerGrid) {
      const answer = await prisma.puzzle_answers.findFirst({
        where: {
          session_id: `${roundId}_${player.id}`,
          puzzle_id: puzzleId,
        },
      });
      if (!answer) throw new Error('未找到答题记录');
      playerGrid = typeof answer.current_grid === 'string'
        ? JSON.parse(answer.current_grid)
        : answer.current_grid;
    }

    // Calculate completion score
    const completion = this.scoring.calculateCompletion(initialGrid, solution, playerGrid);
    const maxPoints = puzzle.score || 100;
    const puzzleScore = Math.round(maxPoints * completion.completionRatio);

    // Update puzzle_answers with final score
    await prisma.puzzle_answers.updateMany({
      where: {
        session_id: `${roundId}_${player.id}`,
        puzzle_id: puzzleId,
      },
      data: {
        current_grid: playerGrid,
        correct_cells: completion.correctlyFilledCells,
        total_empty_cells: completion.totalOriginallyEmptyCells,
        progress_percentage: completion.completionRatio * 100,
      },
    });

    // Update player_round_session status if all puzzles completed
    const allAnswers = await prisma.puzzle_answers.findMany({
      where: {
        session_id: `${roundId}_${player.id}`,
      },
    });
    const allCompleted = allAnswers.every(a => a.progress_percentage >= 100);
    if (allCompleted) {
      await prisma.player_round_sessions.updateMany({
        where: {
          round_id: roundId,
          participant_id: player.id,
        },
        data: { status: 'SUBMITTED' },
      });
    }

    // Emit score update
    emissions.push(this._emitUser(userId, 'ANSWER_RESULT', {
      roundId,
      puzzleId,
      isCorrect: completion.completionRatio >= 1.0,
      pointsEarned: puzzleScore,
      completionRatio: completion.completionRatio,
      correctlyFilledCells: completion.correctlyFilledCells,
      totalOriginallyEmptyCells: completion.totalOriginallyEmptyCells,
    }));

    // Emit score update to competition
    emissions.push({
      target: 'competition',
      targetId: competitionId,
      event: 'SCORE_UPDATE',
      payload: {
        roundId,
        playerId: userId,
        playerName: player.users?.username || 'Unknown',
        puzzleScore,
        completionRatio: completion.completionRatio,
      },
    });

    return {
      result: {
        puzzleId,
        puzzleScore,
        completionRatio: completion.completionRatio,
        correctlyFilledCells: completion.correctlyFilledCells,
        totalOriginallyEmptyCells: completion.totalOriginallyEmptyCells,
      },
      emissions,
    };
  }

  // ─── Reconnect state ──────────────────────────────────────────

  async getReconnectState(userId, competitionId, roundId) {
    const prisma = this._prisma;

    const player = await prisma.players.findFirst({
      where: { competition_id: competitionId, user_id: userId },
    });
    if (!player) return null;

    const session = await prisma.player_round_sessions.findUnique({
      where: {
        round_id_participant_id: {
          round_id: roundId,
          participant_id: player.id,
        },
      },
      include: {
        puzzle_answers: {
          include: { puzzles: true },
        },
      },
    });

    if (!session) return null;

    const puzzles = session.puzzle_answers.map(pa => {
      const puzzle = pa.puzzles;
      const initialGrid = typeof puzzle.initial_grid === 'string'
        ? JSON.parse(puzzle.initial_grid)
        : puzzle.initial_grid;
      const currentGrid = pa.current_grid
        ? (typeof pa.current_grid === 'string' ? JSON.parse(pa.current_grid) : pa.current_grid)
        : initialGrid;

      return {
        puzzleId: puzzle.id,
        puzzleType: puzzle.type || 'STANDARD',
        orderInRound: pa.progress_percentage,
        initialGrid,
        currentGrid,
        points: puzzle.score || 100,
        difficulty: puzzle.difficulty || 'MEDIUM',
        progressPercentage: pa.progress_percentage,
        isCompleted: pa.progress_percentage >= 100,
      };
    });

    const totalScore = puzzles.reduce((sum, p) => {
      return sum + Math.round((p.points || 100) * (p.progressPercentage / 100));
    }, 0);

    return {
      puzzles,
      sessionStatus: session.status,
      totalScore,
      solvedCount: puzzles.filter(p => p.isCompleted).length,
      totalPuzzles: puzzles.length,
    };
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  async cleanup(competitionId, roundId) {
    // Individual rounds have no special state to clean up
    // puzzle_answers and player_round_sessions persist for scoring
  }
}

module.exports = IndividualRoundEngine;
