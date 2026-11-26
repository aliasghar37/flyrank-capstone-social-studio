import { extractHashtags, PROFILES, validateVariant } from '@studio/shared';
import type { Platform, Violation } from '@studio/shared';
import { generateTemplate } from '../generation/template.js';
import { HttpError } from '../lib/http-error.js';
import type { PostRecord, PostsRepository } from '../repositories/posts.js';
import type { VariantRecord, VariantsRepository } from '../repositories/variants.js';
import { LiveVariantExistsError } from '../repositories/variants.js';

export interface GenerationResult {
  variants: VariantRecord[];
  blocked: { platform: Platform; violations: Violation[] }[];
  skipped: { platform: Platform; reason: string }[];
}

export function createGenerationService(deps: {
  posts: PostsRepository;
  variants: VariantsRepository;
  enabledPlatforms: readonly Platform[];
}) {
  async function loadPost(ownerId: string, postId: string): Promise<PostRecord> {
    const post = await deps.posts.findById(ownerId, postId);
    if (!post) throw new HttpError(404, 'POST_NOT_FOUND', 'Post not found');
    return post;
  }

  function checkPlatform(platform: string): Platform {
    if (!deps.enabledPlatforms.includes(platform as Platform)) {
      throw new HttpError(400, 'PLATFORM_NOT_ENABLED', `Platform "${platform}" is not enabled`, [
        { enabled: deps.enabledPlatforms },
      ]);
    }
    return platform as Platform;
  }

  return {
    /** Generates one variant per platform from the stored post only. */
    async generate(
      ownerId: string,
      postId: string,
      platforms?: string[],
    ): Promise<GenerationResult> {
      const post = await loadPost(ownerId, postId);
      const targets = platforms
        ? [...new Set(platforms)].map(checkPlatform)
        : deps.enabledPlatforms;
      const existing = await deps.variants.listByPost(ownerId, postId);
      const result: GenerationResult = { variants: [], blocked: [], skipped: [] };

      for (const platform of targets) {
        const live = existing.find((v) => v.platform === platform && v.status !== 'rejected');
        if (live) {
          result.skipped.push({ platform, reason: `Live variant ${live.id} already exists` });
          continue;
        }

        const started = Date.now();
        const profile = PROFILES[platform];
        const body = generateTemplate(post, profile);
        const validation = validateVariant(body, profile, { sourceUrl: post.sourceUrl });
        const run = {
          postId,
          ownerId,
          platform,
          engine: 'template',
          latencyMs: Date.now() - started,
        };

        if (!validation.passed) {
          await deps.variants.logBlocked(run, validation.violations);
          result.blocked.push({ platform, violations: validation.violations });
          continue;
        }

        try {
          const variant = await deps.variants.storeGenerated(
            {
              postId,
              ownerId,
              platform,
              body,
              hashtags: extractHashtags(body),
              origin: 'template',
              validationReport: validation,
            },
            run,
          );
          result.variants.push(variant);
        } catch (error) {
          if (!(error instanceof LiveVariantExistsError)) throw error;
          result.skipped.push({ platform, reason: 'Live variant already exists' });
        }
      }

      return result;
    },

    /** Stores a hand-written variant only if it passes the platform's rules. */
    async createManual(
      ownerId: string,
      postId: string,
      input: { platform: string; body: string },
    ): Promise<VariantRecord> {
      const post = await loadPost(ownerId, postId);
      const platform = checkPlatform(input.platform);
      const validation = validateVariant(input.body, PROFILES[platform], {
        sourceUrl: post.sourceUrl,
      });

      if (!validation.passed) {
        throw new HttpError(
          422,
          'CONSTRAINT_VIOLATION',
          `Variant violates ${validation.violations.length} rule(s) for platform '${platform}': ${validation.violations
            .map((v) => v.rule)
            .join(', ')}`,
          validation.violations,
        );
      }

      try {
        return await deps.variants.storeManual({
          postId,
          ownerId,
          platform,
          body: input.body,
          hashtags: extractHashtags(input.body),
          origin: 'manual',
          validationReport: validation,
        });
      } catch (error) {
        if (error instanceof LiveVariantExistsError) {
          throw new HttpError(409, 'LIVE_VARIANT_EXISTS', error.message);
        }
        throw error;
      }
    },

    async listVariants(ownerId: string, postId: string): Promise<VariantRecord[]> {
      await loadPost(ownerId, postId);
      return deps.variants.listByPost(ownerId, postId);
    },

    async listRuns(ownerId: string, postId: string) {
      await loadPost(ownerId, postId);
      return deps.variants.listRuns(ownerId, postId);
    },
  };
}

export type GenerationService = ReturnType<typeof createGenerationService>;
