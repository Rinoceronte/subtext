import { fail, redirect } from '@sveltejs/kit';
import { ingestFile, parseFileKey } from '$lib/server/figma';
import { triage } from '$lib/server/triage';
import { recompileAcceptanceCriteria } from '$lib/server/compile';
import { listProjects, saveGraph } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return { projects: await listProjects() };
};

export const actions: Actions = {
	project: async ({ request }) => {
		const form = await request.formData();
		const url = String(form.get('figmaUrl') ?? '').trim();
		if (!url) return fail(400, { error: 'Paste a Figma file link first.' });

		let projectId: string;
		try {
			const graph = triage(await ingestFile(parseFileKey(url)));
			recompileAcceptanceCriteria(graph);
			await saveGraph(graph);
			projectId = graph.project.id;
		} catch (e) {
			return fail(502, { error: e instanceof Error ? e.message : 'Ingest failed' });
		}
		redirect(303, `/walkthrough/${projectId}`);
	}
};
