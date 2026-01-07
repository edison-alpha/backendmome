import { apolloClient, GET_ALL_RAFFLE_EVENTS, GET_TRANSACTION_TIMESTAMPS } from '../config/apollo.js';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { cacheService } from '../config/redis.js';

const RAFFLE_CONTRACT_ADDRESS = process.env.RAFFLE_CONTRACT_ADDRESS || 
  '0x139b57d91686291b2b07d827a84fdc6cf81a80d29a8228a941c3b11fc66c59cf';

// Using draw_v5 with security enhancements
const RAFFLE_MODULE = 'draw_v5';
const RAFFLE_ADMIN_ADDRESS = RAFFLE_CONTRACT_ADDRESS;

// Initialize Aptos client for Movement
const aptosConfig = new AptosConfig({
  network: Network.CUSTOM,
  fullnode: process.env.MOVEMENT_RPC_URL || 'https://aptos.testnet.porto.movementlabs.xyz/v1',
});
const aptos = new Aptos(aptosConfig);

export interface RaffleMetadata {
  id: number;
  title: string;
  description: string;
  imageUrl: string;
  ticketPrice: number;
  totalTickets: number;
  ticketsSold: number;
  prizeAmount: number;
  creator: string;
  status: number;
}

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
  // Enriched raffle data (optional)
  raffle?: RaffleMetadata;
}

/**
 * Parse event data from indexer
 */
function parseEventData(event: any): RaffleActivity | null {
  try {
    let eventData = event.data;
    if (typeof eventData === 'string') {
      eventData = JSON.parse(eventData);
    }

    const eventType = event.type || event.indexed_type;

    // BuyTicketEvent
    if (eventType?.includes('BuyTicketEvent')) {
      return {
        type: 'ticket_purchase',
        buyer: String(eventData.buyer || eventData.user || ''),
        raffleId: Number(eventData.raffle_id || eventData.raffleId || 0),
        ticketCount: Number(eventData.ticket_count || eventData.ticketCount || 0),
        totalPaid: Number(eventData.total_paid || eventData.totalPaid || 0) / 100000000,
        timestamp: '',
        transactionVersion: String(event.transaction_version),
        blockHeight: Number(event.transaction_block_height),
      };
    }

    // CreateRaffleEvent
    // Note: CreateRaffleEvent doesn't have prize_amount field
    // Available fields: raffle_id, creator, title, ticket_price, total_tickets, target_amount, end_time
    if (eventType?.includes('CreateRaffleEvent') || eventType?.includes('RaffleCreatedEvent')) {
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
        timestamp: '',
        transactionVersion: String(event.transaction_version),
        blockHeight: Number(event.transaction_block_height),
      };
    }

    // FinalizeRaffleEvent
    if (eventType?.includes('FinalizeRaffleEvent') || eventType?.includes('RaffleFinalizedEvent')) {
      return {
        type: 'raffle_finalized',
        winner: String(eventData.winner || eventData.winner_address || ''),
        raffleId: Number(eventData.raffle_id || eventData.raffleId || 0),
        prizeAmount: Number(eventData.prize_amount || eventData.prizeAmount || eventData.amount || 0) / 100000000,
        timestamp: '',
        transactionVersion: String(event.transaction_version),
        blockHeight: Number(event.transaction_block_height),
      };
    }

    return null;
  } catch (error) {
    console.error('Error parsing event data:', error);
    return null;
  }
}

/**
 * Pad address to 64 characters (excluding 0x) for Aptos/Movement
 */
const padAddress = (address: string): string => {
  let cleanAddress = address.startsWith('0x') ? address.slice(2) : address;
  return '0x' + cleanAddress.padStart(64, '0');
};

/**
 * Convert octas to MOVE
 */
const octasToMove = (octas: number | string | any): number => {
  const octasNum = typeof octas === 'string' ? parseInt(octas) : Number(octas);
  return Math.round(octasNum) / 100000000;
};

/**
 * Fetch single raffle metadata from blockchain
 */
async function fetchRaffleMetadata(raffleId: number): Promise<RaffleMetadata | null> {
  try {
    const paddedStore = padAddress(RAFFLE_ADMIN_ADDRESS);
    
    const result = await aptos.view({
      payload: {
        function: `${RAFFLE_CONTRACT_ADDRESS}::${RAFFLE_MODULE}::get_raffle`,
        typeArguments: [],
        functionArguments: [paddedStore, raffleId],
      },
    });

    const [
      id, creator, title, description, imageUrl,
      ticketPrice, totalTickets, ticketsSold, _targetAmount,
      prizeAmount, _endTime, status, _winner, _prizePool, _isClaimed, _assetInEscrow,
    ] = result;

    return {
      id: Number(id),
      title: String(title),
      description: String(description),
      imageUrl: String(imageUrl),
      ticketPrice: octasToMove(ticketPrice),
      totalTickets: Number(totalTickets),
      ticketsSold: Number(ticketsSold),
      prizeAmount: octasToMove(prizeAmount),
      creator: String(creator),
      status: Number(status),
    };
  } catch (error) {
    console.error(`Error fetching raffle ${raffleId}:`, error);
    return null;
  }
}

/**
 * Batch fetch raffle metadata with caching
 * Cache raffle metadata for 5 minutes (metadata rarely changes)
 */
async function batchFetchRaffleMetadata(raffleIds: number[]): Promise<Map<number, RaffleMetadata>> {
  const result = new Map<number, RaffleMetadata>();
  const uncachedIds: number[] = [];

  // Check cache first
  for (const id of raffleIds) {
    const cacheKey = `raffle:metadata:${id}`;
    const cached = await cacheService.get<RaffleMetadata>(cacheKey);
    if (cached) {
      result.set(id, cached);
    } else {
      uncachedIds.push(id);
    }
  }

  // Fetch uncached raffles in parallel (max 10 concurrent)
  if (uncachedIds.length > 0) {
    console.log(`[batchFetchRaffleMetadata] Fetching ${uncachedIds.length} uncached raffles`);
    
    const batchSize = 10;
    for (let i = 0; i < uncachedIds.length; i += batchSize) {
      const batch = uncachedIds.slice(i, i + batchSize);
      const promises = batch.map(id => fetchRaffleMetadata(id));
      const results = await Promise.all(promises);
      
      for (let j = 0; j < batch.length; j++) {
        const metadata = results[j];
        if (metadata) {
          result.set(batch[j], metadata);
          // Cache for 5 minutes
          await cacheService.set(`raffle:metadata:${batch[j]}`, metadata, 300);
        }
      }
    }
  }

  return result;
}

/**
 * Enrich activities with timestamps and raffle metadata
 */
async function enrichActivities(
  activities: RaffleActivity[], 
  includeRaffleData: boolean = true
): Promise<RaffleActivity[]> {
  if (activities.length === 0) return [];

  // Add timestamps
  let enriched = activities.map(activity => ({
    ...activity,
    timestamp: activity.timestamp || new Date().toISOString(),
  }));

  // Optionally enrich with raffle metadata
  if (includeRaffleData) {
    const uniqueRaffleIds = [...new Set(activities.map(a => a.raffleId))];
    const raffleMetadataMap = await batchFetchRaffleMetadata(uniqueRaffleIds);
    
    enriched = enriched.map(activity => ({
      ...activity,
      raffle: raffleMetadataMap.get(activity.raffleId) || undefined,
    }));
  }

  return enriched;
}

/**
 * Get global raffle activity with enriched raffle data
 */
export async function getGlobalActivity(limit: number = 50, includeRaffleData: boolean = true): Promise<RaffleActivity[]> {
  try {
    console.log(`[getGlobalActivity] Fetching ${limit} activities...`);
    
    const { data, errors } = await apolloClient.query({
      query: GET_ALL_RAFFLE_EVENTS,
      variables: {
        contract_address: RAFFLE_CONTRACT_ADDRESS,
        limit: limit * 2,
        offset: 0,
      },
    });

    if (errors && errors.length > 0) {
      console.error('[getGlobalActivity] GraphQL errors:', errors);
    }

    if (!data || !data.events) {
      console.warn('[getGlobalActivity] No events data returned');
      return [];
    }

    console.log(`[getGlobalActivity] Received ${data.events.length} events`);

    const activities = data.events
      .map(parseEventData)
      .filter((activity: RaffleActivity | null): activity is RaffleActivity => activity !== null);

    const enriched = await enrichActivities(activities.slice(0, limit), includeRaffleData);
    return enriched;
  } catch (error: any) {
    console.error('[getGlobalActivity] Error:', {
      message: error.message,
      networkError: error.networkError?.statusCode,
    });
    // Return empty array instead of throwing to prevent API failure
    return [];
  }
}

/**
 * Get raffle-specific activity (no need for raffle metadata - already on detail page)
 */
export async function getRaffleActivity(raffleId: number, limit: number = 50): Promise<RaffleActivity[]> {
  try {
    console.log(`[getRaffleActivity] Fetching activities for raffle ${raffleId}...`);
    
    const { data, errors } = await apolloClient.query({
      query: GET_ALL_RAFFLE_EVENTS,
      variables: {
        contract_address: RAFFLE_CONTRACT_ADDRESS,
        limit: 500,
        offset: 0,
      },
    });

    if (errors && errors.length > 0) {
      console.error('[getRaffleActivity] GraphQL errors:', errors);
    }

    if (!data || !data.events) {
      console.warn('[getRaffleActivity] No events data returned');
      return [];
    }

    const allActivities = data.events
      .map(parseEventData)
      .filter((activity: RaffleActivity | null): activity is RaffleActivity => activity !== null);

    const filtered = allActivities
      .filter((activity: RaffleActivity) => activity.raffleId === raffleId)
      .slice(0, limit);

    // No need to include raffle data for raffle-specific activity
    return await enrichActivities(filtered, false);
  } catch (error: any) {
    console.error('[getRaffleActivity] Error:', {
      message: error.message,
      networkError: error.networkError?.statusCode,
    });
    // Return empty array instead of throwing
    return [];
  }
}
