# Design Intent Layer — Build Brief

**Purpose:** Build the layer that sits between a Figma design and code-generating agents. It pulls down the full design, works out what connects to what, captures what the design can't say — through documents the human feeds in and clarifying questions the system asks — and compiles the result into (a) epics, stories, and tasks, and (b) per-task AI build plans for build agents.

This document is the handoff for a coding AI agent. Read the **Non-goals** and **Operating principles** sections before writing any code — they exist to keep you from over-building.

## 1. The job, in plain terms

1. **Pull down the Figma designs.** Every screen in the file, via Figma's Dev Mode MCP server / REST API. The design stays the live source of truth; we never re-implement Figma reading.
2. **Work out what goes to what.** This button opens that screen; this section means this; that list is fed by that data. Seed it from prototype links, component names, and structure. The output is a navigation-and-meaning map of the whole design.
3. **Take in what the design can't say.** The human can feed in documents, data, and knowledge as needed — written specs, spreadsheets, database exports, prior code, emails. The system reads them, pulls out candidate rules and behaviors, and binds them to the design nodes they belong to.
4. **Ask when the design doesn't make sense.** Where the design is ambiguous, contradictory, or silent about something that matters, the system asks clarifying questions — and the human can also ask questions back about the design. Answers land in the intent graph as structured facts, not in a chat log.
5. **Produce the plan.** Compile epics → stories → tasks, each with acceptance criteria — and each with deep links back to the exact Figma screens and nodes it covers, so anyone (human or agent) can jump from a task straight to the design. Theoretically this pushes to Jira; for now, write it to a document or folder. Jira is a later output target, not a dependency.
6. **Produce the AI build plans.** For each task, generate the plan doc a build agent needs: design node refs (as Figma links), interactions, rules, states, and acceptance criteria — explicit enough that the agent builds what was intended instead of guessing.
7. **Show intended vs. built.** Once something is implemented, our overlay renders what it *should* look like (fetched from Figma) against what it *does* look like (captured from the running implementation), node by node, and runs the compiled behavior checks. This is the later verification layer; the graph keeps the node↔implementation bindings it needs from day one.

Steps 1–4 build the asset (the intent graph). Steps 5–7 are compilations from it.

## 2. Thesis

Code generation is solved. Figma's Dev Mode MCP server already reads the live node tree — tokens, variants, auto-layout, constraints — into agents like Claude Code, and Code Connect maps Figma components to real codebase components. Do not rebuild any of that.

The unsolved, high-value problem is the **intent layer**: a design is unambiguous about layout and silent about behavior and meaning. "This button opens X" and "this total is line items × tax tier" live in someone's head and evaporate into unstructured form (discovery calls, notes, a client email), then get re-discovered mid-build. That evaporation is what makes plans wrong and makes build agents guess. This tool's job is to capture that intent once, structurally, and compile everything else from it.

## 3. Non-goals (do not build these)

- **Do not build design-to-code generation.** Agents already do this well. This tool produces the plans that feed them.
- **Do not reimplement Figma reading.** Consume Figma's Dev Mode MCP server / REST API as the design input. Treat the design as a live, queryable source, not a static import.
- **Do not build a Jira/Linear clone, and do not build Jira sync yet.** The plan output is a folder of documents for now. Pushing to a real tracker via API is a later, thin adapter — never issue-tracking features of our own.
- **Do not require whole-screen manual annotation.** That is the failure mode that kills adoption. (See §6.)
- **Do not fabricate intent.** If the design doesn't say it and no fed-in source says it, it becomes a clarifying question — never a guess presented as fact.

## 4. Core concept: the intent graph and its projections

The durable asset is a single **intent graph**: screens and annotation nodes bound to Figma node IDs, carrying semantic role, interactions, data bindings, business rules, states, open questions, and provenance.

Everything else is a **projection** compiled from that graph:

- **Navigation/meaning map** — what goes to what: screens, the edges between them, and what each section is for. The first thing the human reviews and corrects.
- **PM projection** — epics → stories → tasks, each with derived acceptance criteria. Written to a folder of documents now; pushed to Jira later.
- **Agent plan projection** — per-task build plan: design node refs + interactions + rules + states + acceptance criteria, structured for a build agent.
- **Fidelity overlay projection** — our own verification layer, compiled from the graph; not a Zeplin integration. Zeplin proves the visual comparison is worth having, but it stops at a human eyeballing a static spec — it knows nothing about our intent graph, our bindings, or behavior. Ours is generated per node from data we already store:
  - **Visual:** for every node with a `builtRef`, fetch the intended rendering via Figma's image-export API (`figmaNodeId`) and capture the implementation via browser automation (navigate to `builtRef`, screenshot that element). Present the pair as an overlay/slider with a pixel-diff score; flag nodes that exceed tolerance.
  - **Behavioral:** compile the node's `interactions`, `businessRules`, and `states` into executable checks. A `click → navigate` interaction becomes "click `builtRef`, assert the app lands on the screen bound to `target`." A `formula` rule becomes "feed known inputs, assert the displayed value matches the expression." A `ConditionalState` becomes "set up the condition, assert the behavior."
  - **Output:** a per-screen report — every node pass/fail on visual and behavioral checks, each failure linked to the Figma node it should match and the task that built it.

  Post-MVP, but it costs nothing now to keep the bindings it runs on (`figmaNodeId` on one side, `builtRef` on the other).
- **(Later) quote projection** — the same task decomposition with complexity signals and hours attached by humans. Not part of the current scope; the graph is designed so this can be added without rework.

## 5. Data model

This is the load-bearing schema. Every field must serve the map, the plan, or the agent build plans. If a field serves none of those, cut it.

```typescript
interface Project {
  id: string;
  figmaFileKey: string;          // with a node id, compiles to a deep link: figma.com/design/<fileKey>?node-id=<id>
}

interface Screen {
  id: string;
  figmaNodeId: string;           // the frame
  name: string;
  purpose: string;               // one line: what this screen is for — human-confirmed
}

interface IntentNode {
  id: string;

  // Binding to the design
  figmaNodeId: string;
  figmaNodeName: string;         // denormalized for readability
  figmaNodeType: string;         // FRAME | INSTANCE | TEXT | ...
  screenId: string;              // owning screen

  // Mostly inferable tier (cheap)
  role: SemanticRole;            // button | input | displayField | list | nav | section | container | ...
  label: string;
  meaning?: string;              // "this section means X" — one line, human-confirmed

  // Behavior tier — seedable from Figma prototype links, human-confirmed
  interactions: Interaction[];   // { trigger, action, target } — "this button opens that screen"
  dataBindings: DataBinding[];   // { source, field, direction: read | write | readwrite }

  // The high-value, uninferable tier
  businessRules: BusinessRule[];
  states: ConditionalState[];    // { condition, behavior }

  // Derived, never authored
  acceptanceCriteria: string[];  // COMPILED from interactions + businessRules + states

  // Filled in during/after build — powers the fidelity overlay
  builtRef?: string;             // route, component, or selector in the implementation

  // Review workflow
  provenance: Provenance;        // { origin, confidence, needsReview }
  status: 'draft' | 'confirmed' | 'needsInput';
}

interface Interaction {
  trigger: 'click' | 'submit' | 'change' | 'load' | 'hover';
  action: 'navigate' | 'mutate' | 'compute' | 'openModal' | 'callApi';
  target?: string;               // screenId, endpoint, or rule ref
}

interface BusinessRule {
  type: 'formula' | 'validation' | 'conditional' | 'derivation';
  expression: string;            // e.g. "total = sum(lineItems.amount) * taxTier(region)"
  inputs: string[];              // referenced fields / other node ids
  sourceId?: string;             // KnowledgeSource that supplied it, if any
}

// Anything the human feeds in: a spec, spreadsheet, DB export, prior code, an email
interface KnowledgeSource {
  id: string;
  kind: 'document' | 'spreadsheet' | 'dbExport' | 'code' | 'other';
  ref: string;                   // path or URL
  summary: string;               // what the system found in it
}

// Ambiguity made durable: asked once, answered once, stored forever
interface ClarifyingQuestion {
  id: string;
  nodeIds: string[];             // the design nodes it's about
  question: string;
  why: string;                   // what's ambiguous/missing that forced the question
  answer?: string;
  status: 'open' | 'answered' | 'dismissed';
}

interface Provenance {
  origin: 'inferred' | 'fromSource' | 'human';   // inferred from design | pulled from a KnowledgeSource | answered/authored by a human
  confidence: number;            // 0..1
  needsReview: boolean;
}
```

Key relationships:

- **`acceptanceCriteria` is derived, not authored.** Compile it from `interactions`, `businessRules`, and `states`. This is what makes annotation and plan-writing the same act.
- **The navigation map is derived** from `Interaction`s whose action is `navigate`/`openModal` — it is a projection, not separate data.
- **An answered `ClarifyingQuestion` writes structured facts into the graph** (an interaction, a rule, a state, a meaning) — the Q&A record is provenance, not the storage format.
- **`provenance.origin = 'fromSource'` nodes** need only confirm/correct, not authoring — the cheapest path to a fully-specified rule.
- **Every emitted task and build plan carries Figma deep links.** `figmaFileKey` + `figmaNodeId` compile to clickable URLs on every epic/story/task and agent plan — the graph stores IDs; projections render links.
- **`figmaNodeId` ↔ `builtRef` is the overlay's spine.** The design side exists from ingest; the built side gets filled in during implementation (build agents should report it back in their output). With both, the overlay can fetch the Figma rendering and the live implementation for the same node and compare.

## 6. Operating principles

These are the design decisions that make capturing intent affordable. Violate them and the tool becomes an annotation chore nobody uses.

**AI proposes, human corrects — never blank canvas.** Every screen and node arrives with a first-draft mapping and annotation. The human is always confirming or editing, never authoring from nothing.

**Triage, don't annotate everything.** Most nodes are layout and obvious CRUD. The first pass over a design is not "annotate everything"; it is "here is the map I inferred, and here are the ~6 places where meaning is unclear or behavior is hiding — let's talk about these." Concentrate human attention on the 10–20% of nodes that matter; auto-fill the rest.

**Read sources, don't make humans transcribe them.** When the human feeds in a document, spreadsheet, or export, the system extracts candidate rules and bindings from it and asks confirm/correct questions ("this formula in the spreadsheet — does it drive this total field?"). Confirming is nearly free; transcribing is expensive.

**Elicit conversationally, don't make people fill forms.** Humans are bad at populating a node-panel taxonomy and good at answering "what happens when they hit checkout?" The clarifying-question loop is the primary input surface; the graph is populated behind the scenes.

**Questions flow both ways.** The system asks when the design is ambiguous; the human can also interrogate the design ("what did we say this section does?") and the answer comes from the graph, with provenance.

**Accept an irreducible floor.** Some intent exists only in someone's head. Don't infer or fabricate it — ask. The tool doesn't remove discovery; it makes discovery produce a durable artifact instead of a forgotten call.

## 7. MVP scope — one thin end-to-end slice

Build the full pipeline of §1 at minimum width, on one real Figma file:

1. **Design ingest** — pull every screen's node tree from the Figma file. Seed screens, roles, labels, and interactions from prototype links, component names, and structure.
2. **Map + triage** — build the navigation/meaning map; compute confidence per node; flag the ambiguous or silent spots as `ClarifyingQuestion`s.
3. **Knowledge intake** — accept human-fed documents/data; extract candidate rules/bindings from them; propose bindings to design nodes with confirm/correct prompts.
4. **Clarify** — surface the open questions; write answers into the graph as structured facts with provenance.
5. **Compile the plan** — emit epics/stories/tasks with derived acceptance criteria, as markdown files in a folder (Jira comes later). Every item carries deep links to its Figma nodes.
6. **Compile agent plans** — per task, emit the build-plan doc: design refs (as Figma links) + interactions + rules + states + acceptance criteria, plus the instruction that the agent report back `builtRef`s for the nodes it implements.

The fidelity overlay itself is not in the MVP — but because tasks carry Figma links and plans request `builtRef`s, the MVP already accumulates everything the overlay needs.

**The walkthrough app — the human surface for steps 2–4.** A thin web app with one flow: paste the Figma file link ("let's start projecting…") → the pipeline runs with visible progress → then walk the design screen by screen. Split view: the screen itself on one side (Figma image export by default; a live Embed Kit iframe toggle, deep-linked via `node-id`, for zoom/inspect); on the other, the AI's notes for that screen — inferred purpose, interactions, meanings, decisions with confidence, and the open `ClarifyingQuestion`s, each with confirm / correct / answer controls. Answers write to the graph immediately; when the walk is done, compile (steps 5–6). It is a **walkthrough, not an editor**: no annotation canvas, no per-node form taxonomy (§6) — if a correction doesn't fit a one-line answer or a confirm/correct tap, it becomes a question thread, not a form.

## 8. MVP acceptance criteria

The MVP succeeds if, on one real design:

- The inferred navigation/meaning map is mostly right, and correcting it takes minutes, not hours.
- Ambiguities become explicit questions rather than silent guesses, and answering a question visibly updates the graph and the compiled outputs.
- The emitted plan folder contains coherent epics/stories/tasks a human PM would recognize as a real plan.
- **The decisive test:** a build agent produces a meaningfully better implementation from an emitted task plan than from raw Figma + a plain prompt — it builds the intended behavior instead of hallucinating it.

If yes, the Jira push, quoting layer, and richer UI have something solid to stand on. If no, this was a weekend, not a quarter.

## 9. Architecture & stack

- **Design input:** Figma Dev Mode MCP server (read-only design context) + Figma REST API for prototype links and node metadata.
- **Inference, source-reading, and question generation:** AI-agent layer (Python/PydanticAI or the Claude Agent SDK — pick one and keep it thin).
- **Intent graph store:** PostgreSQL. The graph is relational (screens, nodes, rules, questions, sources, provenance). For the MVP a JSON-file store is acceptable if it keeps the slice moving; keep the schema shaped for Postgres.
- **App/API:** Node.js + TypeScript is the house stack. The walkthrough app is SvelteKit; web-first (design review happens in a desktop browser). A Capacitor wrap is a later option, not a starting point.
- **Screen rendering:** Figma image-export API for screen PNGs (also feeds the fidelity overlay later); Figma Embed Kit iframe as the live-view toggle (requires the viewer to have Figma access to the file).
- **Pipeline execution:** the ingest/map/triage/compile runs execute server-side via the Claude Agent SDK (subscription auth); the app shell stays thin — start a run, show progress, serve the graph.
- **Plan output (MVP):** markdown files in a folder — one per epic/story/task, plus one build-plan doc per task. A Jira/Linear push is a later adapter over the same projection.
- **Hosting & repo:** GitHub under `github.com/Rinoceronte`; deployed to the existing Linode server (`ssh dev@45.33.127.209`, app served at http://45.33.127.209/ or a subpath/port alongside what's already running there).

## 10. Open decisions (do not invent answers — flag for the human)

- How much free-form chat the walkthrough's question flow needs, vs. pure confirm/correct/answer controls in the sidebar.
- When the fidelity overlay lands (MVP+1?) and what its first form is: static screenshot diff (Figma export vs. implementation screenshot) vs. a live overlay on the running app. Start with the cheapest thing that catches real mismatches.
- Jira vs Linear as the eventual push target (Figma's own connectors favor Linear).
- Whether the graph store starts as Postgres or JSON files for the MVP slice.

Resolved: the human review surface is the walkthrough app (§7) — not Figma comments, not a terminal flow.

## 11. Suggested build sequence

1. Schema + store (§5).
2. Figma ingest → screens, nodes, seeded interactions (§7.1).
3. Map + triage → navigation map and `ClarifyingQuestion`s (§7.2).
4. Knowledge intake → candidate rules bound to nodes (§7.3).
5. Clarify loop → answers become graph facts (§7.4).
6. Walkthrough app → thin SvelteKit shell over the graph: run trigger, progress, screen-by-screen review (§7). Deploy to the Linode box.
7. Plan compiler → epics/stories/tasks folder (§7.5).
8. Agent-plan compiler → per-task build docs (§7.6).
9. Run the decisive test (§8). **Stop and report before building any richer UI or Jira sync.**
