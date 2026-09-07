// Loaded only by diagram previews, shared across all diagrams on the page.
const library = () => import('mermaid').then(({ default: mermaid }) => {
	mermaid.initialize({ startOnLoad: false, securityLevel: 'strict',
		suppressErrorRendering: true, theme: 'default', htmlLabels: false,
		fontFamily: 'sans-serif', maxTextSize: 50000 });
	return mermaid;
});
let ready: ReturnType<typeof library> | undefined;
export async function renderMermaid(source: string): Promise<string> {
	const mermaid = await (ready ??= library());
	const { svg } = await mermaid.render(`review-diagram-${crypto.randomUUID()}`, source);
	return svg;
}
