import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ comments: [] as any[], markCommentsSent: vi.fn() }));
vi.mock('$lib/server/storage/queries', () => ({
	getReviewDetail: () => ({ review: { id: 'r1', sourceKind: 'document' }, latestVersion: { version: 1, filesPath: '/nonexistent/review/files.json' } })
}));
vi.mock('$lib/server/storage/store', () => ({ getReviewStore: () => ({ listComments: () => state.comments, markCommentsSent: state.markCommentsSent }) }));
vi.mock('$lib/server/config/env', () => ({
	reviewPlatformDiscordTargetEnv: () => ({ channelId: 'test' }),
	reviewPlatformGatewayNotifyUrl: () => 'https://gateway.invalid',
	reviewPlatformGatewayToken: () => undefined,
	reviewPlatformPublicUrl: () => undefined
}));
import { POST } from './+server';

const send = () => POST({ params: { id: 'r1' } } as any);
describe('region comment delivery', () => {
	beforeEach(() => {
		state.comments = [{ id: 'region', status: 'open', body: 'Fix this', textSelection: null, pageRegion: { page: 1, x: 0, y: 0, width: 0.2, height: 0.2 }, sentAt: null }];
		state.markCommentsSent.mockReset().mockImplementation((ids, sentAt) => {
			for (const comment of state.comments) if (ids.includes(comment.id)) comment.sentAt = sentAt;
		});
	});
	afterEach(() => vi.unstubAllGlobals());
	it('marks accepted regions as sent and does not deliver them again', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response('ok'));
		vi.stubGlobal('fetch', fetch);
		expect((await send()).status).toBe(200);
		expect(state.markCommentsSent).toHaveBeenCalledWith(['region'], expect.any(String));
		expect(await (await send()).json()).toMatchObject({ newCommentCount: 0 });
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it('keeps regions unsent when the gateway fails so they can be retried', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));
		expect((await send()).status).toBe(502);
		expect(state.markCommentsSent).not.toHaveBeenCalled();
		expect(state.comments[0].sentAt).toBeNull();
	});
});
