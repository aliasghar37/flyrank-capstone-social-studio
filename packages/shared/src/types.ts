/**
 * Domain vocabulary shared by the API, worker and dashboard.
 * These values mirror the PostgreSQL CHECK constraints in db/migrations/.
 */

export const PLATFORMS = ['telegram', 'discord', 'x', 'linkedin'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const VARIANT_STATUSES = ['draft', 'approved', 'rejected', 'published'] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];

export const SLOT_STATUSES = [
  'scheduled',
  'publishing',
  'retry_wait',
  'published',
  'failed',
  'uncertain',
  'cancelled',
] as const;
export type SlotStatus = (typeof SLOT_STATUSES)[number];

export const ATTEMPT_STATUSES = [
  'started',
  'request_sent',
  'succeeded',
  'failed_retryable',
  'failed_permanent',
  'uncertain',
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const GENERATION_ENGINES = ['groq', 'template'] as const;
export type GenerationEngine = (typeof GENERATION_ENGINES)[number];

export const VARIANT_ORIGINS = ['ai', 'template', 'manual'] as const;
export type VariantOrigin = (typeof VARIANT_ORIGINS)[number];

export interface PublishRequest {
  /** Stable per variant + slot: variant:{variantId}:slot:{slotId}. */
  idempotencyKey: string;
  text: string;
  /** Profile key, informational only. */
  platform: Platform;
  linkUrl?: string;
  ownerId: string;
}

export interface PublishResult {
  externalId: string;
  /** Live message link, or a mock preview link. */
  externalUrl: string;
  /** Sanitized metadata for debugging. Never contains secrets. */
  raw?: unknown;
}

export type PublishErrorKind = 'retryable' | 'permanent' | 'ambiguous';

export class PublishError extends Error {
  readonly kind: PublishErrorKind;
  readonly httpStatus?: number;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    kind: PublishErrorKind,
    options: { httpStatus?: number; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'PublishError';
    this.kind = kind;
    this.httpStatus = options.httpStatus;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * The one seam between business logic and every platform.
 * Business code must depend on this interface only, never on an implementation.
 */
export interface SocialPublisher {
  readonly key: string;
  readonly supportsIdempotentLookup: boolean;
  publish(req: PublishRequest): Promise<PublishResult>;
  findByIdempotencyKey?(key: string): Promise<PublishResult | null>;
}

export interface Violation {
  rule: string;
  limit?: number | string;
  actual?: number | string;
  message: string;
}

export interface ValidationResult {
  passed: boolean;
  violations: Violation[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details: unknown[];
  };
}
