import { error, fail } from '@sveltejs/kit';
import { loadGraph, updateGraph } from '$lib/server/store';
import { compilePlans } from '$lib/server/compile';
import type { IntentGraph } from '$lib/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	try {
		return { graph: await loadGraph(params.project) };
	} catch {
		error(404, 'No such project');
	}
};

// All mutations run through updateGraph: per-project write lock, one error
// path. The mutator returns a message to abort without saving.
async function act(
	projectId: string,
	mutate: (graph: IntentGraph) => string | void | Promise<string | void>
) {
	try {
		const message = await updateGraph(projectId, mutate);
		return message ? fail(400, { error: message }) : { ok: true };
	} catch (e) {
		return fail(404, { error: e instanceof Error ? e.message : 'Project not found' });
	}
}

export const actions: Actions = {
	// Confirm: the AI's proposal for this node is right as-is
	confirm: async ({ params, request }) => {
		const form = await request.formData();
		return act(params.project, (graph) => {
			const node = graph.nodes.find((n) => n.id === form.get('nodeId'));
			if (!node) return 'Node not found.';
			node.status = 'confirmed';
			node.provenance = { origin: 'human', confidence: 1, needsReview: false };
		});
	},

	// Correct: a one-line human fix to meaning — anything bigger becomes a question
	correct: async ({ params, request }) => {
		const form = await request.formData();
		return act(params.project, (graph) => {
			const node = graph.nodes.find((n) => n.id === form.get('nodeId'));
			if (!node) return 'Node not found.';
			const meaning = String(form.get('meaning') ?? '').trim();
			if (meaning) node.meaning = meaning;
			node.status = 'confirmed';
			node.provenance = { origin: 'human', confidence: 1, needsReview: false };
		});
	},

	setPurpose: async ({ params, request }) => {
		const form = await request.formData();
		return act(params.project, (graph) => {
			const screen = graph.screens.find((s) => s.id === form.get('screenId'));
			if (!screen) return 'Screen not found.';
			screen.purpose = String(form.get('purpose') ?? '').trim();
			screen.provenance = { origin: 'human', confidence: 1, needsReview: false };
		});
	},

	answer: async ({ params, request }) => {
		const form = await request.formData();
		return act(params.project, (graph) => {
			const question = graph.questions.find((q) => q.id === form.get('questionId'));
			if (!question) return 'Question not found.';
			const answer = String(form.get('answer') ?? '').trim();
			if (!answer) return 'Type an answer first.';
			question.answer = answer;
			question.status = 'answered';

			// Where the answer maps cleanly to a structured fact, apply it now;
			// richer answers get structured by the AI pass later.
			const screen = graph.screens.find((s) => question.nodeIds.includes(s.id));
			if (screen && !screen.purpose) {
				screen.purpose = answer;
				screen.provenance = { origin: 'human', confidence: 1, needsReview: false };
			}
			for (const node of graph.nodes.filter((n) => question.nodeIds.includes(n.id))) {
				if (!node.meaning) node.meaning = answer;
				// 'needsInput' here means: answered in prose, awaiting AI structuring
				node.status = 'needsInput';
			}
		});
	},

	dismiss: async ({ params, request }) => {
		const form = await request.formData();
		return act(params.project, (graph) => {
			const question = graph.questions.find((q) => q.id === form.get('questionId'));
			if (!question) return 'Question not found.';
			question.status = 'dismissed';
		});
	},

	compile: async ({ params }) => {
		let compiled = 0;
		const result = await act(params.project, async (graph) => {
			const { files } = await compilePlans(graph);
			compiled = files.length;
		});
		return 'ok' in result ? { ok: true, compiled } : result;
	}
};
