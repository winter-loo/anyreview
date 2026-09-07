import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { json, type RequestHandler } from '@sveltejs/kit';
import { getReviewDetail } from '$lib/server/storage/queries';
import { getReviewStore } from '$lib/server/storage/store';
import { reviewPlatformDiscordTargetEnv, reviewPlatformGatewayNotifyUrl, reviewPlatformGatewayToken, reviewPlatformPublicUrl } from '$lib/server/config/env';
import { commentWithAnchor } from '$lib/server/comments/anchors';
import type { ReviewCommentRecord } from '$lib/server/storage/types';

type DiscordNotificationTarget = {
	platform: 'discord';
	channelId: string;
	threadId?: string;
	executorMention?: string;
};

const MAX_MESSAGE_CHARS = 1800;

function sanitizeOutput(text: string) {
	return text.replace(/(api[_-]?key|token|secret|password)=\S+/gi, '$1=[REDACTED]').slice(0, 8000);
}

function readMetadataTarget(filesPath: string): DiscordNotificationTarget | null {
	const metadataPath = path.join(path.dirname(filesPath), 'metadata.json');
	if (!existsSync(metadataPath)) return null;
	const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as { notificationTarget?: DiscordNotificationTarget | null };
	const target = metadata.notificationTarget;
	if (target?.platform !== 'discord' || !target.channelId) return null;
	return target;
}

function envTarget(): DiscordNotificationTarget | null {
	const envTarget = reviewPlatformDiscordTargetEnv();
	const { channelId, threadId } = envTarget;
	if (!channelId && !threadId) return null;
	return {
		platform: 'discord',
		channelId: channelId ?? threadId!,
		threadId,
		executorMention: envTarget.executorMention
	};
}

function formatComment(comment: ReviewCommentRecord, index: number) {
	const lineEnd = comment.lineEnd ?? comment.lineStart;
	const range = comment.lineStart ? `${comment.lineStart}${lineEnd && lineEnd !== comment.lineStart ? `-${lineEnd}` : ''}` : '-';
	return [
		`#${index + 1} ${comment.filePath ?? 'general'}:${range} ${comment.side} by ${comment.author}`,
		comment.body
	].join('\n');
}

function buildDiscordMessage(reviewId: string, reviewUrl: string, comments: ReviewCommentRecord[], target: DiscordNotificationTarget) {
	const mention = target.executorMention ? `${target.executorMention} ` : '';
	const header = `${mention}请处理 review 的新增/open comments。\nReview: ${reviewId}\nURL: ${reviewUrl}\nOpen comments: ${comments.length}`;
	const details = comments.map(formatComment).join('\n\n');
	const full = `${header}\n\n${details}`;
	if (full.length <= MAX_MESSAGE_CHARS) return full;
	return `${full.slice(0, MAX_MESSAGE_CHARS - 120)}\n\n... comments text truncated in Discord message; full structured comments are included in the gateway payload.`;
}

async function notifyGateway(payload: unknown) {
	const gatewayUrl = reviewPlatformGatewayNotifyUrl();
	if (!gatewayUrl) throw new Error('REVIEW_PLATFORM_GATEWAY_NOTIFY_URL is not configured');
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	const token = reviewPlatformGatewayToken();
	if (token) {
		headers.authorization = `Bearer ${token}`;
	}
	const response = await fetch(gatewayUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
	const text = sanitizeOutput(await response.text());
	if (!response.ok) throw new Error(text || `gateway returned HTTP ${response.status}`);
	return text;
}

export const POST: RequestHandler = async ({ params }) => {
	const reviewId = params.id ?? '';
	if (!reviewId) return json({ error: 'Review id is required' }, { status: 400 });
	const detail = getReviewDetail(reviewId);
	if (!detail?.review || !detail.latestVersion) return json({ error: 'Review not found' }, { status: 404 });

	const store = getReviewStore();
	const openComments = store.listComments(reviewId).filter((comment) => comment.status === 'open');
	const comments = detail.review.sourceKind === 'document'
		? openComments.filter((comment) => !(comment.textSelection || comment.pageRegion) || !comment.sentAt)
		: openComments;
	if (comments.length === 0) {
		return json({ message: 'No unsent comments to notify.', newCommentCount: 0 });
	}

	let target: DiscordNotificationTarget | null = null;
	try {
		target = readMetadataTarget(detail.latestVersion.filesPath) ?? envTarget();
	} catch (cause) {
		return json(
			{ error: 'Unable to read Discord target', message: cause instanceof Error ? sanitizeOutput(cause.message) : 'Invalid review metadata' },
			{ status: 500 }
		);
	}
	if (!target) {
		return json({ error: 'No Discord thread is linked to this review', message: 'Publish the review with --discord-channel/--discord-thread or configure REVIEW_PLATFORM_DISCORD_CHANNEL_ID/REVIEW_PLATFORM_DISCORD_THREAD_ID.' }, { status: 409 });
	}

	const publicUrl = reviewPlatformPublicUrl();
	const reviewKind = detail.review.sourceKind === 'document' ? 'document' : 'code';
	// Document reviews have a different route; sending the code-review URL here leaves the agent on a 404.
	const reviewPath = reviewKind === 'document' ? `/document-reviews/${reviewId}` : `/reviews/${reviewId}`;
	const reviewUrl = publicUrl ? `${publicUrl.replace(/\/$/, '')}${reviewPath}` : reviewPath;
	const message = buildDiscordMessage(reviewId, reviewUrl, comments, target);
	const structuredComments = comments.map((comment) => commentWithAnchor(comment, reviewKind));
	const payload = {
		type: 'review.open_comments',
		legacyType: 'ltsql_review.open_comments',
		target,
		message,
		review: {
			id: detail.review.id,
			title: detail.review.title,
			url: reviewUrl,
			version: detail.latestVersion.version,
			repoRoot: detail.review.repoRoot,
			sourceKind: detail.review.sourceKind,
			sourceRef: detail.review.sourceRef
		},
		comments: structuredComments
	};

	try {
		const gatewayOutput = await notifyGateway(payload);
		// Mark delivery only after the gateway accepts the batch; doing it earlier loses feedback on transient failures.
		store.markCommentsSent(
			comments.filter((comment) => comment.textSelection || comment.pageRegion).map((comment) => comment.id),
			new Date().toISOString()
		);
		return json({ message: `Notified Discord executor about ${comments.length} open comment(s).`, newCommentCount: comments.length, target, gatewayOutput });
	} catch (cause) {
		return json(
			{ error: 'Gateway notification failed', message: cause instanceof Error ? sanitizeOutput(cause.message) : 'Unable to notify Hermes gateway' },
			{ status: 502 }
		);
	}
};
