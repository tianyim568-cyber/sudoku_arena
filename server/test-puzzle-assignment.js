/**
 * Automated tests for the Round 1 puzzle assignment system.
 *
 * Validates:
 * 1. Enough puzzle validation
 * 2. Insufficient bank handling
 * 3. 300-team simulation
 * 4. Exact puzzle counts (9 JOC + 1 FINAL per team)
 * 5. No duplicate puzzle IDs within a team
 * 6. Difficulty balancing
 * 7. Random distribution (different teams get different puzzles)
 * 8. FINAL assignment (one per team)
 * 9. Word-letter mapping (9-letter words, letters match word)
 * 10. Repeated letters handling (different puzzles for same letter)
 * 11. Idempotent restart (same assignment on re-call)
 *
 * Run: node server/test-puzzle-assignment.js
 */

const PuzzleAssignmentService = require('./src/services/PuzzleAssignmentService');

// ─── Mock repos ──────────────────────────────────────────────────

function createMockRepos() {
  const assignments = [];
  return {
    db: {
      run: (sql, params) => {
        if (sql.includes('INSERT')) {
          assignments.push({ round_id: params[1], team_id: params[2], word: params[3], puzzle_ids: params[4] });
        }
        if (sql.includes('DELETE')) {
          assignments.length = 0;
        }
      },
      all: (sql, params) => {
        if (sql.includes('team_puzzle_sets')) {
          return assignments.filter(a => a.round_id === params[0]);
        }
        return [];
      },
      get: () => null,
    },
    puzzles: {
      updateLetter: () => {},
    },
  };
}

function generatePuzzles(jocCount, finalCount) {
  const puzzles = [];
  for (let i = 0; i < jocCount; i++) {
    puzzles.push({
      id: i + 1,
      puzzle_type: 'JOC',
      difficulty: 'EASY',
      initial_grid: JSON.stringify(Array(9).fill(null).map(() => Array(9).fill(0))),
      solution: JSON.stringify(Array(9).fill(null).map(() => Array(9).fill(1))),
      points: 100,
      letter: null,
    });
  }
  for (let i = 0; i < finalCount; i++) {
    puzzles.push({
      id: jocCount + i + 1,
      puzzle_type: 'FINAL',
      difficulty: 'MEDIUM',
      initial_grid: JSON.stringify(Array(9).fill(null).map(() => Array(9).fill(0))),
      solution: JSON.stringify(Array(9).fill(null).map(() => Array(9).fill(1))),
      points: 100,
      letter: null,
    });
  }
  return puzzles;
}

function generateTeams(count) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}` }));
}

// ─── Test runner ─────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error('  FAIL:', message);
  }
}

function describe(name, fn) {
  console.log(`\n${name}`);
  fn();
}

// ─── Tests ───────────────────────────────────────────────────────

describe('1. Enough puzzle validation', () => {
  const repos = createMockRepos();
  const service = new PuzzleAssignmentService(repos);
  const teams = generateTeams(5);
  const puzzles = generatePuzzles(45, 5); // 5 teams × 9 = 45 JOC + 5 FINAL
  const result = service.assignPerTeamPuzzles(1, 1, teams, puzzles);
  assert(result.size === 5, 'All 5 teams should get assignments');
  for (const [teamId, teamPuzzles] of result) {
    assert(teamPuzzles.length === 10, `Team ${teamId} should have 10 puzzles, got ${teamPuzzles.length}`);
  }
});

describe('2. Insufficient bank handling', () => {
  const repos = createMockRepos();
  const service = new PuzzleAssignmentService(repos);
  const teams = generateTeams(10);
  const puzzles = generatePuzzles(30, 3); // Need 90 JOC + 10 FINAL, only have 30 + 3
  const result = service.assignPerTeamPuzzles(1, 1, teams, puzzles);
  // Should still assign what's available, some teams get fewer
  assert(result.size === 10, 'All 10 teams should still get entries');
  const teamsWith10 = [...result.values()].filter(p => p.length === 10).length;
  console.log(`  ${teamsWith10}/10 teams got full 10-puzzle sets (expected: fewer than 10 due to insufficient bank)`);
  assert(teamsWith10 < 10, 'Not all teams should get full sets when bank is insufficient');
});

describe('3. 300-team simulation', () => {
  const repos = createMockRepos();
  const service = new PuzzleAssignmentService(repos);
  const teams = generateTeams(300);
  const puzzles = generatePuzzles(2700, 300);
  const start = Date.now();
  const result = service.assignPerTeamPuzzles(1, 1, teams, puzzles);
  const elapsed = Date.now() - start;
  assert(result.size === 300, 'All 300 teams should get assignments');
  assert(elapsed < 5000, `Should complete in under 5s, took ${elapsed}ms`);
  console.log(`  Completed in ${elapsed}ms`);
});

describe('4. Exact puzzle counts (9 JOC + 1 FINAL per team)', () => {
  const repos = createMockRepos();
  const service = new PuzzleAssignmentService(repos);
  const teams = generateTeams(20);
  const puzzles = generatePuzzles(180, 20);
  const result = service.assignPerTeamPuzzles(1, 1, teams, puzzles);
  for (const [teamId, teamPuzzles] of result) {
    const jocCount = teamPuzzles.filter(p => p.puzzle_type === 'JOC').length;
    const finalCount = teamPuzzles.filter(p => p.puzzle_type === 'FINAL').length;
    assert(jocCount === 9, `Team ${teamId}: JOC count should be 9, got ${jocCount}`);
    assert(finalCount === 1, `Team ${teamId}: FINAL count should be 1, got ${finalCount}`);
    assert(teamPuzzles.length === 10, `Team ${teamId}: total should be 10, got ${teamPuzzles.length}`);
  }
});

describe('5. No duplicate puzzle IDs within a team', () => {
  const repos = createMockRepos();
  const service = new PuzzleAssignmentService(repos);
  const teams = generateTeams(50);
  const puzzles = generatePuzzles(450, 50);
  const result = service.assignPerTeamPuzzles(1, 1, teams, puzzles);
  for (const [teamId, teamPuzzles] of result) {
    const ids = teamPuzzles.map(p => p.id);
    const uniqueIds = new Set(ids);
    assert(uniqueIds.size === ids.length, `Team ${teamId}: no duplicate puzzle IDs (got ${ids.length} ids, ${uniqueIds.size} unique)`);
  }
});

describe('6. Difficulty balancing', () => {
  const repos = createMockRepos();
  const service = new PuzzleAssignmentService(repos);
  const teams = generateTeams(20);
  // All JOC are EASY (by definition: only 1 empty cell)
  const puzzles = generatePuzzles(180, 20);
  const result = service.assignPerTeamPuzzles(1, 1, teams, puzzles);
  for (const [teamId, teamPuzzles] of result) {
    const jocPuzzles = teamPuzzles.filter(p => p.puzzle_type === 'JOC');
    const diffCounts = { EASY: 0, MEDIUM: 0, HARD: 0 };
    jocPuzzles.forEach(p => { diffCounts[p.difficulty]++; });
    // All 9 JOC should be EASY
    assert(diffCounts.EASY === 9, `Team ${teamId}: EASY should be 9, got ${diffCounts.EASY}`);
    assert(diffCounts.MEDIUM === 0, `Team ${teamId}: MEDIUM should be 0, got ${diffCounts.MEDIUM}`);
    assert(diffCounts.HARD === 0, `Team ${teamId}: HARD should be 0, got ${diffCounts.HARD}`);
  }
});

describe('7. Random distribution (different teams get different puzzles)', () => {
  const repos = createMockRepos();
  const service = new PuzzleAssignmentService(repos);
  const teams = generateTeams(10);
  const puzzles = generatePuzzles(90, 10);

  // Run twice with same inputs - should produce different results (with very high probability)
  const result1 = service.assignPerTeamPuzzles(1, 1, teams, puzzles);

  // Reset DB mock
  repos.db.run('DELETE FROM team_puzzle_sets');

  const result2 = service.assignPerTeamPuzzles(2, 2, teams, puzzles);

  // Check that at least some teams got different puzzle sets
  let differentTeams = 0;
  for (const team of teams) {
    const set1 = (result1.get(team.id) || []).map(p => p.id).sort().join(',');
    const set2 = (result2.get(team.id) || []).map(p => p.id).sort().join(',');
    if (set1 !== set2) differentTeams++;
  }
  assert(differentTeams > 0, `At least some teams should get different puzzles across runs (got ${differentTeams}/10)`);
  console.log(`  ${differentTeams}/10 teams got different puzzles across two runs`);
});

describe('8. FINAL assignment (one per team)', () => {
  const repos = createMockRepos();
  const service = new PuzzleAssignmentService(repos);
  const teams = generateTeams(15);
  const puzzles = generatePuzzles(135, 15);
  const result = service.assignPerTeamPuzzles(1, 1, teams, puzzles);

  // Each team should have exactly 1 FINAL
  for (const [teamId, teamPuzzles] of result) {
    const finals = teamPuzzles.filter(p => p.puzzle_type === 'FINAL');
    assert(finals.length === 1, `Team ${teamId}: should have 1 FINAL, got ${finals.length}`);
  }

  // Different teams should generally have different FINAL puzzles
  const finalIds = [...result.values()].map(puzzles =>
    puzzles.find(p => p.puzzle_type === 'FINAL').id
  );
  const uniqueFinals = new Set(finalIds);
  console.log(`  ${uniqueFinals.size}/15 unique FINAL puzzles across teams`);
  assert(uniqueFinals.size === 15, 'Each team should get a different FINAL puzzle');
});

describe('9. Word-letter mapping (9-letter words)', () => {
  const repos = createMockRepos();
  const service = new PuzzleAssignmentService(repos);
  const teams = generateTeams(10);
  const puzzles = generatePuzzles(90, 10);
  const result = service.assignPerTeamPuzzles(1, 1, teams, puzzles);

  for (const [teamId, teamPuzzles] of result) {
    const jocPuzzles = teamPuzzles.filter(p => p.puzzle_type === 'JOC');
    const word = jocPuzzles.map(p => p.letter).join('');
    assert(word.length === 9, `Team ${teamId}: word should be 9 letters, got ${word.length} (${word})`);
    assert(/^[A-Z]+$/.test(word), `Team ${teamId}: word should be uppercase letters, got ${word}`);
    // Verify it's a valid word from the list
    const WORDS = require('./src/data/words');
    assert(WORDS.includes(word), `Team ${teamId}: word "${word}" should be in word list`);
  }
});

describe('10. Repeated letters handling', () => {
  const repos = createMockRepos();
  const service = new PuzzleAssignmentService(repos);
  const teams = generateTeams(5);
  const puzzles = generatePuzzles(45, 5);
  const result = service.assignPerTeamPuzzles(1, 1, teams, puzzles);

  for (const [teamId, teamPuzzles] of result) {
    const jocPuzzles = teamPuzzles.filter(p => p.puzzle_type === 'JOC');
    const word = jocPuzzles.map(p => p.letter).join('');

    // Check that repeated letter positions have different puzzle IDs
    const letterPositions = {};
    for (let i = 0; i < word.length; i++) {
      const letter = word[i];
      if (!letterPositions[letter]) letterPositions[letter] = [];
      letterPositions[letter].push({ index: i, puzzleId: jocPuzzles[i].id });
    }

    for (const [letter, positions] of Object.entries(letterPositions)) {
      if (positions.length > 1) {
        const puzzleIds = positions.map(p => p.puzzleId);
        const uniqueIds = new Set(puzzleIds);
        assert(uniqueIds.size === puzzleIds.length,
          `Team ${teamId}: repeated letter "${letter}" should map to different puzzle IDs (got ${puzzleIds})`);
      }
    }
  }
});

describe('11. Idempotent restart', () => {
  const repos = createMockRepos();
  const service = new PuzzleAssignmentService(repos);
  const teams = generateTeams(5);
  const puzzles = generatePuzzles(45, 5);

  // First assignment
  const result1 = service.assignPerTeamPuzzles(1, 1, teams, puzzles);

  // Collect first assignment data
  const firstWords = {};
  const firstPuzzleIds = {};
  for (const [teamId, teamPuzzles] of result1) {
    firstWords[teamId] = teamPuzzles.filter(p => p.puzzle_type === 'JOC').map(p => p.letter).join('');
    firstPuzzleIds[teamId] = teamPuzzles.map(p => p.id).sort().join(',');
  }

  // Simulate restart: call again with same tournament/round
  const result2 = service.assignPerTeamPuzzles(1, 1, teams, puzzles);

  // Should return same assignments (loaded from persistence)
  for (const [teamId, teamPuzzles] of result2) {
    const word2 = teamPuzzles.filter(p => p.puzzle_type === 'JOC').map(p => p.letter).join('');
    const ids2 = teamPuzzles.map(p => p.id).sort().join(',');
    assert(word2 === firstWords[teamId], `Team ${teamId}: word should be same on restart`);
    assert(ids2 === firstPuzzleIds[teamId], `Team ${teamId}: puzzle IDs should be same on restart`);
  }
});

describe('12. Non-overlapping puzzle sets across teams', () => {
  const repos = createMockRepos();
  const service = new PuzzleAssignmentService(repos);
  const teams = generateTeams(10);
  const puzzles = generatePuzzles(90, 10);
  const result = service.assignPerTeamPuzzles(1, 1, teams, puzzles);

  // Collect all puzzle IDs used by each team
  const teamPuzzleIds = new Map();
  for (const [teamId, teamPuzzles] of result) {
    teamPuzzleIds.set(teamId, new Set(teamPuzzles.map(p => p.id)));
  }

  // No two teams should share any puzzle ID
  let overlaps = 0;
  const teamIds = [...teamPuzzleIds.keys()];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      const set1 = teamPuzzleIds.get(teamIds[i]);
      const set2 = teamPuzzleIds.get(teamIds[j]);
      for (const id of set1) {
        if (set2.has(id)) overlaps++;
      }
    }
  }
  assert(overlaps === 0, `No puzzle should be assigned to multiple teams (found ${overlaps} overlaps)`);
});

// ─── Summary ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) process.exit(1);
