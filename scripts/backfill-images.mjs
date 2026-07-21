// Backfill screen.imageUrl on an existing project via the Figma image-export
// API (a different rate bucket than file content). Run while the dev server
// is idle — this edits graph.json directly.
//
// Usage: node scripts/backfill-images.mjs <projectId>
import { readFileSync, writeFileSync } from 'node:fs';

const projectId = process.argv[2];
if (!projectId) {
	console.error('usage: node scripts/backfill-images.mjs <projectId>');
	process.exit(1);
}

const token = readFileSync('.env', 'utf-8').match(/^FIGMA_TOKEN=(.+)$/m)?.[1];
if (!token) {
	console.error('FIGMA_TOKEN not found in .env');
	process.exit(1);
}

const graphPath = `data/projects/${projectId}/graph.json`;
const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));

// Giant screens hit "Render timeout" on fat batches/scales — go small, and
// drop to individual requests at scale 1 when a batch still times out.
async function fetchImages(screens, scale) {
	const ids = screens.map((s) => encodeURIComponent(s.figmaNodeId)).join(',');
	const res = await fetch(
		`https://api.figma.com/v1/images/${graph.project.figmaFileKey}?ids=${ids}&format=png&scale=${scale}`,
		{ headers: { 'X-Figma-Token': token } }
	);
	if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
	return (await res.json()).images ?? {};
}

let filled = 0;
const pending = graph.screens.filter((s) => !s.imageUrl);
for (let i = 0; i < pending.length; i += 8) {
	const batch = pending.slice(i, i + 8);
	try {
		const images = await fetchImages(batch, 1);
		for (const screen of batch) {
			if (images[screen.figmaNodeId]) {
				screen.imageUrl = images[screen.figmaNodeId];
				filled++;
			}
		}
	} catch (e) {
		console.error(`batch failed (${e.message.slice(0, 80)}), retrying singly`);
		for (const screen of batch) {
			try {
				const images = await fetchImages([screen], 1);
				if (images[screen.figmaNodeId]) {
					screen.imageUrl = images[screen.figmaNodeId];
					filled++;
				}
			} catch {
				console.error(`  no render for "${screen.name}"`);
			}
			await new Promise((r) => setTimeout(r, 300));
		}
	}
	process.stdout.write(`\r${filled}/${pending.length}`);
	await new Promise((r) => setTimeout(r, 500));
}
console.log();

writeFileSync(graphPath, JSON.stringify(graph, null, '\t'));
console.log(`filled ${filled}/${graph.screens.length} screen images`);
