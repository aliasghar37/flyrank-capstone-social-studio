import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { HttpError } from '../lib/http-error.js';
import { isPublicAddress } from './url-guard.js';

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Tests only: lets the fetcher reach a local server. */
  allowPrivateHosts?: boolean;
}

export interface FetchedDocument {
  finalUrl: string;
  contentType: string;
  body: string;
}

const ACCEPTED_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown'];

export async function fetchUrl(
  rawUrl: string,
  options: FetchOptions = {},
): Promise<FetchedDocument> {
  const settings = {
    timeoutMs: options.timeoutMs ?? 10_000,
    maxBytes: options.maxBytes ?? 2 * 1024 * 1024,
    maxRedirects: options.maxRedirects ?? 3,
    allowPrivateHosts: options.allowPrivateHosts ?? false,
  };
  const deadline = Date.now() + settings.timeoutMs;

  let url = parseUrl(rawUrl);
  for (let redirects = 0; ; redirects++) {
    const response = await request(url, settings, deadline);
    const status = response.statusCode ?? 0;

    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      if (redirects >= settings.maxRedirects) {
        throw new HttpError(502, 'URL_FETCH_FAILED', 'Too many redirects');
      }
      url = parseUrl(new URL(response.headers.location, url).toString());
      continue;
    }

    if (status < 200 || status >= 300) {
      response.resume();
      throw new HttpError(502, 'URL_FETCH_FAILED', `The page returned HTTP ${status}`);
    }

    const contentType = (response.headers['content-type'] ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase();
    if (!ACCEPTED_TYPES.includes(contentType)) {
      response.resume();
      throw new HttpError(
        422,
        'UNSUPPORTED_CONTENT_TYPE',
        `Expected an HTML or text page, got "${contentType || 'unknown'}"`,
      );
    }

    const body = await readBody(response, settings.maxBytes);
    return { finalUrl: url.toString(), contentType, body };
  }
}

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'INVALID_URL', 'The URL is not valid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'INVALID_URL', 'Only http and https URLs are supported');
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'INVALID_URL', 'URLs with credentials are not supported');
  }
  return url;
}

function request(
  url: URL,
  settings: { allowPrivateHosts: boolean },
  deadline: number,
): Promise<IncomingMessage> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !settings.allowPrivateHosts && !isPublicAddress(host)) {
    return Promise.reject(notAllowed());
  }

  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(timeout());
      return;
    }

    const req = client.get(url, {
      headers: { 'user-agent': 'SocialMediaStudio/0.1', accept: ACCEPTED_TYPES.join(', ') },
      lookup: (hostname, opts, callback) => {
        dnsLookup(hostname, { all: true, family: opts.family }, (error, addresses) => {
          if (error) return callback(error, '', 0);
          const list = addresses as LookupAddress[];
          if (!settings.allowPrivateHosts && list.some((a) => !isPublicAddress(a.address))) {
            return callback(notAllowed(), '', 0);
          }
          if (opts.all) return (callback as (e: null, a: LookupAddress[]) => void)(null, list);
          callback(null, list[0]!.address, list[0]!.family);
        });
      },
    });

    let response: IncomingMessage | undefined;
    const timer = setTimeout(() => (response ?? req).destroy(timeout()), remaining);
    req.on('response', (res) => {
      response = res;
      res.on('close', () => clearTimeout(timer));
      resolve(res);
    });
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(
        error instanceof HttpError
          ? error
          : new HttpError(502, 'URL_FETCH_FAILED', `Could not fetch the URL: ${describe(error)}`),
      );
    });
  });
}

function readBody(response: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        response.destroy();
        reject(
          new HttpError(422, 'CONTENT_TOO_LARGE', `The page is larger than ${maxBytes} bytes`),
        );
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    response.on('error', (error) =>
      reject(
        error instanceof HttpError
          ? error
          : new HttpError(502, 'URL_FETCH_FAILED', `Could not read the page: ${error.message}`),
      ),
    );
  });
}

function notAllowed(): HttpError {
  return new HttpError(
    400,
    'URL_NOT_ALLOWED',
    'URLs that point to private or local addresses are not allowed',
  );
}

function timeout(): HttpError {
  return new HttpError(504, 'URL_FETCH_TIMEOUT', 'The page took too long to respond');
}

function describe(error: Error & { code?: string }): string {
  return error.message || error.code || 'connection failed';
}
