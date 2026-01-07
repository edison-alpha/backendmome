import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import crypto from 'crypto';

const router = Router();

// Helper to hash IP for privacy
const hashIP = (ip: string): string => {
  return crypto.createHash('sha256').update(ip + process.env.IP_SALT || 'raffle-salt').digest('hex').substring(0, 16);
};

// Helper to get supabase client with null check
const getDb = () => {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client not initialized');
  }
  return supabaseAdmin;
};

// =====================================================
// COMMENTS ENDPOINTS
// =====================================================

// Get comments for a raffle
router.get('/raffles/:raffleId/comments', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { raffleId } = req.params;
    const { page = '1', limit = '20' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);

    const { data: comments, error, count } = await db
      .from('raffle_comments')
      .select('*', { count: 'exact' })
      .eq('raffle_id', parseInt(raffleId))
      .is('parent_id', null)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit as string) - 1);

    if (error) throw error;

    // Get replies for each comment
    const commentsWithReplies = await Promise.all(
      (comments || []).map(async (comment) => {
        const { data: replies } = await db
          .from('raffle_comments')
          .select('*')
          .eq('parent_id', comment.id)
          .eq('is_deleted', false)
          .order('created_at', { ascending: true })
          .limit(3);

        const { count: replyCount } = await db
          .from('raffle_comments')
          .select('*', { count: 'exact', head: true })
          .eq('parent_id', comment.id)
          .eq('is_deleted', false);

        return { ...comment, replies: replies || [], reply_count: replyCount || 0 };
      })
    );

    res.json({
      success: true,
      data: commentsWithReplies,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / parseInt(limit as string)),
      },
    });
  } catch (error: any) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a comment
router.post('/raffles/:raffleId/comments', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { raffleId } = req.params;
    const { user_address, content, parent_id } = req.body;

    if (!user_address || !content) {
      return res.status(400).json({ success: false, error: 'user_address and content are required' });
    }
    if (content.length > 500) {
      return res.status(400).json({ success: false, error: 'Comment must be 500 characters or less' });
    }

    const { data: comment, error } = await db
      .from('raffle_comments')
      .insert({ raffle_id: parseInt(raffleId), user_address, content, parent_id: parent_id || null })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data: comment });
  } catch (error: any) {
    console.error('Error adding comment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Edit a comment
router.put('/comments/:commentId', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { commentId } = req.params;
    const { user_address, content } = req.body;

    if (!user_address || !content) {
      return res.status(400).json({ success: false, error: 'user_address and content are required' });
    }

    const { data: existing } = await db
      .from('raffle_comments')
      .select('user_address')
      .eq('id', commentId)
      .single();

    if (!existing || existing.user_address.toLowerCase() !== user_address.toLowerCase()) {
      return res.status(403).json({ success: false, error: 'Not authorized to edit this comment' });
    }

    const { data: comment, error } = await db
      .from('raffle_comments')
      .update({ content, is_edited: true, updated_at: new Date().toISOString() })
      .eq('id', commentId)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, data: comment });
  } catch (error: any) {
    console.error('Error editing comment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a comment (soft delete)
router.delete('/comments/:commentId', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { commentId } = req.params;
    const { user_address } = req.body;

    if (!user_address) {
      return res.status(400).json({ success: false, error: 'user_address is required' });
    }

    const { data: existing } = await db
      .from('raffle_comments')
      .select('user_address')
      .eq('id', commentId)
      .single();

    if (!existing || existing.user_address.toLowerCase() !== user_address.toLowerCase()) {
      return res.status(403).json({ success: false, error: 'Not authorized to delete this comment' });
    }

    const { error } = await db
      .from('raffle_comments')
      .update({ is_deleted: true, content: '[deleted]', updated_at: new Date().toISOString() })
      .eq('id', commentId);

    if (error) throw error;
    res.json({ success: true, message: 'Comment deleted' });
  } catch (error: any) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Like/Unlike a comment
router.post('/comments/:commentId/like', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { commentId } = req.params;
    const { user_address } = req.body;

    if (!user_address) {
      return res.status(400).json({ success: false, error: 'user_address is required' });
    }

    const { data: existing } = await db
      .from('comment_likes')
      .select('id')
      .eq('comment_id', commentId)
      .eq('user_address', user_address.toLowerCase())
      .single();

    if (existing) {
      await db.from('comment_likes').delete().eq('id', existing.id);
      res.json({ success: true, action: 'unliked' });
    } else {
      await db.from('comment_likes').insert({ comment_id: commentId, user_address: user_address.toLowerCase() });
      res.json({ success: true, action: 'liked' });
    }
  } catch (error: any) {
    console.error('Error toggling like:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// WATCHLIST ENDPOINTS
// =====================================================

router.get('/watchlist/:userAddress', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { userAddress } = req.params;

    const { data: watchlist, error } = await db
      .from('watchlist')
      .select('id, raffle_id, created_at')
      .eq('user_address', userAddress.toLowerCase())
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data: watchlist || [] });
  } catch (error: any) {
    console.error('Error fetching watchlist:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/watchlist/:userAddress/:raffleId', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { userAddress, raffleId } = req.params;

    const { data, error } = await db
      .from('watchlist')
      .select('id')
      .eq('user_address', userAddress.toLowerCase())
      .eq('raffle_id', parseInt(raffleId))
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    res.json({ success: true, isWatching: !!data });
  } catch (error: any) {
    console.error('Error checking watchlist:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/watchlist', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { user_address, raffle_id } = req.body;

    if (!user_address || !raffle_id) {
      return res.status(400).json({ success: false, error: 'user_address and raffle_id are required' });
    }

    const { data, error } = await db
      .from('watchlist')
      .insert({ user_address: user_address.toLowerCase(), raffle_id })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.json({ success: true, message: 'Already in watchlist' });
      throw error;
    }
    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Error adding to watchlist:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/watchlist/:userAddress/:raffleId', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { userAddress, raffleId } = req.params;

    const { error } = await db
      .from('watchlist')
      .delete()
      .eq('user_address', userAddress.toLowerCase())
      .eq('raffle_id', parseInt(raffleId));

    if (error) throw error;
    res.json({ success: true, message: 'Removed from watchlist' });
  } catch (error: any) {
    console.error('Error removing from watchlist:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// VIEW COUNT ENDPOINTS
// =====================================================

router.post('/raffles/:raffleId/view', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { raffleId } = req.params;
    const { user_address } = req.body;
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const userAgent = req.headers['user-agent'] || '';
    const ipHash = hashIP(ip as string);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: recentView } = await db
      .from('raffle_views')
      .select('id')
      .eq('raffle_id', parseInt(raffleId))
      .or(`user_address.eq.${user_address?.toLowerCase() || 'null'},ip_hash.eq.${ipHash}`)
      .gte('created_at', oneHourAgo)
      .limit(1)
      .single();

    if (recentView) {
      const { data: engagement } = await db
        .from('raffle_engagement')
        .select('view_count')
        .eq('raffle_id', parseInt(raffleId))
        .single();
      return res.json({ success: true, view_count: engagement?.view_count || 0, message: 'View already counted' });
    }

    await db.from('raffle_views').insert({
      raffle_id: parseInt(raffleId),
      user_address: user_address?.toLowerCase() || null,
      ip_hash: ipHash,
      user_agent: userAgent.substring(0, 255),
    });

    const { data: engagement } = await db
      .from('raffle_engagement')
      .select('view_count')
      .eq('raffle_id', parseInt(raffleId))
      .single();

    res.json({ success: true, view_count: engagement?.view_count || 1 });
  } catch (error: any) {
    console.error('Error tracking view:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/raffles/:raffleId/engagement', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { raffleId } = req.params;

    const { data: engagement, error } = await db
      .from('raffle_engagement')
      .select('*')
      .eq('raffle_id', parseInt(raffleId))
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    res.json({
      success: true,
      data: engagement || { raffle_id: parseInt(raffleId), view_count: 0, unique_viewers: 0, watchlist_count: 0, comment_count: 0 },
    });
  } catch (error: any) {
    console.error('Error fetching engagement:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/popular', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { limit = '10' } = req.query;

    const { data, error } = await db
      .from('raffle_engagement')
      .select('*')
      .order('view_count', { ascending: false })
      .limit(parseInt(limit as string));

    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error: any) {
    console.error('Error fetching popular raffles:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
