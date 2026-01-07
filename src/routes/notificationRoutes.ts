import { Router, Request, Response } from 'express';
import {
  getUserNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  getUserTickets,
  createNotification,
  notifyRaffleSoldOut,
} from '../services/notificationService.js';

const router = Router();

/**
 * POST /api/notifications
 * Create a notification (called from frontend after successful transaction)
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { user_address, type, title, message, raffle_id, amount, transaction_hash } = req.body;

    if (!user_address || !type || !title || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: user_address, type, title, message',
      });
    }

    const success = await createNotification({
      user_address,
      type,
      title,
      message,
      raffle_id,
      amount,
      transaction_hash,
    });

    if (!success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to create notification',
      });
    }

    res.json({
      success: true,
      message: 'Notification created',
    });
  } catch (error) {
    console.error('Error in POST /notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create notification',
    });
  }
});

/**
 * GET /api/notifications/:userAddress
 * Get notifications for a user
 */
router.get('/:userAddress', async (req: Request, res: Response) => {
  try {
    const { userAddress } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const unreadOnly = req.query.unreadOnly === 'true';

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'User address required',
      });
    }

    const notifications = await getUserNotifications(userAddress, limit, unreadOnly);

    res.json({
      success: true,
      data: notifications,
      count: notifications.length,
    });
  } catch (error) {
    console.error('Error in GET /notifications/:userAddress:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notifications',
    });
  }
});

/**
 * GET /api/notifications/:userAddress/unread-count
 * Get unread notification count
 */
router.get('/:userAddress/unread-count', async (req: Request, res: Response) => {
  try {
    const { userAddress } = req.params;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'User address required',
      });
    }

    const count = await getUnreadCount(userAddress);

    res.json({
      success: true,
      data: { count },
    });
  } catch (error) {
    console.error('Error in GET /notifications/:userAddress/unread-count:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch unread count',
    });
  }
});

/**
 * PUT /api/notifications/:notificationId/read
 * Mark a notification as read
 */
router.put('/:notificationId/read', async (req: Request, res: Response) => {
  try {
    const { notificationId } = req.params;

    if (!notificationId) {
      return res.status(400).json({
        success: false,
        error: 'Notification ID required',
      });
    }

    const success = await markAsRead(notificationId);

    if (!success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to mark notification as read',
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read',
    });
  } catch (error) {
    console.error('Error in PUT /notifications/:notificationId/read:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notification as read',
    });
  }
});

/**
 * PUT /api/notifications/:userAddress/read-all
 * Mark all notifications as read for a user
 */
router.put('/:userAddress/read-all', async (req: Request, res: Response) => {
  try {
    const { userAddress } = req.params;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'User address required',
      });
    }

    const success = await markAllAsRead(userAddress);

    if (!success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to mark all notifications as read',
      });
    }

    res.json({
      success: true,
      message: 'All notifications marked as read',
    });
  } catch (error) {
    console.error('Error in PUT /notifications/:userAddress/read-all:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark all notifications as read',
    });
  }
});

/**
 * GET /api/notifications/:userAddress/tickets
 * Get user's tickets across all raffles
 */
router.get('/:userAddress/tickets', async (req: Request, res: Response) => {
  try {
    const { userAddress } = req.params;
    const raffleId = req.query.raffleId ? parseInt(req.query.raffleId as string) : undefined;

    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'User address required',
      });
    }

    const tickets = await getUserTickets(userAddress, raffleId);

    res.json({
      success: true,
      data: tickets,
      count: tickets.length,
    });
  } catch (error) {
    console.error('Error in GET /notifications/:userAddress/tickets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user tickets',
    });
  }
});

/**
 * POST /api/notifications/raffle-sold-out
 * Notify all participants that raffle is sold out
 */
router.post('/raffle-sold-out', async (req: Request, res: Response) => {
  try {
    const { raffle_id, raffle_title, exclude_address } = req.body;

    if (!raffle_id || !raffle_title) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: raffle_id, raffle_title',
      });
    }

    const count = await notifyRaffleSoldOut(raffle_id, raffle_title, exclude_address);

    res.json({
      success: true,
      message: `Notified ${count} participants`,
      count,
    });
  } catch (error) {
    console.error('Error in POST /notifications/raffle-sold-out:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to notify participants',
    });
  }
});

export default router;
