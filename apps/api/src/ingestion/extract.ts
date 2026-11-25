import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { HttpError } from '../lib/http-error.js';

export interface ExtractedArticle {
  title: string | null;
  markdown: string;
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.remove(['script', 'style', 'noscript', 'iframe', 'form']);
turndown.addRule('dropMedia', {
  filter: ['img', 'picture', 'svg', 'video', 'audio'],
  replacement: () => '',
});
turndown.addRule('dropEmptyLinks', {
  filter: (node) => node.nodeName === 'A' && !node.textContent?.trim(),
  replacement: () => '',
});

export function extractArticle(body: string, contentType: string): ExtractedArticle {
  if (contentType === 'text/plain' || contentType === 'text/markdown') {
    return { title: null, markdown: body };
  }

  const { document } = parseHTML(body);
  const pageTitle = document.querySelector('title')?.textContent?.trim() || null;
  const article = new Readability(
    document as unknown as ConstructorParameters<typeof Readability>[0],
  ).parse();

  const markdown = article?.content ? turndown.turndown(article.content).trim() : '';
  if (!markdown) {
    throw new HttpError(422, 'NO_ARTICLE_CONTENT', 'Could not find article text on that page');
  }
  return { title: article?.title?.trim() || pageTitle, markdown };
}
