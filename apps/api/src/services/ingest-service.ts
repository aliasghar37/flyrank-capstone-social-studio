import { extractArticle } from '../ingestion/extract.js';
import {
  deriveTitle,
  hashContent,
  MAX_CONTENT_CHARS,
  normalizeMarkdown,
} from '../ingestion/normalize.js';
import type { FetchOptions } from '../ingestion/url-fetcher.js';
import { fetchUrl } from '../ingestion/url-fetcher.js';
import { HttpError } from '../lib/http-error.js';
import type { PostRecord, PostsRepository } from '../repositories/posts.js';

export type IngestInput =
  | { kind: 'url'; url: string }
  | { kind: 'markdown'; markdown: string; title?: string; canonicalUrl?: string };

export function createIngestService(posts: PostsRepository, fetchOptions: FetchOptions = {}) {
  return {
    async ingest(
      ownerId: string,
      input: IngestInput,
    ): Promise<{ post: PostRecord; created: boolean }> {
      let raw: string;
      let title: string | null | undefined;
      let sourceUrl: string | null;

      if (input.kind === 'url') {
        const page = await fetchUrl(input.url, fetchOptions);
        const article = extractArticle(page.body, page.contentType);
        raw = article.markdown;
        title = article.title;
        sourceUrl = page.finalUrl;
      } else {
        raw = input.markdown;
        title = input.title;
        sourceUrl = input.canonicalUrl ?? null;
      }

      const content = normalizeMarkdown(raw);
      if (!content) {
        throw new HttpError(422, 'EMPTY_CONTENT', 'The post has no text content');
      }
      if (content.length > MAX_CONTENT_CHARS) {
        throw new HttpError(
          422,
          'CONTENT_TOO_LARGE',
          `The post is longer than ${MAX_CONTENT_CHARS} characters`,
        );
      }

      return posts.insertOrGetExisting({
        ownerId,
        sourceType: input.kind,
        sourceUrl,
        title: deriveTitle(content, title),
        contentMarkdown: content,
        contentHash: hashContent(content),
      });
    },
  };
}

export type IngestService = ReturnType<typeof createIngestService>;
