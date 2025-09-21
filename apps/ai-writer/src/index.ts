import express from 'express';
import { createServer } from 'http';
import pino from 'pino';

const logger = pino({
  name: 'ai-writer',
  level: process.env.LOG_LEVEL || 'info'
});

const app = express();
const PORT = process.env.PORT || 8080;

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
      version: '/version'
    }
  });
});

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