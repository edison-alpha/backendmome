import { Router, Request, Response } from 'express';
import axios from 'axios';

const router = Router();

// Pinata config from environment (SECURE - not exposed to frontend)
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;
const PINATA_GATEWAY = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs';
const PINATA_API_URL = 'https://api.pinata.cloud';

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Allowed MIME types
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/**
 * Check if Pinata is configured
 */
const isPinataConfigured = (): boolean => {
  return !!(PINATA_JWT || (PINATA_API_KEY && PINATA_SECRET_KEY));
};

/**
 * Get Pinata auth headers
 */
const getPinataHeaders = (): Record<string, string> => {
  if (PINATA_JWT) {
    return { 'Authorization': `Bearer ${PINATA_JWT}` };
  }
  return {
    'pinata_api_key': PINATA_API_KEY!,
    'pinata_secret_api_key': PINATA_SECRET_KEY!,
  };
};

/**
 * GET /api/upload/status
 * Check if upload service is available
 */
router.get('/status', (req: Request, res: Response) => {
  res.json({
    success: true,
    configured: isPinataConfigured(),
    maxFileSize: MAX_FILE_SIZE,
    allowedTypes: ALLOWED_TYPES,
  });
});

/**
 * POST /api/upload/image
 * Upload image to Pinata IPFS
 * Expects multipart/form-data with 'file' field
 * 
 * This endpoint acts as a proxy to Pinata, keeping API keys secure on backend
 */
router.post('/image', async (req: Request, res: Response) => {
  try {
    // Check if Pinata is configured
    if (!isPinataConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Upload service not configured',
      });
    }

    const contentType = req.headers['content-type'] || '';
    
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({
        success: false,
        error: 'Content-Type must be multipart/form-data',
      });
    }

    // Collect raw body chunks
    const chunks: Buffer[] = [];
    
    await new Promise<void>((resolve, reject) => {
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        // Check size limit
        const totalSize = chunks.reduce((acc, c) => acc + c.length, 0);
        if (totalSize > MAX_FILE_SIZE) {
          reject(new Error('File too large'));
        }
      });
      req.on('end', resolve);
      req.on('error', reject);
    });

    const body = Buffer.concat(chunks);

    // Forward to Pinata
    const response = await axios.post(
      `${PINATA_API_URL}/pinning/pinFileToIPFS`,
      body,
      {
        headers: {
          ...getPinataHeaders(),
          'Content-Type': contentType,
          'Content-Length': body.length.toString(),
        },
        maxBodyLength: MAX_FILE_SIZE,
        maxContentLength: MAX_FILE_SIZE,
      }
    );

    const ipfsHash = response.data.IpfsHash;
    const ipfsUrl = `${PINATA_GATEWAY}/${ipfsHash}`;

    console.log(`✅ Image uploaded to IPFS: ${ipfsHash}`);

    res.json({
      success: true,
      data: {
        ipfsHash,
        ipfsUrl,
        pinSize: response.data.PinSize,
        timestamp: response.data.Timestamp,
      },
    });
  } catch (error: any) {
    console.error('Upload error:', error.response?.data || error.message);

    if (error.message === 'File too large') {
      return res.status(413).json({
        success: false,
        error: 'File too large. Maximum size is 10MB.',
      });
    }

    if (error.response?.status === 401) {
      return res.status(500).json({
        success: false,
        error: 'Upload service authentication failed',
      });
    }

    if (error.response?.status === 413) {
      return res.status(413).json({
        success: false,
        error: 'File too large',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to upload file',
    });
  }
});

/**
 * POST /api/upload/json
 * Upload JSON metadata to Pinata IPFS
 */
router.post('/json', async (req: Request, res: Response) => {
  try {
    if (!isPinataConfigured()) {
      return res.status(503).json({
        success: false,
        error: 'Upload service not configured',
      });
    }

    const { content, name } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Content is required',
      });
    }

    const response = await axios.post(
      `${PINATA_API_URL}/pinning/pinJSONToIPFS`,
      {
        pinataContent: content,
        pinataMetadata: {
          name: name || `metadata-${Date.now()}`,
        },
      },
      {
        headers: {
          ...getPinataHeaders(),
          'Content-Type': 'application/json',
        },
      }
    );

    const ipfsHash = response.data.IpfsHash;
    const ipfsUrl = `${PINATA_GATEWAY}/${ipfsHash}`;

    console.log(`✅ JSON uploaded to IPFS: ${ipfsHash}`);

    res.json({
      success: true,
      data: {
        ipfsHash,
        ipfsUrl,
      },
    });
  } catch (error: any) {
    console.error('JSON upload error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to upload metadata',
    });
  }
});

export default router;
