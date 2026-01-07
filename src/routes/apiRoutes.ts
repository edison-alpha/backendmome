import { Router, Request, Response } from 'express';
import {
  getGlobalActivity,
  getRaffleActivity,
  getUserActivity,
  getGlobalLeaderboard,
  getRaffleLeaderboard,
  getPlatformStats,
  getRaffleStats,
} from '../services/raffleService.js';
import { trackActivitiesBatch } from '../services/analyticsService.js';
import { processActivitiesBatch } from '../services/notificationTriggerService.js';
import { cacheService } from '../config/redis.js';

const router = Router();

// ============================================
// ACTIVITY ENDPOINTS
// ============================================

/**
 * GET /api/activity/global
 * Global activity feed (all raffles) - for LiveTicker & /activity page
 */
router.get('/activity/global', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const activities = await getGlobalActivity(limit);
    
    // Track to Supabase (async)
    trackActivitiesBatch(activities).catch(console.error);
    
    // Process notifications (async) - only for new activities
    processActivitiesBatch(activities).catch(console.error);
    
    res.json({
      success: true,
      data: activities,
      count: activities.length,
    });
  } catch (error) {
    console.error('Error in /activity/global:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch global activity' });
  }
});

/**
 * GET /api/activity/raffle/:raffleId
 * Activity for specific raffle - for RaffleDetail page
 */
router.get('/activity/raffle/:raffleId', async (req: Request, res: Response) => {
  try {
    const raffleId = parseInt(req.params.raffleId);
    const limit = parseInt(req.query.limit as string) || 50;
    
    if (isNaN(raffleId)) {
      return res.status(400).json({ success: false, error: 'Invalid raffle ID' });
    }
    
    const activities = await getRaffleActivity(raffleId, limit);
    
    // Process notifications (async)
    processActivitiesBatch(activities).catch(console.error);
    
    res.json({
      success: true,
      data: activities,
      count: activities.length,
      raffleId,
    });
  } catch (error) {
    console.error('Error in /activity/raffle:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch raffle activity' });
  }
});

/**
 * GET /api/activity/user/:address
 * Activity for specific user - for Profile page
 */
router.get('/activity/user/:address', async (req: Request, res: Response) => {
  try {
    const userAddress = req.params.address;
    const limit = parseInt(req.query.limit as string) || 50;
    
    if (!userAddress) {
      return res.status(400).json({ success: false, error: 'User address required' });
    }
    
    const activities = await getUserActivity(userAddress, limit);
    
    res.json({
      success: true,
      data: activities,
      count: activities.length,
      userAddress,
    });
  } catch (error) {
    console.error('Error in /activity/user:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch user activity' });
  }
});

// ============================================
// LEADERBOARD ENDPOINTS
// ============================================

/**
 * GET /api/leaderboard/global
 * Global leaderboard (all raffles)
 */
router.get('/leaderboard/global', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const leaderboard = await getGlobalLeaderboard(limit);
    
    res.json({
      success: true,
      data: leaderboard,
      count: leaderboard.length,
    });
  } catch (error) {
    console.error('Error in /leaderboard/global:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch global leaderboard' });
  }
});

/**
 * GET /api/leaderboard/raffle/:raffleId
 * Leaderboard for specific raffle
 */
router.get('/leaderboard/raffle/:raffleId', async (req: Request, res: Response) => {
  try {
    const raffleId = parseInt(req.params.raffleId);
    const limit = parseInt(req.query.limit as string) || 100;
    
    if (isNaN(raffleId)) {
      return res.status(400).json({ success: false, error: 'Invalid raffle ID' });
    }
    
    const leaderboard = await getRaffleLeaderboard(raffleId, limit);
    
    res.json({
      success: true,
      data: leaderboard,
      count: leaderboard.length,
      raffleId,
    });
  } catch (error) {
    console.error('Error in /leaderboard/raffle:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch raffle leaderboard' });
  }
});

// ============================================
// STATS ENDPOINTS
// ============================================

/**
 * GET /api/stats/platform
 * Platform-wide statistics
 */
router.get('/stats/platform', async (req: Request, res: Response) => {
  try {
    const stats = await getPlatformStats();
    
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error in /stats/platform:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch platform stats' });
  }
});

/**
 * GET /api/stats/raffle/:raffleId
 * Statistics for specific raffle
 */
router.get('/stats/raffle/:raffleId', async (req: Request, res: Response) => {
  try {
    const raffleId = parseInt(req.params.raffleId);
    
    if (isNaN(raffleId)) {
      return res.status(400).json({ success: false, error: 'Invalid raffle ID' });
    }
    
    const stats = await getRaffleStats(raffleId);
    
    res.json({
      success: true,
      data: stats,
      raffleId,
    });
  } catch (error) {
    console.error('Error in /stats/raffle:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch raffle stats' });
  }
});

// ============================================
// HEALTH & UTILITY ENDPOINTS
// ============================================

/**
 * GET /api/health
 * Health check
 */
router.get('/health', async (req: Request, res: Response) => {
  res.json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      api: 'running',
      redis: 'connected',
      supabase: 'connected',
    },
  });
});

/**
 * POST /api/cache/clear
 * Clear all Redis cache - untuk reset saat deploy contract baru
 */
router.post('/cache/clear', async (req: Request, res: Response) => {
  try {
    const { pattern } = req.body;
    
    if (pattern) {
      // Clear by pattern (e.g., "raffle:*")
      const cleared = await cacheService.clearByPattern(pattern);
      res.json({
        success: true,
        message: `Cleared ${cleared} keys matching pattern: ${pattern}`,
        keysCleared: cleared,
      });
    } else {
      // Clear all
      const success = await cacheService.flushAll();
      res.json({
        success,
        message: success ? 'All Redis cache cleared' : 'Failed to clear cache',
      });
    }
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ success: false, error: 'Failed to clear cache' });
  }
});

/**
 * GET /api/cache/clear
 * Clear all Redis cache (GET method for easy browser access)
 */
router.get('/cache/clear', async (req: Request, res: Response) => {
  try {
    const success = await cacheService.flushAll();
    res.json({
      success,
      message: success ? '✅ All Redis cache cleared!' : '❌ Failed to clear cache',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ success: false, error: 'Failed to clear cache' });
  }
});

export default router;
