/**
 * Team repository — abstracts all team-related database operations.
 *
 * NOTE: The legacy `teams` / `team_members` / `tournament_judges` tables were
 * dropped in migration 018. This repository now backs:
 *   - `teams` (UUID PK, competition_id FK, name, created_at)
 *   - `team_members` (composite PK: team_id + participant_id, no position column)
 *   - `competition_judges` (composite PK: competition_id + user_id, assigned_at)
 *
 * Legacy → new column mapping:
 *   teams.tournament_id        → teams.competition_id
 *   team_members.player_id     → team_members.participant_id
 *   team_members.position      → (gone)
 *   tournament_judges          → competition_judges (judge_id → user_id)
 *
 * Public method names are kept identical so route handlers keep working.
 * Methods that took `competitionId` now use `competitionId` (renamed in
 * Phase 13 of the migration).
 */

class TeamRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Find a single team by its UUID.
   */
  async findById(id) {
    return this.prisma.teams.findUnique({ where: { id } });
  }

  /**
   * Find all teams for a competition.
   * (Legacy name: findByCompetition — kept for backward compat.)
   * @param {string} competitionId
   * @returns {Promise<object[]>}
   */
  async findByCompetition(competitionId) {
    return this.prisma.teams.findMany({
      where: { competition_id: competitionId },
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Find all teams for a competition with a member_count field.
   * @param {string} competitionId
   * @returns {Promise<object[]>} teams with member_count
   */
  async findByCompetitionWithMemberCount(competitionId) {
    const teams = await this.prisma.teams.findMany({
      where: { competition_id: competitionId },
      include: {
        _count: { select: { team_members: true } },
      },
      orderBy: { created_at: 'asc' },
    });
    return teams.map((t) => ({
      ...t,
      member_count: t._count?.team_members ?? 0,
      _count: undefined,
    }));
  }

  /**
   * Find all teams for a competition with their members expanded.
   * @param {string} competitionId
   * @returns {Promise<object[]>} teams each with a `members` array.
   */
  async findByCompetitionWithMembers(competitionId) {
    const teams = await this.findByCompetition(competitionId);
    for (const t of teams) {
      t.members = await this.getMembers(t.id);
    }
    return teams;
  }

  /**
   * Create a new team.
   * @param {Object} params
   * @param {string} params.competitionId - Competition UUID.
   * @param {string} params.name - Team name.
   * @returns {Promise<object>} The created team.
   */
  async create({ competitionId, name }) {
    return this.prisma.teams.create({
      data: {
        competition_id: competitionId,
        name,
      },
    });
  }

  /**
   * Find the team a participant belongs to in a given competition.
   * @param {string} competitionId
   * @param {string} participantId - Player UUID (was player_id).
   * @returns {Promise<object|null>} team_members row or null.
   */
  async findMemberTeam(competitionId, participantId) {
    const team = await this.prisma.teams.findFirst({
      where: {
        competition_id: competitionId,
        team_members: { some: { participant_id: participantId } },
      },
      include: {
        team_members: { where: { participant_id: participantId } },
      },
    });
    return team?.team_members?.[0] ?? null;
  }

  /**
   * Find the team a player is assigned to for a specific round.
   *
   * The new schema has no `player_puzzle_assignments.team_id` column.
   * Instead, a player belongs to at most one team per competition; we resolve
   * the team by looking up the player's competition (via the round → stage →
   * competition chain) and then their team_membership.
   * @param {string} roundId
   * @param {string} participantId
   * @returns {Promise<string|null>} team UUID or null.
   */
  async findTeamForPlayerInRound(roundId, participantId) {
    const round = await this.prisma.rounds.findUnique({
      where: { id: roundId },
      select: {
        stage: { select: { competition_id: true } },
      },
    });
    if (!round) return null;
    const competitionId = round.stage.competition_id;

    const member = await this.prisma.team_members.findFirst({
      where: { participant_id: participantId },
      include: { teams: { select: { competition_id: true } } },
    });
    if (!member || member.teams.competition_id !== competitionId) return null;
    return member.team_id;
  }

  /**
   * Get all members of a team with their player info.
   * @param {string} teamId
   * @returns {Promise<object[]>}
   */
  async getMembers(teamId) {
    const members = await this.prisma.team_members.findMany({
      where: { team_id: teamId },
      include: {
        players: {
          select: {
            id: true,
            name: true,
            school: true,
            users: { select: { username: true } },
          },
        },
      },
    });
    // Shape: legacy callers expected username + display_name on each row.
    return members.map((m) => ({
      team_id: m.team_id,
      participant_id: m.participant_id,
      player_id: m.participant_id, // backward compat alias
      username: m.players?.users?.username ?? null,
      display_name: m.players?.name ?? null,
    }));
  }

  /**
   * Get all members of a team with detailed player info.
   * @param {string} teamId
   * @returns {Promise<object[]>}
   */
  async getMembersWithDetails(teamId) {
    const members = await this.prisma.team_members.findMany({
      where: { team_id: teamId },
      include: {
        players: {
          select: { id: true, name: true },
        },
      },
    });
    return members.map((m) => ({
      team_id: m.team_id,
      participant_id: m.participant_id,
      player_id: m.participant_id, // backward compat alias
      display_name: m.players?.name ?? null,
    }));
  }

  /**
   * Add a participant to a team.
   * @param {Object} params
   * @param {string} params.teamId
   * @param {string} params.playerId - Participant UUID (legacy name kept).
   * @param {*} params.position - Ignored in new schema (no position column).
   */
  async addMember({ teamId, playerId, position }) {
    await this.prisma.team_members.create({
      data: {
        team_id: teamId,
        participant_id: playerId,
      },
    });
  }

  /**
   * Remove a participant from a team.
   * @param {string} teamId
   * @param {string} participantId - Participant UUID.
   */
  async removeMember(teamId, participantId) {
    await this.prisma.team_members.delete({
      where: {
        team_id_participant_id: { team_id: teamId, participant_id: participantId },
      },
    });
  }

  /**
   * Check if a participant is already in a team.
   * @param {string} teamId
   * @param {string} playerId - Participant UUID.
   * @returns {Promise<boolean>}
   */
  async memberExists(teamId, playerId) {
    const row = await this.prisma.team_members.findUnique({
      where: {
        team_id_participant_id: { team_id: teamId, participant_id: playerId },
      },
    });
    return !!row;
  }

  /**
   * Check if a participant is already in any other team of the same competition.
   * @param {string} competitionId
   * @param {string} playerId - Participant UUID.
   * @returns {Promise<object|null>} team_members row or null.
   */
  async playerInOtherTeam(competitionId, playerId) {
    return this.prisma.team_members.findFirst({
      where: {
        participant_id: playerId,
        teams: { competition_id: competitionId },
      },
    });
  }

  /**
   * Build a { participantId: displayName } map for all members of a team.
   * @param {string} teamId
   * @returns {Promise<object>}
   */
  async getPlayerNames(teamId) {
    const members = await this.getMembers(teamId);
    const names = {};
    members.forEach((m) => {
      names[m.participant_id] = m.display_name;
    });
    return names;
  }

  /**
   * Get all players in a competition with their team assignment.
   * @param {string} competitionId
   * @returns {Promise<object[]>}
   */
  async getCompetitionPlayers(competitionId) {
    const teams = await this.prisma.teams.findMany({
      where: { competition_id: competitionId },
      include: {
        team_members: {
          include: {
            players: { select: { id: true, name: true } },
          },
        },
      },
    });
    const result = [];
    for (const team of teams) {
      for (const m of team.team_members) {
        result.push({
          id: m.players.id,
          display_name: m.players.name,
          player_id: m.participant_id, // backward compat alias
          team_id: team.id,
        });
      }
    }
    return result;
  }

  /**
   * Assign a judge to a competition.
   * @param {Object} params
   * @param {string} params.competitionId - Competition UUID.
   * @param {string} params.judgeId - User UUID.
   */
  async assignJudge({ competitionId, judgeId }) {
    await this.prisma.competition_judges.create({
      data: {
        competition_id: competitionId,
        user_id: judgeId,
      },
    });
  }

  /**
   * Check if a judge is already assigned to a competition.
   * @param {string} competitionId
   * @param {string} judgeId - User UUID.
   * @returns {Promise<boolean>}
   */
  async judgeAlreadyAssigned(competitionId, judgeId) {
    const row = await this.prisma.competition_judges.findUnique({
      where: {
        competition_id_user_id: { competition_id: competitionId, user_id: judgeId },
      },
    });
    return !!row;
  }

  /**
   * Get all judges assigned to a competition, with their user info.
   * @param {string} competitionId
   * @returns {Promise<object[]>}
   */
  async getJudges(competitionId) {
    const judges = await this.prisma.competition_judges.findMany({
      where: { competition_id: competitionId },
      include: {
        users: {
          select: { id: true, username: true },
        },
      },
      orderBy: { assigned_at: 'asc' },
    });
    return judges.map((j) => ({
      competition_id: j.competition_id,
      judge_id: j.user_id,
      user_id: j.user_id,
      username: j.users.username,
      display_name: j.users.username, // display_name removed in new schema
      assigned_at: j.assigned_at,
    }));
  }
}

module.exports = TeamRepository;
