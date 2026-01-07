import { supabaseAdmin } from '../config/supabase.js';
import { RaffleActivity } from './indexerService.js';

const ENABLE_NOTIFICATIONS = process.env.ENABLE_SUPABASE === 'true';

export interface Notification {
  id?: string;
  user_address: string;
  type: NotificationType;
  title: string;
  message: string;
  raffle_id?: number;
  related_address?: string;
  amount?: number;
  transaction_hash?: string;
  is_read?: boolean;
  created_at?: string;
}

export type NotificationType = 
  | 'ticket_purchased'      // Someone bought tickets on your raffle
  | 'raffle_won'           // You won a raffle
  | 'raffle_ended'         // Your raffle ended
  | 'raffle_sold_out'      // Your raffle sold out
  | 'prize_claimed'        // Winner claimed prize from your raffle
  | 'new_participant'      // New participant in your raffle
  | 'raffle_created'       // Your raffle was created successfully
  | 'system';              // System notifications

export interface UserTicket {
  id?: string;
  user_address: string;
  raffle_id: number;
  ticket_count: number;
  total_spent: number;
  first_purchase_at?: string;
  last_purchase_at?: string;
}

/**
 * Check if notification with transaction_hash already exists
 */
export async function notificationExists(transactionHash: string): Promise<boolean> {
  if (!ENABLE_NOTIFICATIONS || !supabaseAdmin || !transactionHash) {
    return false;
  }

  try {
    const { count, error } = await supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('transaction_hash', transactionHash);

    if (error) {
      console.error('[notificationExists] Error:', error);
      return false;
    }

    return (count || 0) > 0;
  } catch (error) {
    console.error('[notificationExists] Error:', error);
    return false;
  }
}

/**
 * Create a notification (with duplicate check)
 */
export async function createNotification(notification: Omit<Notification, 'id' | 'created_at'>): Promise<boolean> {
  if (!ENABLE_NOTIFICATIONS || !supabaseAdmin) {
    console.log('[notificationService] Notifications disabled or Supabase not configured');
    return false;
  }

  try {
    // Check for duplicate if transaction_hash is provided
    if (notification.transaction_hash) {
      const exists = await notificationExists(notification.transaction_hash);
      if (exists) {
        console.log(`[createNotification] Skipping duplicate notification for tx: ${notification.transaction_hash}`);
        return false;
      }
    }

    const { error } = await supabaseAdmin
      .from('notifications')
      .insert({
        ...notification,
        user_address: notification.user_address.toLowerCase(),
        is_read: false,
      });

    if (error) {
      // Handle unique constraint violation gracefully
      if (error.code === '23505') {
        console.log(`[createNotification] Duplicate notification skipped for tx: ${notification.transaction_hash}`);
        return false;
      }
      console.error('[createNotification] Error:', error);
      return false;
    }

    console.log(`✅ Notification created for ${notification.user_address}: ${notification.type}`);
    return true;
  } catch (error) {
    console.error('[createNotification] Error:', error);
    return false;
  }
}

/**
 * Get notifications for a user
 */
export async function getUserNotifications(
  userAddress: string,
  limit = 50,
  unreadOnly = false
): Promise<Notification[]> {
  if (!ENABLE_NOTIFICATIONS || !supabaseAdmin) {
    return [];
  }

  try {
    let query = supabaseAdmin
      .from('notifications')
      .select('*')
      .eq('user_address', userAddress.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(limit);

    if (unreadOnly) {
      query = query.eq('is_read', false);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[getUserNotifications] Error:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('[getUserNotifications] Error:', error);
    return [];
  }
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(userAddress: string): Promise<number> {
  if (!ENABLE_NOTIFICATIONS || !supabaseAdmin) {
    return 0;
  }

  try {
    const { count, error } = await supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_address', userAddress.toLowerCase())
      .eq('is_read', false);

    if (error) {
      console.error('[getUnreadCount] Error:', error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error('[getUnreadCount] Error:', error);
    return 0;
  }
}

/**
 * Mark notification as read
 */
export async function markAsRead(notificationId: string): Promise<boolean> {
  if (!ENABLE_NOTIFICATIONS || !supabaseAdmin) {
    return false;
  }

  try {
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (error) {
      console.error('[markAsRead] Error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[markAsRead] Error:', error);
    return false;
  }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userAddress: string): Promise<boolean> {
  if (!ENABLE_NOTIFICATIONS || !supabaseAdmin) {
    return false;
  }

  try {
    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_address', userAddress.toLowerCase())
      .eq('is_read', false);

    if (error) {
      console.error('[markAllAsRead] Error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[markAllAsRead] Error:', error);
    return false;
  }
}

/**
 * Update or create user ticket record
 */
export async function upsertUserTicket(
  userAddress: string,
  raffleId: number,
  ticketCount: number,
  totalSpent: number
): Promise<boolean> {
  if (!ENABLE_NOTIFICATIONS || !supabaseAdmin) {
    return false;
  }

  try {
    const now = new Date().toISOString();
    
    // Check if record exists
    const { data: existing } = await supabaseAdmin
      .from('user_tickets')
      .select('*')
      .eq('user_address', userAddress.toLowerCase())
      .eq('raffle_id', raffleId)
      .single();

    if (existing) {
      // Update existing record
      const { error } = await supabaseAdmin
        .from('user_tickets')
        .update({
          ticket_count: existing.ticket_count + ticketCount,
          total_spent: existing.total_spent + totalSpent,
          last_purchase_at: now,
          updated_at: now,
        })
        .eq('id', existing.id);

      if (error) {
        console.error('[upsertUserTicket] Update error:', error);
        return false;
      }
    } else {
      // Insert new record
      const { error } = await supabaseAdmin
        .from('user_tickets')
        .insert({
          user_address: userAddress.toLowerCase(),
          raffle_id: raffleId,
          ticket_count: ticketCount,
          total_spent: totalSpent,
          first_purchase_at: now,
          last_purchase_at: now,
        });

      if (error) {
        console.error('[upsertUserTicket] Insert error:', error);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('[upsertUserTicket] Error:', error);
    return false;
  }
}

/**
 * Get user tickets for a specific raffle or all raffles
 */
export async function getUserTickets(
  userAddress: string,
  raffleId?: number
): Promise<UserTicket[]> {
  if (!ENABLE_NOTIFICATIONS || !supabaseAdmin) {
    return [];
  }

  try {
    let query = supabaseAdmin
      .from('user_tickets')
      .select('*')
      .eq('user_address', userAddress.toLowerCase())
      .order('last_purchase_at', { ascending: false });

    if (raffleId !== undefined) {
      query = query.eq('raffle_id', raffleId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[getUserTickets] Error:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('[getUserTickets] Error:', error);
    return [];
  }
}

/**
 * Get all participants for a raffle
 */
export async function getRaffleParticipants(raffleId: number): Promise<string[]> {
  if (!ENABLE_NOTIFICATIONS || !supabaseAdmin) {
    return [];
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('user_tickets')
      .select('user_address')
      .eq('raffle_id', raffleId);

    if (error) {
      console.error('[getRaffleParticipants] Error:', error);
      return [];
    }

    return (data || []).map(d => d.user_address);
  } catch (error) {
    console.error('[getRaffleParticipants] Error:', error);
    return [];
  }
}

/**
 * Notify all participants that raffle is sold out
 */
export async function notifyRaffleSoldOut(
  raffleId: number,
  raffleTitle: string,
  excludeAddress?: string
): Promise<number> {
  if (!ENABLE_NOTIFICATIONS || !supabaseAdmin) {
    return 0;
  }

  try {
    // Get all participants
    const participants = await getRaffleParticipants(raffleId);
    
    // Filter out excluded address (the buyer who triggered sold out) and creator
    const toNotify = participants.filter(addr => 
      addr.toLowerCase() !== excludeAddress?.toLowerCase()
    );

    let notifiedCount = 0;

    // Send notification to each participant
    for (const userAddress of toNotify) {
      const success = await createNotification({
        user_address: userAddress,
        type: 'raffle_sold_out',
        title: 'Raffle Sold Out! 🎫',
        message: `"${raffleTitle}" is now sold out! Please wait for the winner to be selected. Good luck! 🍀`,
        raffle_id: raffleId,
      });

      if (success) notifiedCount++;
    }

    console.log(`[notifyRaffleSoldOut] Notified ${notifiedCount}/${toNotify.length} participants for raffle ${raffleId}`);
    return notifiedCount;
  } catch (error) {
    console.error('[notifyRaffleSoldOut] Error:', error);
    return 0;
  }
}
