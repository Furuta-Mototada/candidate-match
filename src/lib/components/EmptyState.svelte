<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		message: string;
		icon?: Snippet;
		children?: Snippet;
	}

	let { message, icon, children }: Props = $props();
</script>

<div class="empty-state">
	{#if icon}
		<span class="empty-icon">{@render icon()}</span>
	{/if}
	<p class="empty-message">{message}</p>
	{#if children}
		{@render children()}
	{/if}
</div>

<style>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem 2rem;
		text-align: center;
		background: white;
		border-radius: 12px;
		border: 1px dashed #d1d5db;
	}

	.empty-icon {
		font-size: 3rem;
		margin-bottom: 1rem;
	}

	.empty-message {
		color: #6b7280;
		font-size: 1rem;
		margin: 0 0 1rem 0;
		max-width: 400px;
		line-height: 1.6;
	}
</style>
