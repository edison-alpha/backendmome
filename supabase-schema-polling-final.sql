-- =====================================================
-- CUSTOM POLLING INDEXER SCHEMA (FINAL VERSION)
-- Renamed tables to avoid conflicts with existing schema
-- =====================================================

-- =====================================================
-- RAFFLE EVENTS TABLE (NEW)
-- =====================================================
CREATE TABLE IF NOT EXISTS raffle_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT NOT NULL CHECK (event_type IN ('CreateRaffleEvent', 'BuyTicketEvent', 'FinalizeRaffleEvent', 'CancelRaffleEvent')),
  raffle_id INTEGER NOT NULL,
  transaction_version BIGINT NOT NULL UNIQUE,
  transaction_hash TEXT,
  block_height BIGINT,
  timestamp TIMESTAMPTZ NOT NULL,
  event_data JSONB NOT NULL,
  user_address TEXT,
  amount BIGINT,
  ticket_count INTEGER,
  indexed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raffle_events_type ON raffle_events(event_type);
CREATE INDEX IF NOT EXISTS idx_raffle_events_raffle_id ON raffle_events(raffle_id);
CREATE INDEX IF NOT EXISTS idx_raffle_events_user_address ON raffle_events(user_address);
CREATE INDEX IF NOT EXISTS idx_raffle_events_timestamp ON raffle_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_raffle_events_tx_version ON raffle_events(transaction_version DESC);
CREATE INDEX IF NOT EXISTS idx_raffle_events_block_height ON raffle_events(block_height DESC);
CREATE INDEX IF NOT EXISTS idx_raffle_events_raffle_type ON raffle_events(raffle_id, event_type);
CREATE INDEX IF NOT EXISTS idx_raffle_events_user_type ON raffle_events(user_address, event_type);

-- =====================================================
-- POLLING STATE TABLE (NEW)
-- =====================================================
CREATE TABLE IF NOT EXISTS polling_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  last_synced_version BIGINT NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  is_syncing BOOLEAN DEFAULT FALSE,
  error_count INTEGER DEFAULT 0,
  last_error TEXT,
  last_error_at TIMESTAMPTZ,
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO polling_state (id, last_synced_version) 
VALUES (1, 0) 
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- POLLING LEADERBOARD TABLE (RENAMED - no conflict)
-- =====================================================
CREATE TABLE IF NOT EXISTS polling_leaderboard (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_address TEXT NOT NULL,
  raffle_id INTEGER,
  total_tickets INTEGER DEFAULT 0,
  total_spent BIGINT DEFAULT 0,
  raffle_count INTEGER DEFAULT 0,
  first_purchase_at TIMESTAMPTZ,
  last_purchase_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_user_raffle_polling UNIQUE (user_address, raffle_id)
);

CREATE INDEX IF NOT EXISTS idx_polling_leaderboard_user ON polling_leaderboard(user_address);
CREATE INDEX IF NOT EXISTS idx_polling_leaderboard_raffle ON polling_leaderboard(raffle_id);
CREATE INDEX IF NOT EXISTS idx_polling_leaderboard_tickets ON polling_leaderboard(total_tickets DESC);
CREATE INDEX IF NOT EXISTS idx_polling_leaderboard_spent ON polling_leaderboard(total_spent DESC);

-- =====================================================
-- ENABLE RLS
-- =====================================================
ALTER TABLE raffle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE polling_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE polling_leaderboard ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS POLICIES
-- =====================================================
DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Public read access" ON raffle_events;
  CREATE POLICY "Public read access" ON raffle_events FOR SELECT USING (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Service role full access" ON raffle_events;
  CREATE POLICY "Service role full access" ON raffle_events FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Public read access" ON polling_state;
  CREATE POLICY "Public read access" ON polling_state FOR SELECT USING (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Service role full access" ON polling_state;
  CREATE POLICY "Service role full access" ON polling_state FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Public read access" ON polling_leaderboard;
  CREATE POLICY "Public read access" ON polling_leaderboard FOR SELECT USING (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ 
BEGIN
  DROP POLICY IF EXISTS "Service role full access" ON polling_leaderboard;
  CREATE POLICY "Service role full access" ON polling_leaderboard FOR ALL USING (auth.role() = 'service_role');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- =====================================================
-- TRIGGER FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION update_polling_leaderboard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_type = 'BuyTicketEvent' AND NEW.user_address IS NOT NULL THEN
    -- Update global leaderboard
    INSERT INTO polling_leaderboard (
      user_address, raffle_id, total_tickets, total_spent, raffle_count,
      first_purchase_at, last_purchase_at, updated_at
    )
    VALUES (
      NEW.user_address, NULL, COALESCE(NEW.ticket_count, 0), COALESCE(NEW.amount, 0),
      1, NEW.timestamp, NEW.timestamp, NOW()
    )
    ON CONFLICT (user_address, raffle_id) 
    DO UPDATE SET
      total_tickets = polling_leaderboard.total_tickets + COALESCE(NEW.ticket_count, 0),
      total_spent = polling_leaderboard.total_spent + COALESCE(NEW.amount, 0),
      raffle_count = polling_leaderboard.raffle_count + 1,
      last_purchase_at = NEW.timestamp,
      updated_at = NOW();
    
    -- Update raffle-specific leaderboard
    INSERT INTO polling_leaderboard (
      user_address, raffle_id, total_tickets, total_spent, raffle_count,
      first_purchase_at, last_purchase_at, updated_at
    )
    VALUES (
      NEW.user_address, NEW.raffle_id, COALESCE(NEW.ticket_count, 0), COALESCE(NEW.amount, 0),
      1, NEW.timestamp, NEW.timestamp, NOW()
    )
    ON CONFLICT (user_address, raffle_id) 
    DO UPDATE SET
      total_tickets = polling_leaderboard.total_tickets + COALESCE(NEW.ticket_count, 0),
      total_spent = polling_leaderboard.total_spent + COALESCE(NEW.amount, 0),
      last_purchase_at = NEW.timestamp,
      updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_polling_leaderboard ON raffle_events;
CREATE TRIGGER trigger_update_polling_leaderboard
AFTER INSERT ON raffle_events
FOR EACH ROW EXECUTE FUNCTION update_polling_leaderboard();

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================
CREATE OR REPLACE FUNCTION get_last_synced_version()
RETURNS BIGINT AS $$
  SELECT last_synced_version FROM polling_state WHERE id = 1;
$$ LANGUAGE SQL;

CREATE OR REPLACE FUNCTION update_last_synced_version(version BIGINT)
RETURNS VOID AS $$
  UPDATE polling_state 
  SET last_synced_version = version, last_synced_at = NOW(), is_syncing = FALSE
  WHERE id = 1;
$$ LANGUAGE SQL;

CREATE OR REPLACE FUNCTION set_syncing_state(syncing BOOLEAN)
RETURNS VOID AS $$
  UPDATE polling_state SET is_syncing = syncing WHERE id = 1;
$$ LANGUAGE SQL;

CREATE OR REPLACE FUNCTION record_polling_error(error_msg TEXT)
RETURNS VOID AS $$
  UPDATE polling_state 
  SET error_count = error_count + 1, last_error = error_msg, 
      last_error_at = NOW(), is_syncing = FALSE
  WHERE id = 1;
$$ LANGUAGE SQL;

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE raffle_events IS 'Blockchain events from Movement Network (polling service)';
COMMENT ON TABLE polling_state IS 'Track polling sync state';
COMMENT ON TABLE polling_leaderboard IS 'Cached leaderboard data from polling service';
