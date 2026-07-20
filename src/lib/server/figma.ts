// Design ingest: Figma REST API → seeded intent graph.
// We read the design; we never re-implement it. Prototype links seed
// interactions, names/structure seed roles — everything lands as
// provenance.origin = 'inferred' with needsReview where confidence is low.
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

async function figmaGet(path: string): Promise<any> {
	const token = env.FIGMA_TOKEN;
	if (!token) throw new Error('FIGMA_TOKEN is not set');
	const res = await fetch(`${FIGMA_API}${path}`, {
		headers: { 'X-Figma-Token': token }
	});
	if (!res.ok) throw new Error(`Figma API ${res.status}: ${await res.text()}`);
	return res.json();
}

export function parseFileKey(input: string): string {
	// Accepts a raw key or any figma.com/design|file/<key>/... URL
	const match = input.match(/figma\.com\/(?:design|file|proto)\/([a-zA-Z0-9]+)/);
	return match ? match[1] : input.trim();
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
const MAX_DEPTH = 6;

export async function ingestFile(fileKey: string): Promise<IntentGraph> {
	const file = await figmaGet(`/files/${fileKey}`);
	const pages: FigmaNode[] = file.document?.children ?? [];

	const screens: Screen[] = [];
	const nodes: IntentNode[] = [];
	const frameIdToScreenId = new Map<string, string>();

	// Pass 1: every top-level frame on every page is a screen
	for (const page of pages) {
		for (const frame of page.children ?? []) {
			if (frame.type !== 'FRAME' && frame.type !== 'COMPONENT') continue;
			const screenId = `s_${frame.id.replace(/[:;]/g, '-')}`;
			frameIdToScreenId.set(frame.id, screenId);
			screens.push({
				id: screenId,
				figmaNodeId: frame.id,
				name: frame.name,
				purpose: '', // inferred/confirmed later — never fabricated
				provenance: { origin: 'inferred', confidence: 0.4, needsReview: true }
			});
		}
	}

	// Pass 2: walk each screen's tree and seed intent nodes
	for (const page of pages) {
		for (const frame of page.children ?? []) {
			const screenId = frameIdToScreenId.get(frame.id);
			if (!screenId) continue;
			let count = 0;
			const walk = (node: FigmaNode, depth: number) => {
				if (depth > MAX_DEPTH || count >= MAX_NODES_PER_SCREEN) return;
				const role = inferRole(node);
				if (isInteresting(node, role)) {
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
				for (const child of node.children ?? []) walk(child, depth + 1);
			};
			for (const child of frame.children ?? []) walk(child, 1);
		}
	}

	// Pass 3: screen renders via the image-export API (also future overlay input)
	if (screens.length) {
		const ids = screens.map((s) => s.figmaNodeId).join(',');
		try {
			const images = await figmaGet(`/images/${fileKey}?ids=${ids}&format=png&scale=2`);
			for (const screen of screens) {
				screen.imageUrl = images.images?.[screen.figmaNodeId] ?? undefined;
			}
		} catch {
			// non-fatal: walkthrough falls back to the live embed
		}
	}

	return {
		project: {
			id: `p_${Date.now().toString(36)}`,
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
