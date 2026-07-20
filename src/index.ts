// Public entry point for @aishorty/sdk.

export { Shorty, default } from './client'
export type { RawRequestOptions, ShortyOptions } from './client'

export { VERSION } from './version'

// Errors
export {
    APIConnectionError,
    APIError,
    APIServerError,
    APITimeoutError,
    AuthenticationError,
    ConflictError,
    JobFailedError,
    NotFoundError,
    PermissionDeniedError,
    QuotaExhaustedError,
    RateLimitError,
    ShortyError,
    ValidationError,
} from './core/errors'

// Pagination
export { Page } from './core/pagination'
export type { ListEnvelope, PageFetcher } from './core/pagination'

// Resource option + param types
export type {
    ListArticlesParams,
    SearchArticlesParams,
} from './resources/articles'
export type { RequestOptions, WriteOptions } from './resources/common'
export { normalizeJobStatus } from './resources/jobs'
export type { NormalizedJobStatus, WaitForOptions } from './resources/jobs'
export type { DownloadSubtitlesParams } from './resources/subtitles'
export type { ListTranscriptionsParams } from './resources/transcriptions'

// Webhooks
export { verifyWebhookSignature } from './webhooks'
export type {
    VerifyWebhookInput,
    WebhookHeaders,
    WebhookVerifyFailure,
    WebhookVerifyResult,
} from './webhooks'

// HTTP escape-hatch types
export type { FetchLike, HttpResponse, QueryParams } from './core/http'

// Wire DTOs
export type {
    Article,
    ArticleDetail,
    ArticleListResponse,
    ArticleSearchResponse,
    ArticleSummaryPart,
    ArticleType,
    CreateSubtitlesBody,
    CreateSummaryBody,
    CreateSummaryTextBody,
    CreateSummaryUrlBody,
    CreateSummaryYoutubeBody,
    CreateTranscriptionBody,
    FieldError,
    JobAccepted,
    JobStatusResponse,
    ProblemBody,
    SubtitleDownload,
    SubtitleKind,
    SubtitleStyle,
    Transcription,
    TranscriptionDetail,
    TranscriptionListResponse,
    TranscriptionStatus,
    UsageConversionLimits,
    UsageCounters,
    UsageLimits,
    UsagePlan,
    UsageResponse,
    UsageSubscription,
    UsageTier,
    UsageTranscriptionLimits,
} from './types'
