import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createReviewStore } from '../lib/server/storage/db';
import { getGitRoot } from '../lib/server/git/git';
import { publishDocumentReview, publishImageReview, publishReview, type ReviewNotificationTarget } from '../lib/server/reviews/publish';
import { reviewPlatformBaseUrl, reviewPlatformDiscordTargetEnv } from '../lib/server/config/env';
import type { CommentSide, ReviewCommentRecord, ReviewSourceKind } from '../lib/server/storage/types';

function parseArgs(argv: string[]) {
	const [command, ...rest] = argv;
	const flags = new Map<string, string | boolean>();
	const positionals: string[] = [];

	for (let i = 0; i < rest.length; i += 1) {
		const arg = rest[i];
		if (arg.startsWith('--')) {
			const key = arg.slice(2);
			const next = rest[i + 1];
			if (next && !next.startsWith('--')) {
				flags.set(key, next);
				i += 1;
			} else {
				flags.set(key, true);
			}
		} else {
			positionals.push(arg);
		}
	}

	return { command, flags, positionals };
}

function stringFlag(flags: Map<string, string | boolean>, name: string) {
	const value = flags.get(name);
	return typeof value === 'string' ? value : undefined;
}

function usage() {
	return `reviewctl

Commands:
  publish --repo <git-root> [--type worktree|staged] [--range <range>] [--show <ref>] --title <title> [--discord-channel <id>] [--discord-thread <id>] [--executor-mention <mention>]
  publish-doc --file <markdown.md> --title <title>
  publish-image --file <page.png|page.jpg|page.webp> --title <title>
  list
  add-comment --review <id> --file <path> --line <n> [--line-end <n>] --side old|new --body <text> [--author <name>]
  comments --review <id> --json
`;
}

function reviewSourceKind(value: string): ReviewSourceKind {
	if (value === 'worktree' || value === 'staged') return value;
	throw new Error(`Unsupported --type '${value}'. Use worktree or staged, or pass --range/--show.`);
}


function notificationTargetFromFlags(flags: Map<string, string | boolean>): ReviewNotificationTarget | null {
	const envTarget = reviewPlatformDiscordTargetEnv();
	const channelId = stringFlag(flags, 'discord-channel') ?? envTarget.channelId;
	const threadId = stringFlag(flags, 'discord-thread') ?? envTarget.threadId;
	const executorMention = stringFlag(flags, 'executor-mention') ?? envTarget.executorMention;
	if (!channelId && !threadId) return null;
	return {
		platform: 'discord',
		channelId: channelId ?? threadId!,
		threadId,
		executorMention
	};
}

function commentSide(value: string | undefined): CommentSide {
	if (!value) return 'file';
	if (value === 'old' || value === 'new' || value === 'file') return value;
	throw new Error(`Unsupported --side '${value}'. Use old, new, or file.`);
}

function optionalPositiveInt(value: string | undefined, flagName: string) {
	if (!value) return null;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flagName} must be a positive integer`);
	return parsed;
}

function createCommentFromFlags(flags: Map<string, string | boolean>, reviewId: string, version: number): ReviewCommentRecord {
	const body = stringFlag(flags, 'body')?.trim();
	if (!body) throw new Error('--body is required');
	const filePath = stringFlag(flags, 'file');
	if (!filePath) throw new Error('--file is required for inline review comments');
	const lineStart = optionalPositiveInt(stringFlag(flags, 'line'), '--line');
	if (!lineStart) throw new Error('--line is required for inline review comments');
	const lineEnd = optionalPositiveInt(stringFlag(flags, 'line-end'), '--line-end') ?? lineStart;
	if (lineEnd < lineStart) throw new Error('--line-end must be greater than or equal to --line');
	const side = commentSide(stringFlag(flags, 'side') ?? 'new');
	if (side === 'file') throw new Error('--side must be old or new for inline review comments');
	const now = new Date().toISOString();
	return {
		id: randomUUID(),
		reviewId,
		version,
		filePath,
		side,
		lineStart,
		lineEnd,
		textSelection: null,
		pageRegion: null,
		sentAt: null,
		body,
		author: stringFlag(flags, 'author') ?? process.env.USER ?? 'anonymous',
		status: 'open',
		createdAt: now,
		updatedAt: now
	};
}

async function main() {
	const { command, flags } = parseArgs(process.argv.slice(2));
	const store = createReviewStore();

	try {
		if (!command || command === 'help' || command === '--help') {
			console.log(usage());
			return;
		}

		if (command === 'publish') {
			const repoInput = stringFlag(flags, 'repo') ?? process.cwd();
			const repoRoot = await getGitRoot(repoInput);
			const title = stringFlag(flags, 'title') ?? 'Untitled code review';
			const range = stringFlag(flags, 'range');
			const show = stringFlag(flags, 'show');
			const type = reviewSourceKind(stringFlag(flags, 'type') ?? 'worktree');

			const sourceKind: ReviewSourceKind = range ? 'range' : show ? 'show' : type;
			const sourceRef = range ?? show ?? null;
			const result = await publishReview({
				repoRoot,
				title,
				sourceKind,
				sourceRef,
				createdBy: process.env.USER || 'unknown',
				store,
				baseUrl: reviewPlatformBaseUrl(),
				notificationTarget: notificationTargetFromFlags(flags)
			});
			console.log(`Created review ${result.review.id}`);
			console.log(`URL: ${result.url}`);
			console.log(`Files: ${result.files.length}`);
			if (result.files.length === 0 && sourceKind === 'worktree') {
				console.log(
					'Hint: worktree review only captures uncommitted changes. For committed work, publish a commit range, e.g. --range "origin/main..HEAD".'
				);
			}
			return;
		}

		if (command === 'publish-doc') {
			const file = stringFlag(flags, 'file');
			if (!file) throw new Error('--file is required');
			const title = stringFlag(flags, 'title') ?? path.basename(file);
			const result = publishDocumentReview({
				filePath: file,
				title,
				createdBy: process.env.USER || 'unknown',
				store,
				baseUrl: reviewPlatformBaseUrl(),
				notificationTarget: notificationTargetFromFlags(flags)
			});
			console.log(`Created review ${result.review.id}`);
			console.log(`URL: ${result.url}`);
			console.log(`Document: ${result.document.path}`);
			console.log(`Lines: ${result.document.lineCount}`);
			return;
		}

		if (command === 'publish-image') {
			const file = stringFlag(flags, 'file');
			if (!file) throw new Error('--file is required');
			const result = publishImageReview({
				filePath: file,
				title: stringFlag(flags, 'title') ?? path.basename(file),
				createdBy: process.env.USER || 'unknown',
				store,
				baseUrl: reviewPlatformBaseUrl(),
				notificationTarget: notificationTargetFromFlags(flags)
			});
			console.log(`Created review ${result.review.id}`);
			console.log(`URL: ${result.url}`);
			console.log(`Image: ${result.document.path}`);
			return;
		}

		if (command === 'list') {
			const reviews = store.listReviews();
			if (reviews.length === 0) {
				console.log('No reviews.');
				return;
			}
			for (const review of reviews) {
				console.log(`${review.id}\t${review.status}\t${review.title}\t${review.repoRoot}`);
			}
			return;
		}

		if (command === 'comments') {
			const reviewId = stringFlag(flags, 'review');
			if (!reviewId) throw new Error('--review is required');
			const review = store.getReview(reviewId);
			if (!review) throw new Error(`Review not found: ${reviewId}`);
			const latestVersion = store.getLatestVersion(reviewId);
			const comments = store.listComments(reviewId);
			if (flags.has('json')) {
				console.log(JSON.stringify({ review, latestVersion, comments }, null, 2));
			} else {
				for (const comment of comments) {
					console.log(`${comment.id}\t${comment.status}\t${comment.filePath ?? '<general>'}:${comment.lineStart ?? ''}\t${comment.body}`);
				}
			}
			return;
		}

		if (command === 'add-comment') {
			const reviewId = stringFlag(flags, 'review');
			if (!reviewId) throw new Error('--review is required');
			const review = store.getReview(reviewId);
			if (!review) throw new Error(`Review not found: ${reviewId}`);
			const latestVersion = store.getLatestVersion(reviewId);
			if (!latestVersion) throw new Error(`Review has no version: ${reviewId}`);
			const comment = createCommentFromFlags(flags, reviewId, latestVersion.version);
			store.addComment(comment);
			if (flags.has('json')) {
				console.log(JSON.stringify({ review, latestVersion, comment }, null, 2));
			} else {
				console.log(`Added comment ${comment.id} to ${reviewId}`);
			}
			return;
		}

		throw new Error(`Unknown command: ${command}`);
	} finally {
		store.close();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
