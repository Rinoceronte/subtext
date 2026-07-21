// The intent graph schema — the load-bearing data model.
// Every field must serve the map, the plan, or the agent build plans.

export type SemanticRole =
	| 'button'
	| 'input'
	| 'displayField'
	| 'list'
	| 'nav'
	| 'section'
	| 'container'
	| 'text'
	| 'image'
	| 'unknown';

export interface Project {
	id: string;
	name: string;
	figmaFileKey: string; // with a node id, compiles to figma.com/design/<fileKey>?node-id=<id>
	createdAt: string;
}

export interface Screen {
	id: string;
	figmaNodeId: string; // the frame
	name: string;
	purpose: string; // one line: what this screen is for — human-confirmed
	imageUrl?: string; // Figma image-export render, fetched at ingest
	size?: { w: number; h: number }; // design-px dimensions — scales node bboxes onto the render
	truncatedNodes?: number; // interesting nodes ingest could NOT annotate (over cap) — shown, never silent
	provenance: Provenance;
}

export interface IntentNode {
	id: string;

	// Binding to the design
	figmaNodeId: string;
	figmaNodeName: string;
	figmaNodeType: string; // FRAME | INSTANCE | TEXT | ...
	screenId: string;

	// Mostly inferable tier (cheap)
	role: SemanticRole;
	label: string;
	meaning?: string; // "this section means X" — one line, human-confirmed
	bbox?: { x: number; y: number; w: number; h: number }; // design px, relative to the owning screen

	// Behavior tier — seedable from Figma prototype links, human-confirmed
	interactions: Interaction[];
	dataBindings: DataBinding[];

	// The high-value, uninferable tier
	businessRules: BusinessRule[];
	states: ConditionalState[];

	// Derived, never authored — compiled from interactions + businessRules + states
	acceptanceCriteria: string[];

	// Filled in during/after build — powers the fidelity overlay
	builtRef?: string;

	// Review workflow
	provenance: Provenance;
	status: 'draft' | 'confirmed' | 'needsInput';
}

export interface Interaction {
	trigger: 'click' | 'submit' | 'change' | 'load' | 'hover';
	action: 'navigate' | 'mutate' | 'compute' | 'openModal' | 'callApi';
	target?: string; // screenId, endpoint, or rule ref
}

export interface DataBinding {
	source: string;
	field: string;
	direction: 'read' | 'write' | 'readwrite';
}

export interface BusinessRule {
	type: 'formula' | 'validation' | 'conditional' | 'derivation';
	expression: string; // e.g. "total = sum(lineItems.amount) * taxTier(region)"
	inputs: string[];
	sourceId?: string; // KnowledgeSource that supplied it, if any
}

export interface ConditionalState {
	condition: string;
	behavior: string;
}

// Anything the human feeds in: a spec, spreadsheet, DB export, prior code, an email
export interface KnowledgeSource {
	id: string;
	kind: 'document' | 'spreadsheet' | 'dbExport' | 'code' | 'other';
	ref: string; // path or URL
	summary: string;
}

// Ambiguity made durable: asked once, answered once, stored forever
export interface ClarifyingQuestion {
	id: string;
	nodeIds: string[];
	question: string;
	why: string; // what's ambiguous/missing that forced the question
	answer?: string;
	status: 'open' | 'answered' | 'dismissed';
}

export interface Provenance {
	origin: 'inferred' | 'fromSource' | 'human';
	confidence: number; // 0..1
	needsReview: boolean;
}

// The whole graph for one project, as persisted
export interface IntentGraph {
	project: Project;
	screens: Screen[];
	nodes: IntentNode[];
	questions: ClarifyingQuestion[];
	sources: KnowledgeSource[];
}

export function figmaDeepLink(fileKey: string, figmaNodeId: string): string {
	return `https://www.figma.com/design/${fileKey}/?node-id=${figmaNodeId.replace(':', '-')}`;
}

export function figmaEmbedUrl(fileKey: string, figmaNodeId: string): string {
	return `https://embed.figma.com/design/${fileKey}/?node-id=${figmaNodeId.replace(':', '-')}&embed-host=subtext`;
}
