<script lang="ts">
	interface Props {
		message?: string;
		size?: 'small' | 'medium' | 'large';
	}

	let { message = '読み込み中...', size = 'medium' }: Props = $props();
</script>

<div class="loading-container {size}">
	<div class="spinner"></div>
	{#if message}
		<p class="loading-message">{message}</p>
	{/if}
</div>

<style>
	.loading-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 2rem;
	}

	.loading-container.small {
		padding: 1rem;
		gap: 0.5rem;
	}

	.loading-container.large {
		padding: 4rem;
		gap: 1.5rem;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 3px solid #e5e7eb;
		border-top-color: #6366f1;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	.loading-container.small .spinner {
		width: 24px;
		height: 24px;
		border-width: 2px;
	}

	.loading-container.large .spinner {
		width: 56px;
		height: 56px;
		border-width: 4px;
	}

	.loading-message {
		color: #6b7280;
		font-size: 0.95rem;
		margin: 0;
	}

	.loading-container.small .loading-message {
		font-size: 0.85rem;
	}

	.loading-container.large .loading-message {
		font-size: 1.1rem;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
