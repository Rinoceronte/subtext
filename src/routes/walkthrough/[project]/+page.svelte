<script lang="ts">
	import { enhance } from '$app/forms';
	import { figmaDeepLink, figmaEmbedUrl } from '$lib/schema';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let screenIndex = $state(0);
	let showEmbed = $state(false);

	const graph = $derived(data.graph);
	const screen = $derived(graph.screens[screenIndex]);
	const screenNodes = $derived(
		screen ? graph.nodes.filter((n) => n.screenId === screen.id) : []
	);
	const openQuestions = $derived(
		screen
			? graph.questions.filter(
					(q) =>
						q.status === 'open' &&
						(q.nodeIds.includes(screen.id) || screenNodes.some((n) => q.nodeIds.includes(n.id)))
				)
			: []
	);
	const embedUrl = $derived(
		screen ? figmaEmbedUrl(graph.project.figmaFileKey, screen.figmaNodeId) : ''
	);
</script>

<svelte:head><title>{graph.project.name} · subtext</title></svelte:head>

<div class="layout">
	<header>
		<a href="/">subtext</a>
		<strong>{graph.project.name}</strong>
		<nav>
			<button onclick={() => (screenIndex = Math.max(0, screenIndex - 1))} disabled={screenIndex === 0}>←</button>
			<span>{screenIndex + 1} / {graph.screens.length}</span>
			<button
				onclick={() => (screenIndex = Math.min(graph.screens.length - 1, screenIndex + 1))}
				disabled={screenIndex >= graph.screens.length - 1}>→</button
			>
		</nav>
		<form method="POST" action="?/compile" use:enhance>
			<button class="primary">Compile plan</button>
		</form>
		{#if form && 'compiled' in form}<span class="ok">{form.compiled} files compiled</span>{/if}
		{#if form && 'error' in form && form.error}<span class="error">{form.error}</span>{/if}
	</header>

	{#if screen}
		<section class="design">
			<div class="design-bar">
				<h2>{screen.name}</h2>
				<a href={figmaDeepLink(graph.project.figmaFileKey, screen.figmaNodeId)} target="_blank">open in Figma ↗</a>
				<label><input type="checkbox" bind:checked={showEmbed} /> live view</label>
				{#if screen.truncatedNodes}
					<span class="warn">⚠ {screen.truncatedNodes} nodes over the ingest cap were not annotated</span>
				{/if}
			</div>
			{#if showEmbed}
				<iframe src={embedUrl} title="{screen.name} in Figma" allowfullscreen></iframe>
			{:else if screen.imageUrl}
				<img src={screen.imageUrl} alt="Design render of {screen.name}" />
			{:else}
				<p class="dim">No render available — toggle live view.</p>
			{/if}
		</section>

		<aside>
			<div class="block">
				<h3>Purpose</h3>
				<form method="POST" action="?/setPurpose" use:enhance>
					<input type="hidden" name="screenId" value={screen.id} />
					<input name="purpose" value={screen.purpose} placeholder="What is this screen for?" />
					<button>Save</button>
				</form>
			</div>

			{#if openQuestions.length}
				<div class="block questions">
					<h3>Questions ({openQuestions.length})</h3>
					{#each openQuestions as q (q.id)}
						<div class="question">
							<p>{q.question}</p>
							<p class="why">{q.why}</p>
							<form method="POST" action="?/answer" use:enhance>
								<input type="hidden" name="questionId" value={q.id} />
								<input name="answer" placeholder="Answer…" />
								<button>Answer</button>
							</form>
							<form method="POST" action="?/dismiss" use:enhance>
								<input type="hidden" name="questionId" value={q.id} />
								<button class="ghost">Dismiss</button>
							</form>
						</div>
					{/each}
				</div>
			{/if}

			<div class="block">
				<h3>Notes ({screenNodes.length})</h3>
				{#each screenNodes as node (node.id)}
					<div class="node" class:confirmed={node.status === 'confirmed'}>
						<div class="node-head">
							<span class="role">{node.role}</span>
							<a href={figmaDeepLink(graph.project.figmaFileKey, node.figmaNodeId)} target="_blank">{node.label}</a>
							<span class="conf" title="confidence">{Math.round(node.provenance.confidence * 100)}%</span>
						</div>
						{#if node.meaning}<p class="meaning">{node.meaning}</p>{/if}
						{#each node.interactions as i}
							<p class="fact">{i.trigger} → {i.action} {graph.screens.find((s) => s.id === i.target)?.name ?? i.target ?? ''}</p>
						{/each}
						{#each node.acceptanceCriteria as c}
							<p class="fact ac">✓ {c}</p>
						{/each}
						{#if node.status !== 'confirmed'}
							<div class="node-actions">
								<form method="POST" action="?/confirm" use:enhance>
									<input type="hidden" name="nodeId" value={node.id} />
									<button>Confirm</button>
								</form>
								<form method="POST" action="?/correct" use:enhance>
									<input type="hidden" name="nodeId" value={node.id} />
									<input name="meaning" placeholder="Correct in one line…" />
									<button>Fix</button>
								</form>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</aside>
	{:else}
		<p class="dim">No screens ingested.</p>
	{/if}
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, sans-serif;
	}
	.layout {
		display: grid;
		grid-template-columns: 1fr 400px;
		grid-template-rows: auto 1fr;
		height: 100vh;
	}
	header {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid #ddd;
	}
	header a {
		color: #666;
		text-decoration: none;
	}
	nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-left: auto;
	}
	.design {
		overflow: auto;
		background: #f4f4f6;
		padding: 1rem;
	}
	.design-bar {
		display: flex;
		gap: 1rem;
		align-items: baseline;
	}
	.design-bar h2 {
		margin: 0;
	}
	.design img {
		max-width: 100%;
		border: 1px solid #ddd;
		border-radius: 8px;
		background: white;
	}
	.design iframe {
		width: 100%;
		height: calc(100% - 3rem);
		border: 1px solid #ddd;
		border-radius: 8px;
	}
	aside {
		overflow: auto;
		border-left: 1px solid #ddd;
		padding: 1rem;
	}
	.block {
		margin-bottom: 1.5rem;
	}
	.block h3 {
		margin: 0 0 0.5rem;
	}
	.question {
		border: 1px solid #e8c66a;
		background: #fdf6e3;
		border-radius: 8px;
		padding: 0.6rem;
		margin-bottom: 0.6rem;
	}
	.question p {
		margin: 0 0 0.4rem;
	}
	.why {
		font-size: 0.8rem;
		color: #8a7a45;
	}
	.node {
		border: 1px solid #e3e3e8;
		border-radius: 8px;
		padding: 0.5rem 0.6rem;
		margin-bottom: 0.5rem;
	}
	.node.confirmed {
		border-color: #9ecfa8;
	}
	.node-head {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
	}
	.role {
		font-size: 0.7rem;
		text-transform: uppercase;
		background: #eef;
		border-radius: 4px;
		padding: 0.1rem 0.35rem;
		color: #556;
	}
	.conf {
		margin-left: auto;
		font-size: 0.75rem;
		color: #999;
	}
	.meaning {
		font-style: italic;
		margin: 0.3rem 0;
	}
	.fact {
		font-size: 0.85rem;
		color: #555;
		margin: 0.15rem 0;
	}
	.ac {
		color: #2e7d46;
	}
	.node-actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.4rem;
	}
	.node-actions form {
		display: flex;
		gap: 0.3rem;
		flex: 1;
	}
	.node-actions input {
		flex: 1;
		min-width: 0;
	}
	input {
		padding: 0.35rem 0.5rem;
		border: 1px solid #ccc;
		border-radius: 6px;
	}
	button {
		padding: 0.35rem 0.7rem;
		border: 1px solid #ccc;
		border-radius: 6px;
		background: white;
		cursor: pointer;
	}
	button.primary {
		background: #1a1a2e;
		color: white;
		border: none;
	}
	button.ghost {
		border: none;
		background: none;
		color: #999;
		font-size: 0.8rem;
		padding: 0;
	}
	.ok {
		color: #2e7d46;
		font-size: 0.85rem;
	}
	.error {
		color: #c0392b;
		font-size: 0.85rem;
	}
	.warn {
		color: #9a6b00;
		font-size: 0.8rem;
	}
	.dim {
		color: #999;
		padding: 2rem;
	}
	form {
		display: flex;
		gap: 0.4rem;
	}
	form input[name='purpose'],
	form input[name='answer'] {
		flex: 1;
	}
</style>
