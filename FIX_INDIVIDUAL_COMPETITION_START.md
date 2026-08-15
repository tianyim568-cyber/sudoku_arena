# Fix: Allow Individual-Only Competitions to Start Without Teams

## Problem
The `GameOrchestrator.startCompetition()` method had a hard requirement that teams must exist before starting any competition:

```javascript
const teams = await this._prisma.teams.findMany({
  where: { competition_id: competitionId },
});
if (teams.length === 0) throw new CompetitionError('没有队伍');
```

This blocked individual-only competitions (with only `INDIVIDUAL_STANDARD`, `INDIVIDUAL_SHAPED`, or `INDIVIDUAL_MIXED` rounds) from starting, even though they only need registered players, not teams.

## Root Cause
The validation logic didn't distinguish between:
- **Team competitions** (with `ROUND1_NINE_ONE`, `ROUND2_RELAY`, `ROUND3_COLLABORATE` rounds) — require teams
- **Individual competitions** (with `INDIVIDUAL_*` rounds) — only require players
- **Mixed competitions** (both team and individual stages) — require teams

## Solution
Modified `GameOrchestrator.js` to conditionally enforce the team requirement based on whether the competition contains team-type rounds.

### Changes Made

#### 1. Import `isTeamRoundType` helper (line 39)
```javascript
const { isTeamRoundType, isIndividualRoundType } = require('./RoundTypes');
```

#### 2. Conditional team validation (lines 252-260)
```javascript
// Only require teams when the competition actually has team-type stages.
// Individual-only competitions need registered players, not teams.
const hasTeamStages = allRounds.some(r => isTeamRoundType(r.type));

const teams = await this._prisma.teams.findMany({
  where: { competition_id: competitionId },
});
if (hasTeamStages && teams.length === 0) throw new CompetitionError('没有队伍');
```

#### 3. Add `hasTeamStages` flag to emission payload (line 278)
```javascript
const emissions = [{
  target: 'competition', targetId: competitionId, event: 'COMPETITION_STARTED',
  payload: {
    competitionName: comp.name, totalRounds: allRounds.length,
    totalStages: allStages.length,
    firstStageId: firstStage.id,
    firstStageType: firstStage.type,
    teams: teams.map(tm => ({ teamId: tm.id, teamName: tm.name })),
    hasTeamStages,  // ← NEW: tells clients whether to expect team data
  },
}];
```

### Test Coverage
Created comprehensive unit tests in `server/src/__tests__/GameOrchestrator-startCompetition.test.js`:

**Individual-only competitions (3 tests)**
- ✓ Starts WITHOUT teams
- ✓ Emission includes `hasTeamStages: false`
- ✓ Emission payload has all expected fields

**Team competitions (2 tests)**
- ✓ THROWS when no teams exist
- ✓ STARTS when teams exist (with `hasTeamStages: true`)

**Mixed competitions (2 tests)**
- ✓ Requires teams (has team rounds)
- ✓ Starts when teams exist

**Pre-existing guards (4 tests)**
- ✓ Throws when competition does not exist
- ✓ Throws when competition status is not DRAFT or PUBLISHED
- ✓ Throws when competition has no stages
- ✓ Throws when competition has fewer than 3 rounds

**Test results:**
- New tests: 11/11 passed ✓
- All project tests: 157/157 passed ✓
- No regressions

## Behavior After Fix

| Competition Type | Has Teams? | Can Start? |
|-----------------|-----------|------------|
| Individual-only | No | ✓ Yes |
| Individual-only | Yes | ✓ Yes |
| Team-only | No | ✗ No (throws "没有队伍") |
| Team-only | Yes | ✓ Yes |
| Mixed | No | ✗ No (throws "没有队伍") |
| Mixed | Yes | ✓ Yes |

## Files Modified
1. `server/src/engine/GameOrchestrator.js` — Conditional team validation + emission flag
2. `server/src/__tests__/GameOrchestrator-startCompetition.test.js` — New test suite (11 tests)

## Backward Compatibility
✓ No breaking changes. Existing team competitions still require teams as before. The fix only relaxes the requirement for individual-only competitions.
