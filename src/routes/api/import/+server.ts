import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { triage } from '$lib/server/triage';
import { recompileAcceptanceCriteria } from '$lib/server/compile';
import { saveGraph } from '$lib/server/store';
import type { IntentGraph } from '$lib/schema';
import type { RequestHandler } from './$types';

// Import a graph built outside the REST ingest path (MCP-driven ingest, the
// future Agent SDK pass, or a hand-repaired export). The imported graph goes
// through the same triage + acceptance-criteria pipeline as native ingest.
export const POST: RequestHandler = async ({ request }) => {
	let graph: IntentGraph;
	try {
		graph = (await request.json()) as IntentGraph;
	} catch {
		error(400, 'Body must be an IntentGraph JSON document');
	}
	if (!graph?.project?.figmaFileKey || !Array.isArray(graph.screens) || !Array.isArray(graph.nodes)) {
		error(400, 'Graph is missing project.figmaFileKey, screens, or nodes');
	}

	graph.project.id ||= `p_${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
	graph.project.createdAt ||= new Date().toISOString();
	graph.questions ??= [];
	graph.sources ??= [];

	const triaged = graph.questions.length ? graph : triage(graph);
	recompileAcceptanceCriteria(triaged);
	await saveGraph(triaged);
	return json({ projectId: triaged.project.id, screens: triaged.screens.length, nodes: triaged.nodes.length, questions: triaged.questions.length });
};
