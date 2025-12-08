<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		badge?: string;
		title: string;
		description?: string;
		children?: Snippet;
	}

	let { badge, title, description, children }: Props = $props();
</script>

<section class="hero">
	{#if badge}
		<span class="hero-badge">{badge}</span>
	{/if}
	<h1>{title}</h1>
	{#if description}
		<p class="hero-description">{description}</p>
	{/if}
	{#if children}
		{@render children()}
	{/if}
</section>

<style>
	.hero {
		text-align: center;
		padding: 4rem 2rem 3rem;
		background: white;
		border-bottom: 1px solid #e5e7eb;
	}

	.hero-badge {
		display: inline-block;
		background: linear-gradient(135deg, #eef2ff, #e0e7ff);
		color: #4f46e5;
		padding: 0.5rem 1.25rem;
		border-radius: 100px;
		font-size: 0.9rem;
		font-weight: 600;
		margin-bottom: 1.5rem;
	}

	.hero h1 {
		font-size: 2.5rem;
		font-weight: 800;
		color: #1f2937;
		margin: 0 0 1rem 0;
	}

	.hero-description {
		font-size: 1.1rem;
		color: #6b7280;
		max-width: 600px;
		margin: 0 auto;
		line-height: 1.6;
	}
</style>
