// Design ingest: Figma REST API → seeded intent graph.
// We read the design; we never re-implement it. Prototype links seed
// interactions, names/structure seed roles — everything lands as
// provenance.origin = 'inferred' with needsReview where confidence is low.
import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type {
	IntentGraph,
	IntentNode,
	Interaction,
	Screen,
	SemanticRole
} from '$lib/schema';

const FIGMA_API = 'https://api.figma.com/v1';

interface FigmaNode {
	id: string;
	name: string;
	type: string;
	children?: FigmaNode[];
	characters?: string; // TEXT nodes
	transitionNodeID?: string | null; // prototype link target
	visible?: boolean;
}

interface FigmaFileResponse {
	name?: string;
	document?: { children?: FigmaNode[] };
}

interface FigmaNodesResponse {
	nodes?: Record<string, { document?: FigmaNode } | null>;
}

interface FigmaImagesResponse {
	images?: Record<string, string | null>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_RETRIES = 6;
const MAX_WAIT_MS = 5 * 60_000; // honor long Retry-After values, within reason

async function figmaGet<T>(path: string): Promise<T> {
	const token = env.FIGMA_TOKEN;
	if (!token) throw new Error('FIGMA_TOKEN is not set');

	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`${FIGMA_API}${path}`, {
			headers: { 'X-Figma-Token': token }
		});
		if (res.status === 429 && attempt < MAX_RETRIES) {
			const retryAfter = Number(res.headers.get('retry-after')) * 1000 || 0;
			// A wait beyond our patience means a long quota window — blind
			// retries just burn more budget. Fail fast with the real number.
			if (retryAfter > MAX_WAIT_MS) {
				throw new Error(
					`Figma rate limit: asked to retry in ${Math.ceil(retryAfter / 60_000)} minutes — wait that long, then rerun`
				);
			}
			const wait = Math.min(Math.max(retryAfter, 2000 * 2 ** attempt), MAX_WAIT_MS);
			console.log(
				`Figma rate limit hit — waiting ${Math.round(wait / 1000)}s (Retry-After: ${retryAfter ? Math.round(retryAfter / 1000) + 's' : 'not sent'})`
			);
			await sleep(wait);
			continue;
		}
		if (!res.ok) throw new Error(`Figma API ${res.status}: ${await res.text()}`);
		return res.json() as Promise<T>;
	}
}

export function parseFileKey(input: string): string {
	// Accepts a raw key or any figma.com/design|file|proto/<key>/... URL
	const match = input.match(/figma\.com\/(?:design|file|proto)\/([a-zA-Z0-9]+)/);
	return match?.[1] ?? input.trim();
}

function inferRole(node: FigmaNode): SemanticRole {
	const name = node.name.toLowerCase();
	if (/\b(button|btn|cta)\b/.test(name)) return 'button';
	if (/\b(input|field|textbox|search|select|dropdown|checkbox|radio|toggle)\b/.test(name))
		return 'input';
	if (/\b(list|table|grid|row|card list|items)\b/.test(name)) return 'list';
	if (/\b(nav|menu|tab|header|footer|sidebar|breadcrumb)\b/.test(name)) return 'nav';
	if (/\b(total|subtotal|sum|price|amount|balance|count|qty|quantity)\b/.test(name))
		return 'displayField';
	if (node.type === 'TEXT') return 'text';
	if (node.type === 'INSTANCE' || node.type === 'COMPONENT') return 'section';
	if (node.type === 'FRAME' || node.type === 'GROUP') return 'container';
	if (/image|img|photo|icon|logo/.test(name) || node.type === 'RECTANGLE') return 'image';
	return 'unknown';
}

function label(node: FigmaNode): string {
	if (node.type === 'TEXT' && node.characters) return node.characters.slice(0, 80);
	return node.name;
}

// A node is worth carrying into the graph if it plausibly means something:
// it has a prototype link, is a component instance, or its name/type inferred a real role.
function isInteresting(node: FigmaNode, role: SemanticRole): boolean {
	if (node.visible === false) return false;
	if (node.transitionNodeID) return true;
	if (node.type === 'INSTANCE') return true;
	return role !== 'container' && role !== 'unknown' && role !== 'image';
}

const MAX_NODES_PER_SCREEN = 150;
const NODES_PER_REQUEST = 10; // split-on-400 handles oversized batches; fewer requests = friendlier to rate limits

// Large files 400 on a whole-file GET ("Request too large"), so subtrees are
// fetched per-frame in small batches. A failing batch splits in half; a single
// frame that is still too large retries at decreasing depth before giving up.
async function fetchSubtrees(fileKey: string, ids: string[]): Promise<Map<string, FigmaNode>> {
	const out = new Map<string, FigmaNode>();

	const fetchBatch = async (batch: string[], depth?: number): Promise<void> => {
		const depthParam = depth ? `&depth=${depth}` : '';
		try {
			const res = await figmaGet<FigmaNodesResponse>(
				`/files/${fileKey}/nodes?ids=${batch.map(encodeURIComponent).join(',')}${depthParam}`
			);
			for (const [id, entry] of Object.entries(res.nodes ?? {})) {
				if (entry?.document) out.set(id, entry.document);
			}
		} catch (e) {
			const tooLarge = e instanceof Error && e.message.includes('400');
			if (!tooLarge) throw e;
			if (batch.length > 1) {
				const mid = Math.ceil(batch.length / 2);
				await fetchBatch(batch.slice(0, mid), depth);
				await fetchBatch(batch.slice(mid), depth);
			} else if (!depth) {
				await fetchBatch(batch, 8);
			} else if (depth > 3) {
				await fetchBatch(batch, depth - 3);
			}
			// depth exhausted: skip this frame — it stays an un-annotated screen
		}
	};

	for (let i = 0; i < ids.length; i += NODES_PER_REQUEST) {
		if (i > 0) await sleep(300); // pace requests instead of bursting into the rate limit
		await fetchBatch(ids.slice(i, i + NODES_PER_REQUEST));
	}
	return out;
}

// One depth-limited whole-file request is far cheaper against Figma's rate
// budget than per-frame fetches. Start deep and back off until it fits;
// depth=2 (pages + frames only) always fits.
async function fetchTree(fileKey: string): Promise<FigmaFileResponse> {
	for (const depth of [5, 4, 3]) {
		try {
			return await figmaGet<FigmaFileResponse>(`/files/${fileKey}?depth=${depth}`);
		} catch (e) {
			const tooLarge = e instanceof Error && e.message.includes('Figma API 400');
			if (!tooLarge) throw e;
		}
	}
	return figmaGet<FigmaFileResponse>(`/files/${fileKey}?depth=2`);
}

export async function ingestFile(fileKey: string): Promise<IntentGraph> {
	const file = await fetchTree(fileKey);
	const pages: FigmaNode[] = file.document?.children ?? [];

	const screens: Screen[] = [];
	const nodes: IntentNode[] = [];
	const frameIdToScreenId = new Map<string, string>();
	const framesById = new Map<string, FigmaNode>();

	// Pass 1: every top-level frame on every page is a screen
	for (const page of pages) {
		for (const frame of page.children ?? []) {
			if (frame.type !== 'FRAME' && frame.type !== 'COMPONENT') continue;
			const screenId = `s_${frame.id.replace(/[:;]/g, '-')}`;
			frameIdToScreenId.set(frame.id, screenId);
			framesById.set(frame.id, frame);
			screens.push({
				id: screenId,
				figmaNodeId: frame.id,
				name: frame.name,
				purpose: '', // inferred/confirmed later — never fabricated
				provenance: { origin: 'inferred', confidence: 0.4, needsReview: true }
			});
		}
	}

	// Pass 2: walk each screen's tree and seed intent nodes. The depth-limited
	// tree already contains most frames' children; only frames that came back
	// childless need their subtree fetched individually (batched + paced).
	// Past the per-screen cap we keep counting instead of adding, so
	// truncation is recorded on the screen — never silently dropped.
	const missing = screens.filter((s) => !framesById.get(s.figmaNodeId)?.children?.length);
	const subtrees = missing.length
		? await fetchSubtrees(fileKey, missing.map((s) => s.figmaNodeId))
		: new Map<string, FigmaNode>();

	for (const screen of screens) {
		const fromTree = framesById.get(screen.figmaNodeId);
		const root = fromTree?.children?.length ? fromTree : subtrees.get(screen.figmaNodeId);
		if (!root) continue; // subtree fetch gave up — screen stays un-annotated
		{
			const screenId = screen.id;
			let count = 0;
			let dropped = 0;
			const walk = (node: FigmaNode) => {
				const role = inferRole(node);
				if (isInteresting(node, role)) {
					if (count >= MAX_NODES_PER_SCREEN) {
						dropped++;
					} else {
						count++;
						const interactions: Interaction[] = [];
						if (node.transitionNodeID) {
							const targetScreen = frameIdToScreenId.get(node.transitionNodeID);
							interactions.push({
								trigger: 'click',
								action: 'navigate',
								target: targetScreen ?? node.transitionNodeID
							});
						}
						nodes.push({
							id: `n_${node.id.replace(/[:;]/g, '-')}`,
							figmaNodeId: node.id,
							figmaNodeName: node.name,
							figmaNodeType: node.type,
							screenId,
							role,
							label: label(node),
							interactions,
							dataBindings: [],
							businessRules: [],
							states: [],
							acceptanceCriteria: [],
							provenance: {
								origin: 'inferred',
								confidence: interactions.length ? 0.7 : 0.5,
								needsReview: true
							},
							status: 'draft'
						});
					}
				}
				for (const child of node.children ?? []) walk(child);
			};
			for (const child of root.children ?? []) walk(child);
			if (dropped > 0) screen.truncatedNodes = dropped;
		}
	}

	// Pass 3: screen renders via the image-export API (also future overlay input)
	for (let i = 0; i < screens.length; i += 40) {
		const batch = screens.slice(i, i + 40);
		try {
			const images = await figmaGet<FigmaImagesResponse>(
				`/images/${fileKey}?ids=${batch.map((s) => encodeURIComponent(s.figmaNodeId)).join(',')}&format=png&scale=2`
			);
			for (const screen of batch) {
				screen.imageUrl = images.images?.[screen.figmaNodeId] ?? undefined;
			}
		} catch {
			// non-fatal: walkthrough falls back to the live embed
		}
	}

	return {
		project: {
			id: `p_${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
			name: file.name ?? fileKey,
			figmaFileKey: fileKey,
			createdAt: new Date().toISOString()
		},
		screens,
		nodes,
		questions: [],
		sources: []
	};
}
