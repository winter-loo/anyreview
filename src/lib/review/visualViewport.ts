/** Keep review panels above the on-screen keyboard, including Safari's panned viewport. */
export function reviewViewport(node: HTMLElement) {
	const viewport = window.visualViewport;
	function update() {
		const height = viewport?.height ?? window.innerHeight;
		const top = viewport?.offsetTop ?? 0;
		node.style.setProperty('--review-visible-height', `${height}px`);
		node.style.setProperty('--review-visible-top', `${top}px`);
		node.style.setProperty('--review-keyboard-inset', `${Math.max(0, window.innerHeight - height - top)}px`);
	}
	update();
	viewport?.addEventListener('resize', update);
	viewport?.addEventListener('scroll', update);
	window.addEventListener('resize', update);
	return {
		destroy() {
			viewport?.removeEventListener('resize', update);
			viewport?.removeEventListener('scroll', update);
			window.removeEventListener('resize', update);
		}
	};
}

/** Refit when a comment sidebar or orientation changes the actual reading width. */
export function reviewWidth(node: HTMLElement, resize: () => void) {
 let width = node.clientWidth;
 let frame = 0;
 const observer = new ResizeObserver(() => {
  if (node.clientWidth === width) return;
  width = node.clientWidth;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(resize);
 });
 observer.observe(node);
 return { destroy() { observer.disconnect(); cancelAnimationFrame(frame); } };
}
