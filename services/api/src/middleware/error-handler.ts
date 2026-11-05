import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';
import { config } from '../config/env.js';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || err.status || 500;
  const correlationId = (req.headers['x-correlation-id'] as string) || 'unknown';

  logger.error(
    {
      err: {
        message: err.message,
        stack: config.isProduction ? undefined : err.stack,
        code: err.code,
      },
      correlationId,
      url: req.originalUrl,
      method: req.method,
    },
    'Unhandled request error'
  );

  // Redact any potential credentials in error messages
  let clientMessage = err.message || 'An unexpected internal server error occurred.';
  clientMessage = clientMessage.replace(/postgresql:\/\/[^@]+@/gi, 'postgresql://[REDACTED]@');

  // In production, mask generic 500 errors to prevent information disclosure
  if (config.isProduction && statusCode === 500) {
    clientMessage = 'An unexpected internal server error occurred. Please contact support with correlation ID.';
  }

  res.status(statusCode).json({
    error: err.name || 'InternalServerError',
    message: clientMessage,
    statusCode,
    correlationId,
  });
}

