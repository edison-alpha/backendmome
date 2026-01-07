import { Router, Request, Response } from 'express';
import { cacheService } from '../config/redis.js';
import { getGlobalActivity, getRaffleActivity } from '../services/indexerService.js';
import { trackActivitiesBatch, cacheLeaderboard, getCachedLeaderboard } from '../services/analyticsService.js';

const router = Router();

const CACHE_TTL = {
  SHORT: parseInt(process.env.CACHE_TTL_SHORT || '30'),
  MEDIUM: parseInt(process.env.CACHE_TTL_MEDIUM || '300'),
  LONG: parseInt(process.env.CACHE_TTL_LONG || '3600'),
};

/**
 * GET /api/raffle-activity/global
 * Get global raffle activity with Redis caching + Supabase analytics
 */
router.get('/global', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const cacheKey = `raffle:activity:global:${limit}`;

    // Check Redis cache first (fast)
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        cached: true,
        source: 'redis',
      });
    }

    // Fetch from indexer
    const activities = await getGlobalActivity(limit);

    // Cache to Redis for 30 seconds (hot cache)
    await cacheService.set(cacheKey, activities, CACHE_TTL.SHORT);

    // Track to Supabase for analytics (async, don't wait)
    trackActivitiesBatch(activities).catch(err => 
      console.error('Failed to track activities:', err)
    );

    res.json({
      success: true,
      data: activities,
      cached: false,
      source: 'indexer',
    });
  } catch (error) {
    console.error('Error in /global:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch global activity',
    });
  }
});

/**
 * GET /api/raffle-activity/:raffleId
 * Get raffle-specific activity with caching
 */
router.get('/:raffleId', async (req: Request, res: Response) => {
  try {
    const raffleId = parseInt(req.params.raffleId);
    const limit = parseInt(req.query.limit as string) || 50;
    const cacheKey = `raffle:activity:${raffleId}:${limit}`;

    if (isNaN(raffleId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid raffle ID',
      });
    }

    // Check Redis cache
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json({
        success: true,
        data: cached,
        cached: true,
        source: 'redis',
      });
    }

    // Fetch from indexer
    const activities = await getRaffleActivity(raffleId, limit);

    // Cache to Redis
    await cacheService.set(cacheKey, activities, CACHE_TTL.SHORT);

    // Track to Supabase (async)
    trackActivitiesBatch(activities).catch(err => 
      console.error('Failed to track activities:', err)
    );

    res.json({
      success: true,
      data: activities,
      cached: false,
      source: 'indexer',
    });
  } catch (error) {
    console.error(`Error in /:raffleId:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch raffle activity',
    });
  }
});

/**
 * GET /api/raffle-activity/leaderboard/:raffleId
 * Get leaderboard with multi-layer caching
 */
router.get('/leaderboard/:raffleId', async (req: Request, res: Response) => {
  try {
    const raffleId = req.params.raffleId === 'global' ? null : parseInt(req.params.raffleId);
    const cacheKey = `raffle:leaderboard:${raffleId || 'global'}`;

    // Layer 1: Redis cache (fastest)
    const redisCache = await cacheService.get(cacheKey);
    if (redisCache) {
      return res.json({
        success: true,
        data: redisCache,
        cached: true,
        source: 'redis',
      });
    }

    // Layer 2: Supabase cache (fast)
    const supabaseCache = await getCachedLeaderboard(raffleId);
    if (supabaseCache) {
      // Cache to Redis for next request
      await cacheService.set(cacheKey, supabaseCache, CACHE_TTL.MEDIUM);
      
      return res.json({
        success: true,
        data: supabaseCache,
        cached: true,
        source: 'supabase',
      });
    }

    // Layer 3: Compute from activities (slow)
    // TODO: Implement leaderboard computation
    const leaderboard = { message: 'Leaderboard computation not implemented yet' };

    // Cache to both layers
    await cacheService.set(cacheKey, leaderboard, CACHE_TTL.MEDIUM);
    await cacheLeaderboard(raffleId, leaderboard);

    res.json({
      success: true,
      data: leaderboard,
      cached: false,
      source: 'computed',
    });
  } catch (error) {
    console.error('Error in /leaderboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch leaderboard',
    });
  }
});

/**
 * POST /api/raffle-activity/invalidate
 * Invalidate cache (for admin/testing)
 */
router.post('/invalidate', async (req: Request, res: Response) => {
  try {
    const { pattern } = req.body;
    
    if (!pattern) {
      return res.status(400).json({
        success: false,
        error: 'Pattern required',
      });
    }

    // Simple invalidation (in production, use Redis SCAN)
    await cacheService.del(pattern);

    res.json({
      success: true,
      message: 'Cache invalidated',
    });
  } catch (error) {
    console.error('Error invalidating cache:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to invalidate cache',
    });
  }
});

/**
 * GET /api/raffle-activity/health
 * Health check endpoint
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const redisHealthy = await cacheService.exists('health:check');
    await cacheService.set('health:check', { timestamp: Date.now() }, 10);

    res.json({
      success: true,
      redis: redisHealthy !== null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Health check failed',
    });
  }
});

export default router;
