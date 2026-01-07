// Load environment variables FIRST
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import apiRoutes from './routes/apiRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import socialRoutes from './routes/socialRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(compression());

// Parse JSON for all routes except upload (which needs raw body)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/upload/image')) {
    // Skip JSON parsing for upload routes - they handle raw body
    next();
  } else {
    express.json()(req, res, next);
  }
});

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8080'];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// API Routes
app.use('/api', apiRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/upload', uploadRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Raffle Backend API',
    version: '2.1.0',
    status: 'running',
    endpoints: {
      // Activity
      globalActivity: 'GET /api/activity/global?limit=50',
      raffleActivity: 'GET /api/activity/raffle/:raffleId?limit=50',
      userActivity: 'GET /api/activity/user/:address?limit=50',
      // Leaderboard
      globalLeaderboard: 'GET /api/leaderboard/global?limit=100',
      raffleLeaderboard: 'GET /api/leaderboard/raffle/:raffleId?limit=100',
      // Stats
      platformStats: 'GET /api/stats/platform',
      raffleStats: 'GET /api/stats/raffle/:raffleId',
      // Notifications
      userNotifications: 'GET /api/notifications/:userAddress',
      unreadCount: 'GET /api/notifications/:userAddress/unread-count',
      markAsRead: 'PUT /api/notifications/:notificationId/read',
      markAllAsRead: 'PUT /api/notifications/:userAddress/read-all',
      userTickets: 'GET /api/notifications/:userAddress/tickets',
      // Social Features
      comments: 'GET /api/social/raffles/:raffleId/comments',
      addComment: 'POST /api/social/raffles/:raffleId/comments',
      editComment: 'PUT /api/social/comments/:commentId',
      deleteComment: 'DELETE /api/social/comments/:commentId',
      likeComment: 'POST /api/social/comments/:commentId/like',
      watchlist: 'GET /api/social/watchlist/:userAddress',
      addToWatchlist: 'POST /api/social/watchlist',
      removeFromWatchlist: 'DELETE /api/social/watchlist/:userAddress/:raffleId',
      trackView: 'POST /api/social/raffles/:raffleId/view',
      engagement: 'GET /api/social/raffles/:raffleId/engagement',
      popularRaffles: 'GET /api/social/popular',
      // Health
      health: 'GET /api/health',
    },
  });
});

// Health check (legacy)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ success: false, error: err.message || 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`
🚀 Raffle Backend API v2.0 is running!
📡 Port: ${PORT}
🌍 Environment: ${process.env.NODE_ENV || 'development'}
🔗 URL: http://localhost:${PORT}

📋 Available Endpoints:
   Activity:
   - GET /api/activity/global
   - GET /api/activity/raffle/:raffleId
   - GET /api/activity/user/:address
   
   Leaderboard:
   - GET /api/leaderboard/global
   - GET /api/leaderboard/raffle/:raffleId
   
   Stats:
   - GET /api/stats/platform
   - GET /api/stats/raffle/:raffleId
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  process.exit(0);
});
