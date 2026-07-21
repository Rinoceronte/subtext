// Export the structuring-pass work list: nodes that carry prose intent
// (meaning and/or answered questions) but no structured behavior yet.
// Chunks land in the scratchpad dir for agents to process.
//
// Usage: node scripts/export-structuring-work.mjs <projectId> <outDir> [chunks=2]
import { readFileSync, writeFileSync } from 'node:fs';

const [, , projectId, outDir, chunkArg] = process.argv;
if (!projectId || !outDir) {
	console.error('usage: node scripts/export-structuring-work.mjs <projectId> <outDir> [chunks]');
	process.exit(1);
}

const graph = JSON.parse(readFileSync(`data/projects/${projectId}/graph.json`, 'utf-8'));
const screensById = new Map(graph.screens.map((s) => [s.id, s]));

const qaByNode = new Map();
for (const q of graph.questions) {
	if (q.status !== 'answered' || !q.answer) continue;
	for (const id of q.nodeIds) {
		if (!qaByNode.has(id)) qaByNode.set(id, []);
		qaByNode.get(id).push({ question: q.question, answer: q.answer });
	}
}

const targets = graph.nodes.filter(
	(n) =>
		n.status !== 'confirmed' &&
		(n.meaning || qaByNode.has(n.id)) &&
		n.interactions.length + n.businessRules.length + n.states.length === 0
);

const items = targets.map((n) => {
	const screen = screensById.get(n.screenId);
	return {
		nodeId: n.id,
		label: n.label,
		role: n.role,
		figmaNodeName: n.figmaNodeName,
		meaning: n.meaning ?? null,
		qa: qaByNode.get(n.id) ?? [],
		screen: {
			id: n.screenId,
			name: screen?.name ?? '',
			purpose: screen?.purpose ?? '',
			renderPath: screen?.imageUrl?.startsWith('/renders/')
				? `${process.cwd()}/static${screen.imageUrl}`
				: null
		}
	};
});

// Screen directory so navigation targets can be bound to real screen ids
const screenIndex = graph.screens.map((s) => ({ id: s.id, name: s.name }));

const chunks = Number(chunkArg) || 2;
const per = Math.ceil(items.length / chunks);
for (let i = 0; i < chunks; i++) {
	writeFileSync(
		`${outDir}/structure-chunk-${i + 1}.json`,
		JSON.stringify({ screens: screenIndex, items: items.slice(i * per, (i + 1) * per) }, null, 2)
	);
}
console.log(`${items.length} nodes to structure across ${chunks} chunks`);
