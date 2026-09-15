export type Point = { x: number; y: number };
export type Stroke = { color: string; size: number; points: Point[] };

export const BRUSH_COLORS = [
	{ name: '红色', value: '#e54b4b' },
	{ name: '橙黄', value: '#e99821' },
	{ name: '蓝色', value: '#2563eb' },
	{ name: '绿色', value: '#159b79' },
	{ name: '紫色', value: '#9364d8' },
	{ name: '白色', value: '#ffffff' }
];

export const BRUSH_SIZES = [
	{ name: '细', value: 3 },
	{ name: '中', value: 6 },
	{ name: '粗', value: 12 }
];

/** SVG path for normalized 0..1 points, smoothed through segment midpoints. */
export function strokePath(points: Point[]) {
	if (!points.length) return '';
	const first = points[0];
	if (points.length === 1) return `M ${first.x} ${first.y} l 0.0001 0.0001`;
	let path = `M ${first.x} ${first.y}`;
	for (let i = 1; i < points.length; i++) {
		const p = points[i - 1], q = points[i];
		path += ` Q ${p.x} ${p.y} ${(p.x + q.x) / 2} ${(p.y + q.y) / 2}`;
	}
	const last = points[points.length - 1];
	return `${path} L ${last.x} ${last.y}`;
}

/** Draw normalized strokes onto a canvas context whose user space is width x height CSS pixels. */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], width: number, height: number) {
	for (const stroke of strokes) {
		if (!stroke.points.length) continue;
		const at = (p: Point) => [p.x * width, p.y * height] as const;
		ctx.strokeStyle = stroke.color;
		ctx.lineWidth = stroke.size;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.beginPath();
		ctx.moveTo(...at(stroke.points[0]));
		if (stroke.points.length === 1) {
			const [x, y] = at(stroke.points[0]);
			ctx.lineTo(x + 0.1, y + 0.1);
		} else {
			for (let i = 1; i < stroke.points.length; i++) {
				const [px, py] = at(stroke.points[i - 1]), [qx, qy] = at(stroke.points[i]);
				ctx.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
			}
			ctx.lineTo(...at(stroke.points[stroke.points.length - 1]));
		}
		ctx.stroke();
	}
}
