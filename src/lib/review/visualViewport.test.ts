import { afterEach, describe, expect, it, vi } from 'vitest';
import { reviewViewport } from './visualViewport';

afterEach(() => vi.unstubAllGlobals());

describe('review panel keyboard positioning', () => {
	it('keeps panels within a resized and panned visual viewport and cleans up listeners', () => {
		const viewport = Object.assign(new EventTarget(), { height: 740, offsetTop: 0 });
		const windowStub = Object.assign(new EventTarget(), { innerHeight: 740, visualViewport: viewport });
		vi.stubGlobal('window', windowStub);
		const values = new Map<string, string>();
		const node = { style: { setProperty: (name: string, value: string) => values.set(name, value) } } as unknown as HTMLElement;
		const action = reviewViewport(node);
		expect(values.get('--review-keyboard-inset')).toBe('0px');

		// A keyboard covers 400px; Safari then pans the viewport by 80px.
		viewport.height = 340;
		viewport.dispatchEvent(new Event('resize'));
		expect(values.get('--review-visible-height')).toBe('340px');
		expect(values.get('--review-keyboard-inset')).toBe('400px');
		viewport.offsetTop = 80;
		viewport.dispatchEvent(new Event('scroll'));
		expect(values.get('--review-visible-top')).toBe('80px');
		expect(values.get('--review-keyboard-inset')).toBe('320px');

		viewport.height = 740;
		viewport.offsetTop = 0;
		viewport.dispatchEvent(new Event('resize'));
		expect(values.get('--review-keyboard-inset')).toBe('0px');
		action.destroy();
		viewport.height = 300;
		viewport.dispatchEvent(new Event('resize'));
		expect(values.get('--review-visible-height')).toBe('740px');
	});

	it('uses the layout viewport when VisualViewport is unavailable', () => {
		vi.stubGlobal('window', Object.assign(new EventTarget(), { innerHeight: 600 }));
		const setProperty = vi.fn();
		const action = reviewViewport({ style: { setProperty } } as unknown as HTMLElement);
		expect(setProperty).toHaveBeenCalledWith('--review-visible-height', '600px');
		expect(setProperty).toHaveBeenCalledWith('--review-keyboard-inset', '0px');
		action.destroy();
	});
});
