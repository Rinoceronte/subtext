// JSON-file graph store. Deliberately shaped so a Postgres swap is mechanical:
// one graph per project, whole-document read/write, no cross-project queries.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import type { IntentGraph } from '$lib/schema';

const dataDir = () => env.DATA_DIR || 'data';
const projectDir = (id: string) => join(dataDir(), 'projects', id);

export async function saveGraph(graph: IntentGraph): Promise<void> {
	const dir = projectDir(graph.project.id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'graph.json'), JSON.stringify(graph, null, '\t'));
}

export async function loadGraph(projectId: string): Promise<IntentGraph> {
	const raw = await readFile(join(projectDir(projectId), 'graph.json'), 'utf-8');
	return JSON.parse(raw) as IntentGraph;
}

export async function listProjects(): Promise<IntentGraph['project'][]> {
	try {
		const ids = await readdir(join(dataDir(), 'projects'));
		const projects = [];
		for (const id of ids) {
			try {
				projects.push((await loadGraph(id)).project);
			} catch {
				// skip corrupt/partial entries
			}
		}
		return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	} catch {
		return [];
	}
}

export function plansDir(projectId: string): string {
	return join(projectDir(projectId), 'plans');
}
