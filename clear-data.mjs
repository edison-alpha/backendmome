import { createClient } from '@supabase/supabase-js';
import { createClient as createRedisClient } from 'redis';

const SUPABASE_URL = 'https://lwwfkqbxnugfynkuoaky.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx3d2ZrcWJ4bnVnZnlua3VvYWt5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjYyNDgyMiwiZXhwIjoyMDgyMjAwODIyfQ.ypqjlzyhhpV4M-e85ZZ8YgS_E0HwDw-sgvmXWyC7fUw';

const REDIS_HOST = 'redis-13780.c8.us-east-1-3.ec2.cloud.redislabs.com';
const REDIS_PORT = 13780;
const REDIS_PASSWORD = 'maTOug4o11wlPOIaZ9Vx3M92NUeqKVEU';

async function clearSupabase() {
  console.log('🗑️  Clearing Supabase...');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  
  const tables = ['user_activities', 'leaderboard_cache', 'raffle_stats', 'notifications', 'user_tickets'];
  
  for (const table of tables) {
    try {
      // Try with created_at first, then updated_at
      let { error } = await supabase.from(table).delete().gte('created_at', '1970-01-01');
      if (error && error.message.includes('does not exist')) {
        const result = await supabase.from(table).delete().gte('updated_at', '1970-01-01');
        error = result.error;
      }
      if (error) {
        console.log(`   ⚠️  ${table}: ${error.message}`);
      } else {
        console.log(`   ✅ ${table} cleared`);
      }
    } catch (e) {
      console.log(`   ⚠️  ${table}: table may not exist`);
    }
  }
}

async function clearRedis() {
  console.log('🗑️  Clearing Redis...');
  
  const redis = createRedisClient({
    socket: {
      host: REDIS_HOST,
      port: REDIS_PORT,
    },
    password: REDIS_PASSWORD,
  });

  try {
    await redis.connect();
    await redis.flushAll();
    console.log('   ✅ Redis cache cleared');
    await redis.quit();
  } catch (e) {
    console.log(`   ⚠️  Redis error: ${e.message}`);
  }
}

async function main() {
  console.log('\n========================================');
  console.log('  Clear Database & Cache for V4');
  console.log('========================================\n');
  
  await clearSupabase();
  await clearRedis();
  
  console.log('\n✅ Done!\n');
}

main();
