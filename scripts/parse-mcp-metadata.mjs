// Parse Figma MCP get_metadata XML into a subtext IntentGraph and POST it
// to /api/import. Used when REST-quota is exhausted and ingest runs through
// an MCP session instead.
//
// Usage: node scripts/parse-mcp-metadata.mjs <tool-result.txt|.xml> <fileKey> [importUrl]
// The input is either the raw XML or the saved MCP tool-result JSON ([{type,text}]).
import { readFileSync } from 'node:fs';

const [, , inputPath, fileKey, importUrl = 'http://localhost:5173/api/import'] = process.argv;
if (!inputPath || !fileKey) {
	console.error('usage: node scripts/parse-mcp-metadata.mjs <input> <fileKey> [importUrl]');
	process.exit(1);
}

const raw = readFileSync(inputPath, 'utf-8');
let xml = raw;
if (raw.trimStart().startsWith('[')) {
	xml = JSON.parse(raw)
		.map((part) => part.text ?? '')
		.join('\n');
}

const unescape = (s) =>
	s
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&');

// The MCP metadata XML is pretty-printed one tag per line — parse it with a stack.
const OPEN = /^\s*<(\w+)((?:\s+[\w-]+="[^"]*")*)\s*(\/?)>/;
const CLOSE = /^\s*<\/(\w+)>/;
const ATTR = /([\w-]+)="([^"]*)"/g;

const root = { tag: 'root', children: [] };
const stack = [root];
for (const line of xml.split('\n')) {
	const close = line.match(CLOSE);
	if (close) {
		stack.pop();
		continue;
	}
	const open = line.match(OPEN);
	if (!open) continue;
	const attrs = {};
	for (const m of open[2].matchAll(ATTR)) attrs[m[1]] = unescape(m[2]);
	const node = { tag: open[1], attrs, children: [] };
	stack[stack.length - 1].children.push(node);
	if (!open[3]) stack.push(node); // not self-closing
}

const canvas = root.children[0];
if (!canvas) {
	console.error('no root canvas found in metadata');
	process.exit(1);
}

// Same role heuristics as src/lib/server/figma.ts, adapted to metadata
// (no characters, no prototype links — triage will ask about behavior).
function inferRole(tag, name) {
	const n = name.toLowerCase();
	if (/\b(button|btn|cta)\b/.test(n)) return 'button';
	if (/\b(input|field|textbox|search|select|dropdown|checkbox|radio|toggle)\b/.test(n)) return 'input';
	if (/\b(list|table|grid|row|card list|items)\b/.test(n)) return 'list';
	if (/\b(nav|menu|tab|header|footer|sidebar|breadcrumb)\b/.test(n)) return 'nav';
	if (/\b(total|subtotal|sum|price|amount|balance|count|qty|quantity)\b/.test(n)) return 'displayField';
	if (tag === 'text') return 'text';
	if (tag === 'instance') return 'section';
	if (tag === 'frame' || tag === 'group') return 'container';
	if (/image|img|photo|icon|logo/.test(n)) return 'image';
	return 'unknown';
}

const isInteresting = (tag, role, attrs) =>
	attrs.hidden !== 'true' && (tag === 'instance' || (role !== 'container' && role !== 'unknown' && role !== 'image'));

const MAX_NODES_PER_SCREEN = 150;
const MIN_SCREEN_PX = 100;

const screens = [];
const nodes = [];

function addScreen(el, sectionName) {
	const { id, name, width, height } = el.attrs;
	if (Number(width) < MIN_SCREEN_PX || Number(height) < MIN_SCREEN_PX) return;
	const screenId = `s_${id.replace(/[:;]/g, '-')}`;
	screens.push({
		id: screenId,
		figmaNodeId: id,
		name: sectionName ? `${sectionName} / ${name}` : name,
		purpose: '',
		size: { w: Math.round(Number(width)), h: Math.round(Number(height)) },
		provenance: { origin: 'inferred', confidence: 0.4, needsReview: true }
	});

	let count = 0;
	let dropped = 0;
	// metadata x/y are parent-relative; accumulate to screen-relative
	const walk = (node, offX, offY) => {
		const role = inferRole(node.tag, node.attrs.name ?? '');
		if (isInteresting(node.tag, role, node.attrs)) {
			if (count >= MAX_NODES_PER_SCREEN) {
				dropped++;
			} else {
				count++;
				nodes.push({
					id: `n_${node.attrs.id.replace(/[:;]/g, '-')}`,
					figmaNodeId: node.attrs.id,
					figmaNodeName: node.attrs.name ?? '',
					figmaNodeType: node.tag.toUpperCase(),
					screenId,
					role,
					label: node.attrs.name ?? '',
					bbox: {
						x: Math.round(offX + Number(node.attrs.x ?? 0)),
						y: Math.round(offY + Number(node.attrs.y ?? 0)),
						w: Math.round(Number(node.attrs.width ?? 0)),
						h: Math.round(Number(node.attrs.height ?? 0))
					},
					interactions: [],
					dataBindings: [],
					businessRules: [],
					states: [],
					acceptanceCriteria: [],
					provenance: { origin: 'inferred', confidence: 0.5, needsReview: true },
					status: 'draft'
				});
			}
		}
		const childX = offX + Number(node.attrs.x ?? 0);
		const childY = offY + Number(node.attrs.y ?? 0);
		for (const child of node.children) walk(child, childX, childY);
	};
	for (const child of el.children) walk(child, 0, 0);
	if (dropped > 0) screens[screens.length - 1].truncatedNodes = dropped;
}

// Screens = frames directly under the canvas, and frames directly under sections.
for (const child of canvas.children) {
	if (child.tag === 'section') {
		for (const frame of child.children) {
			if (frame.tag === 'frame' || frame.tag === 'instance') addScreen(frame, child.attrs.name);
		}
	} else if (child.tag === 'frame') {
		addScreen(child, null);
	}
}

const graph = {
	project: {
		id: '',
		name: canvas.attrs.name?.replace(/^↳\s*/, '') || fileKey,
		figmaFileKey: fileKey,
		createdAt: ''
	},
	screens,
	nodes,
	questions: [],
	sources: []
};

const res = await fetch(importUrl, {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(graph)
});
if (!res.ok) {
	console.error(`import failed: ${res.status} ${await res.text()}`);
	process.exit(1);
}
console.log(JSON.stringify(await res.json(), null, 2));
