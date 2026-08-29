// Unit tests for ParticipantRepository.bulkImport — the team-creation path.
//
// The Excel `teamName` column used to be read and thrown away. After the
// rebranching, bulkImport creates one team per distinct name (case- and
// space-insensitive) inside the competition, and attaches each participant
// via team_members. The four cases that matter:
//
//   1. Two rows, same team name → ONE team created, TWO members linked.
//   2. One row, no team name → NO team created, NO member linked (individual).
//   3. Re-import against a competition that already has the team → the
//      existing team is reused, NO duplicate team, NO duplicate member.
//   4. "Red" and " red " → same team (normalised lookup).
//
// We mock Prisma so no real database is needed. The mock simulates the
// $transaction callback (runs synchronously with a fake `tx` that records
// every call), and the team_members composite-PK findUnique that gates
// duplicate membership.

const ParticipantRepository = require('../db/repositories/ParticipantRepository');

// Build a fake Prisma client. Each model's methods are jest.fn so the test
// can assert calls and return canned values. The `$transaction` mock runs
// the callback with a fake `tx` that mirrors the same model stubs, so code
// inside the transaction sees the same API as outside.
function buildPrismaMock(overrides = {}) {
  const models = {
    users: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => ({ id: 'user-' + data.username, ...data })),
      update: jest.fn(async () => ({})),
    },
    players: {
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => ({ id: 'player-existing', competition_id: COMP })),
      create: jest.fn(async ({ data }) => ({
        id: 'player-' + data.name,
        ...data,
      })),
    },
    categories: { findFirst: jest.fn(async () => null) },
    teams: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }) => ({
        id: 'team-' + data.name,
        name: data.name,
        competition_id: data.competition_id,
      })),
    },
    team_members: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async () => ({})),
    },
  };

  const merged = {
    users: { ...models.users, ...overrides.users },
    players: { ...models.players, ...overrides.players },
    categories: { ...models.categories, ...overrides.categories },
    teams: { ...models.teams, ...overrides.teams },
    team_members: { ...models.team_members, ...overrides.team_members },
  };

  // $transaction runs the callback immediately with `merged` as the tx
  // client. The real Prisma would do the same but wrap in BEGIN/COMMIT.
  const prisma = {
    ...merged,
    $transaction: jest.fn(async (cb) => cb(merged)),
  };
  return prisma;
}

const COMP = 'comp-00000000-0000-4000-8000-000000000001';

describe('ParticipantRepository.bulkImport — team creation', () => {
  test('two rows with the same team name create ONE team and TWO members', async () => {
    const prisma = buildPrismaMock();
    const repo = new ParticipantRepository(prisma);

    const result = await repo.bulkImport(COMP, [
      { name: 'Alice', school: 'School A', teamName: 'Red' },
      { name: 'Bob', school: 'School B', teamName: 'Red' },
    ]);

    // One team created — the second "Red" row hits the cache.
    expect(prisma.teams.create).toHaveBeenCalledTimes(1);
    expect(prisma.teams.create).toHaveBeenCalledWith({
      data: { competition_id: COMP, name: 'Red' },
      select: { id: true, name: true },
    });

    // Two memberships — one per participant.
    expect(prisma.team_members.create).toHaveBeenCalledTimes(2);

    // The counts returned reflect what happened. The credentials array
    // holds generated login info for each imported row (added by the
    // credential-generation feature — see ParticipantRepository JSDoc).
    expect(result).toMatchObject({ imported: 2, teamsCreated: 1, membersLinked: 2 });
    expect(result.credentials).toHaveLength(2);
    expect(result.credentials[0]).toMatchObject({ name: 'Alice', school: 'School A' });
    expect(result.credentials[1]).toMatchObject({ name: 'Bob', school: 'School B' });
  });

  test('a row without a team name creates NO team and NO member', async () => {
    const prisma = buildPrismaMock();
    const repo = new ParticipantRepository(prisma);

    const result = await repo.bulkImport(COMP, [
      { name: 'Solo', school: 'School A', teamName: '' },
    ]);

    expect(prisma.teams.create).not.toHaveBeenCalled();
    expect(prisma.team_members.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ imported: 1, teamsCreated: 0, membersLinked: 0 });
    expect(result.credentials).toHaveLength(1);
    expect(result.credentials[0]).toMatchObject({ name: 'Solo', school: 'School A' });
  });

  test('a row with a whitespace-only team name is treated as no team', async () => {
    const prisma = buildPrismaMock();
    const repo = new ParticipantRepository(prisma);

    const result = await repo.bulkImport(COMP, [
      { name: 'Solo', school: 'School A', teamName: '   ' },
    ]);

    expect(prisma.teams.create).not.toHaveBeenCalled();
    expect(prisma.team_members.create).not.toHaveBeenCalled();
    expect(result.teamsCreated).toBe(0);
  });

  test('"Red" and " red " resolve to the SAME team (case/space insensitive)', async () => {
    const prisma = buildPrismaMock();
    const repo = new ParticipantRepository(prisma);

    await repo.bulkImport(COMP, [
      { name: 'Alice', school: 'School A', teamName: 'Red' },
      { name: 'Bob', school: 'School B', teamName: ' red ' },
    ]);

    // Only one team created, and its name keeps the casing of the FIRST row.
    expect(prisma.teams.create).toHaveBeenCalledTimes(1);
    expect(prisma.teams.create.mock.calls[0][0].data.name).toBe('Red');
  });

  test('re-importing against an existing team reuses it (no duplicate team)', async () => {
    // The competition already has a "Red" team from a previous import.
    const prisma = buildPrismaMock({
      teams: {
        findMany: jest.fn(async () => [
          { id: 'team-existing', name: 'Red' },
        ]),
        create: jest.fn(),
      },
    });
    const repo = new ParticipantRepository(prisma);

    const result = await repo.bulkImport(COMP, [
      { name: 'Alice', school: 'School A', teamName: 'Red' },
    ]);

    // The existing team was found, so no new team was created.
    expect(prisma.teams.create).not.toHaveBeenCalled();
    expect(result.teamsCreated).toBe(0);
  });

  test('re-importing an already-linked participant does not duplicate the membership', async () => {
    // The participant is already in the team — findUnique returns a row.
    const prisma = buildPrismaMock({
      team_members: {
        findUnique: jest.fn(async () => ({ team_id: 'team-existing' })),
        create: jest.fn(),
      },
    });
    const repo = new ParticipantRepository(prisma);

    const result = await repo.bulkImport(COMP, [
      { name: 'Alice', school: 'School A', teamName: 'Red' },
    ]);

    expect(prisma.team_members.create).not.toHaveBeenCalled();
    expect(result.membersLinked).toBe(0);
    // Still imported — the player row exists.
    expect(result.imported).toBe(1);
  });

  test('the transaction wraps every write (failure rolls back)', async () => {
    // If anything inside the transaction throws, $transaction rethrows and
    // the caller (the route) maps it to a rollback response. This test pins
    // that contract: a thrown error propagates out of bulkImport.
    const prisma = buildPrismaMock({
      team_members: {
        findUnique: jest.fn(async () => {
          throw new Error('DB connection lost');
        }),
        create: jest.fn(),
      },
    });
    const repo = new ParticipantRepository(prisma);

    await expect(
      repo.bulkImport(COMP, [{ name: 'Alice', school: 'School A', teamName: 'Red' }])
    ).rejects.toThrow('DB connection lost');
  });
});
