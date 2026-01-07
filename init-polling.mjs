/**
 * Initialize Polling Service
 * Run this script to set up Supabase tables for polling
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function initPolling() {
  console.log('🔄 Initializing Polling Service...\n');

  try {
    // Read SQL schema
    const schema = fs.readFileSync('./supabase-schema-polling.sql', 'utf8');
    
    console.log('📋 SQL Schema loaded');
    console.log('⚠️  Please run this SQL manually in Supabase SQL Editor:\n');
    console.log('1. Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/sql/new');
    console.log('2. Copy the contents of: backend/supabase-schema-polling.sql');
    console.log('3. Paste and run the SQL\n');

    // Check if tables exist
    console.log('🔍 Checking if tables exist...');
    
    const { data: pollingState, error: pollingError } = await supabase
      .from('polling_state')
      .select('*')
      .limit(1);

    if (pollingError) {
      console.log('❌ polling_state table not found');
      console.log('   Please run the SQL schema first!\n');
      return;
    }

    console.log('✅ polling_state table exists');

    const { data: raffleEvents, error: eventsError } = await supabase
      .from('raffle_events')
      .select('*')
      .limit(1);

    if (eventsError) {
      console.log('❌ raffle_events table not found');
      console.log('   Please run the SQL schema first!\n');
      return;
    }

    console.log('✅ raffle_events table exists');

    const { data: leaderboard, error: leaderboardError } = await supabase
      .from('leaderboard_cache')
      .select('*')
      .limit(1);

    if (leaderboardError) {
      console.log('❌ leaderboard_cache table not found');
      console.log('   Please run the SQL schema first!\n');
      return;
    }

    console.log('✅ leaderboard_cache table exists');

    // Initialize polling state if empty
    if (!pollingState || pollingState.length === 0) {
      console.log('\n📝 Initializing polling state...');
      
      const { error: insertError } = await supabase
        .from('polling_state')
        .insert({
          id: 1,
          last_synced_version: 0,
          last_synced_at: new Date().toISOString(),
          is_syncing: false,
          error_count: 0,
        });

      if (insertError) {
        console.error('❌ Failed to initialize polling state:', insertError.message);
        return;
      }

      console.log('✅ Polling state initialized');
    } else {
      console.log('✅ Polling state already initialized');
    }

    console.log('\n✅ Polling service is ready!');
    console.log('\n📋 Next steps:');
    console.log('1. Start backend: cd backend && npm run dev');
    console.log('2. Check status: GET http://localhost:3000/api/polling/status');
    console.log('3. View activity: GET http://localhost:3000/api/polling/activity/global');

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

initPolling();
