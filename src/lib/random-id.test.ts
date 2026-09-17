import { expect, test, vi } from 'vitest';
import { randomId } from './random-id';

test('generates v4 UUIDs without crypto.randomUUID', () => {
	vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
	try {
		const ids = new Set(Array.from({ length: 100 }, randomId));
		expect(ids.size).toBe(100);
		for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	} finally {
		vi.unstubAllGlobals();
	}
});
