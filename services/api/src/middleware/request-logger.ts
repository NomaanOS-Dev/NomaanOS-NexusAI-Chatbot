import { Request, Response, NextFunction } from 'express';
import { pinoHttp } from 'pino-http';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config/logger.js';

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req) => (req.headers['x-correlation-id'] as string) || uuidv4(),
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
  customErrorMessage: (req, _res, err) => `${req.method} ${req.url} failed: ${err.message}`,
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      headers: {
        host: req.headers.host,
        'user-agent': req.headers['user-agent'],
        'x-correlation-id': req.id,
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
});

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  req.headers['x-correlation-id'] = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);
  next();
}

