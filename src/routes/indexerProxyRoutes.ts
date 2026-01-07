import express from 'express';
import fetch from 'cross-fetch';

const router = express.Router();

const MOVEMENT_INDEXER_URL = process.env.MOVEMENT_INDEXER_URL || 
  'https://hasura.testnet.movementnetwork.xyz/v1/graphql';

/**
 * Proxy GraphQL requests to Movement Indexer
 * This avoids CORS issues when calling from the frontend
 */
router.post('/graphql', async (req, res) => {
  try {
    const response = await fetch(MOVEMENT_INDEXER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'MoME-Backend/1.0',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    
    // Forward the status code from the indexer
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[Indexer Proxy] Error:', error);
    res.status(500).json({ 
      errors: [{ message: 'Failed to proxy request to Movement Indexer' }] 
    });
  }
});

export default router;
