const { loginSchema } = require('../validations/auth');
const { createCompetitionSchema, createRoundSchema, addTeamMemberSchema, assignJudgeSchema } = require('../validations/competitions');
const { submitAnswerSchema } = require('../validations/game');
const { generatePuzzlesSchema, generateBulkSchema, importToRoundSchema } = require('../validations/puzzleBank');

// Valid UUIDs used across tests (v4 format, any value works for Zod .uuid()).
const UUID_A = '3f2a9c14-1234-4abc-9def-000000000001';
const UUID_B = 'a1b2c3d4-5678-4abc-9def-000000000002';

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

describe('Competition validation schemas', () => {
  test('createCompetitionSchema accepts valid competition', () => {
    const result = createCompetitionSchema.safeParse({ name: 'Test Cup' });
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

  test('addTeamMemberSchema accepts valid UUID playerId', () => {
    const result = addTeamMemberSchema.safeParse({ playerId: UUID_A });
    expect(result.success).toBe(true);
  });

  test('addTeamMemberSchema rejects integer playerId (legacy SERIAL)', () => {
    const result = addTeamMemberSchema.safeParse({ playerId: 5 });
    expect(result.success).toBe(false);
  });

  test('assignJudgeSchema accepts valid UUID judgeId', () => {
    const result = assignJudgeSchema.safeParse({ judgeId: UUID_B });
    expect(result.success).toBe(true);
  });

  test('assignJudgeSchema rejects non-UUID string judgeId', () => {
    const result = assignJudgeSchema.safeParse({ judgeId: 'abc' });
    expect(result.success).toBe(false);
  });
});

describe('Game validation schemas', () => {
  test('submitAnswerSchema accepts SINGLE_CELL submission', () => {
    const result = submitAnswerSchema.safeParse({
      submissionType: 'SINGLE_CELL', roundId: UUID_A, puzzleId: UUID_B,
      row: 3, col: 7, value: 4,
    });
    expect(result.success).toBe(true);
  });

  test('submitAnswerSchema accepts FULL_GRID submission', () => {
    const grid = Array(9).fill(null).map(() => Array(9).fill(1));
    const result = submitAnswerSchema.safeParse({
      submissionType: 'FULL_GRID', roundId: UUID_A, puzzleId: UUID_B, grid,
    });
    expect(result.success).toBe(true);
  });

  test('submitAnswerSchema rejects row out of range', () => {
    const result = submitAnswerSchema.safeParse({
      submissionType: 'SINGLE_CELL', roundId: UUID_A, puzzleId: UUID_B,
      row: 999, col: 0, value: 1,
    });
    expect(result.success).toBe(false);
  });

  test('submitAnswerSchema rejects invalid submissionType', () => {
    const result = submitAnswerSchema.safeParse({
      submissionType: 'HACKED', roundId: UUID_A, puzzleId: UUID_B,
    });
    expect(result.success).toBe(false);
  });

  test('submitAnswerSchema rejects integer roundId (legacy SERIAL)', () => {
    const result = submitAnswerSchema.safeParse({
      submissionType: 'SINGLE_CELL', roundId: 1, puzzleId: UUID_B,
      row: 3, col: 7, value: 4,
    });
    expect(result.success).toBe(false);
  });

  test('submitAnswerSchema accepts integer game values (row/col/value)', () => {
    const result = submitAnswerSchema.safeParse({
      submissionType: 'SINGLE_CELL', roundId: UUID_A, puzzleId: UUID_B,
      row: 3, col: 7, value: 4,
    });
    expect(result.success).toBe(true);
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

  test('importToRoundSchema accepts UUID roundId', () => {
    const result = importToRoundSchema.safeParse({ roundId: UUID_A });
    expect(result.success).toBe(true);
  });

  test('importToRoundSchema rejects integer roundId (legacy SERIAL)', () => {
    const result = importToRoundSchema.safeParse({ roundId: 1 });
    expect(result.success).toBe(false);
  });

  test('importToRoundSchema accepts integer count and teamsCount', () => {
    const result = importToRoundSchema.safeParse({
      roundId: UUID_A, count: 5, teamsCount: 3,
    });
    expect(result.success).toBe(true);
  });
});
