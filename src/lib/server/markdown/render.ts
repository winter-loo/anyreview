import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';

export interface RenderedMarkdownBlock {
	id: string;
	lineStart: number;
	lineEnd: number;
	html: string;
	text: string;
	headingLevel: number | null;
	headingText: string | null;
}

function renderedText(html: string) {
	return html
		.replace(/<[^>]*>/g, '')
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
		.replace(/&quot;/g, '"')
		.replace(/&gt;/g, '>')
		.replace(/&lt;/g, '<')
		.replace(/&amp;/g, '&');
}

const markdown = new MarkdownIt({
	html: false,
	linkify: true,
	typographer: true,
	breaks: false
});

function findMatchingBlockEnd(tokens: Token[], start: number) {
	const opening = tokens[start];
	if (opening.nesting !== 1) return start;
	for (let index = start + 1; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token.level === opening.level && token.nesting === -1) return index;
	}
	return start;
}

function tokenLineRange(tokens: Token[], start: number, end: number) {
	let lineStart = Number.POSITIVE_INFINITY;
	let lineEnd = 0;
	for (const token of tokens.slice(start, end + 1)) {
		if (!token.map) continue;
		lineStart = Math.min(lineStart, token.map[0] + 1);
		lineEnd = Math.max(lineEnd, token.map[1]);
	}
	if (!Number.isFinite(lineStart)) {
		lineStart = 1;
		lineEnd = 1;
	}
	return { lineStart, lineEnd: Math.max(lineStart, lineEnd) };
}

function tokenHeading(tokens: Token[], start: number, end: number) {
	const opening = tokens[start];
	if (opening.type !== 'heading_open') return { headingLevel: null, headingText: null };

	const level = Number(opening.tag.replace(/^h/, ''));
	const inline = tokens.slice(start + 1, end + 1).find((token) => token.type === 'inline');
	const text = (inline?.children ?? [])
		.filter((token) => token.type !== 'html_inline')
		.map((token) => token.content)
		.join('')
		.trim();

	return {
		headingLevel: Number.isInteger(level) ? level : null,
		headingText: text || null
	};
}

export function renderMarkdownDocument(source: string): RenderedMarkdownBlock[] {
	const tokens = markdown.parse(source, {});
	const blocks: RenderedMarkdownBlock[] = [];
	let index = 0;

	while (index < tokens.length) {
		const token = tokens[index];
		if (token.level !== 0 || token.hidden) {
			index += 1;
			continue;
		}

		const end = findMatchingBlockEnd(tokens, index);
		const group = tokens.slice(index, end + 1);
		const { lineStart, lineEnd } = tokenLineRange(tokens, index, end);
		const { headingLevel, headingText } = tokenHeading(tokens, index, end);
		const html = markdown.renderer.render(group, markdown.options, {});
		blocks.push({
			id: `L${lineStart}`,
			lineStart,
			lineEnd,
			html,
			text: renderedText(html),
			headingLevel,
			headingText
		});
		index = end + 1;
	}

	return blocks;
}
