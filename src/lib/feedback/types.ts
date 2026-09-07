export type Annotation = { id: string; body: string; createdAt: string; [key: string]: unknown };
export type FeedbackState = { review: { id: string; version: string; kind: string; files: { filename: string; hash: string; size: number }[] }; annotations: Annotation[]; pendingCount: number; submittedCount: number; legacyCount: number; missingPreviewCount: number };
export type FeedbackOperation = { operationId: string; type: 'add' | 'delete' | 'preview'; annotation?: Annotation; id?: string; preview?: string; previewError?: string; imported?: boolean };
export type FeedbackContext = { status: string; error: string; pendingCount: number; submittedCount: number; legacyCount: number; missingPreviewCount: number; busy: boolean; submit: () => Promise<void>; retry: () => Promise<void> };
export const FEEDBACK_CONTEXT = Symbol('live-feedback');
