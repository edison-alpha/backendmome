import { supabaseAdmin, UserActivity, LeaderboardCache, RaffleStats } from '../config/supabase.js';
import { RaffleActivity } from './indexerService.js';

const ENABLE_ANALYTICS = process.env.ENABLE_ANALYTICS === 'true';

/**
 * Track user activity to Supabase for analytics
 */
export async function trackActivity(activity: RaffleActivity): Promise<void> {
  if (!ENABLE_ANALYTICS || !supabaseAdmin) {
    return; // Analytics disabled or Supabase not configured
  }

  try {
    const userActivity: UserActivity = {
      user_address: activity.buyer || activity.creator || activity.winner || '',
      raffle_id: activity.raffleId,
      activity_type: activity.type,
      ticket_count: activity.ticketCount,
      total_paid: activity.totalPaid,
      prize_amount: activity.prizeAmount,
      transaction_version: activity.transactionVersion,
      block_height: activity.blockHeight,
      timestamp: activity.timestamp,
    };

    const { error } = await supabaseAdmin
      .from('user_activities')
      .insert(userActivity);

    if (error) {
      console.error('Error tracking activity:', error);
    }
  } catch (error) {
    console.error('Error in trackActivity:', error);
  }
}

/**
 * Track multiple activities in batch
 */
export async function trackActivitiesBatch(activities: RaffleActivity[]): Promise<void> {
  if (!ENABLE_ANALYTICS || !supabaseAdmin || activities.length === 0) {
    return;
  }

  try {
    const userActivities: UserActivity[] = activities.map(activity => ({
      user_address: activity.buyer || activity.creator || activity.winner || '',
      raffle_id: activity.raffleId,
      activity_type: activity.type,
      ticket_count: activity.ticketCount,
      total_paid: activity.totalPaid,
      prize_amount: activity.prizeAmount,
      transaction_version: activity.transactionVersion,
      block_height: activity.blockHeight,
      timestamp: activity.timestamp,
    }));

    const { error } = await supabaseAdmin
      .from('user_activities')
      .upsert(userActivities, {
        onConflict: 'transaction_version',
        ignoreDuplicates: true,
      });

    if (error) {
      console.error('Error tracking activities batch:', error);
    } else {
      console.log(`✅ Tracked ${activities.length} activities to Supabase`);
    }
  } catch (error) {
    console.error('Error in trackActivitiesBatch:', error);
  }
}

/**
 * Cache leaderboard to Supabase
 */
export async function cacheLeaderboard(raffleId: number | null, data: any): Promise<void> {
  if (!ENABLE_ANALYTICS || !supabaseAdmin) {
    return;
  }

  try {
    const cache: LeaderboardCache = {
      raffle_id: raffleId,
      data,
    };

    const { error } = await supabaseAdmin
      .from('leaderboard_cache')
      .upsert(cache, {
        onConflict: 'raffle_id',
      });

    if (error) {
      console.error('Error caching leaderboard:', error);
    }
  } catch (error) {
    console.error('Error in cacheLeaderboard:', error);
  }
}

/**
 * Get cached leaderboard from Supabase
 */
export async function getCachedLeaderboard(raffleId: number | null): Promise<any | null> {
  if (!ENABLE_ANALYTICS || !supabaseAdmin) {
    return null;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('leaderboard_cache')
      .select('data, updated_at')
      .eq('raffle_id', raffleId)
      .single();

    if (error || !data) {
      return null;
    }

    // Check if cache is fresh (< 5 minutes)
    const updatedAt = new Date(data.updated_at);
    const now = new Date();
    const diffMinutes = (now.getTime() - updatedAt.getTime()) / 1000 / 60;

    if (diffMinutes > 5) {
      return null; // Cache expired
    }

    return data.data;
  } catch (error) {
    console.error('Error getting cached leaderboard:', error);
    return null;
  }
}

/**
 * Cache raffle stats to Supabase
 */
export async function cacheStats(raffleId: number | null, stats: Omit<RaffleStats, 'id' | 'raffle_id' | 'updated_at'>): Promise<void> {
  if (!ENABLE_ANALYTICS || !supabaseAdmin) {
    return;
  }

  try {
    const cache: Omit<RaffleStats, 'id' | 'updated_at'> = {
      raffle_id: raffleId,
      ...stats,
    };

    const { error } = await supabaseAdmin
      .from('raffle_stats')
      .upsert(cache, {
        onConflict: 'raffle_id',
      });

    if (error) {
      console.error('Error caching stats:', error);
    }
  } catch (error) {
    console.error('Error in cacheStats:', error);
  }
}

/**
 * Get user analytics
 */
export async function getUserAnalytics(userAddress: string): Promise<any> {
  if (!ENABLE_ANALYTICS || !supabaseAdmin) {
    return null;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('user_activities')
      .select('*')
      .eq('user_address', userAddress)
      .order('timestamp', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error getting user analytics:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getUserAnalytics:', error);
    return null;
  }
}
