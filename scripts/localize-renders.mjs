// Download remote screen renders to static/renders/ and repoint the graph at
// the local copies — Figma's signed URLs expire; local files don't.
// Usage: node scripts/localize-renders.mjs <projectId>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const projectId = process.argv[2];
const graphPath = `data/projects/${projectId}/graph.json`;
const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
mkdirSync('static/renders', { recursive: true });

let localized = 0;
for (const screen of graph.screens) {
	if (!screen.imageUrl?.startsWith('http')) continue;
	const file = `${screen.figmaNodeId.replace(/[:;]/g, '-')}.png`;
	const res = await fetch(screen.imageUrl);
	if (!res.ok) {
		console.error(`failed ${screen.name}: ${res.status}`);
		continue;
	}
	writeFileSync(`static/renders/${file}`, Buffer.from(await res.arrayBuffer()));
	screen.imageUrl = `/renders/${file}`;
	localized++;
}
writeFileSync(graphPath, JSON.stringify(graph, null, '\t'));
console.log(`localized ${localized} renders`);
