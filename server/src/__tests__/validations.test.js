const { loginSchema } = require('../validations/auth');
const { createTournamentSchema, createRoundSchema } = require('../validations/tournaments');
const { submitAnswerSchema } = require('../validations/game');
const { generatePuzzlesSchema, generateBulkSchema } = require('../validations/puzzleBank');

describe('Auth validation schemas', () => {
  test('loginSchema accepts valid credentials', () => {
    const result = loginSchema.safeParse({ username: 'admin', password: '123456' });
    expect(result.success).toBe(true);
  });

  test('loginSchema rejects empty username', () => {
    const result = loginSchema.safeParse({ username: '', password: '123456' });
    expect(result.success).toBe(false);
  });

  test('loginSchema rejects missing password', () => {
    const result = loginSchema.safeParse({ username: 'admin' });
    expect(result.success).toBe(false);
  });
});

describe('Tournament validation schemas', () => {
  test('createTournamentSchema accepts valid tournament', () => {
    const result = createTournamentSchema.safeParse({ name: 'Test Cup' });
    expect(result.success).toBe(true);
  });

  test('createRoundSchema rejects invalid roundType', () => {
    const result = createRoundSchema.safeParse({
      name: 'Round 1', roundType: 'INVALID_TYPE', durationSeconds: 600,
    });
    expect(result.success).toBe(false);
  });

  test('createRoundSchema accepts valid round', () => {
    const result = createRoundSchema.safeParse({
      name: 'Round 1', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600,
    });
    expect(result.success).toBe(true);
  });
});

describe('Game validation schemas', () => {
  test('submitAnswerSchema accepts SINGLE_CELL submission', () => {
    const result = submitAnswerSchema.safeParse({
      submissionType: 'SINGLE_CELL', roundId: 1, puzzleId: 5,
      row: 3, col: 7, value: 4,
    });
    expect(result.success).toBe(true);
  });

  test('submitAnswerSchema accepts FULL_GRID submission', () => {
    const grid = Array(9).fill(null).map(() => Array(9).fill(1));
    const result = submitAnswerSchema.safeParse({
      submissionType: 'FULL_GRID', roundId: 1, puzzleId: 5, grid,
    });
    expect(result.success).toBe(true);
  });

  test('submitAnswerSchema rejects row out of range', () => {
    const result = submitAnswerSchema.safeParse({
      submissionType: 'SINGLE_CELL', roundId: 1, puzzleId: 5,
      row: 999, col: 0, value: 1,
    });
    expect(result.success).toBe(false);
  });

  test('submitAnswerSchema rejects invalid submissionType', () => {
    const result = submitAnswerSchema.safeParse({
      submissionType: 'HACKED', roundId: 1, puzzleId: 5,
    });
    expect(result.success).toBe(false);
  });
});

describe('PuzzleBank validation schemas', () => {
  test('generatePuzzlesSchema accepts valid roundType', () => {
    const result = generatePuzzlesSchema.safeParse({ roundType: 'ROUND2_RELAY' });
    expect(result.success).toBe(true);
  });

  test('generatePuzzlesSchema rejects invalid roundType', () => {
    const result = generatePuzzlesSchema.safeParse({ roundType: 'BANANE' });
    expect(result.success).toBe(false);
  });

  test('generateBulkSchema requires teamsCount', () => {
    const result = generateBulkSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  test('generateBulkSchema rejects negative teamsCount', () => {
    const result = generateBulkSchema.safeParse({ teamsCount: -3 });
    expect(result.success).toBe(false);
  });
});
