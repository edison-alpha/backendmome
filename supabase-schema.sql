-- Supabase Database Schema for Raffle Analytics

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User Activities Table
CREATE TABLE IF NOT EXISTS user_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_address TEXT NOT NULL,
  raffle_id INTEGER NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('ticket_purchase', 'raffle_created', 'raffle_finalized')),
  ticket_count INTEGER,
  total_paid NUMERIC,
  prize_amount NUMERIC,
  transaction_version TEXT NOT NULL UNIQUE,
  block_height BIGINT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for user_activities
CREATE INDEX IF NOT EXISTS idx_user_activities_user_address ON user_activities(user_address);
CREATE INDEX IF NOT EXISTS idx_user_activities_raffle_id ON user_activities(raffle_id);
CREATE INDEX IF NOT EXISTS idx_user_activities_activity_type ON user_activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_user_activities_timestamp ON user_activities(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_user_activities_transaction_version ON user_activities(transaction_version);

-- Leaderboard Cache Table
CREATE TABLE IF NOT EXISTS leaderboard_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raffle_id INTEGER UNIQUE, -- NULL for global leaderboard
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for leaderboard_cache
CREATE INDEX IF NOT EXISTS idx_leaderboard_cache_raffle_id ON leaderboard_cache(raffle_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_cache_updated_at ON leaderboard_cache(updated_at DESC);

-- Raffle Stats Table
CREATE TABLE IF NOT EXISTS raffle_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raffle_id INTEGER UNIQUE, -- NULL for global stats
  total_tickets_sold INTEGER NOT NULL DEFAULT 0,
  total_volume NUMERIC NOT NULL DEFAULT 0,
  unique_participants INTEGER NOT NULL DEFAULT 0,
  average_tickets_per_user NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for raffle_stats
CREATE INDEX IF NOT EXISTS idx_raffle_stats_raffle_id ON raffle_stats(raffle_id);
CREATE INDEX IF NOT EXISTS idx_raffle_stats_updated_at ON raffle_stats(updated_at DESC);

-- =====================================================
-- NOTIFICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_address TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'ticket_purchased',      -- Someone bought tickets on your raffle
    'raffle_won',           -- You won a raffle
    'raffle_ended',         -- Your raffle ended
    'raffle_sold_out',      -- Your raffle sold out
    'prize_claimed',        -- Winner claimed prize from your raffle
    'new_participant',      -- New participant in your raffle
    'raffle_created',       -- Your raffle was created successfully
    'raffle_finalized',     -- Raffle finalized, winner selected
    'system'                -- System notifications
  )),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  raffle_id INTEGER,
  related_address TEXT,     -- Address of related user (buyer, winner, etc)
  amount NUMERIC,           -- Amount involved (tickets, prize, etc)
  transaction_hash TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_address ON notifications(user_address);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_raffle_id ON notifications(raffle_id);
CREATE INDEX IF NOT EXISTS idx_notifications_transaction_hash ON notifications(transaction_hash);

-- Unique constraint on transaction_hash (only for non-null values) to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unique_tx_hash 
  ON notifications(transaction_hash) 
  WHERE transaction_hash IS NOT NULL;

-- =====================================================
-- USER TICKETS TABLE (for tracking user's tickets per raffle)
-- =====================================================
CREATE TABLE IF NOT EXISTS user_tickets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_address TEXT NOT NULL,
  raffle_id INTEGER NOT NULL,
  ticket_count INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC NOT NULL DEFAULT 0,
  first_purchase_at TIMESTAMPTZ,
  last_purchase_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_address, raffle_id)
);

-- Indexes for user_tickets
CREATE INDEX IF NOT EXISTS idx_user_tickets_user_address ON user_tickets(user_address);
CREATE INDEX IF NOT EXISTS idx_user_tickets_raffle_id ON user_tickets(raffle_id);
CREATE INDEX IF NOT EXISTS idx_user_tickets_updated_at ON user_tickets(updated_at DESC);

-- Row Level Security (RLS) Policies

-- Enable RLS
ALTER TABLE user_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE leaderboard_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE raffle_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tickets ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first (to avoid conflicts)
DROP POLICY IF EXISTS "Public read access" ON user_activities;
DROP POLICY IF EXISTS "Public read access" ON leaderboard_cache;
DROP POLICY IF EXISTS "Public read access" ON raffle_stats;
DROP POLICY IF EXISTS "Public read access" ON notifications;
DROP POLICY IF EXISTS "Public read access" ON user_tickets;

DROP POLICY IF EXISTS "Service role full access" ON user_activities;
DROP POLICY IF EXISTS "Service role full access" ON leaderboard_cache;
DROP POLICY IF EXISTS "Service role full access" ON raffle_stats;
DROP POLICY IF EXISTS "Service role full access" ON notifications;
DROP POLICY IF EXISTS "Service role full access" ON user_tickets;

-- Public read access for all tables
CREATE POLICY "Public read access" ON user_activities FOR SELECT USING (true);
CREATE POLICY "Public read access" ON leaderboard_cache FOR SELECT USING (true);
CREATE POLICY "Public read access" ON raffle_stats FOR SELECT USING (true);
CREATE POLICY "Public read access" ON notifications FOR SELECT USING (true);
CREATE POLICY "Public read access" ON user_tickets FOR SELECT USING (true);

-- Only service role can insert/update/delete
CREATE POLICY "Service role full access" ON user_activities FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON leaderboard_cache FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON raffle_stats FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON notifications FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON user_tickets FOR ALL USING (auth.role() = 'service_role');

-- Useful Views

-- User Leaderboard View
CREATE OR REPLACE VIEW user_leaderboard AS
SELECT 
  user_address,
  COUNT(*) FILTER (WHERE activity_type = 'ticket_purchase') as total_purchases,
  SUM(ticket_count) as total_tickets,
  SUM(total_paid) as total_spent,
  COUNT(DISTINCT raffle_id) as raffles_participated,
  MAX(timestamp) as last_activity
FROM user_activities
WHERE activity_type = 'ticket_purchase'
GROUP BY user_address
ORDER BY total_tickets DESC;

-- Raffle Activity Summary View
CREATE OR REPLACE VIEW raffle_activity_summary AS
SELECT 
  raffle_id,
  COUNT(*) FILTER (WHERE activity_type = 'ticket_purchase') as total_purchases,
  SUM(ticket_count) as total_tickets_sold,
  SUM(total_paid) as total_volume,
  COUNT(DISTINCT user_address) FILTER (WHERE activity_type = 'ticket_purchase') as unique_buyers,
  MIN(timestamp) FILTER (WHERE activity_type = 'raffle_created') as created_at,
  MAX(timestamp) FILTER (WHERE activity_type = 'raffle_finalized') as finalized_at
FROM user_activities
GROUP BY raffle_id
ORDER BY raffle_id DESC;

-- Recent Activity View (last 100)
CREATE OR REPLACE VIEW recent_activities AS
SELECT 
  id,
  user_address,
  raffle_id,
  activity_type,
  ticket_count,
  total_paid,
  timestamp
FROM user_activities
ORDER BY timestamp DESC
LIMIT 100;

-- User Notifications View (unread first)
CREATE OR REPLACE VIEW user_notifications_view AS
SELECT 
  id,
  user_address,
  type,
  title,
  message,
  raffle_id,
  related_address,
  amount,
  transaction_hash,
  is_read,
  created_at
FROM notifications
ORDER BY is_read ASC, created_at DESC;

-- Comments
COMMENT ON TABLE user_activities IS 'Stores all user activities (ticket purchases, raffle creations, finalizations)';
COMMENT ON TABLE leaderboard_cache IS 'Caches computed leaderboards for fast access';
COMMENT ON TABLE raffle_stats IS 'Caches raffle statistics for fast access';
COMMENT ON TABLE notifications IS 'User notifications for raffle events';
COMMENT ON TABLE user_tickets IS 'Aggregated user tickets per raffle';
COMMENT ON VIEW user_leaderboard IS 'Aggregated user statistics for leaderboard';
COMMENT ON VIEW raffle_activity_summary IS 'Summary statistics per raffle';
COMMENT ON VIEW recent_activities IS 'Most recent 100 activities across all raffles';
COMMENT ON VIEW user_notifications_view IS 'User notifications sorted by read status and date';
