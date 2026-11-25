import type { Pool } from 'pg';

export interface PostRecord {
  id: string;
  ownerId: string;
  sourceType: 'url' | 'markdown';
  sourceUrl: string | null;
  title: string;
  contentMarkdown: string;
  contentHash: string;
  createdAt: Date;
}

export type PostSummary = Omit<PostRecord, 'contentMarkdown'> & { contentLength: number };

export interface NewPost {
  ownerId: string;
  sourceType: 'url' | 'markdown';
  sourceUrl: string | null;
  title: string;
  contentMarkdown: string;
  contentHash: string;
}

interface PostRow {
  id: string;
  owner_id: string;
  source_type: 'url' | 'markdown';
  source_url: string | null;
  title: string;
  content_markdown: string;
  content_hash: string;
  created_at: Date;
}

const COLUMNS =
  'id, owner_id, source_type, source_url, title, content_markdown, content_hash, created_at';

function toRecord(row: PostRow): PostRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    title: row.title,
    contentMarkdown: row.content_markdown,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}

export function createPostsRepository(db: Pool) {
  return {
    /** Inserts the post, or returns the existing one with the same content for this owner. */
    async insertOrGetExisting(post: NewPost): Promise<{ post: PostRecord; created: boolean }> {
      const inserted = await db.query<PostRow>(
        `INSERT INTO posts (owner_id, source_type, source_url, title, content_markdown, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (owner_id, content_hash) DO NOTHING
         RETURNING ${COLUMNS}`,
        [
          post.ownerId,
          post.sourceType,
          post.sourceUrl,
          post.title,
          post.contentMarkdown,
          post.contentHash,
        ],
      );
      if (inserted.rows[0]) return { post: toRecord(inserted.rows[0]), created: true };

      const existing = await db.query<PostRow>(
        `SELECT ${COLUMNS} FROM posts WHERE owner_id = $1 AND content_hash = $2`,
        [post.ownerId, post.contentHash],
      );
      return { post: toRecord(existing.rows[0]!), created: false };
    },

    async findById(ownerId: string, id: string): Promise<PostRecord | null> {
      const result = await db.query<PostRow>(
        `SELECT ${COLUMNS} FROM posts WHERE owner_id = $1 AND id = $2`,
        [ownerId, id],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : null;
    },

    async listByOwner(ownerId: string, limit: number): Promise<PostSummary[]> {
      const result = await db.query<PostRow & { content_length: number }>(
        `SELECT ${COLUMNS}, char_length(content_markdown) AS content_length
         FROM posts WHERE owner_id = $1
         ORDER BY created_at DESC, id
         LIMIT $2`,
        [ownerId, limit],
      );
      return result.rows.map((row) => {
        const { contentMarkdown: _content, ...summary } = toRecord(row);
        return { ...summary, contentLength: row.content_length };
      });
    },
  };
}

export type PostsRepository = ReturnType<typeof createPostsRepository>;
