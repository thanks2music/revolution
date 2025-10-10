import express from 'express';
import { createServer } from 'http';
import pino from 'pino';
import testWordPressRoute from './routes/test-wordpress.route.js';
import testSpecificRoute from './routes/test-specific.route.js';
import testExtendedPostRoute from './routes/test-extended-post.route.js';
import testTypedRoute from './routes/test-typed.route.js';

const logger = pino({
  name: 'ai-writer',
  level: process.env.LOG_LEVEL || 'info'
});

const app = express();
const PORT = process.env.PORT || 7777;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: '@revolution/ai-writer',
    timestamp: new Date().toISOString(),
    version: '0.0.1'
  });
});

// Basic info endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'AI Writer Service',
    service: '@revolution/ai-writer',
    endpoints: {
      health: '/health',
      version: '/version',
      test: {
        connection: '/test/wordpress/connection',
        createPost: '/test/wordpress/create-post',
        createTestPost: '/test/wordpress/create-test-post',
        getPosts: '/test/wordpress/posts',
        createSpecificPost: '/test/create-specific-post',
        createExtendedPost: '/test/create-extended-post',
        createPostNoAuth: '/test/create-post-no-auth',
        authStatus: '/test/auth-status'
      },
      typed: {
        connection: '/test/typed/connection',
        createPost: '/test/typed/create-post',
        createPostExtended: '/test/typed/create-post-extended',
        getCategoriesTags: '/test/typed/categories-tags'
      }
    }
  });
});

// Mount test routes
app.use(testWordPressRoute);
app.use(testSpecificRoute);
app.use(testExtendedPostRoute);
app.use(testTypedRoute);

// Version endpoint
app.get('/version', (req, res) => {
  res.json({
    version: '0.0.1',
    name: '@revolution/ai-writer',
    node: process.version,
    environment: process.env.NODE_ENV || 'development'
  });
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err, req: { method: req.method, url: req.url } }, 'Request error');
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler (Express v5 compatible)
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

const server = createServer(app);

server.listen(PORT, () => {
  logger.info(`🚀 AI Writer service listening on port ${PORT}`);
  logger.info(`📍 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
    process.exit(0);
  });
});

export default app;