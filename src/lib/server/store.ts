// JSON-file graph store. Deliberately shaped so a Postgres swap is mechanical:
// one graph per project, whole-document read/write, no cross-project queries.
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';
import type { IntentGraph } from '$lib/schema';

const dataDir = () => env.DATA_DIR || 'data';

// Route params reach this module — without this check, join() would follow
// ../ segments out of the data directory.
const VALID_PROJECT_ID = /^p_[a-z0-9-]+$/;

function projectDir(id: string): string {
	if (!VALID_PROJECT_ID.test(id)) throw new Error(`invalid project id: ${id}`);
	return join(dataDir(), 'projects', id);
}

export async function saveGraph(graph: IntentGraph): Promise<void> {
	const dir = projectDir(graph.project.id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'graph.json'), JSON.stringify(graph, null, '\t'));
}

export async function loadGraph(projectId: string): Promise<IntentGraph> {
	const raw = await readFile(join(projectDir(projectId), 'graph.json'), 'utf-8');
	return JSON.parse(raw) as IntentGraph;
}

// Serialize load→mutate→save per project so two concurrent form submissions
// can't clobber each other's writes. In-process is enough for a single node.
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
	const tail = locks.get(id) ?? Promise.resolve();
	const run = tail.then(fn, fn);
	locks.set(
		id,
		run.catch(() => {}).finally(() => {
			if (locks.get(id) === run) locks.delete(id);
		})
	);
	return run;
}

type Mutation = (graph: IntentGraph) => string | void | Promise<string | void>;

/** Load, mutate, save under a per-project lock. Returns a user-facing error
 *  message (graph left unsaved) or null on success. Throws if the project
 *  itself can't be loaded. */
export async function updateGraph(projectId: string, mutate: Mutation): Promise<string | null> {
	return withLock(projectId, async () => {
		const graph = await loadGraph(projectId);
		const error = await mutate(graph);
		if (error) return error;
		await saveGraph(graph);
		return null;
	});
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
