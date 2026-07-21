<script lang="ts">
	import { page } from '$app/state';
	import { marked } from 'marked';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const html = $derived(data.selected ? (marked.parse(data.selected.content) as string) : '');
	const base = $derived(`/walkthrough/${page.params.project}/plans`);
	const shortName = (f: string) => f.replace(/\.md$/, '').replace(/^epic-\d+-/, '').replace(/--n_[\d-]+$/, '');
</script>

<svelte:head><title>Plans · {data.projectName} · subtext</title></svelte:head>

<div class="layout">
	<header>
		<a href="/">subtext</a>
		<a href="/walkthrough/{page.params.project}">← walkthrough</a>
		<strong>{data.projectName} — compiled plan</strong>
	</header>

	<aside>
		{#if !data.epics.length}
			<p class="dim">Nothing compiled yet — hit “Compile plan” in the walkthrough first.</p>
		{/if}
		{#if data.epics.length}
			<h3>Epics ({data.epics.length})</h3>
			{#each data.epics as f (f)}
				<a class="file" class:active={data.selected?.name === f} href="{base}?file={encodeURIComponent(f)}">{shortName(f)}</a>
			{/each}
		{/if}
		{#if data.buildPlans.length}
			<h3>Build plans ({data.buildPlans.length})</h3>
			{#each data.buildPlans as f (f)}
				<a class="file" class:active={data.selected?.name === `build-plans/${f}`} href="{base}?file={encodeURIComponent(`build-plans/${f}`)}">{shortName(f)}</a>
			{/each}
		{/if}
	</aside>

	<main>
		{#if data.selected}
			<article>{@html html}</article>
		{:else}
			<p class="dim">Select an epic or build plan on the left.</p>
		{/if}
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, sans-serif;
	}
	.layout {
		display: grid;
		grid-template-columns: 340px 1fr;
		grid-template-rows: auto 1fr;
		height: 100vh;
	}
	header {
		grid-column: 1 / -1;
		display: flex;
		gap: 1rem;
		align-items: center;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid #ddd;
	}
	header a {
		color: #666;
		text-decoration: none;
	}
	aside {
		overflow: auto;
		border-right: 1px solid #ddd;
		padding: 1rem;
	}
	aside h3 {
		margin: 0.5rem 0;
	}
	.file {
		display: block;
		padding: 0.3rem 0.5rem;
		border-radius: 6px;
		color: #1a56db;
		text-decoration: none;
		font-size: 0.9rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.file.active {
		background: #eef2ff;
		color: #1a1a2e;
	}
	main {
		overflow: auto;
		padding: 1.5rem 2rem;
	}
	article :global(h1) {
		margin-top: 0;
	}
	article :global(a) {
		color: #1a56db;
	}
	article :global(li) {
		margin: 0.25rem 0;
	}
	article :global(code) {
		background: #f4f4f6;
		padding: 0.1rem 0.3rem;
		border-radius: 4px;
	}
	.dim {
		color: #999;
	}
</style>
