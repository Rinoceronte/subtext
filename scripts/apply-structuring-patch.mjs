// Apply structuring-pass patches: structured behavior proposed from prose.
// Same contract as the triage applier — inferred + needsReview, only fills
// empty behavior arrays, never touches confirmed nodes.
//
// Usage: node scripts/apply-structuring-patch.mjs <projectId> <patch...>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , projectId, ...patchPaths] = process.argv;
if (!projectId || !patchPaths.length) {
	console.error('usage: node scripts/apply-structuring-patch.mjs <projectId> <patch...>');
	process.exit(1);
}

const TRIGGERS = new Set(['click', 'submit', 'change', 'load', 'hover']);
const ACTIONS = new Set(['navigate', 'mutate', 'compute', 'openModal', 'callApi']);
const RULE_TYPES = new Set(['formula', 'validation', 'conditional', 'derivation']);

const graphPath = `data/projects/${projectId}/graph.json`;
const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
const screenIds = new Set(graph.screens.map((s) => s.id));

const counts = { structured: 0, interactions: 0, rules: 0, states: 0, bindings: 0, rejected: 0 };

for (const path of patchPaths) {
	const patch = JSON.parse(readFileSync(path, 'utf-8'));
	for (const p of patch.nodes ?? []) {
		const node = nodesById.get(p.id);
		if (!node || node.status === 'confirmed') {
			counts.rejected++;
			continue;
		}

		const interactions = (p.interactions ?? []).filter(
			(i) =>
				TRIGGERS.has(i.trigger) &&
				ACTIONS.has(i.action) &&
				(i.action !== 'navigate' || !i.target || screenIds.has(i.target))
		);
		const rules = (p.businessRules ?? []).filter(
			(r) => RULE_TYPES.has(r.type) && typeof r.expression === 'string' && r.expression.length
		);
		const states = (p.states ?? []).filter((s) => s.condition && s.behavior);
		const bindings = (p.dataBindings ?? []).filter(
			(b) => b.source && b.field && ['read', 'write', 'readwrite'].includes(b.direction)
		);

		if (!interactions.length && !rules.length && !states.length && !bindings.length) continue;

		if (!node.interactions.length) node.interactions = interactions;
		if (!node.businessRules.length)
			node.businessRules = rules.map((r) => ({ ...r, inputs: r.inputs ?? [] }));
		if (!node.states.length) node.states = states;
		if (!node.dataBindings.length) node.dataBindings = bindings;

		node.provenance = { origin: 'inferred', confidence: 0.8, needsReview: true };
		if (node.status === 'needsInput') node.status = 'draft'; // structured — now awaiting confirm
		counts.structured++;
		counts.interactions += interactions.length;
		counts.rules += rules.length;
		counts.states += states.length;
		counts.bindings += bindings.length;
	}
}

writeFileSync(graphPath, JSON.stringify(graph, null, '\t'));
console.log(JSON.stringify(counts));
