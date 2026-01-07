import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const ENABLE_SUPABASE = process.env.ENABLE_SUPABASE === 'true';

// Client for public operations (with RLS)
export const supabase = ENABLE_SUPABASE && SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// Admin client for backend operations (bypass RLS)
export const supabaseAdmin = ENABLE_SUPABASE && SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

if (ENABLE_SUPABASE) {
  if (supabase) {
    console.log('✅ Supabase client initialized');
  } else {
    console.warn('⚠️  Supabase enabled but credentials missing');
  }
}

// Database schema types
export interface UserActivity {
  id?: string;
  user_address: string;
  raffle_id: number;
  activity_type: 'ticket_purchase' | 'raffle_created' | 'raffle_finalized';
  ticket_count?: number;
  total_paid?: number;
  prize_amount?: number;
  transaction_version: string;
  block_height: number;
  timestamp: string;
  created_at?: string;
}

export interface LeaderboardCache {
  id?: string;
  raffle_id: number | null; // null for global leaderboard
  data: any;
  updated_at?: string;
}

export interface RaffleStats {
  id?: string;
  raffle_id: number | null; // null for global stats
  total_tickets_sold: number;
  total_volume: number;
  unique_participants: number;
  average_tickets_per_user: number;
  updated_at?: string;
}
