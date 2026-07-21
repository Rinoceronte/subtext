import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { loadGraph, plansDir } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	let graph;
	try {
		graph = await loadGraph(params.project);
	} catch {
		error(404, 'No such project');
	}

	const dir = plansDir(params.project);
	let epics: string[] = [];
	let buildPlans: string[] = [];
	try {
		epics = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
		buildPlans = (await readdir(join(dir, 'build-plans'))).filter((f) => f.endsWith('.md')).sort();
	} catch {
		// nothing compiled yet — page shows the empty state
	}

	// The file param is only ever honored if it exactly matches a discovered
	// file — never joined into a path from raw user input.
	const requested = url.searchParams.get('file');
	const valid =
		requested && (epics.includes(requested) || buildPlans.includes(requested.replace(/^build-plans\//, '')));
	let selected: { name: string; content: string } | null = null;
	if (requested && valid) {
		const rel = epics.includes(requested) ? requested : join('build-plans', requested.replace(/^build-plans\//, ''));
		selected = { name: requested, content: await readFile(join(dir, rel), 'utf-8') };
	}

	return { projectName: graph.project.name, epics, buildPlans, selected };
};
