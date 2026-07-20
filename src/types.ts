// Wire DTOs — hand-written interfaces matching `src/openapi/v1.json` component
// schemas EXACTLY. Snake_case is preserved from the wire; ISO-8601 timestamps
// stay strings. Enum-ish fields are forward-compatible unions (`| (string & {})`)
// so a NEW server enum value never breaks a typed client — the known members
// still autocomplete, unknown ones widen to string instead of a type error.

/** A forward-compatible string union: known members plus any future value. */
type Open<T extends string> = T | (string & {})

// ---------------------------------------------------------------------------
// Errors (RFC 9457 problem document, mirrors ProblemSchema)
// ---------------------------------------------------------------------------

/** One field-level validation error (from a `validation_failed` problem). */
export interface FieldError {
    /** JSON-pointer-ish path to the offending input field, e.g. "#/body/url". */
    pointer: string
    /** Machine-readable validation code (from the validator). */
    code: string
    /** Human-readable explanation of this field error. */
    message: string
}

/** The RFC 9457 problem document returned by every /v1 route on error. */
export interface ProblemBody {
    type: string
    title: string
    status: number
    detail?: string
    instance: string
    code: string
    request_id: string
    errors?: FieldError[]
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export type UsageTier = Open<'free' | 'subscriber' | 'pro'>

export interface UsagePlan {
    tier: UsageTier
    planName: string
}

export interface UsageSubscription {
    isSubscribed: boolean
    isProSubscriber: boolean
    isOnTrial: boolean
    trialEndsAt: string | null
    expiresAt: string | null
    willRenew: boolean | null
}

export interface UsageTranscriptionLimits {
    maxUploadSizeGb: number
    maxUploadSizeLabel: string
    realtimeMaxDurationMinutes: number
    realtimeMaxDurationLabel: string
}

export interface UsageConversionLimits {
    maxFileSizeMb: number
    maxFileSizeLabel: string
    maxBatchItems: number
    canUseManagedQueue: boolean
    dailyCloudQuota: number | null
}

export interface UsageLimits {
    transcription: UsageTranscriptionLimits
    conversion: UsageConversionLimits
}

export interface UsageCounters {
    cloudConversionsUsedLast24h: number
    cloudConversionsRemaining: number | null
}

export interface UsageResponse {
    plan: UsagePlan
    subscription: UsageSubscription
    limits: UsageLimits
    usage: UsageCounters
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

export type ArticleType = Open<
    | 'YOUTUBE_ARTICLE'
    | 'WEBPAGE_ARTICLE'
    | 'PDF_ARTICLE'
    | 'WORD_ARTICLE'
    | 'TEXT_ARTICLE'
    | 'AUDIO_ARTICLE'
>

/** An article summary row (list + search results). */
export interface Article {
    id: string
    title: string | null
    description: string | null
    article_type: ArticleType
    source_url: string | null
    created_at: string
}

export interface ArticleSummaryPart {
    title: string | null
    content: string | null
}

/** A single article with its generated summary and backing text. */
export interface ArticleDetail extends Article {
    summary: { parts: ArticleSummaryPart[] } | null
    body_text: string | null
}

export interface ArticleListResponse {
    data: Article[]
    has_more: boolean
    next_cursor: string | null
}

export interface ArticleSearchResponse {
    data: Article[]
    count: number
}

// ---------------------------------------------------------------------------
// Transcriptions
// ---------------------------------------------------------------------------

export type TranscriptionStatus = Open<
    'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR'
>

export interface Transcription {
    id: string
    status: TranscriptionStatus
    progress: number
    model_type: string
    language: string | null
    input_file: string
    error: string | null
    created_at: string
}

export interface TranscriptionDetail extends Transcription {
    output_text: string | null
}

export interface TranscriptionListResponse {
    data: Transcription[]
    has_more: boolean
    next_cursor: string | null
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** The 202-Accepted body every async write returns. */
export interface JobAccepted {
    job_id: string
    status: string
    tracking_url: string
}

/**
 * The nested camelCase job-status shape (GET /v1/jobs/{id}). Pinned deliberately
 * — the July 2026 flat-vs-nested drift incidents are why this must match the
 * server's `JobStatusResponse` byte-for-byte.
 */
export interface JobStatusResponse {
    jobId: string
    status: string
    progress?: number
    step?: string | null
    error?: string | null
    output?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Subtitles
// ---------------------------------------------------------------------------

export type SubtitleKind = Open<'srt' | 'vtt' | 'ass' | 'burned'>
export type SubtitleStyle = Open<'CLEAN' | 'TIKTOK' | 'PODCAST' | 'MINIMAL'>

export interface SubtitleDownload {
    url: string
    expires_at: string
    kind: SubtitleKind
    filename: string
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export interface CreateTranscriptionBody {
    /** A URL to audio/video media to transcribe. */
    url: string
    /** Language name ("english") or ISO-639-1 code ("en"). Defaults to english. */
    language?: string
}

export interface CreateSummaryYoutubeBody {
    source: 'youtube'
    url: string
    language?: string
}

export interface CreateSummaryUrlBody {
    source: 'url'
    url: string
    language?: string
}

export interface CreateSummaryTextBody {
    source: 'text'
    content: string
    /** Optional title hint (reserved — currently derived by the summarizer). */
    title?: string
    language?: string
}

/** Discriminated on `source`: youtube | url | text. */
export type CreateSummaryBody =
    | CreateSummaryYoutubeBody
    | CreateSummaryUrlBody
    | CreateSummaryTextBody

export interface CreateSubtitlesBody {
    /** A URL to the media to caption. */
    url: string
    language?: string
    /** CLEAN is free; TIKTOK/PODCAST/MINIMAL require Premium. */
    style?: SubtitleStyle
}
