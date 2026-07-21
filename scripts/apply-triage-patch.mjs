// Apply AI-triage patch files to a project graph. AI proposes, human corrects:
// everything lands as origin 'inferred' + needsReview, never overwrites
// human-entered data, and never touches confirmed nodes.
//
// Usage: node scripts/apply-triage-patch.mjs <projectId> <patch.json> [more patches...]
import { readFileSync, writeFileSync } from 'node:fs';

const [, , projectId, ...patchPaths] = process.argv;
if (!projectId || !patchPaths.length) {
	console.error('usage: node scripts/apply-triage-patch.mjs <projectId> <patch...>');
	process.exit(1);
}

const graphPath = `data/projects/${projectId}/graph.json`;
const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
const screensById = new Map(graph.screens.map((s) => [s.id, s]));
const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
const questionsById = new Map(graph.questions.map((q) => [q.id, q]));

const AI = { origin: 'inferred', confidence: 0.85, needsReview: true };
const counts = { purposes: 0, nodes: 0, dismissed: 0, refined: 0, skipped: 0 };

for (const path of patchPaths) {
	const patch = JSON.parse(readFileSync(path, 'utf-8'));

	for (const p of patch.screens ?? []) {
		const screen = screensById.get(p.screenId);
		if (!screen || !p.purpose) continue;
		if (screen.purpose && screen.provenance.origin === 'human') {
			counts.skipped++;
			continue;
		}
		screen.purpose = p.purpose;
		screen.provenance = { ...AI };
		counts.purposes++;
	}

	for (const p of patch.nodes ?? []) {
		const node = nodesById.get(p.id);
		if (!node || node.status === 'confirmed') {
			if (node) counts.skipped++;
			continue;
		}
		if (p.label) node.label = p.label;
		if (p.meaning && !node.meaning) node.meaning = p.meaning;
		if (p.role) node.role = p.role;
		node.provenance = { ...AI };
		counts.nodes++;
	}

	for (const id of patch.dismiss ?? []) {
		const q = questionsById.get(id);
		if (q?.status === 'open') {
			q.status = 'dismissed';
			counts.dismissed++;
		}
	}

	for (const p of patch.refine ?? []) {
		const q = questionsById.get(p.id);
		if (q?.status === 'open' && p.question) {
			q.question = p.question;
			counts.refined++;
		}
	}
}

writeFileSync(graphPath, JSON.stringify(graph, null, '\t'));
console.log(JSON.stringify(counts));
