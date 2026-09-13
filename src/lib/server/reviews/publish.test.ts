import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createReviewStore } from '../storage/db';
import { publishReview } from './publish';

function createGitRepo() {
	const repo = mkdtempSync(path.join(os.tmpdir(), 'reviewloop-repo-'));
	execFileSync('git', ['init'], { cwd: repo });
	execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
	execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
	writeFileSync(path.join(repo, 'a.txt'), 'one\n');
	execFileSync('git', ['add', 'a.txt'], { cwd: repo });
	execFileSync('git', ['commit', '-m', 'initial'], { cwd: repo });
	writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
	return repo;
}

function commit(repo: string, filePath: string, content: string, message: string, body?: string) {
	writeFileSync(path.join(repo, filePath), content);
	execFileSync('git', ['add', filePath], { cwd: repo });
	const args = ['commit', '-m', message];
	if (body) args.push('-m', body);
	execFileSync('git', args, { cwd: repo });
	return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();
}

describe('publishReview', () => {
	it('creates a durable worktree review snapshot without mutating the repo', async () => {
		const repo = createGitRepo();
		const home = mkdtempSync(path.join(os.tmpdir(), 'reviewloop-home-'));
		mkdirSync(home, { recursive: true });
		const store = createReviewStore(home);
		const beforeStatus = execFileSync('git', ['status', '--short'], { cwd: repo }).toString();

		const result = await publishReview({
			repoRoot: repo,
			title: 'local worktree smoke',
			sourceKind: 'worktree',
			createdBy: 'tester',
			store,
			baseUrl: 'http://localhost:5173'
		});

		expect(result.review.id).toMatch(/^CR-\d{8}-\d{4}$/);
		expect(result.version.version).toBe(1);
		expect(result.url).toContain(`/reviews/${result.review.id}`);
		expect(result.diff).toContain('+two');
		expect(result.files).toEqual([
			expect.objectContaining({
				id: '000001',
				path: 'a.txt',
				additions: 1,
				deletions: 0,
				status: 'modified',
				patchPath: expect.stringContaining('000001.patch'),
				patchBytes: expect.any(Number),
				lineCount: expect.any(Number),
				tooLarge: false,
				generatedLike: false
			})
		]);
		const afterStatus = execFileSync('git', ['status', '--short'], { cwd: repo }).toString();
		expect(afterStatus).toBe(beforeStatus);
	});

	it('stores one commit section per commit in a range review', async () => {
		const repo = createGitRepo();
		execFileSync('git', ['checkout', '--', 'a.txt'], { cwd: repo });
		const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();
		const first = commit(
			repo,
			'a.txt',
			'one\ntwo\n',
			'add second line',
			'任务编号:T202604226103\n\n修改说明:统一SQL commit list should show this full body without truncating the sidebar context.'
		);
		const second = commit(repo, 'b.txt', 'bee\n', 'add b file');
		const home = mkdtempSync(path.join(os.tmpdir(), 'reviewloop-home-'));
		mkdirSync(home, { recursive: true });
		const store = createReviewStore(home);

		const result = await publishReview({
			repoRoot: repo,
			title: 'two commit range',
			sourceKind: 'range',
			sourceRef: `${base}..HEAD`,
			createdBy: 'tester',
			store,
			baseUrl: 'http://localhost:5173',
			notificationTarget: {
				platform: 'discord',
				channelId: '1492092161414398074',
				threadId: '1505797759687725129',
				executorMention: '<@1234567890>'
			}
		});

		expect(result.commits).toHaveLength(2);
		expect(result.commits.map((commit) => commit.sha)).toEqual([first, second]);
		expect(result.commits.map((commit) => commit.subject)).toEqual(['add second line', 'add b file']);
		expect(result.commits[0].message).toContain('任务编号:T202604226103');
		expect(result.commits[0].message).toContain('修改说明:统一SQL commit list should show this full body');
		expect(result.commits[1].message).toBe('add b file');
		expect(result.commits[0].files).toEqual([expect.objectContaining({ id: 'c000001-f000001', path: 'a.txt' })]);
		expect(result.commits[1].files).toEqual([expect.objectContaining({ id: 'c000002-f000001', path: 'b.txt' })]);
		expect(result.files.map((file) => file.path)).toEqual(['a.txt', 'b.txt']);
		expect(result.files.map((file) => file.id)).toEqual(['000001', '000002']);
		expect(result.files.every((file) => !file.id?.startsWith('c'))).toBe(true);
		const metadata = JSON.parse(readFileSync(path.join(store.home, 'artifacts', result.review.id, 'v1', 'metadata.json'), 'utf8'));
		expect(metadata.notificationTarget).toEqual({
			platform: 'discord',
			channelId: '1492092161414398074',
			threadId: '1505797759687725129',
			executorMention: '<@1234567890>'
		});
		const manifest = JSON.parse(readFileSync(path.join(store.home, 'artifacts', result.review.id, 'v1', 'manifest.json'), 'utf8'));
		expect(manifest.reviewKind).toBe('code');
		expect(manifest.source).toEqual(expect.objectContaining({ type: 'git-diff', refKind: 'range', repoRoot: repo }));
		expect(manifest.entries.map((entry: { id: string; path: string }) => [entry.id, entry.path])).toEqual([
			['000001', 'a.txt'],
			['000002', 'b.txt']
		]);
		expect(manifest.groups.map((group: { id: string; entries: string[] }) => [group.id, group.entries])).toEqual([
			['c000001', ['c000001-f000001']],
			['c000002', ['c000002-f000001']]
		]);
	});
});
