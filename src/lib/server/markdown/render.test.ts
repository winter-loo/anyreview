import { describe, expect, it } from 'vitest';
import { markdownImageSources, renderMarkdownDocument } from './render';

describe('renderMarkdownDocument', () => {
	it('rewrites parsed images without changing line anchors, alt text, links or code examples', () => {
		const source = '# Title\n\n[![Alt](image.png "Caption")](https://example.com)\n\n```md\n![Example](code.png)\n```\n';
		const original = renderMarkdownDocument(source);
		const rewritten = renderMarkdownDocument(source, () => '/live/token/assets/image');
		expect(markdownImageSources(source)).toEqual(['image.png']);
		expect(rewritten.map(b => [b.id, b.lineStart, b.lineEnd, b.text])).toEqual(original.map(b => [b.id, b.lineStart, b.lineEnd, b.text]));
		expect(rewritten[1].html).toContain('href="https://example.com"');
		expect(rewritten[1].html).toContain('src="/live/token/assets/image" alt="Alt" title="Caption"');
		expect(rewritten[2].html).toContain('![Example](code.png)');
	});

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

it('keeps Mermaid source and annotation anchors while identifying diagrams', () => {
 const [block] = renderMarkdownDocument('```mermaid\ngraph TD\n A-->B\n```\n');
 expect(block).toMatchObject({ id: 'L1', lineStart: 1, lineEnd: 4,
  text: 'graph TD\n A-->B\n\n', diagram: { language: 'mermaid', source: 'graph TD\n A-->B\n' } });
 expect(block.html).toContain('language-mermaid');
 expect(renderMarkdownDocument('```text\ngraph TD\n```')[0].diagram).toBeUndefined();
});
