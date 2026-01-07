# Raffle Backend API

Backend API dengan Redis caching untuk aplikasi raffle Movement Network.

## 🏗️ Architecture

```
User → React App → Backend API → Redis Cache → Movement GraphQL Indexer
```

## 📦 Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **Cache**: Redis (ioredis)
- **GraphQL Client**: Apollo Client
- **Deployment**: Railway / Render

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Setup Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
REDIS_URL=redis://default:password@your-redis-host:6379
MOVEMENT_INDEXER_URL=https://indexer.testnet.movementnetwork.xyz/v1/graphql
RAFFLE_CONTRACT_ADDRESS=0x139b57d91686291b2b07d827a84fdc6cf81a80d29a8228a941c3b11fc66c59cf
```

### 3. Run Development Server

```bash
npm run dev
```

Server akan berjalan di `http://localhost:3000`

### 4. Test API

```bash
# Health check
curl http://localhost:3000/health

# Get global activity
curl http://localhost:3000/api/raffle-activity/global?limit=20

# Get raffle-specific activity
curl http://localhost:3000/api/raffle-activity/0?limit=50
```

## 📡 API Endpoints

### GET `/api/raffle-activity/global`

Get global raffle activity (all raffles)

**Query Parameters**:
- `limit` (optional): Number of activities to return (default: 50)

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "type": "ticket_purchase",
      "buyer": "0x123...",
      "raffleId": 0,
      "ticketCount": 5,
      "totalPaid": 0.5,
      "timestamp": "2024-01-01T00:00:00Z",
      "transactionVersion": "12345",
      "blockHeight": 1000
    }
  ],
  "cached": false
}
```

### GET `/api/raffle-activity/:raffleId`

Get activity for specific raffle

**Parameters**:
- `raffleId`: Raffle ID (number)

**Query Parameters**:
- `limit` (optional): Number of activities to return (default: 50)

**Response**: Same as global endpoint

### GET `/api/raffle-activity/health`

Health check for API and Redis

**Response**:
```json
{
  "success": true,
  "redis": true,
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## 🔧 Configuration

### Cache TTL

Edit `.env`:
```env
CACHE_TTL_SHORT=30      # 30 seconds for activity feeds
CACHE_TTL_MEDIUM=300    # 5 minutes for leaderboards
CACHE_TTL_LONG=3600     # 1 hour for stats
```

### CORS

Edit `.env`:
```env
ALLOWED_ORIGINS=http://localhost:8080,https://your-frontend.com
```

## 🚢 Deployment

### Option 1: Railway (Recommended)

1. Push code to GitHub
2. Connect Railway to your repo
3. Add Redis addon in Railway
4. Set environment variables
5. Deploy!

**Cost**: ~$5-10/month

### Option 2: Render

1. Create new Web Service
2. Connect GitHub repo
3. Add Redis from Render marketplace
4. Set environment variables
5. Deploy!

**Cost**: ~$7-15/month

### Redis Options

**Free Tier**:
- Upstash (250MB, 10K commands/day)
- Redis Cloud (30MB)

**Paid**:
- Upstash Pro ($10/mo)
- Redis Cloud ($10-20/mo)
- Railway Redis ($5/mo)

## 📊 Monitoring

### Check Cache Hit Rate

```bash
# Redis CLI
redis-cli INFO stats | grep keyspace_hits
redis-cli INFO stats | grep keyspace_misses
```

### Check Memory Usage

```bash
redis-cli INFO memory | grep used_memory_human
```

## 🔄 Update Frontend

Update `src/services/movementIndexerService.ts`:

```typescript
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const movementIndexerService = {
  async getAllRaffleEvents(contractAddress: string, limit = 100) {
    const response = await fetch(`${API_BASE}/api/raffle-activity/global?limit=${limit}`);
    const json = await response.json();
    return json.data;
  }
};
```

Add to `.env`:
```env
VITE_API_URL=https://your-backend.railway.app
```

## 📈 Performance

**Without Cache**:
- Response time: 2-5 seconds
- Movement Indexer load: High

**With Cache (Redis)**:
- Response time: 50-200ms (10-100x faster!)
- Movement Indexer load: Low
- Cache hit rate: 80-95%

## 🐛 Troubleshooting

### Redis Connection Error

```bash
# Check Redis is running
redis-cli ping
# Should return: PONG
```

### CORS Error

Add your frontend URL to `ALLOWED_ORIGINS` in `.env`

### Slow Queries

Increase cache TTL in `.env`

## 📝 License

MIT
