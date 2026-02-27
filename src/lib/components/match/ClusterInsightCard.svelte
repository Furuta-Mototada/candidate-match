<script lang="ts">
	import type { BaseClusterResult } from '$lib/types/index.js';
	import MemberRankingList from '$lib/components/match/MemberRankingList.svelte';

	interface Props {
		result: BaseClusterResult;
	}

	let { result }: Props = $props();

	function getStars(importance: number): string {
		return '★'.repeat(importance) + '☆'.repeat(5 - importance);
	}

	function getImportanceLabel(importance: number): string {
		const labels = ['', '低', 'やや低', '中', 'やや高', '高'];
		return labels[importance] || '';
	}
</script>

<div class="insight-card">
	<div class="card-header">
		<div class="header-top">
			<h3 class="cluster-title">
				{result.clusterLabelName || `クラスター${result.clusterLabel}`}
			</h3>
			<div class="importance-badge" title="重要度: {getImportanceLabel(result.importance)}">
				<span class="stars">{getStars(result.importance)}</span>
			</div>
		</div>
		<div class="header-meta">
			<span class="meta-item">{result.answeredCount}問回答</span>
		</div>
	</div>

	<div class="card-body">
		<MemberRankingList
			members={result.matches.map((m) => ({ ...m, score: m.similarity }))}
			limit={3}
			compact={true}
			showGroup={true}
			className="insight-ranking"
		/>
	</div>
</div>

<style>
	.insight-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		overflow: hidden;
		transition: all 0.2s ease;
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.insight-card:hover {
		transform: translateY(-2px);
		box-shadow:
			0 4px 6px -1px rgba(0, 0, 0, 0.1),
			0 2px 4px -1px rgba(0, 0, 0, 0.06);
		border-color: #d1d5db;
	}

	.card-header {
		padding: 1rem;
		background: #f9fafb;
		border-bottom: 1px solid #f3f4f6;
	}

	.header-top {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.cluster-title {
		font-size: 1rem;
		font-weight: 600;
		color: #1f2937;
		line-height: 1.4;
	}

	.importance-badge {
		flex-shrink: 0;
	}

	.stars {
		color: #fbbf24;
		font-size: 0.875rem;
		letter-spacing: 1px;
	}

	.header-meta {
		font-size: 0.75rem;
		color: #6b7280;
	}

	.card-body {
		padding: 0.75rem;
		flex: 1;
	}

	/* Override ranking list styles for this context */
	:global(.insight-ranking .ranking-item) {
		padding: 0.5rem !important;
		margin-bottom: 0.25rem !important;
	}

	:global(.insight-ranking .member-name) {
		font-size: 0.875rem !important;
	}

	:global(.insight-ranking .score-value) {
		font-size: 0.875rem !important;
	}
</style>
