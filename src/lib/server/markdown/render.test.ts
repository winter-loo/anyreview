import { describe, expect, it } from 'vitest';
import { renderMarkdownDocument } from './render';

describe('renderMarkdownDocument', () => {
	it('renders real markdown blocks while preserving source line anchors', () => {
		const blocks = renderMarkdownDocument('# Title\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```sql\nselect 1;\n```\n');

		expect(blocks.map((block) => [block.lineStart, block.lineEnd])).toEqual([
			[1, 1],
			[3, 5],
			[7, 9]
		]);
		expect(blocks[0].html).toContain('<h1>Title</h1>');
		expect(blocks[0].text).toBe('Title\n');
		expect(blocks[0]).toMatchObject({ headingLevel: 1, headingText: 'Title' });
		expect(blocks[1].html).toContain('<table>');
		expect(blocks[1].headingText).toBeNull();
		expect(blocks[2].html).toContain('<pre><code class="language-sql">select 1;');
	});

	it('extracts section titles for document navigation without including markup', () => {
		const blocks = renderMarkdownDocument('## Scope & Goals\n\nBody\n\n### `API` details\n');

		expect(blocks.map((block) => block.headingText).filter(Boolean)).toEqual(['Scope & Goals', 'API details']);
		expect(blocks.map((block) => block.headingLevel).filter(Boolean)).toEqual([2, 3]);
	});

	it('escapes raw html because document reviews render untrusted markdown artifacts', () => {
		const [block] = renderMarkdownDocument('<script>alert(1)</script>');
		expect(block.html).toContain('&lt;script&gt;');
		expect(block.html).not.toContain('<script>');
	});
});
