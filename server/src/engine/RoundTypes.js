/**
 * RoundTypes — centralized constants for all round types in Sudoku Arena.
 *
 * Grouped by stage category:
 *   - TEAM:  team-based collaborative rounds (R1, R2, R3)
 *   - INDIVIDUAL: solo speed-solving rounds
 *   - PK: head-to-head duel rounds (future)
 *
 * RoundManager sits above ALL round types regardless of category.
 */

// ─── Team Round Types ──────────────────────────────────────────────

const TeamRoundType = Object.freeze({
  ROUND1_NINE_ONE: 'ROUND1_NINE_ONE',
  ROUND2_RELAY: 'ROUND2_RELAY',
  ROUND3_COLLABORATE: 'ROUND3_COLLABORATE',
});

// ─── Individual Round Types ────────────────────────────────────────

const IndividualRoundType = Object.freeze({
  INDIVIDUAL_STANDARD: 'INDIVIDUAL_STANDARD',
  INDIVIDUAL_SHAPED: 'INDIVIDUAL_SHAPED',
  INDIVIDUAL_MIXED: 'INDIVIDUAL_MIXED',
});

// ─── PK Round Types (future) ──────────────────────────────────────

const PKRoundType = Object.freeze({});

// ─── Unified RoundType (all types) ────────────────────────────────

const RoundType = Object.freeze({
  ...TeamRoundType,
  ...IndividualRoundType,
  ...PKRoundType,
});

// ─── Helper functions ──────────────────────────────────────────────

function isTeamRoundType(type) {
  return Object.values(TeamRoundType).includes(type);
}

function isIndividualRoundType(type) {
  return Object.values(IndividualRoundType).includes(type);
}

function isPKRoundType(type) {
  return Object.values(PKRoundType).includes(type);
}

function isValidRoundType(type) {
  return Object.values(RoundType).includes(type);
}

/**
 * Get the stage category for a given round type.
 * @param {string} roundType
 * @returns {'INDIVIDUAL'|'TEAM'|'PK'|null}
 */
function getStageCategoryForRoundType(roundType) {
  if (isTeamRoundType(roundType)) return 'TEAM';
  if (isIndividualRoundType(roundType)) return 'INDIVIDUAL';
  if (isPKRoundType(roundType)) return 'PK';
  return null;
}

module.exports = {
  RoundType,
  TeamRoundType,
  IndividualRoundType,
  PKRoundType,
  isTeamRoundType,
  isIndividualRoundType,
  isPKRoundType,
  isValidRoundType,
  getStageCategoryForRoundType,
};
