import { describe, expect, it } from 'vitest';
import { renderMermaid } from './mermaid';

describe('Mermaid preview with Pele', () => {
	it('renders a flowchart as a sized SVG', async () => {
		const source = 'flowchart LR\n A[Start] --> B[End]';
		const first = await renderMermaid(source);
		expect(first).toContain('<svg');
		expect(first).toContain('class="pele pele-flowchart"');
		expect(first).toMatch(/viewBox="0 0 \d+ \d+"/);
	});

	it('reports invalid diagram syntax to the preview', async () => {
		await expect(renderMermaid('flowchart LR\n A -->')).rejects.toThrow();
	});

	it('does not add diagram links from reviewed text', async () => {
		const svg = await renderMermaid('flowchart LR\n A[Open]\n click A "https://example.com"');
		expect(svg).not.toContain('https://example.com');
		expect(svg).not.toContain('<a ');
	});
});
