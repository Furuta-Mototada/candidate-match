<script lang="ts">
	interface Props {
		name: string;
		algorithm: string;
		createdAt: string | Date;
		parameters?: string | null;
		active?: boolean;
		onclick?: () => void;
	}

	let { name, algorithm, createdAt, parameters, active = false, onclick }: Props = $props();

	function formatDate(date: string | Date): string {
		return new Date(date).toLocaleDateString('ja-JP');
	}
</script>

<button class="cluster-card" class:active {onclick}>
	<div class="cluster-name">{name}</div>
	<div class="cluster-meta">
		<span class="badge">{algorithm.toUpperCase()}</span>
		<span class="date">{formatDate(createdAt)}</span>
	</div>
	{#if parameters}
		<div class="cluster-params">{parameters}</div>
	{/if}
</button>

<style>
	.cluster-card {
		display: block;
		width: 100%;
		text-align: left;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.cluster-card:hover {
		border-color: #6366f1;
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.1);
	}

	.cluster-card.active {
		border-color: #6366f1;
		background: #f5f3ff;
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15);
	}

	.cluster-name {
		font-weight: 600;
		color: #1f2937;
		margin-bottom: 0.5rem;
	}

	.cluster-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.badge {
		background: #e0e7ff;
		color: #4338ca;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
	}

	.date {
		color: #6b7280;
		font-size: 0.85rem;
	}

	.cluster-params {
		color: #9ca3af;
		font-size: 0.8rem;
		font-family: monospace;
	}
</style>
