/**
 * Team repository — abstracts all team-related database operations.
 * All methods are async (PostgreSQL).
 */

class TeamRepository {
  constructor(db) {
    this.db = db;
  }

  async findById(id) {
    return this.db.get('SELECT * FROM teams WHERE id = ?', [id]);
  }

  async findByTournament(tournamentId) {
    return this.db.all('SELECT * FROM teams WHERE tournament_id = ?', [tournamentId]);
  }

  async findByTournamentWithMemberCount(tournamentId) {
    return this.db.all(
      'SELECT t.*, (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) as member_count FROM teams t WHERE t.tournament_id = ?',
      [tournamentId]
    );
  }

  async findByTournamentWithMembers(tournamentId) {
    const teams = await this.findByTournament(tournamentId);
    for (const t of teams) {
      t.members = await this.getMembers(t.id);
    }
    return teams;
  }

  async create({ tournamentId, name }) {
    await this.db.run('INSERT INTO teams (tournament_id, name) VALUES (?, ?)', [tournamentId, name]);
    return this.db.get('SELECT * FROM teams ORDER BY id DESC LIMIT 1');
  }

  async findMemberTeam(tournamentId, playerId) {
    return this.db.get(
      'SELECT tm.* FROM team_members tm JOIN teams t ON tm.team_id = t.id WHERE tm.player_id = ? AND t.tournament_id = ?',
      [playerId, tournamentId]
    );
  }

  async findTeamForPlayerInRound(roundId, playerId) {
    const row = await this.db.get(
      'SELECT ppa.team_id FROM player_puzzle_assignments ppa WHERE ppa.round_id = ? AND ppa.player_id = ? LIMIT 1',
      [roundId, playerId]
    );
    return row?.team_id || null;
  }

  async getMembers(teamId) {
    return this.db.all(
      'SELECT tm.*, u.username, u.display_name FROM team_members tm JOIN users u ON tm.player_id = u.id WHERE tm.team_id = ?',
      [teamId]
    );
  }

  async getMembersWithDetails(teamId) {
    return this.db.all(
      'SELECT tm.*, u.id as player_id, u.display_name FROM team_members tm JOIN users u ON tm.player_id = u.id WHERE tm.team_id = ? ORDER BY tm.position',
      [teamId]
    );
  }

  async addMember({ teamId, playerId, position }) {
    await this.db.run('INSERT INTO team_members (team_id, player_id, position) VALUES (?, ?, ?)', [teamId, playerId, position || null]);
  }

  async memberExists(teamId, playerId) {
    const row = await this.db.get('SELECT * FROM team_members WHERE team_id = ? AND player_id = ?', [teamId, playerId]);
    return !!row;
  }

  async playerInOtherTeam(tournamentId, playerId) {
    return this.db.get(
      'SELECT tm.* FROM team_members tm JOIN teams t ON tm.team_id = t.id WHERE tm.player_id = ? AND t.tournament_id = ?',
      [playerId, tournamentId]
    );
  }

  async getPlayerNames(teamId) {
    const members = await this.getMembers(teamId);
    const names = {};
    members.forEach(m => names[m.player_id] = m.display_name);
    return names;
  }

  async getTournamentPlayers(tournamentId) {
    return this.db.all(
      'SELECT u.id, u.display_name, tm.team_id FROM users u JOIN team_members tm ON u.id = tm.player_id JOIN teams t ON tm.team_id = t.id WHERE t.tournament_id = ?',
      [tournamentId]
    );
  }

  async assignJudge({ tournamentId, judgeId }) {
    await this.db.run('INSERT INTO tournament_judges (tournament_id, judge_id) VALUES (?, ?)', [tournamentId, judgeId]);
  }

  async judgeAlreadyAssigned(tournamentId, judgeId) {
    const row = await this.db.get('SELECT * FROM tournament_judges WHERE tournament_id = ? AND judge_id = ?', [tournamentId, judgeId]);
    return !!row;
  }

  async getJudges(tournamentId) {
    return this.db.all(
      'SELECT tj.*, u.username, u.display_name FROM tournament_judges tj JOIN users u ON tj.judge_id = u.id WHERE tj.tournament_id = ?',
      [tournamentId]
    );
  }
}

module.exports = TeamRepository;
