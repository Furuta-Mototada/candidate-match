<script lang="ts">
	import type { EnrichedBillData } from '$lib/types/index.js';
	import BillContent from '$lib/components/match/BillContent.svelte';
	import { X, Maximize, Minimize, Book } from '@lucide/svelte';

	interface Props {
		enrichmentData: EnrichedBillData | null;
		isLoading: boolean;
		detailLevel: number;
		isFullscreen: boolean;
		onClose: () => void;
		onDetailLevelChange: (level: number) => void;
		onToggleFullscreen: () => void;
	}

	let {
		enrichmentData,
		isLoading,
		detailLevel,
		isFullscreen = false,
		onClose,
		onDetailLevelChange,
		onToggleFullscreen
	}: Props = $props();
</script>

<div class="detail-panel slide-in" class:fullscreen={isFullscreen}>
	<div class="detail-panel-header">
		<h3 class="detail-panel-title">法案の詳細</h3>
		<div class="header-actions">
			{#if detailLevel === 2}
				<button class="header-btn" onclick={() => onDetailLevelChange(3)}>
					<Book size={14} class="inline-icon" /> もっと詳しく
				</button>
			{/if}
			<button class="header-btn" onclick={onToggleFullscreen}>
				{#if isFullscreen}
					<Minimize size={14} class="inline-icon" /> 縮小
				{:else}
					<Maximize size={14} class="inline-icon" /> 拡大
				{/if}
			</button>
			<button class="close-btn" onclick={onClose}>
				<X size={16} /> 閉じる
			</button>
		</div>
	</div>

	<div class="detail-panel-content">
		{#if isLoading}
			<div class="loading-state">
				<span class="spinner"></span>
				<span>詳細を読み込み中...</span>
			</div>
		{:else if enrichmentData}
			<BillContent {enrichmentData} showDebates={detailLevel >= 3} />
		{:else}
			<div class="no-enrichment">
				<p>詳細情報はまだ生成されていません</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.detail-panel {
		background: white;
		border-radius: 16px;
		box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		max-height: 80vh;
		transition: all 0.3s ease;
	}

	.detail-panel.fullscreen {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		max-height: 100vh;
		border-radius: 0;
		z-index: 1000;
		box-shadow: none;
		animation: none;
	}

	.slide-in {
		animation: slideIn 0.35s ease-out;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateX(30px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	.detail-panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid #e5e7eb;
		flex-shrink: 0;
	}

	.detail-panel-title {
		font-size: 1rem;
		font-weight: 600;
		color: #1f2937;
		margin: 0;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.header-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		background: #f3f4f6;
		border: none;
		cursor: pointer;
		font-size: 0.8rem;
		color: #4b5563;
		transition: all 0.2s;
	}

	.header-btn:hover {
		background: #e5e7eb;
	}

	.close-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		background: #f3f4f6;
		border: none;
		cursor: pointer;
		font-size: 0.8rem;
		color: #4b5563;
		transition: all 0.2s;
	}

	.close-btn:hover {
		background: #e5e7eb;
	}

	.detail-panel-content {
		padding: 1.5rem;
		overflow-y: auto;
		flex: 1;
	}

	/* Loading */
	.loading-state {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #6b7280;
		padding: 1rem 0;
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid #e5e7eb;
		border-top-color: #3b82f6;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.no-enrichment {
		text-align: center;
		padding: 1rem;
		color: #9ca3af;
	}
</style>
