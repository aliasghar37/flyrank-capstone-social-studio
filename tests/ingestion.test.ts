import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractArticle } from '../apps/api/src/ingestion/extract.js';
import {
  deriveTitle,
  hashContent,
  normalizeMarkdown,
} from '../apps/api/src/ingestion/normalize.js';
import { isPublicAddress } from '../apps/api/src/ingestion/url-guard.js';
import { fetchUrl } from '../apps/api/src/ingestion/url-fetcher.js';

const ARTICLE_HTML = `<!doctype html><html><head><title>Durable queues | Blog</title></head><body>
<nav><a href="/">Home</a> <a href="/about">About</a></nav>
<article><h1>Why durable queues matter</h1>
<p><img src="/chart.png" alt="chart">In 2025 our team lost 14 scheduled posts when a single Redis node restarted. That was the day we stopped trusting memory.</p>
<p>We moved the job store into PostgreSQL and kept Redis only for wake-ups. Every slot is a row, and every row survives a restart.</p>
<p>Since then, worker restarts have caused zero missed or duplicate posts, and on-call has been quiet.</p>
</article><footer>Copyright 2026</footer><script>alert(1)</script></body></html>`;

describe('normalizeMarkdown', () => {
  it('unifies line endings, strips trailing spaces and extra blank lines', () => {
    expect(normalizeMarkdown('  # Title  \r\n\r\n\r\n\r\nBody text \t\r\n')).toBe(
      '# Title\n\nBody text',
    );
  });

  it('produces the same hash for the same content with different whitespace', () => {
    const a = hashContent(normalizeMarkdown('Hello\r\nworld  \n'));
    const b = hashContent(normalizeMarkdown('Hello\nworld'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('deriveTitle', () => {
  it('prefers the given title', () => {
    expect(deriveTitle('# Heading', '  My title ')).toBe('My title');
  });

  it('falls back to the first heading', () => {
    expect(deriveTitle('Intro line\n\n## The **real** heading')).toBe('The real heading');
  });

  it('falls back to a shortened first line', () => {
    const title = deriveTitle('word '.repeat(60));
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('blocks %s', (address) => expect(isPublicAddress(address)).toBe(false));

  it.each(['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111'])('allows %s', (address) =>
    expect(isPublicAddress(address)).toBe(true),
  );
});

describe('extractArticle', () => {
  it('keeps the article text and drops navigation, footer and scripts', () => {
    const article = extractArticle(ARTICLE_HTML, 'text/html');
    expect(article.markdown).toContain('lost 14 scheduled posts');
    expect(article.markdown).not.toContain('About');
    expect(article.markdown).not.toContain('Copyright');
    expect(article.markdown).not.toContain('alert');
    expect(article.markdown).not.toContain('chart.png');
    expect(article.title).toContain('Durable queues');
  });

  it('passes plain text through unchanged', () => {
    expect(extractArticle('# Hi\n\nThere', 'text/markdown')).toEqual({
      title: null,
      markdown: '# Hi\n\nThere',
    });
  });

  it('rejects a page with no article text', () => {
    expect(() => extractArticle('<html><body></body></html>', 'text/html')).toThrow(/article text/);
  });
});

describe('fetchUrl', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      switch (req.url) {
        case '/article':
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(ARTICLE_HTML);
          break;
        case '/redirect':
          res.writeHead(302, { location: '/article' }).end();
          break;
        case '/loop':
          res.writeHead(302, { location: '/loop' }).end();
          break;
        case '/image':
          res.writeHead(200, { 'content-type': 'image/png' }).end('png');
          break;
        case '/big':
          res.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(5000));
          break;
        case '/slow':
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.write('start');
          break;
        default:
          res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const local = { allowPrivateHosts: true };

  it('refuses local addresses by default', async () => {
    await expect(fetchUrl(`${base}/article`)).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
    await expect(fetchUrl('http://localhost/')).rejects.toMatchObject({ code: 'URL_NOT_ALLOWED' });
  });

  it('refuses non-http schemes', async () => {
    await expect(fetchUrl('file:///etc/passwd')).rejects.toMatchObject({ code: 'INVALID_URL' });
  });

  it('fetches a page and follows redirects', async () => {
    const page = await fetchUrl(`${base}/redirect`, local);
    expect(page.finalUrl).toBe(`${base}/article`);
    expect(page.contentType).toBe('text/html');
    expect(page.body).toContain('Why durable queues matter');
  });

  it('stops after too many redirects', async () => {
    await expect(fetchUrl(`${base}/loop`, local)).rejects.toThrow(/Too many redirects/);
  });

  it('rejects unsupported content types', async () => {
    await expect(fetchUrl(`${base}/image`, local)).rejects.toMatchObject({
      code: 'UNSUPPORTED_CONTENT_TYPE',
    });
  });

  it('rejects pages over the size limit', async () => {
    await expect(fetchUrl(`${base}/big`, { ...local, maxBytes: 1000 })).rejects.toMatchObject({
      code: 'CONTENT_TOO_LARGE',
    });
  });

  it('times out on a slow page', async () => {
    await expect(fetchUrl(`${base}/slow`, { ...local, timeoutMs: 300 })).rejects.toMatchObject({
      code: 'URL_FETCH_TIMEOUT',
    });
  });

  it('reports HTTP errors', async () => {
    await expect(fetchUrl(`${base}/missing`, local)).rejects.toMatchObject({
      code: 'URL_FETCH_FAILED',
    });
  });
});
