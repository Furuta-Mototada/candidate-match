<script lang="ts">
	import type { EnrichedBillData } from '$lib/types/index.js';
	import { BookOpen } from '@lucide/svelte';

	interface Props {
		billId: number;
		title: string;
		description: string | null;
		passed: boolean;
		result: string | null;
		enrichmentData: EnrichedBillData | null;
		isLoading: boolean;
		onLoadEnrichment: () => void;
		detailLevel?: number;
		onDetailLevelChange?: (level: number) => void;
		billRef?: string | null;
	}

	let {
		title,
		description,
		passed,
		result = null,
		enrichmentData,
		isLoading,
		onLoadEnrichment,
		detailLevel: externalDetailLevel,
		onDetailLevelChange,
		billRef = null,
		...restProps
	}: Props = $props();
	void restProps;

	// Detail level: 1 = basic, 2 = expanded, 3 = full
	// Use external if provided, otherwise internal
	let internalDetailLevel = $state(1);
	let detailLevel = $derived(externalDetailLevel ?? internalDetailLevel);

	function toggleDetailLevel() {
		let newLevel: number;
		if (detailLevel < 3) {
			newLevel = detailLevel + 1;
			// Load enrichment data if not already loaded
			if (!enrichmentData && !isLoading) {
				onLoadEnrichment();
			}
		} else {
			newLevel = 1;
		}
		if (onDetailLevelChange) {
			onDetailLevelChange(newLevel);
		} else {
			internalDetailLevel = newLevel;
		}
	}

	function getResultLabel(result: string | null, passed: boolean): string {
		if (result) {
			switch (result) {
				case '可決':
					return '✓ 可決・成立';
				case '否決':
					return '✗ 否決';
				case '撤回':
					return '↩ 撤回';
				case '未了':
					return '… 未了・廃案';
				default:
					return result;
			}
		}
		return passed ? '✓ 成立' : '審議中';
	}

	function getResultClass(result: string | null, passed: boolean): string {
		if (result) {
			switch (result) {
				case '可決':
					return 'result-passed';
				case '否決':
					return 'result-rejected';
				case '撤回':
					return 'result-withdrawn';
				case '未了':
					return 'result-expired';
				default:
					return 'result-unknown';
			}
		}
		return passed ? 'result-passed' : 'result-pending';
	}
</script>

<div class="enriched-bill-card">
	<!-- Header with status -->
	<div class="card-header">
		<span class="bill-status {getResultClass(result, passed)}">
			{getResultLabel(result, passed)}
		</span>
		{#if detailLevel === 1}
			<button class="detail-toggle" onclick={toggleDetailLevel} disabled={isLoading}>
				<BookOpen size={14} class="inline-icon" /> 詳しく見る
			</button>
		{/if}
	</div>

	<!-- Title -->
	<h2 class="bill-title">{title}</h2>
	{#if billRef}
		<span class="bill-ref">{billRef}</span>
	{/if}

	<!-- Level 1: Basic Info -->
	<div class="level-1">
		{#if enrichmentData?.summaryShort}
			<p class="summary-short">{enrichmentData.summaryShort}</p>
		{:else if description}
			<p class="description">{description}</p>
		{:else}
			<p class="no-description">説明がありません</p>
		{/if}

		<!-- Impact Tags (always show if available) -->
		{#if enrichmentData?.impactTags && enrichmentData.impactTags.length > 0}
			<div class="impact-tags">
				{#each enrichmentData.impactTags as tag, i (i)}
					<span class="tag">{tag}</span>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.enriched-bill-card {
		max-width: 100%;
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.bill-status {
		font-size: 0.875rem;
		padding: 0.25rem 0.75rem;
		border-radius: 9999px;
		font-weight: 500;
	}

	.bill-status.result-passed {
		background: #dcfce7;
		color: #166534;
	}

	.bill-status.result-rejected {
		background: #fee2e2;
		color: #991b1b;
	}

	.bill-status.result-withdrawn {
		background: #f3e8ff;
		color: #6b21a8;
	}

	.bill-status.result-expired {
		background: #fef3c7;
		color: #92400e;
	}

	.bill-status.result-pending {
		background: #e0f2fe;
		color: #075985;
	}

	.bill-status.result-unknown {
		background: #f3f4f6;
		color: #4b5563;
	}

	.detail-toggle {
		font-size: 0.875rem;
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		background: #f3f4f6;
		border: none;
		cursor: pointer;
		transition: all 0.2s;
	}

	.detail-toggle:hover:not(:disabled) {
		background: #e5e7eb;
	}

	.detail-toggle:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.bill-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1f2937;
		margin: 0 0 0.25rem 0;
		line-height: 1.4;
	}

	.bill-ref {
		display: inline-block;
		font-size: 0.75rem;
		color: #6b7280;
		background: #f3f4f6;
		padding: 0.125rem 0.5rem;
		border-radius: 4px;
		margin-bottom: 0.75rem;
		font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
	}

	.summary-short {
		font-size: 1rem;
		color: #4b5563;
		margin: 0 0 0.75rem 0;
		padding: 0.75rem;
		background: #f8fafc;
		border-radius: 8px;
		border-left: 4px solid #3b82f6;
	}

	.description {
		font-size: 0.9375rem;
		color: #6b7280;
		margin: 0 0 0.75rem 0;
	}

	.no-description {
		font-size: 0.875rem;
		color: #9ca3af;
		font-style: italic;
	}

	.impact-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.tag {
		font-size: 0.75rem;
		padding: 0.25rem 0.5rem;
		border-radius: 9999px;
		background: #eff6ff;
		color: #1d4ed8;
	}
</style>
