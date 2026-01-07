import { gql } from '@apollo/client/core';
import { apolloClient } from '../config/apollo.js';
import { cacheService } from '../config/redis.js';

const RAFFLE_CONTRACT_ADDRESS = process.env.RAFFLE_CONTRACT_ADDRESS || 
  '0x139b57d91686291b2b07d827a84fdc6cf81a80d29a8228a941c3b11fc66c59cf';

// GraphQL query untuk raffle events - Filter for draw_v5 module only
const GET_RAFFLE_EVENTS = gql`
  query GetRaffleEvents($contract_address: String!, $limit: Int!, $offset: Int!) {
    events(
      where: {
        account_address: { _eq: $contract_address }
        _or: [
          { type: { _like: "%draw_v5::BuyTicketEvent%" } }
          { type: { _like: "%draw_v5::CreateRaffleEvent%" } }
          { type: { _like: "%draw_v5::FinalizeRaffleEvent%" } }
        ]
      }
      order_by: { transaction_version: desc }
      limit: $limit
      offset: $offset
    ) {
      sequence_number
      type
      data
      indexed_type
      transaction_version
      transaction_block_height
      account_address
    }
  }
`;

// GraphQL query untuk user events - Filter for draw_v5 module only
const GET_USER_EVENTS = gql`
  query GetUserEvents($user_address: String!, $limit: Int!) {
    events(
      where: {
        _and: [
          {
            _or: [
              { type: { _like: "%draw_v5%" } }
            ]
          }
          {
            _or: [
              { data: { _contains: { buyer: $user_address } } }
              { data: { _contains: { creator: $user_address } } }
              { data: { _contains: { winner: $user_address } } }
            ]
          }
        ]
      }
      order_by: { transaction_version: desc }
      limit: $limit
    ) {
      type
      data
      transaction_version
      transaction_block_height
    }
  }
`;

export interface RaffleActivity {
  type: 'ticket_purchase' | 'raffle_created' | 'raffle_finalized';
  buyer?: string;
  creator?: string;
  winner?: string;
  raffleId: number;
  ticketCount?: number;
  totalPaid?: number;
  prizeAmount?: number;
  timestamp: string;
  transactionVersion: string;
  blockHeight: number;
}

export interface LeaderboardEntry {
  address: string;
  totalTickets: number;
  totalSpent: number;
  raffleCount: number;
  rank: number;
}

export interface RaffleStats {
  totalTicketsSold: number;
  totalVolume: number;
  uniqueParticipants: number;
  averageTicketsPerUser: number;
  totalRaffles: number;
  activeRaffles: number;
  completedRaffles: number;
}

/**
 * Parse event data
 */
function parseEventData(event: any): RaffleActivity | null {
  try {
    let eventData = event.data;
    if (typeof eventData === 'string') {
      eventData = JSON.parse(eventData);
    }

    const eventType = event.type || event.indexed_type;

    if (eventType?.includes('BuyTicketEvent')) {
      return {
        type: 'ticket_purchase',
        buyer: String(eventData.buyer || eventData.user || ''),
        raffleId: Number(eventData.raffle_id || eventData.raffleId || 0),
        ticketCount: Number(eventData.ticket_count || eventData.ticketCount || 0),
        totalPaid: Number(eventData.total_paid || eventData.totalPaid || 0) / 100000000,
        timestamp: new Date().toISOString(),
        transactionVersion: String(event.transaction_version),
        blockHeight: Number(event.transaction_block_height),
      };
    }

    if (eventType?.includes('CreateRaffleEvent') || eventType?.includes('RaffleCreatedEvent')) {
      // Note: CreateRaffleEvent doesn't have prize_amount field
      // Available fields: raffle_id, creator, title, ticket_price, total_tickets, target_amount, end_time
      const ticketPrice = Number(eventData.ticket_price || eventData.ticketPrice || 0);
      const totalTickets = Number(eventData.total_tickets || eventData.totalTickets || 0);
      const targetAmount = Number(eventData.target_amount || eventData.targetAmount || 0);
      
      // Use target_amount if available, otherwise calculate from ticket_price * total_tickets
      const prizeAmountOctas = targetAmount > 0 ? targetAmount : (ticketPrice * totalTickets);
      
      return {
        type: 'raffle_created',
        creator: String(eventData.creator || ''),
        raffleId: Number(eventData.raffle_id || eventData.raffleId || 0),
        prizeAmount: prizeAmountOctas / 100000000,
        timestamp: new Date().toISOString(),
        transactionVersion: String(event.transaction_version),
        blockHeight: Number(event.transaction_block_height),
      };
    }

    if (eventType?.includes('FinalizeRaffleEvent') || eventType?.includes('RaffleFinalizedEvent')) {
      return {
        type: 'raffle_finalized',
        winner: String(eventData.winner || eventData.winner_address || ''),
        raffleId: Number(eventData.raffle_id || eventData.raffleId || 0),
        prizeAmount: Number(eventData.prize_amount || eventData.prizeAmount || eventData.amount || 0) / 100000000,
        timestamp: new Date().toISOString(),
        transactionVersion: String(event.transaction_version),
        blockHeight: Number(event.transaction_block_height),
      };
    }

    return null;
  } catch (error) {
    console.error('Error parsing event:', error);
    return null;
  }
}

/**
 * Get all raffle events from indexer
 */
async function fetchRaffleEvents(limit: number = 500): Promise<RaffleActivity[]> {
  try {
    console.log(`[fetchRaffleEvents] Fetching ${limit} events from indexer...`);
    
    const { data, errors } = await apolloClient.query({
      query: GET_RAFFLE_EVENTS,
      variables: {
        contract_address: RAFFLE_CONTRACT_ADDRESS,
        limit,
        offset: 0,
      },
    });

    if (errors && errors.length > 0) {
      console.error('[fetchRaffleEvents] GraphQL errors:', errors);
    }

    if (!data || !data.events) {
      console.warn('[fetchRaffleEvents] No events data returned');
      return [];
    }

    console.log(`[fetchRaffleEvents] Received ${data.events.length} events`);

    return data.events
      .map(parseEventData)
      .filter((a: RaffleActivity | null): a is RaffleActivity => a !== null);
  } catch (error: any) {
    // Log detailed error info
    console.error('[fetchRaffleEvents] Error fetching raffle events:', {
      message: error.message,
      networkError: error.networkError?.statusCode,
      graphQLErrors: error.graphQLErrors?.length,
    });
    
    // Return empty array instead of throwing - allows app to continue
    return [];
  }
}

/**
 * Get global activity (all raffles)
 */
export async function getGlobalActivity(limit: number = 50): Promise<RaffleActivity[]> {
  const cacheKey = `activity:global:${limit}`;
  
  // Check cache
  const cached = await cacheService.get<RaffleActivity[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const activities = await fetchRaffleEvents(limit * 2);
  const result = activities.slice(0, limit);
  
  // Cache for 30 seconds
  await cacheService.set(cacheKey, result, 30);
  
  return result;
}

/**
 * Get activity for specific raffle
 */
export async function getRaffleActivity(raffleId: number, limit: number = 50): Promise<RaffleActivity[]> {
  const cacheKey = `activity:raffle:${raffleId}:${limit}`;
  
  const cached = await cacheService.get<RaffleActivity[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const allActivities = await fetchRaffleEvents(500);
  const filtered = allActivities
    .filter(a => a.raffleId === raffleId)
    .slice(0, limit);
  
  await cacheService.set(cacheKey, filtered, 30);
  
  return filtered;
}

/**
 * Get user activity (profile page)
 */
export async function getUserActivity(userAddress: string, limit: number = 50): Promise<RaffleActivity[]> {
  const cacheKey = `activity:user:${userAddress}:${limit}`;
  
  const cached = await cacheService.get<RaffleActivity[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const allActivities = await fetchRaffleEvents(1000);
  const filtered = allActivities
    .filter(a => 
      a.buyer === userAddress || 
      a.creator === userAddress || 
      a.winner === userAddress
    )
    .slice(0, limit);
  
  await cacheService.set(cacheKey, filtered, 60); // Cache 1 minute for user data
  
  return filtered;
}

/**
 * Get global leaderboard
 */
export async function getGlobalLeaderboard(limit: number = 100): Promise<LeaderboardEntry[]> {
  const cacheKey = `leaderboard:global:${limit}`;
  
  const cached = await cacheService.get<LeaderboardEntry[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const allActivities = await fetchRaffleEvents(5000);
  
  // Aggregate per user
  const userStats = new Map<string, { tickets: number; spent: number; raffles: Set<number> }>();
  
  allActivities
    .filter(a => a.type === 'ticket_purchase' && a.buyer)
    .forEach(a => {
      const buyer = a.buyer!;
      const existing = userStats.get(buyer) || { tickets: 0, spent: 0, raffles: new Set() };
      existing.tickets += a.ticketCount || 0;
      existing.spent += a.totalPaid || 0;
      existing.raffles.add(a.raffleId);
      userStats.set(buyer, existing);
    });

  // Convert to leaderboard
  const leaderboard = Array.from(userStats.entries())
    .map(([address, stats]) => ({
      address,
      totalTickets: stats.tickets,
      totalSpent: stats.spent,
      raffleCount: stats.raffles.size,
      rank: 0,
    }))
    .sort((a, b) => b.totalTickets - a.totalTickets)
    .slice(0, limit)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  await cacheService.set(cacheKey, leaderboard, 300); // Cache 5 minutes
  
  return leaderboard;
}

/**
 * Get raffle-specific leaderboard
 */
export async function getRaffleLeaderboard(raffleId: number, limit: number = 100): Promise<LeaderboardEntry[]> {
  const cacheKey = `leaderboard:raffle:${raffleId}:${limit}`;
  
  const cached = await cacheService.get<LeaderboardEntry[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const allActivities = await fetchRaffleEvents(5000);
  
  const userStats = new Map<string, { tickets: number; spent: number }>();
  
  allActivities
    .filter(a => a.type === 'ticket_purchase' && a.buyer && a.raffleId === raffleId)
    .forEach(a => {
      const buyer = a.buyer!;
      const existing = userStats.get(buyer) || { tickets: 0, spent: 0 };
      existing.tickets += a.ticketCount || 0;
      existing.spent += a.totalPaid || 0;
      userStats.set(buyer, existing);
    });

  const leaderboard = Array.from(userStats.entries())
    .map(([address, stats]) => ({
      address,
      totalTickets: stats.tickets,
      totalSpent: stats.spent,
      raffleCount: 1,
      rank: 0,
    }))
    .sort((a, b) => b.totalTickets - a.totalTickets)
    .slice(0, limit)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  await cacheService.set(cacheKey, leaderboard, 60); // Cache 1 minute
  
  return leaderboard;
}

/**
 * Get platform statistics
 */
export async function getPlatformStats(): Promise<RaffleStats> {
  const cacheKey = 'stats:platform';
  
  const cached = await cacheService.get<RaffleStats>(cacheKey);
  if (cached) {
    return cached;
  }

  const allActivities = await fetchRaffleEvents(10000);
  
  const ticketPurchases = allActivities.filter(a => a.type === 'ticket_purchase');
  const raffleCreations = allActivities.filter(a => a.type === 'raffle_created');
  const raffleFinalizations = allActivities.filter(a => a.type === 'raffle_finalized');
  
  const uniqueBuyers = new Set(ticketPurchases.map(a => a.buyer).filter(Boolean));
  const uniqueRaffles = new Set(allActivities.map(a => a.raffleId));
  const completedRaffles = new Set(raffleFinalizations.map(a => a.raffleId));
  
  const totalTickets = ticketPurchases.reduce((sum, a) => sum + (a.ticketCount || 0), 0);
  const totalVolume = ticketPurchases.reduce((sum, a) => sum + (a.totalPaid || 0), 0);

  const stats: RaffleStats = {
    totalTicketsSold: totalTickets,
    totalVolume,
    uniqueParticipants: uniqueBuyers.size,
    averageTicketsPerUser: uniqueBuyers.size > 0 ? totalTickets / uniqueBuyers.size : 0,
    totalRaffles: uniqueRaffles.size,
    activeRaffles: uniqueRaffles.size - completedRaffles.size,
    completedRaffles: completedRaffles.size,
  };

  await cacheService.set(cacheKey, stats, 300); // Cache 5 minutes
  
  return stats;
}

/**
 * Get raffle-specific statistics
 */
export async function getRaffleStats(raffleId: number): Promise<RaffleStats> {
  const cacheKey = `stats:raffle:${raffleId}`;
  
  const cached = await cacheService.get<RaffleStats>(cacheKey);
  if (cached) {
    return cached;
  }

  const allActivities = await fetchRaffleEvents(5000);
  const raffleActivities = allActivities.filter(a => a.raffleId === raffleId);
  
  const ticketPurchases = raffleActivities.filter(a => a.type === 'ticket_purchase');
  const isFinalized = raffleActivities.some(a => a.type === 'raffle_finalized');
  
  const uniqueBuyers = new Set(ticketPurchases.map(a => a.buyer).filter(Boolean));
  const totalTickets = ticketPurchases.reduce((sum, a) => sum + (a.ticketCount || 0), 0);
  const totalVolume = ticketPurchases.reduce((sum, a) => sum + (a.totalPaid || 0), 0);

  const stats: RaffleStats = {
    totalTicketsSold: totalTickets,
    totalVolume,
    uniqueParticipants: uniqueBuyers.size,
    averageTicketsPerUser: uniqueBuyers.size > 0 ? totalTickets / uniqueBuyers.size : 0,
    totalRaffles: 1,
    activeRaffles: isFinalized ? 0 : 1,
    completedRaffles: isFinalized ? 1 : 0,
  };

  await cacheService.set(cacheKey, stats, 60); // Cache 1 minute
  
  return stats;
}
