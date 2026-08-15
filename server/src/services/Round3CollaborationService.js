/**
 * Round3CollaborationService — consensus-based propose/accept/reject + player focus.
 *
 * Approval model:
 *   - A player PROPOSES a cell fill.
 *   - The proposer CANNOT accept/reject their own proposal.
 *   - ALL other ONLINE teammates must APPROVE for the proposal to become official.
 *   - If even one teammate REJECTS, the proposal is immediately rejected.
 *   - Online status is determined via StateRepository.getActivePlayers().
 *
 * Uses StateRepository for persistence (Redis in production, Memory in dev).
 * Follows SRP: only handles collaboration state and validation.
 */

class Round3CollaborationService {
  /**
   * @param {object} repos - repository factory
   * @param {import('../state/StateRepository')} state - StateRepository
   * @param {import('../engine/ScoringService')} scoring - ScoringService
   */
  constructor(repos, state, scoring) {
    this.repos = repos;
    this.state = state;
    this.scoring = scoring;
  }

  // ─── Propose a cell fill ───────────────────────────────────────

  /**
   * A player proposes filling a cell with a value.
   * Validates that the cell is not an initial cell and not already officially filled.
   *
   * @param {number} puzzleId
   * @param {number} row
   * @param {number} col
   * @param {number} value
   * @param {number} playerId
   * @param {string} playerName
   * @param {number} teamId
   * @param {number} roundId
   * @returns {Promise<{suggestion: object, emissions: Array}>}
   */
  async proposeCell(puzzleId, row, col, value, playerId, playerName, teamId, roundId) {
    const emissions = [];

    // Check if cell has an initial value
    const puzzle = await this.repos.puzzles.findById(puzzleId);
    if (puzzle) {
      const initial = JSON.parse(puzzle.initial_grid);
      if (initial[row]?.[col] !== 0) {
        return { suggestion: null, emissions: [] };
      }
    }

    // Check if cell is already officially filled
    const cells = await this.state.getRound3Cells(puzzleId);
    const key = `${row}-${col}`;
    if (cells[key]) {
      // Already officially filled — don't allow proposal
      return { suggestion: null, emissions: [] };
    }

    // Remove any existing suggestion for this cell (replace with new proposal)
    const existingSuggestions = await this.state.getRound3Suggestions(puzzleId);
    if (existingSuggestions[key]) {
      await this.state.removeRound3Suggestion(puzzleId, key);
      await this.state.deleteRound3SuggestionVotes(puzzleId, key);
    }

    // Store the suggestion
    await this.state.addRound3Suggestion(puzzleId, row, col, value, playerId, playerName);

    const suggestion = { row, col, value, playerId, playerName };

    // Emit to team
    const round = await this.repos.rounds.findById(roundId);
    const competitionId = round?.competition_id;
    if (competitionId) {
      emissions.push({
        target: 'team',
        targetId: { competitionId, teamId },
        event: 'ROUND3_MOVE_PROPOSED',
        payload: { roundId, puzzleId, row, col, value, playerId, playerName }
      });
    }

    return { suggestion, emissions };
  }

  // ─── Approve a proposal (consensus vote) ────────────────────────

  /**
   * A teammate approves a proposed cell fill.
   * If ALL online teammates (excluding the proposer) have approved, the proposal becomes official.
   *
   * @param {number} puzzleId
   * @param {number} row
   * @param {number} col
   * @param {number} approverPlayerId
   * @param {string} approverPlayerName
   * @param {number} teamId
   * @param {number} roundId
   * @param {number} competitionId
   * @returns {Promise<{success: boolean, accepted: boolean, emissions: Array}>}
   */
  async acceptProposal(puzzleId, row, col, approverPlayerId, approverPlayerName, teamId, roundId, competitionId) {
    const emissions = [];
    const key = `${row}-${col}`;

    // Check that a suggestion exists for this cell
    const suggestions = await this.state.getRound3Suggestions(puzzleId);
    const suggestion = suggestions[key];
    if (!suggestion) {
      return { success: false, accepted: false, emissions: [] };
    }

    // Guard: proposer cannot approve their own proposal
    if (Number(suggestion.playerId) === Number(approverPlayerId)) {
      return { success: false, accepted: false, emissions: [] };
    }

    // Check if cell is already officially filled
    const cells = await this.state.getRound3Cells(puzzleId);
    if (cells[key]) {
      await this.state.removeRound3Suggestion(puzzleId, key);
      await this.state.deleteRound3SuggestionVotes(puzzleId, key);
      return { success: false, accepted: false, emissions: [] };
    }

    // Record the approval vote
    await this.state.addRound3SuggestionVote(puzzleId, key, approverPlayerId);

    // Get current votes
    const votes = await this.state.getRound3SuggestionVotes(puzzleId, key);

    // Count required approvals: all online teammates except the proposer
    const onlinePlayers = await this.state.getActivePlayers(competitionId);
    const teamMembers = await this.repos.teams.getMembersWithDetails(teamId);
    const onlineTeammateIds = teamMembers
      .map(m => Number(m.player_id))
      .filter(pid => pid !== Number(suggestion.playerId) && onlinePlayers[String(pid)]);

    const allApproved = onlineTeammateIds.length > 0 &&
      onlineTeammateIds.every(pid => votes.includes(pid));

    // Emit vote cast event (for UI progress)
    emissions.push({
      target: 'team',
      targetId: { competitionId, teamId },
      event: 'ROUND3_VOTE_CAST',
      payload: {
        roundId, puzzleId, row, col,
        voterId: approverPlayerId, voterName: approverPlayerName,
        voteType: 'approve',
        approveCount: votes.length,
        requiredCount: onlineTeammateIds.length
      }
    });

    if (allApproved) {
      // Consensus reached — claim the cell officially
      const claimResult = await this.state.claimRound3Cell(
        puzzleId, row, col, suggestion.value, suggestion.playerId, suggestion.playerName
      );

      if (claimResult.success) {
        // Remove the suggestion and its votes
        await this.state.removeRound3Suggestion(puzzleId, key);
        await this.state.deleteRound3SuggestionVotes(puzzleId, key);

        // Emit accepted event
        emissions.push({
          target: 'team',
          targetId: { competitionId, teamId },
          event: 'ROUND3_MOVE_ACCEPTED',
          payload: {
            roundId, puzzleId, row, col,
            value: suggestion.value,
            playerId: suggestion.playerId,
            playerName: suggestion.playerName,
            acceptedBy: votes // all approvers
          }
        });

        // Emit board updated event
        emissions.push({
          target: 'team',
          targetId: { competitionId, teamId },
          event: 'ROUND3_BOARD_UPDATED',
          payload: {
            roundId, puzzleId, row, col,
            value: suggestion.value,
            playerId: suggestion.playerId,
            playerName: suggestion.playerName
          }
        });

        return { success: true, accepted: true, emissions };
      }

      // Claim failed (race condition — someone else filled it)
      await this.state.removeRound3Suggestion(puzzleId, key);
      await this.state.deleteRound3SuggestionVotes(puzzleId, key);
      return { success: false, accepted: false, emissions };
    }

    // Not all approvals yet — wait for more
    return { success: true, accepted: false, emissions };
  }

  // ─── Reject a proposal ─────────────────────────────────────────

  /**
   * A teammate rejects a proposed cell fill.
   * Any single rejection immediately kills the proposal.
   * The proposer cannot reject their own proposal (they should withdraw instead).
   *
   * @param {number} puzzleId
   * @param {number} row
   * @param {number} col
   * @param {number} rejectorPlayerId
   * @param {string} rejectorPlayerName
   * @param {number} teamId
   * @param {number} roundId
   * @param {number} competitionId
   * @returns {Promise<{success: boolean, emissions: Array}>}
   */
  async rejectProposal(puzzleId, row, col, rejectorPlayerId, rejectorPlayerName, teamId, roundId, competitionId) {
    const emissions = [];
    const key = `${row}-${col}`;

    // Check that a suggestion exists
    const suggestions = await this.state.getRound3Suggestions(puzzleId);
    if (!suggestions[key]) {
      return { success: false, emissions: [] };
    }

    // Guard: proposer cannot reject their own proposal
    if (Number(suggestions[key].playerId) === Number(rejectorPlayerId)) {
      return { success: false, emissions: [] };
    }

    // Remove the suggestion and its votes
    await this.state.removeRound3Suggestion(puzzleId, key);
    await this.state.deleteRound3SuggestionVotes(puzzleId, key);

    // Emit rejected event
    emissions.push({
      target: 'team',
      targetId: { competitionId, teamId },
      event: 'ROUND3_MOVE_REJECTED',
      payload: {
        roundId, puzzleId, row, col,
        rejectedBy: rejectorPlayerId,
        rejectedByName: rejectorPlayerName
      }
    });

    return { success: true, emissions };
  }

  // ─── Withdraw own proposal ──────────────────────────────────────

  /**
   * The proposer withdraws their own proposal.
   *
   * @param {number} puzzleId
   * @param {number} row
   * @param {number} col
   * @param {number} playerId
   * @param {number} teamId
   * @param {number} roundId
   * @param {number} competitionId
   * @returns {Promise<{success: boolean, emissions: Array}>}
   */
  async withdrawProposal(puzzleId, row, col, playerId, teamId, roundId, competitionId) {
    const key = `${row}-${col}`;
    const suggestions = await this.state.getRound3Suggestions(puzzleId);
    const suggestion = suggestions[key];

    if (!suggestion) return { success: false, emissions: [] };
    if (Number(suggestion.playerId) !== Number(playerId)) return { success: false, emissions: [] };

    await this.state.removeRound3Suggestion(puzzleId, key);
    await this.state.deleteRound3SuggestionVotes(puzzleId, key);

    const emissions = [{
      target: 'team',
      targetId: { competitionId, teamId },
      event: 'ROUND3_MOVE_REJECTED',
      payload: { roundId, puzzleId, row, col, rejectedBy: playerId, rejectedByName: '(withdrawn)' }
    }];

    return { success: true, emissions };
  }

  // ─── Player focus ──────────────────────────────────────────────

  /**
   * Update which cell a player is currently viewing.
   */
  async updatePlayerFocus(puzzleId, playerId, playerName, row, col, teamId, roundId, competitionId) {
    await this.state.setRound3PlayerFocus(puzzleId, playerId, { row, col });

    const emissions = [{
      target: 'team',
      targetId: { competitionId, teamId },
      event: 'ROUND3_FOCUS_UPDATE',
      payload: { roundId, puzzleId, playerId, playerName, row, col }
    }];

    return { emissions };
  }

  // ─── Query state ───────────────────────────────────────────────

  /**
   * Get the full collaboration state for a puzzle.
   */
  async getPuzzleState(puzzleId) {
    const [cells, suggestions, playerFocuses] = await Promise.all([
      this.state.getRound3Cells(puzzleId),
      this.state.getRound3Suggestions(puzzleId),
      this.state.getRound3PlayerFocuses(puzzleId)
    ]);

    // Include vote counts for each suggestion
    const suggestionVotes = {};
    for (const key of Object.keys(suggestions)) {
      suggestionVotes[key] = await this.state.getRound3SuggestionVotes(puzzleId, key);
    }

    return { cells, suggestions, playerFocuses, suggestionVotes };
  }

  /**
   * Clean up all R3 state for a puzzle.
   */
  async clearPuzzleState(puzzleId) {
    await Promise.all([
      this.state.deleteRound3Cells(puzzleId),
      this.state.deleteRound3Suggestions(puzzleId),
      this.state.deleteRound3PlayerFocuses(puzzleId),
      this.state.deleteAllRound3SuggestionVotes(puzzleId)
    ]);
  }
}

module.exports = Round3CollaborationService;
