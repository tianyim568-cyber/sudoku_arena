/**
 * DisplayMode constants for big-screen display control.
 *
 * These modes control what the display page shows during a competition:
 * - DEFAULT: Standard display (waiting state)
 * - LIVE_RANKING: Live ranking updates during rounds
 * - PLAYER_BROADCAST: Show specific player's gameplay
 * - ROUND_RANKING: Show ranking after a round completes
 * - STAGE_RANKING: Show ranking after a stage completes
 * - FINAL_RANKING: Show final competition results
 */

const DisplayMode = Object.freeze({
  DEFAULT: 'DEFAULT',
  LIVE_RANKING: 'LIVE_RANKING',
  PLAYER_BROADCAST: 'PLAYER_BROADCAST',
  ROUND_RANKING: 'ROUND_RANKING',
  STAGE_RANKING: 'STAGE_RANKING',
  FINAL_RANKING: 'FINAL_RANKING',
});

module.exports = { DisplayMode };
