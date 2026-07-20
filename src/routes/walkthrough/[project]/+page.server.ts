import { error, fail } from '@sveltejs/kit';
import { loadGraph, saveGraph } from '$lib/server/store';
import { compilePlans, recompileAcceptanceCriteria } from '$lib/server/compile';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		return { graph: await loadGraph(params.project) };
	} catch {
		error(404, 'No such project');
	}
};

export const actions: Actions = {
	// Confirm: the AI's proposal for this node is right as-is
	confirm: async ({ params, request }) => {
		const form = await request.formData();
		const graph = await loadGraph(params.project);
		const node = graph.nodes.find((n) => n.id === form.get('nodeId'));
		if (!node) return fail(404, { error: 'node not found' });
		node.status = 'confirmed';
		node.provenance = { origin: 'human', confidence: 1, needsReview: false };
		await saveGraph(graph);
		return { ok: true };
	},

	// Correct: a one-line human fix to label/meaning — anything bigger becomes a question
	correct: async ({ params, request }) => {
		const form = await request.formData();
		const graph = await loadGraph(params.project);
		const node = graph.nodes.find((n) => n.id === form.get('nodeId'));
		if (!node) return fail(404, { error: 'node not found' });
		const meaning = String(form.get('meaning') ?? '').trim();
		if (meaning) node.meaning = meaning;
		node.status = 'confirmed';
		node.provenance = { origin: 'human', confidence: 1, needsReview: false };
		await saveGraph(graph);
		return { ok: true };
	},

	setPurpose: async ({ params, request }) => {
		const form = await request.formData();
		const graph = await loadGraph(params.project);
		const screen = graph.screens.find((s) => s.id === form.get('screenId'));
		if (!screen) return fail(404, { error: 'screen not found' });
		screen.purpose = String(form.get('purpose') ?? '').trim();
		screen.provenance = { origin: 'human', confidence: 1, needsReview: false };
		await saveGraph(graph);
		return { ok: true };
	},

	answer: async ({ params, request }) => {
		const form = await request.formData();
		const graph = await loadGraph(params.project);
		const question = graph.questions.find((q) => q.id === form.get('questionId'));
		if (!question) return fail(404, { error: 'question not found' });
		const answer = String(form.get('answer') ?? '').trim();
		if (!answer) return fail(400, { error: 'empty answer' });
		question.answer = answer;
		question.status = 'answered';

		// Where the answer maps cleanly to a structured fact, apply it now.
		// (Screen-purpose questions bind directly; richer answers get structured
		// by the AI pass later — the Q&A record itself is provenance either way.)
		const screen = graph.screens.find((s) => question.nodeIds.includes(s.id));
		if (screen && !screen.purpose) {
			screen.purpose = answer;
			screen.provenance = { origin: 'human', confidence: 1, needsReview: false };
		}
		for (const node of graph.nodes.filter((n) => question.nodeIds.includes(n.id))) {
			node.status = 'needsInput';
			if (!node.meaning) node.meaning = answer;
		}
		await saveGraph(graph);
		return { ok: true };
	},

	dismiss: async ({ params, request }) => {
		const form = await request.formData();
		const graph = await loadGraph(params.project);
		const question = graph.questions.find((q) => q.id === form.get('questionId'));
		if (!question) return fail(404, { error: 'question not found' });
		question.status = 'dismissed';
		await saveGraph(graph);
		return { ok: true };
	},

	compile: async ({ params }) => {
		const graph = await loadGraph(params.project);
		recompileAcceptanceCriteria(graph);
		const { files } = await compilePlans(graph);
		await saveGraph(graph);
		return { ok: true, compiled: files.length };
	}
};
