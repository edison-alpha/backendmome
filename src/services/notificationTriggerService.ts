import { RaffleActivity, RaffleMetadata } from './indexerService.js';
import { createNotification, upsertUserTicket } from './notificationService.js';
import { cacheService } from '../config/redis.js';

// Track processed transactions to avoid duplicate notifications
const PROCESSED_TX_PREFIX = 'processed_tx:';
const PROCESSED_TX_TTL = 86400; // 24 hours

/**
 * Check if transaction was already processed
 */
async function isTransactionProcessed(txVersion: string): Promise<boolean> {
  const key = `${PROCESSED_TX_PREFIX}${txVersion}`;
  const exists = await cacheService.exists(key);
  return exists; // Already returns boolean
}

/**
 * Mark transaction as processed
 */
async function markTransactionProcessed(txVersion: string): Promise<void> {
  const key = `${PROCESSED_TX_PREFIX}${txVersion}`;
  await cacheService.set(key, { processed: true }, PROCESSED_TX_TTL);
}

/**
 * Process activity and create appropriate notifications
 */
export async function processActivityNotifications(
  activity: RaffleActivity,
  raffleMetadata?: RaffleMetadata
): Promise<void> {
  // Skip if already processed
  if (await isTransactionProcessed(activity.transactionVersion)) {
    return;
  }

  try {
    switch (activity.type) {
      case 'ticket_purchase':
        await handleTicketPurchase(activity, raffleMetadata);
        break;
      case 'raffle_created':
        await handleRaffleCreated(activity);
        break;
      case 'raffle_finalized':
        await handleRaffleFinalized(activity, raffleMetadata);
        break;
    }

    // Mark as processed
    await markTransactionProcessed(activity.transactionVersion);
  } catch (error) {
    console.error('[processActivityNotifications] Error:', error);
  }
}

/**
 * Handle ticket purchase - notify raffle creator
 */
async function handleTicketPurchase(
  activity: RaffleActivity,
  raffleMetadata?: RaffleMetadata
): Promise<void> {
  if (!activity.buyer || !activity.ticketCount || !activity.totalPaid) {
    return;
  }

  // Update user tickets in Supabase
  await upsertUserTicket(
    activity.buyer,
    activity.raffleId,
    activity.ticketCount,
    activity.totalPaid
  );

  // Get raffle creator from metadata
  const creator = raffleMetadata?.creator;
  if (!creator || creator.toLowerCase() === activity.buyer.toLowerCase()) {
    // Don't notify if buyer is the creator
    return;
  }

  const raffleName = raffleMetadata?.title || `Raffle #${activity.raffleId}`;
  const ticketText = activity.ticketCount === 1 ? 'ticket' : 'tickets';

  // Notify creator about new ticket purchase
  await createNotification({
    user_address: creator,
    type: 'ticket_purchased',
    title: 'New Ticket Purchase! 🎫',
    message: `Someone bought ${activity.ticketCount} ${ticketText} for ${activity.totalPaid.toFixed(4)} MOVE on "${raffleName}"`,
    raffle_id: activity.raffleId,
    related_address: activity.buyer,
    amount: activity.totalPaid,
    transaction_hash: activity.transactionVersion,
  });

  // Check if this is a new participant (first purchase)
  // We can check this by looking at user_tickets table
  // For now, we'll skip this to avoid complexity
}

/**
 * Handle raffle created - notify creator
 */
async function handleRaffleCreated(activity: RaffleActivity): Promise<void> {
  if (!activity.creator) {
    return;
  }

  await createNotification({
    user_address: activity.creator,
    type: 'raffle_created',
    title: 'Raffle Created! ✨',
    message: `Your raffle #${activity.raffleId} has been created successfully. Good luck!`,
    raffle_id: activity.raffleId,
    amount: activity.prizeAmount,
    transaction_hash: activity.transactionVersion,
  });
}

/**
 * Handle raffle finalized - notify winner and creator
 */
async function handleRaffleFinalized(
  activity: RaffleActivity,
  raffleMetadata?: RaffleMetadata
): Promise<void> {
  const raffleName = raffleMetadata?.title || `Raffle #${activity.raffleId}`;
  const prizeAmount = activity.prizeAmount || raffleMetadata?.prizeAmount || 0;

  // Notify winner
  if (activity.winner) {
    await createNotification({
      user_address: activity.winner,
      type: 'raffle_won',
      title: 'Congratulations! You Won! 🏆',
      message: `You won "${raffleName}" with a prize of ${prizeAmount.toFixed(4)} MOVE! Claim your prize now.`,
      raffle_id: activity.raffleId,
      amount: prizeAmount,
      transaction_hash: activity.transactionVersion,
    });
  }

  // Notify creator that raffle ended
  const creator = raffleMetadata?.creator;
  if (creator && creator.toLowerCase() !== activity.winner?.toLowerCase()) {
    await createNotification({
      user_address: creator,
      type: 'raffle_ended',
      title: 'Raffle Ended! 🎉',
      message: `Your raffle "${raffleName}" has ended. A winner has been selected!`,
      raffle_id: activity.raffleId,
      related_address: activity.winner,
      amount: prizeAmount,
      transaction_hash: activity.transactionVersion,
    });
  }
}

/**
 * Process batch of activities for notifications
 */
export async function processActivitiesBatch(
  activities: RaffleActivity[],
  raffleMetadataMap?: Map<number, RaffleMetadata>
): Promise<void> {
  for (const activity of activities) {
    const metadata = raffleMetadataMap?.get(activity.raffleId);
    await processActivityNotifications(activity, metadata);
  }
}
