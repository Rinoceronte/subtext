<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let running = $state(false);
</script>

<main>
	<h1>subtext</h1>
	<p class="tag">what the design can't say</p>

	<form
		method="POST"
		action="?/project"
		use:enhance={() => {
			running = true;
			return async ({ update }) => {
				running = false;
				await update();
			};
		}}
	>
		<label for="figmaUrl">Let's start projecting…</label>
		<div class="row">
			<input
				id="figmaUrl"
				name="figmaUrl"
				placeholder="Paste your main Figma file link"
				autocomplete="off"
			/>
			<button disabled={running}>{running ? 'Reading the design…' : 'Run'}</button>
		</div>
		{#if form?.error}<p class="error">{form.error}</p>{/if}
	</form>

	{#if data.projects.length}
		<h2>Projects</h2>
		<ul>
			{#each data.projects as project (project.id)}
				<li>
					<a href="/walkthrough/{project.id}">{project.name}</a>
					<span class="dim">{new Date(project.createdAt).toLocaleDateString()}</span>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		max-width: 640px;
		margin: 8vh auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
	}
	h1 {
		margin-bottom: 0;
	}
	.tag {
		color: #888;
		margin-top: 0.25rem;
	}
	form {
		margin-top: 2.5rem;
	}
	label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}
	.row {
		display: flex;
		gap: 0.5rem;
	}
	input {
		flex: 1;
		padding: 0.6rem 0.8rem;
		border: 1px solid #ccc;
		border-radius: 8px;
		font-size: 1rem;
	}
	button {
		padding: 0.6rem 1.2rem;
		border: none;
		border-radius: 8px;
		background: #1a1a2e;
		color: white;
		font-size: 1rem;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.error {
		color: #c0392b;
	}
	h2 {
		margin-top: 3rem;
	}
	ul {
		list-style: none;
		padding: 0;
	}
	li {
		display: flex;
		justify-content: space-between;
		padding: 0.5rem 0;
		border-bottom: 1px solid #eee;
	}
	.dim {
		color: #999;
		font-size: 0.85rem;
	}
</style>
