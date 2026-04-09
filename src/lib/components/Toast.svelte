<script lang="ts">
	interface Props {
		message: { text: string; type: 'success' | 'error' } | null;
	}

	let { message }: Props = $props();
</script>

{#if message}
	<div class="toast toast-{message.type}" role="alert">{message.text}</div>
{/if}

<style>
	.toast {
		padding: 0.625rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 500;
		margin-bottom: 1rem;
		animation: slideIn 0.2s ease;
	}

	.toast-success {
		background: #f0fdf4;
		color: #16a34a;
		border: 1px solid #bbf7d0;
	}

	.toast-error {
		background: #fef2f2;
		color: #dc2626;
		border: 1px solid #fecaca;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-0.5rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
