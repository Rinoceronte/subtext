// Fix generic component-instance labels ("PFL Button") on an existing project
// by deriving each node's label from its first visible descendant text layer
// in the MCP metadata XML, then rewriting affected open-question texts.
//
// Usage: node scripts/relabel-from-metadata.mjs <metadata.txt> <projectId>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inputPath, projectId] = process.argv;
if (!inputPath || !projectId) {
	console.error('usage: node scripts/relabel-from-metadata.mjs <metadata> <projectId>');
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
	for (const m of open[2].matchAll(ATTR)) attrs[m[1]] = unescape(m[2]);
	const node = { tag: open[1], attrs, children: [] };
	stack[stack.length - 1].children.push(node);
	if (!open[3]) stack.push(node);
}

// Figma auto-names text layers by their content; the first visible text
// descendant is the closest thing metadata has to a control's visible label.
// Skip obvious placeholder/system layer names.
const BAD_TEXT = /^(placeholdertext|label|text|title|value)$/i;
function firstText(el) {
	for (const child of el.children) {
		if (child.attrs.hidden === 'true') continue;
		if (child.tag === 'text') {
			const name = child.attrs.name ?? '';
			if (name && !BAD_TEXT.test(name)) return name;
		}
		const nested = firstText(child);
		if (nested) return nested;
	}
	return null;
}

const derived = new Map();
(function walk(el) {
	if (el.attrs?.id) {
		const text = firstText(el);
		if (text) derived.set(el.attrs.id, text);
	}
	for (const child of el.children) walk(child);
})(root);

// Instances don't expose their inner text in metadata. When same-named
// siblings would collide ("PFL Button" twice in a row), qualify them by
// their x-order — a positional fact, not a guess.
(function disambiguate(el) {
	const groups = new Map();
	for (const child of el.children) {
		const name = child.attrs?.name;
		if (!name || derived.has(child.attrs.id)) continue;
		if (!groups.has(name)) groups.set(name, []);
		groups.get(name).push(child);
	}
	for (const [name, group] of groups) {
		if (group.length < 2) continue;
		group.sort((a, b) => Number(a.attrs.x ?? 0) - Number(b.attrs.x ?? 0));
		const qual =
			group.length === 2
				? ['left', 'right']
				: group.length === 3
					? ['left', 'middle', 'right']
					: group.map((_, i) => `#${i + 1}`);
		group.forEach((child, i) => derived.set(child.attrs.id, `${name} (${qual[i]})`));
	}
	for (const child of el.children) disambiguate(child);
})(root);

const graphPath = `data/projects/${projectId}/graph.json`;
const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));

let relabeled = 0;
const newLabels = new Map();
for (const node of graph.nodes) {
	// Only fix labels that are still the raw layer/component name
	if (node.label !== node.figmaNodeName) continue;
	const better = derived.get(node.figmaNodeId);
	if (better && better !== node.label) {
		node.label = better;
		newLabels.set(node.id, better);
		relabeled++;
	}
}

let requestioned = 0;
for (const q of graph.questions) {
	if (q.status !== 'open') continue;
	const label = q.nodeIds.map((id) => newLabels.get(id)).find(Boolean);
	if (!label) continue;
	if (q.question.startsWith('What should "')) {
		q.question = `What should the "${label}" button do?`;
		requestioned++;
	} else if (q.question.startsWith('Is "')) {
		q.question = `Is "${label}" computed? If so, what drives it?`;
		requestioned++;
	}
}

writeFileSync(graphPath, JSON.stringify(graph, null, '\t'));
console.log(`relabeled ${relabeled} nodes, rewrote ${requestioned} questions`);
