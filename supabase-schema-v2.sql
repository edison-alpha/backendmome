-- =====================================================
-- RAFFLE SOCIAL FEATURES - V2 Schema
-- Run this after the initial schema
-- =====================================================

-- =====================================================
-- RAFFLE COMMENTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS raffle_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raffle_id INTEGER NOT NULL,
  user_address TEXT NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) <= 500),
  parent_id UUID REFERENCES raffle_comments(id) ON DELETE CASCADE, -- For replies
  is_edited BOOLEAN DEFAULT FALSE,
  is_deleted BOOLEAN DEFAULT FALSE,
  likes_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for raffle_comments
CREATE INDEX IF NOT EXISTS idx_raffle_comments_raffle_id ON raffle_comments(raffle_id);
CREATE INDEX IF NOT EXISTS idx_raffle_comments_user_address ON raffle_comments(user_address);
CREATE INDEX IF NOT EXISTS idx_raffle_comments_parent_id ON raffle_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_raffle_comments_created_at ON raffle_comments(created_at DESC);

-- =====================================================
-- COMMENT LIKES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS comment_likes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  comment_id UUID NOT NULL REFERENCES raffle_comments(id) ON DELETE CASCADE,
  user_address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(comment_id, user_address)
);

-- Indexes for comment_likes
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id ON comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_user_address ON comment_likes(user_address);

-- =====================================================
-- WATCHLIST TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS watchlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_address TEXT NOT NULL,
  raffle_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_address, raffle_id)
);

-- Indexes for watchlist
CREATE INDEX IF NOT EXISTS idx_watchlist_user_address ON watchlist(user_address);
CREATE INDEX IF NOT EXISTS idx_watchlist_raffle_id ON watchlist(raffle_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_created_at ON watchlist(created_at DESC);

-- =====================================================
-- RAFFLE VIEWS TABLE (View Count)
-- =====================================================
CREATE TABLE IF NOT EXISTS raffle_views (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raffle_id INTEGER NOT NULL,
  user_address TEXT, -- NULL for anonymous views
  ip_hash TEXT, -- Hashed IP for anonymous tracking (privacy)
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for raffle_views
CREATE INDEX IF NOT EXISTS idx_raffle_views_raffle_id ON raffle_views(raffle_id);
CREATE INDEX IF NOT EXISTS idx_raffle_views_user_address ON raffle_views(user_address);
CREATE INDEX IF NOT EXISTS idx_raffle_views_created_at ON raffle_views(created_at DESC);

-- =====================================================
-- RAFFLE ENGAGEMENT STATS TABLE (Aggregated)
-- =====================================================
CREATE TABLE IF NOT EXISTS raffle_engagement (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  raffle_id INTEGER NOT NULL UNIQUE,
  view_count INTEGER DEFAULT 0,
  unique_viewers INTEGER DEFAULT 0,
  watchlist_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for raffle_engagement
CREATE INDEX IF NOT EXISTS idx_raffle_engagement_raffle_id ON raffle_engagement(raffle_id);

-- =====================================================
-- ENABLE RLS
-- =====================================================
ALTER TABLE raffle_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE raffle_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE raffle_engagement ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS POLICIES
-- =====================================================

-- Public read access
CREATE POLICY "Public read access" ON raffle_comments FOR SELECT USING (true);
CREATE POLICY "Public read access" ON comment_likes FOR SELECT USING (true);
CREATE POLICY "Public read access" ON watchlist FOR SELECT USING (true);
CREATE POLICY "Public read access" ON raffle_views FOR SELECT USING (true);
CREATE POLICY "Public read access" ON raffle_engagement FOR SELECT USING (true);

-- Service role full access
CREATE POLICY "Service role full access" ON raffle_comments FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON comment_likes FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON watchlist FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON raffle_views FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON raffle_engagement FOR ALL USING (auth.role() = 'service_role');

-- =====================================================
-- FUNCTIONS & TRIGGERS
-- =====================================================

-- Function to update comment likes count
CREATE OR REPLACE FUNCTION update_comment_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE raffle_comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE raffle_comments SET likes_count = likes_count - 1 WHERE id = OLD.comment_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger for comment likes
DROP TRIGGER IF EXISTS trigger_update_comment_likes ON comment_likes;
CREATE TRIGGER trigger_update_comment_likes
AFTER INSERT OR DELETE ON comment_likes
FOR EACH ROW EXECUTE FUNCTION update_comment_likes_count();

-- Function to update raffle engagement stats
CREATE OR REPLACE FUNCTION update_raffle_engagement()
RETURNS TRIGGER AS $$
BEGIN
  -- Upsert engagement stats
  INSERT INTO raffle_engagement (raffle_id, view_count, unique_viewers, watchlist_count, comment_count, updated_at)
  VALUES (
    COALESCE(NEW.raffle_id, OLD.raffle_id),
    0, 0, 0, 0, NOW()
  )
  ON CONFLICT (raffle_id) DO UPDATE SET updated_at = NOW();
  
  -- Update specific counts based on table
  IF TG_TABLE_NAME = 'raffle_views' THEN
    UPDATE raffle_engagement 
    SET 
      view_count = (SELECT COUNT(*) FROM raffle_views WHERE raffle_id = NEW.raffle_id),
      unique_viewers = (SELECT COUNT(DISTINCT COALESCE(user_address, ip_hash)) FROM raffle_views WHERE raffle_id = NEW.raffle_id),
      updated_at = NOW()
    WHERE raffle_id = NEW.raffle_id;
  ELSIF TG_TABLE_NAME = 'watchlist' THEN
    UPDATE raffle_engagement 
    SET 
      watchlist_count = (SELECT COUNT(*) FROM watchlist WHERE raffle_id = COALESCE(NEW.raffle_id, OLD.raffle_id)),
      updated_at = NOW()
    WHERE raffle_id = COALESCE(NEW.raffle_id, OLD.raffle_id);
  ELSIF TG_TABLE_NAME = 'raffle_comments' THEN
    UPDATE raffle_engagement 
    SET 
      comment_count = (SELECT COUNT(*) FROM raffle_comments WHERE raffle_id = COALESCE(NEW.raffle_id, OLD.raffle_id) AND is_deleted = FALSE),
      updated_at = NOW()
    WHERE raffle_id = COALESCE(NEW.raffle_id, OLD.raffle_id);
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Triggers for engagement updates
DROP TRIGGER IF EXISTS trigger_update_engagement_views ON raffle_views;
CREATE TRIGGER trigger_update_engagement_views
AFTER INSERT ON raffle_views
FOR EACH ROW EXECUTE FUNCTION update_raffle_engagement();

DROP TRIGGER IF EXISTS trigger_update_engagement_watchlist ON watchlist;
CREATE TRIGGER trigger_update_engagement_watchlist
AFTER INSERT OR DELETE ON watchlist
FOR EACH ROW EXECUTE FUNCTION update_raffle_engagement();

DROP TRIGGER IF EXISTS trigger_update_engagement_comments ON raffle_comments;
CREATE TRIGGER trigger_update_engagement_comments
AFTER INSERT OR UPDATE OR DELETE ON raffle_comments
FOR EACH ROW EXECUTE FUNCTION update_raffle_engagement();

-- =====================================================
-- VIEWS
-- =====================================================

-- Comments with user info view
CREATE OR REPLACE VIEW raffle_comments_view AS
SELECT 
  c.id,
  c.raffle_id,
  c.user_address,
  c.content,
  c.parent_id,
  c.is_edited,
  c.likes_count,
  c.created_at,
  c.updated_at,
  (SELECT COUNT(*) FROM raffle_comments WHERE parent_id = c.id AND is_deleted = FALSE) as reply_count
FROM raffle_comments c
WHERE c.is_deleted = FALSE
ORDER BY c.created_at DESC;

-- User watchlist view
CREATE OR REPLACE VIEW user_watchlist_view AS
SELECT 
  w.id,
  w.user_address,
  w.raffle_id,
  w.created_at,
  e.view_count,
  e.watchlist_count,
  e.comment_count
FROM watchlist w
LEFT JOIN raffle_engagement e ON w.raffle_id = e.raffle_id
ORDER BY w.created_at DESC;

-- Popular raffles view (by engagement)
CREATE OR REPLACE VIEW popular_raffles_view AS
SELECT 
  raffle_id,
  view_count,
  unique_viewers,
  watchlist_count,
  comment_count,
  (view_count * 1 + watchlist_count * 5 + comment_count * 3) as engagement_score,
  updated_at
FROM raffle_engagement
ORDER BY engagement_score DESC;

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON TABLE raffle_comments IS 'User comments on raffles';
COMMENT ON TABLE comment_likes IS 'Likes on comments';
COMMENT ON TABLE watchlist IS 'User watchlist for raffles';
COMMENT ON TABLE raffle_views IS 'View tracking for raffles';
COMMENT ON TABLE raffle_engagement IS 'Aggregated engagement stats per raffle';
