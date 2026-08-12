-- Add preparation_seconds to rounds table
ALTER TABLE rounds ADD COLUMN preparation_seconds INT DEFAULT 10;

COMMENT ON COLUMN rounds.preparation_seconds IS 'Countdown duration before round starts gameplay (preparation phase)';
