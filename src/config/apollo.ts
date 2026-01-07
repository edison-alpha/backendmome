import { ApolloClient, InMemoryCache, HttpLink, gql } from '@apollo/client/core';
import fetch from 'cross-fetch';

const MOVEMENT_INDEXER_URL = process.env.MOVEMENT_INDEXER_URL || 
  'https://indexer.testnet.movementnetwork.xyz/v1/graphql';

// Create cache without deprecated options
const cache = new InMemoryCache({
  addTypename: false,
});

// Custom fetch with retry logic and proper headers
const fetchWithRetry = async (uri: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(uri as RequestInfo, {
        ...options,
        headers: {
          ...options?.headers,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          // Add user agent to avoid being blocked
          'User-Agent': 'MoME-Backend/1.0',
        },
      });
      
      // If rate limited (429) or forbidden (403), wait and retry
      if (response.status === 429 || response.status === 403) {
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
          console.log(`[Apollo] Rate limited (${response.status}), retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      return response;
    } catch (error) {
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`[Apollo] Request failed, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  
  // Final attempt without retry
  return fetch(uri as RequestInfo, options);
};

export const apolloClient = new ApolloClient({
  link: new HttpLink({
    uri: MOVEMENT_INDEXER_URL,
    fetch: fetchWithRetry,
  }),
  cache,
  defaultOptions: {
    watchQuery: {
      fetchPolicy: 'no-cache',
    },
    query: {
      fetchPolicy: 'no-cache',
      errorPolicy: 'all',
    },
  },
});

// GraphQL Queries - Filter for draw_v5 module only
export const GET_ALL_RAFFLE_EVENTS = gql`
  query GetAllRaffleEvents($contract_address: String!, $limit: Int!, $offset: Int!) {
    events(
      where: {
        account_address: { _eq: $contract_address }
        _and: [
          {
            _or: [
              { type: { _like: "%draw_v5::BuyTicketEvent%" } }
              { type: { _like: "%draw_v5::CreateRaffleEvent%" } }
              { type: { _like: "%draw_v5::FinalizeRaffleEvent%" } }
              { indexed_type: { _like: "%draw_v5::BuyTicketEvent%" } }
              { indexed_type: { _like: "%draw_v5::CreateRaffleEvent%" } }
              { indexed_type: { _like: "%draw_v5::FinalizeRaffleEvent%" } }
            ]
          }
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
      creation_number
      account_address
    }
  }
`;

export const GET_TRANSACTION_TIMESTAMPS = gql`
  query GetTransactionTimestamps($versions: [bigint!]!) {
    transactions(
      where: { version: { _in: $versions } }
    ) {
      version
      timestamp
      block_height
    }
  }
`;
