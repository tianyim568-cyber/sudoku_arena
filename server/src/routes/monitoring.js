/**
 * Judge Participant Monitoring Router
 *
 * Provides real-time participant status monitoring for competition judges.
 * Judges can view all participants with their online/offline status based
 * on heartbeat data from the state repository.
 */

const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { getPrisma } = require('../db/prisma');

/**
 * Create monitoring router factory
 * @param {object} repos - Repository collection
 * @param {object} state - State repository (Redis or memory)
 * @returns {express.Router}
 */
function createMonitoringRouter(repos, state) {
  const router = express.Router();

  /**
   * GET /competitions/:competitionId/monitoring/participants
   *
   * Returns all participants with their online/offline status.
   * Only accessible by judges assigned to this competition.
   *
   * Response:
   * {
   *   code: 200,
   *   message: 'success',
   *   data: {
   *     competitionId: string,
   *     participants: Array<{
   *       id: string,
   *       name: string,
   *       school: string | null,
   *       teamId: string | null,
   *       teamName: string | null,
   *       online: boolean,
   *       lastHeartbeatAt: number | null
   *     }>,
   *     summary: {
   *       total: number,
   *       online: number,
   *       offline: number
   *     }
   *   }
   * }
   */
  router.get(
    '/competitions/:competitionId/monitoring/participants',
    authMiddleware,
    tenantGuard('competitions', { param: 'competitionId' }),
    async (req, res) => {
      try {
        const { competitionId } = req.params;
        const userId = req.user.userId;
        const prisma = getPrisma();

        // Verify user is a judge for this competition
        const judgeAssignment = await prisma.competition_judges.findFirst({
          where: {
            competition_id: competitionId,
            user_id: userId
          }
        });

        if (!judgeAssignment) {
          return res.status(403).json({
            code: 403,
            message: 'Access denied: not assigned as judge for this competition',
            data: null
          });
        }

        // Get all players with team info
        const players = await prisma.players.findMany({
          where: { competition_id: competitionId },
          include: {
            team_members: {
              include: {
                teams: true
              }
            }
          }
        });

        // Get online status from state repository
        const activePlayers = await state.getActivePlayers(competitionId);

        // Merge participant data with online status
        const enrichedParticipants = players.map(p => {
          const activeData = activePlayers[p.user_id];
          const online = !!activeData;
          const lastHeartbeatAt = activeData ? activeData.lastHeartbeatAt : null;
          const teamMember = p.team_members?.[0];

          return {
            id: p.id,
            name: p.name,
            school: p.school || null,
            teamId: teamMember?.team_id || null,
            teamName: teamMember?.teams?.name || null,
            online,
            lastHeartbeatAt
          };
        });

        // Calculate summary statistics
        const total = enrichedParticipants.length;
        const online = enrichedParticipants.filter(p => p.online).length;
        const offline = total - online;

        return res.json({
          code: 200,
          message: 'success',
          data: {
            competitionId,
            participants: enrichedParticipants,
            summary: {
              total,
              online,
              offline
            }
          }
        });
      } catch (error) {
        console.error('[monitoring] Error fetching participants:', error);
        return res.status(500).json({
          code: 500,
          message: 'Internal server error',
          data: null
        });
      }
    }
  );

  /**
   * GET /competitions/:competitionId/monitoring/player/:playerId
   *
   * Returns a specific player's current puzzle state (grid, progress, session status).
   * Only accessible by judges assigned to this competition.
   *
   * Response:
   * {
   *   code: 200,
   *   message: 'success',
   *   data: {
   *     playerId: string,
   *     playerName: string,
   *     roundId: string | null,
   *     sessionStatus: string | null,
   *     puzzles: Array<{
   *       puzzleId: string,
   *       currentGrid: object | null,
   *       correctCells: number,
   *       totalEmptyCells: number,
   *       progressPercentage: number
   *     }>
   *   }
   * }
   */
  router.get(
    '/competitions/:competitionId/monitoring/player/:playerId',
    authMiddleware,
    tenantGuard('competitions', { param: 'competitionId' }),
    async (req, res) => {
      try {
        const { competitionId, playerId } = req.params;
        const userId = req.user.userId;
        const prisma = getPrisma();

        // Verify user is a judge for this competition
        const judgeAssignment = await prisma.competition_judges.findFirst({
          where: {
            competition_id: competitionId,
            user_id: userId
          }
        });

        if (!judgeAssignment) {
          return res.status(403).json({
            code: 403,
            message: 'Access denied: not assigned as judge for this competition',
            data: null
          });
        }

        // Get player info
        const player = await prisma.players.findUnique({
          where: { id: playerId },
        });
        if (!player || player.competition_id !== competitionId) {
          return res.status(404).json({
            code: 404,
            message: 'Player not found in this competition',
            data: null
          });
        }

        // Find current running round (rounds → competition_stages → competitions)
        const currentRound = await prisma.rounds.findFirst({
          where: {
            status: 'RUNNING',
            competition_stages: {
              competition_id: competitionId
            }
          }
        });

        // If no active round, return player info with empty puzzles
        if (!currentRound) {
          return res.json({
            code: 200,
            message: 'success',
            data: {
              playerId,
              playerName: player.name,
              roundId: null,
              sessionStatus: null,
              puzzles: []
            }
          });
        }

        // Get player's session for this round
        const session = await prisma.player_round_sessions.findUnique({
          where: {
            round_id_participant_id: {
              round_id: currentRound.id,
              participant_id: playerId,
            },
          },
        });

        // If no session exists, return empty puzzles
        if (!session) {
          return res.json({
            code: 200,
            message: 'success',
            data: {
              playerId,
              playerName: player.name,
              roundId: currentRound.id,
              sessionStatus: null,
              puzzles: []
            }
          });
        }

        // Get all puzzle answers for this session
        const answers = await prisma.puzzle_answers.findMany({
          where: { session_id: session.id },
        });

        // Build puzzle state array
        const puzzles = answers.map(a => ({
          puzzleId: a.puzzle_id,
          currentGrid: a.current_grid,
          correctCells: a.correct_cells,
          totalEmptyCells: a.total_empty_cells,
          progressPercentage: parseFloat(a.progress_percentage) || 0
        }));

        return res.json({
          code: 200,
          message: 'success',
          data: {
            playerId,
            playerName: player.name,
            roundId: currentRound.id,
            sessionStatus: session.status,
            puzzles
          }
        });
      } catch (error) {
        console.error('[monitoring] Error fetching player state:', error);
        return res.status(500).json({
          code: 500,
          message: 'Internal server error',
          data: null
        });
      }
    }
  );

  return router;
}

module.exports = { createMonitoringRouter };
