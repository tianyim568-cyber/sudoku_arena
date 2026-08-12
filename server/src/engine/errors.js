/**
 * GameError — base class for all domain errors in Sudoku Arena.
 *
 * Subclasses carry a `code` string for programmatic handling and
 * a human-readable `message` (Chinese) for API responses.
 */

class GameError extends Error {
  constructor(message, code = 'GAME_ERROR') {
    super(message);
    this.name = 'GameError';
    this.code = code;
  }
}

class TournamentError extends GameError {
  constructor(message, code = 'TOURNAMENT_ERROR') {
    super(message, code);
    this.name = 'TournamentError';
  }
}

class RoundError extends GameError {
  constructor(message, code = 'ROUND_ERROR') {
    super(message, code);
    this.name = 'RoundError';
  }
}

class PuzzleError extends GameError {
  constructor(message, code = 'PUZZLE_ERROR') {
    super(message, code);
    this.name = 'PuzzleError';
  }
}

class SubmissionError extends GameError {
  constructor(message, code = 'SUBMISSION_ERROR') {
    super(message, code);
    this.name = 'SubmissionError';
  }
}

class StateError extends GameError {
  constructor(message, code = 'STATE_ERROR') {
    super(message, code);
    this.name = 'StateError';
  }
}

class StageError extends GameError {
  constructor(message, code = 'STAGE_ERROR') {
    super(message, code);
    this.name = 'StageError';
  }
}

module.exports = {
  GameError,
  TournamentError,
  RoundError,
  PuzzleError,
  SubmissionError,
  StateError,
  StageError,
};
