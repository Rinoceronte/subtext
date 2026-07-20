// Triage: find where meaning is unclear or behavior is hiding, and turn it
// into ClarifyingQuestions. Never guess — ambiguity becomes a question.
//
// This first version is deterministic heuristics. The AI pass (Agent SDK)
// slots in here later and should follow the same contract: it may propose
// (origin: 'inferred', needsReview: true) and it may ask, but never fabricate.
import type { ClarifyingQuestion, IntentGraph } from '$lib/schema';

const MAX_QUESTIONS_PER_SCREEN = 6; // triage, don't interrogate

export function triage(graph: IntentGraph): IntentGraph {
	const questions: ClarifyingQuestion[] = [];
	let seq = 0;
	const ask = (nodeIds: string[], question: string, why: string) => {
		questions.push({ id: `q_${++seq}`, nodeIds, question, why, status: 'open' });
	};

	for (const screen of graph.screens) {
		const before = questions.length;
		const screenNodes = graph.nodes.filter((n) => n.screenId === screen.id);

		for (const node of screenNodes) {
			if (questions.length - before >= MAX_QUESTIONS_PER_SCREEN) break;

			// A button that goes nowhere is the canonical hidden intent
			if (node.role === 'button' && node.interactions.length === 0) {
				ask(
					[node.id],
					`What should "${node.label}" do?`,
					'Button with no prototype link — the design is silent about its behavior.'
				);
			}

			// A display field that smells computed is where formulas hide
			if (node.role === 'displayField' && node.businessRules.length === 0) {
				ask(
					[node.id],
					`Is "${node.label}" computed? If so, what drives it?`,
					'Field name suggests a derived value; no rule is bound to it yet.'
				);
			}

			// A navigation target we couldn't resolve to a known screen
			for (const interaction of node.interactions) {
				if (
					interaction.action === 'navigate' &&
					interaction.target &&
					!graph.screens.some((s) => s.id === interaction.target)
				) {
					ask(
						[node.id],
						`"${node.label}" links to a frame that isn't a screen here — where should it go?`,
						`Prototype target ${interaction.target} did not resolve to an ingested screen.`
					);
				}
			}
		}

		// A screen whose purpose we couldn't state is unreviewable
		if (!screen.purpose) {
			ask(
				[screen.id],
				`In one line: what is the "${screen.name}" screen for?`,
				'Screen purpose cannot be inferred from the frame name alone.'
			);
		}
	}

	return { ...graph, questions: [...graph.questions, ...questions] };
}
