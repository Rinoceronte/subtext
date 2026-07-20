// Projections: the graph compiled outward.
// - acceptance criteria: derived, never authored
// - PM plan: epics/stories/tasks as markdown, every item deep-linked to Figma
// - agent plans: per-task build docs, explicit enough that agents don't guess
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { figmaDeepLink } from '$lib/schema';
import type { IntentGraph, IntentNode, Screen } from '$lib/schema';
import { plansDir } from './store';

export function deriveAcceptanceCriteria(graph: IntentGraph, node: IntentNode): string[] {
	const criteria: string[] = [];
	for (const i of node.interactions) {
		const targetScreen = graph.screens.find((s) => s.id === i.target);
		const target = targetScreen ? `the "${targetScreen.name}" screen` : (i.target ?? 'its target');
		if (i.action === 'navigate') criteria.push(`${i.trigger} on "${node.label}" navigates to ${target}.`);
		else if (i.action === 'openModal') criteria.push(`${i.trigger} on "${node.label}" opens ${target}.`);
		else criteria.push(`${i.trigger} on "${node.label}" performs ${i.action} against ${target}.`);
	}
	for (const rule of node.businessRules) {
		criteria.push(`"${node.label}" satisfies the ${rule.type}: ${rule.expression}`);
	}
	for (const state of node.states) {
		criteria.push(`When ${state.condition}, "${node.label}" ${state.behavior}`);
	}
	return criteria;
}

export function recompileAcceptanceCriteria(graph: IntentGraph): IntentGraph {
	for (const node of graph.nodes) {
		node.acceptanceCriteria = deriveAcceptanceCriteria(graph, node);
	}
	return graph;
}

const slug = (s: string) =>
	s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';

function taskNodes(graph: IntentGraph, screen: Screen): IntentNode[] {
	// A node earns its own task if it carries behavior or rules; pure layout
	// folds into the screen's layout task.
	return graph.nodes.filter(
		(n) =>
			n.screenId === screen.id &&
			(n.interactions.length || n.businessRules.length || n.states.length)
	);
}

function screenEpicMarkdown(graph: IntentGraph, screen: Screen, epicNum: number): string {
	const key = graph.project.figmaFileKey;
	const behavioral = taskNodes(graph, screen);
	const layoutCount = graph.nodes.filter((n) => n.screenId === screen.id).length - behavioral.length;

	const lines = [
		`# Epic ${epicNum}: ${screen.name}`,
		'',
		`**Figma:** ${figmaDeepLink(key, screen.figmaNodeId)}`,
		`**Purpose:** ${screen.purpose || '_unconfirmed_'}`,
		'',
		`## Tasks`,
		'',
		`### Task ${epicNum}.0 — Build the ${screen.name} layout`,
		`Implement the screen structure per the design (${layoutCount} layout nodes). [Figma](${figmaDeepLink(key, screen.figmaNodeId)})`,
		''
	];
	behavioral.forEach((node, i) => {
		lines.push(`### Task ${epicNum}.${i + 1} — ${node.label} (${node.role})`);
		lines.push(`[Figma](${figmaDeepLink(key, node.figmaNodeId)}) · status: ${node.status}`);
		if (node.meaning) lines.push(`> ${node.meaning}`);
		lines.push('', '**Acceptance criteria:**');
		const criteria = node.acceptanceCriteria.length
			? node.acceptanceCriteria
			: ['_none derived yet — annotate before building_'];
		for (const c of criteria) lines.push(`- [ ] ${c}`);
		lines.push('');
	});
	return lines.join('\n');
}

function agentPlanMarkdown(graph: IntentGraph, screen: Screen, node: IntentNode): string {
	const key = graph.project.figmaFileKey;
	return [
		`# Build plan: ${node.label}`,
		'',
		`Screen: **${screen.name}** — ${screen.purpose || '(purpose unconfirmed)'}`,
		`Design node: ${figmaDeepLink(key, node.figmaNodeId)} (\`${node.figmaNodeType}\`, role: ${node.role})`,
		'',
		'## Behavior',
		...node.interactions.map((i) => {
			const t = graph.screens.find((s) => s.id === i.target);
			return `- on \`${i.trigger}\`: \`${i.action}\` → ${t ? `${t.name} (${figmaDeepLink(key, t.figmaNodeId)})` : (i.target ?? 'unspecified')}`;
		}),
		'',
		'## Business rules',
		...(node.businessRules.length
			? node.businessRules.map((r) => `- **${r.type}**: \`${r.expression}\` (inputs: ${r.inputs.join(', ') || 'none listed'})`)
			: ['- none bound']),
		'',
		'## Conditional states',
		...(node.states.length
			? node.states.map((s) => `- when ${s.condition}: ${s.behavior}`)
			: ['- none bound']),
		'',
		'## Acceptance criteria',
		...node.acceptanceCriteria.map((c) => `- [ ] ${c}`),
		'',
		'## Reporting',
		`When implemented, report the \`builtRef\` (route/component/selector) for node \`${node.id}\` back to the intent graph.`,
		''
	].join('\n');
}

export async function compilePlans(graph: IntentGraph): Promise<{ files: string[] }> {
	recompileAcceptanceCriteria(graph);
	const dir = plansDir(graph.project.id);
	await mkdir(join(dir, 'build-plans'), { recursive: true });
	const files: string[] = [];

	for (const [i, screen] of graph.screens.entries()) {
		const epicFile = `epic-${String(i + 1).padStart(2, '0')}-${slug(screen.name)}.md`;
		await writeFile(join(dir, epicFile), screenEpicMarkdown(graph, screen, i + 1));
		files.push(epicFile);

		for (const node of taskNodes(graph, screen)) {
			const planFile = join('build-plans', `${slug(screen.name)}--${slug(node.label)}--${node.id}.md`);
			await writeFile(join(dir, planFile), agentPlanMarkdown(graph, screen, node));
			files.push(planFile);
		}
	}
	return { files };
}
