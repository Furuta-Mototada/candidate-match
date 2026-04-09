<script lang="ts">
	import ExplanationContent from '$lib/components/match/ExplanationContent.svelte';

	interface Props {
		show: boolean;
		onClose: () => void;
	}

	let { show, onClose }: Props = $props();

	function handleOverlayClick() {
		onClose();
	}

	function handleContainerClick(e: MouseEvent) {
		e.stopPropagation();
	}
</script>

{#if show}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={handleOverlayClick}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div class="modal-container" onclick={handleContainerClick} role="document">
			<button class="modal-close-btn" onclick={onClose}>×</button>

			<div class="explanation-content-modal">
				<ExplanationContent />
			</div>
		</div>
	</div>
{/if}

<style>
	/* ===== MODAL ===== */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		animation: fadeIn 0.2s ease-out;
	}

	.modal-container {
		background: white;
		width: 100%;
		max-width: 900px;
		max-height: 90vh;
		border-radius: 16px;
		box-shadow:
			0 20px 25px -5px rgba(0, 0, 0, 0.1),
			0 10px 10px -5px rgba(0, 0, 0, 0.04);
		position: relative;
		overflow-y: auto;
		animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.modal-close-btn {
		position: absolute;
		top: 1rem;
		right: 1rem;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: #f3f4f6;
		border: none;
		color: #4b5563;
		font-size: 1.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.2s;
		z-index: 10;
	}

	.modal-close-btn:hover {
		background: #e5e7eb;
		color: #1f2937;
	}

	.explanation-content-modal {
		padding: 2rem;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes scaleIn {
		from {
			transform: scale(0.95);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}
</style>
