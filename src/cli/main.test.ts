import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function createRepo() {
	const repo = mkdtempSync(path.join(os.tmpdir(), 'reviewloop-cli-repo-'));
	execFileSync('git', ['init'], { cwd: repo });
	execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
	execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
	writeFileSync(path.join(repo, 'case.sql'), 'select 1;\n');
	execFileSync('git', ['add', 'case.sql'], { cwd: repo });
	execFileSync('git', ['commit', '-m', 'initial'], { cwd: repo });
	writeFileSync(path.join(repo, 'case.sql'), 'select 1;\nselect 2;\n');
	return repo;
}

describe('reviewctl CLI', () => {
	it('publishes and lists a worktree review', () => {
		const repo = createRepo();
		const home = mkdtempSync(path.join(os.tmpdir(), 'reviewloop-cli-home-'));
		const env = { ...process.env, REVIEW_PLATFORM_HOME: home };

		const publishOutput = execFileSync(
			'node',
			['--import', 'tsx', 'src/cli/main.ts', 'publish', '--repo', repo, '--type', 'worktree', '--title', 'cli smoke'],
			{ cwd: process.cwd(), env }
		).toString();

		expect(publishOutput).toContain('Created review CR-');
		const reviewId = /Created review (CR-\d{8}-\d{4})/.exec(publishOutput)?.[1];
		expect(reviewId).toBeTruthy();

		const listOutput = execFileSync('node', ['--import', 'tsx', 'src/cli/main.ts', 'list'], {
			cwd: process.cwd(),
			env
		}).toString();
		expect(listOutput).toContain(reviewId!);
		expect(listOutput).toContain('cli smoke');
	});

	it('adds and exports review comments in agent-friendly JSON', () => {
		const repo = createRepo();
		const home = mkdtempSync(path.join(os.tmpdir(), 'reviewloop-cli-home-'));
		const env = { ...process.env, REVIEW_PLATFORM_HOME: home };
		const publishOutput = execFileSync(
			'node',
			['--import', 'tsx', 'src/cli/main.ts', 'publish', '--repo', repo, '--type', 'worktree', '--title', 'comment smoke'],
			{ cwd: process.cwd(), env }
		).toString();
		const reviewId = /Created review (CR-\d{8}-\d{4})/.exec(publishOutput)?.[1];
		expect(reviewId).toBeTruthy();

		const addOutput = execFileSync(
			'node',
			[
				'--import',
				'tsx',
				'src/cli/main.ts',
				'add-comment',
				'--review',
				reviewId!,
				'--file',
				'case.sql',
				'--line',
				'2',
				'--line-end',
				'3',
				'--side',
				'new',
				'--author',
				'reviewer',
				'--body',
				'Please verify this SQL output.'
			],
			{ cwd: process.cwd(), env }
		).toString();
		expect(addOutput).toContain('Added comment');

		const commentsOutput = execFileSync('node', ['--import', 'tsx', 'src/cli/main.ts', 'comments', '--review', reviewId!, '--json'], {
			cwd: process.cwd(),
			env
		}).toString();
		const payload = JSON.parse(commentsOutput) as {
			review: { id: string; title: string };
			latestVersion: { version: number };
			comments: Array<{ body: string; author: string; filePath: string; lineStart: number; lineEnd: number; status: string }>;
		};
		expect(payload.review).toMatchObject({ id: reviewId, title: 'comment smoke' });
		expect(payload.latestVersion.version).toBe(1);
		expect(payload.comments).toEqual([
			expect.objectContaining({
				body: 'Please verify this SQL output.',
				author: 'reviewer',
				filePath: 'case.sql',
				lineStart: 2,
				lineEnd: 3,
				status: 'open'
			})
		]);
	});

	it('publishes markdown document reviews and exports line comments in agent-friendly JSON', () => {
		const docDir = mkdtempSync(path.join(os.tmpdir(), 'reviewloop-doc-'));
		const docPath = path.join(docDir, 'design.md');
		writeFileSync(docPath, '# Design\n\n## Scope\nReview this markdown.\n');
		const home = mkdtempSync(path.join(os.tmpdir(), 'reviewloop-cli-home-'));
		const env = { ...process.env, REVIEW_PLATFORM_HOME: home };

		const publishOutput = execFileSync(
			'node',
			['--import', 'tsx', 'src/cli/main.ts', 'publish-doc', '--file', docPath, '--title', 'design review'],
			{ cwd: process.cwd(), env }
		).toString();
		expect(publishOutput).toContain('Created review CR-');
		expect(publishOutput).toContain('Lines: 5');
		const reviewId = /Created review (CR-\d{8}-\d{4})/.exec(publishOutput)?.[1];
		expect(reviewId).toBeTruthy();

		execFileSync(
			'node',
			[
				'--import',
				'tsx',
				'src/cli/main.ts',
				'add-comment',
				'--review',
				reviewId!,
				'--file',
				docPath,
				'--line',
				'3',
				'--side',
				'new',
				'--author',
				'hermes',
				'--body',
				'Please expand this section.'
			],
			{ cwd: process.cwd(), env }
		);

		const payload = JSON.parse(
			execFileSync('node', ['--import', 'tsx', 'src/cli/main.ts', 'comments', '--review', reviewId!, '--json'], {
				cwd: process.cwd(),
				env
			}).toString()
		) as { review: { sourceKind: string }; latestVersion: { version: number }; comments: Array<{ filePath: string; lineStart: number; body: string }> };
		expect(payload.review.sourceKind).toBe('document');
		expect(payload.latestVersion.version).toBe(1);
		expect(payload.comments[0]).toMatchObject({ filePath: docPath, lineStart: 3, body: 'Please expand this section.' });
	});
});
