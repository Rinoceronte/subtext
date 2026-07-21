// Backfill node bounding boxes (screen-relative design px) and screen sizes
// onto an existing project from MCP metadata XML. Metadata x/y are relative
// to the parent element, so absolutes are accumulated during the walk.
//
// Usage: node scripts/backfill-bbox.mjs <metadata.txt> <projectId>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inputPath, projectId] = process.argv;
if (!inputPath || !projectId) {
	console.error('usage: node scripts/backfill-bbox.mjs <metadata> <projectId>');
	process.exit(1);
}

const raw = readFileSync(inputPath, 'utf-8');
let xml = raw;
if (raw.trimStart().startsWith('[')) {
	xml = JSON.parse(raw)
		.map((part) => part.text ?? '')
		.join('\n');
}

const OPEN = /^\s*<(\w+)((?:\s+[\w-]+="[^"]*")*)\s*(\/?)>/;
const CLOSE = /^\s*<\/(\w+)>/;
const ATTR = /([\w-]+)="([^"]*)"/g;

const root = { tag: 'root', attrs: {}, children: [] };
const stack = [root];
for (const line of xml.split('\n')) {
	if (line.match(CLOSE)) {
		stack.pop();
		continue;
	}
	const open = line.match(OPEN);
	if (!open) continue;
	const attrs = {};
	for (const m of open[2].matchAll(ATTR)) attrs[m[1]] = m[2];
	const node = { tag: open[1], attrs, children: [] };
	stack[stack.length - 1].children.push(node);
	if (!open[3]) stack.push(node);
}

const graphPath = `data/projects/${projectId}/graph.json`;
const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
const screenRoots = new Set(graph.screens.map((s) => s.figmaNodeId));
const screenSize = new Map();
const bboxes = new Map();

(function walk(el, absX, absY, origin) {
	const x = absX + Number(el.attrs?.x ?? 0);
	const y = absY + Number(el.attrs?.y ?? 0);
	const w = Number(el.attrs?.width ?? 0);
	const h = Number(el.attrs?.height ?? 0);
	const id = el.attrs?.id;

	let nextOrigin = origin;
	if (id && screenRoots.has(id)) {
		screenSize.set(id, { w, h });
		nextOrigin = { x, y };
	} else if (id && nextOrigin) {
		bboxes.set(id, {
			x: Math.round(x - nextOrigin.x),
			y: Math.round(y - nextOrigin.y),
			w: Math.round(w),
			h: Math.round(h)
		});
	}
	for (const child of el.children) walk(child, x, y, nextOrigin);
})(root, 0, 0, null);

let sized = 0;
for (const screen of graph.screens) {
	const size = screenSize.get(screen.figmaNodeId);
	if (size?.w && size?.h) {
		screen.size = size;
		sized++;
	}
}
let boxed = 0;
for (const node of graph.nodes) {
	const bbox = bboxes.get(node.figmaNodeId);
	if (bbox) {
		node.bbox = bbox;
		boxed++;
	}
}

writeFileSync(graphPath, JSON.stringify(graph, null, '\t'));
console.log(`sized ${sized} screens, boxed ${boxed} nodes`);
