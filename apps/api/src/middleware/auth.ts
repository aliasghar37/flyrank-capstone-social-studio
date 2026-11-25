import type { RequestHandler, Response } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../lib/http-error.js';

export const DEV_OWNER_ID = 'dev_user';

export const requireOwner: RequestHandler = (_req, res, next) => {
  if (env.AUTH_MODE !== 'dev') {
    next(new HttpError(501, 'AUTH_NOT_CONFIGURED', 'Only AUTH_MODE=dev is supported'));
    return;
  }
  res.locals.ownerId = DEV_OWNER_ID;
  next();
};

export function ownerId(res: Response): string {
  const id: unknown = res.locals.ownerId;
  if (typeof id !== 'string') throw new Error('requireOwner middleware is missing');
  return id;
}
