-- Add display_mode to competitions table
ALTER TABLE competitions ADD COLUMN display_mode VARCHAR(50) DEFAULT 'DEFAULT' NOT NULL;

COMMENT ON COLUMN competitions.display_mode IS 'Big-screen display mode: DEFAULT, LIVE_RANKING, PLAYER_BROADCAST, ROUND_RANKING, FINAL_RANKING';
