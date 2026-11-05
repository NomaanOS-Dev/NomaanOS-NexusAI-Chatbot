import { createApp } from './app.js';
import { config, getSanitizedConfig } from './config/env.js';
import { logger } from './config/logger.js';
import { pool } from './database/pool.js';

const app = createApp();

// When API_HOST is '0.0.0.0' or unspecified, listen without the IPv4-only host binding
// so Node.js binds to dual-stack (IPv4 and IPv6 [::]).
// This ensures modern browsers resolving 'localhost' to ::1 or 127.0.0.1 can both connect cleanly.
const server = (!config.host || config.host === '0.0.0.0')
  ? app.listen(config.port, () => {
      logger.info(
        {
          port: config.port,
          environment: config.nodeEnv,
          sanitizedConfig: getSanitizedConfig(),
        },
        `Nexus AI API Server started successfully on dual-stack port ${config.port} (http://localhost:${config.port})`
      );
    })
  : app.listen(config.port, config.host, () => {
      logger.info(
        {
          port: config.port,
          host: config.host,
          environment: config.nodeEnv,
          sanitizedConfig: getSanitizedConfig(),
        },
        `Nexus AI API Server started successfully at http://${config.host}:${config.port}`
      );
    });

// Graceful shutdown handling
function gracefulShutdown(signal: string) {
  logger.info({ signal }, `Received ${signal}, initiating graceful shutdown...`);
  server.close(async () => {
    logger.info('HTTP server closed, closing database connection pool...');
    try {
      await pool.end();
      logger.info('Database pool closed cleanly. Process terminating.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during database pool shutdown');
      process.exit(1);
    }
  });

  // Force close after 10s if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing process exit.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

