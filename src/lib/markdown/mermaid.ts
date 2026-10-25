import { randomId } from '../random-id';

// Load diagram code only when a Markdown review contains a Mermaid preview.
let library: Promise<typeof import('pele')> | undefined;

export async function renderMermaid(source: string): Promise<string> {
	const { render } = await (library ??= import('pele'));
	const { svg } = render(source, {
		idPrefix: `review-diagram-${randomId()}`,
		limit: 50_000,
		links: false,
		images: false
	});
	return svg;
}
