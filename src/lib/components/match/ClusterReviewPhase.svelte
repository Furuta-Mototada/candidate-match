<script lang="ts">
	import LatentSpaceVisualization from '$lib/components/match/LatentSpaceVisualization.svelte';
	import MemberRankingList from '$lib/components/match/MemberRankingList.svelte';
	import type { MemberMatch, ClusterResult, MemberVectorForViz } from '$lib/types/index.js';
	import { CircleCheck, Hourglass, PartyPopper } from '@lucide/svelte';

	interface Props {
		currentClusterDisplayName: string | null;
		currentClusterMatches: MemberMatch[];
		pendingImportance: number;
		currentClusterIndex: number;
		totalClusters: number;
		isLastClusterInSession: boolean;
		isLoading: boolean;

		// Visualization props
		memberVectorsForViz: MemberVectorForViz[];
		explainedVariance: number[];
		xDimension: number;
		yDimension: number;
		userVector: number[];
		userVectorHistory: number[][];

		// Callbacks
		onSetImportance: (importance: number) => void;
		onSaveAndContinue: () => void;
	}

	let {
		currentClusterDisplayName,
		currentClusterMatches,
		pendingImportance = $bindable(),
		currentClusterIndex,
		totalClusters,
		isLastClusterInSession,
		isLoading,
		memberVectorsForViz,
		explainedVariance,
		xDimension = $bindable(),
		yDimension = $bindable(),
		userVector,
		userVectorHistory,
		onSetImportance,
		onSaveAndContinue
	}: Props = $props();

	function formatSimilarity(sim: number) {
		return `${(sim * 100).toFixed(1)}%`;
	}

	function getImportanceLabel(importance: number): string {
		const labels = ['', 'あまり重要ではない', '少し重要', '普通に重要', 'かなり重要', '最も重要'];
		return labels[importance] || '';
	}
</script>

<div class="cluster-review-container fade-in-up">
	<h2 class="section-title">
		<CircleCheck size={20} class="inline-icon" color="#22c55e" />
		{currentClusterDisplayName} 完了
	</h2>

	<div class="review-content">
		<!-- 1. Rating Section -->
		<div class="rating-section">
			<p class="section-description">この分野の重要度を設定してください</p>
			<div class="star-rating">
				{#each [1, 2, 3, 4, 5] as star (star)}
					<button
						onclick={() => onSetImportance(star)}
						class="star-btn"
						class:selected={star <= pendingImportance}
					>
						★
					</button>
				{/each}
			</div>
			<p class="importance-label">{getImportanceLabel(pendingImportance)}</p>
		</div>

		<!-- 2. Top Matches -->
		<div class="matches-preview">
			<MemberRankingList
				title="トップマッチ"
				members={currentClusterMatches.map((m) => ({ ...m, score: m.similarity }))}
				limit={3}
				compact={true}
				showGroup={true}
			/>
		</div>

		<!-- 3. Visualization Toggle & Content -->
		<div class="viz-section">
			<div class="viz-container">
				<LatentSpaceVisualization
					members={memberVectorsForViz}
					{explainedVariance}
					bind:xDimension
					bind:yDimension
					{userVector}
					{userVectorHistory}
					highlightedMembers={currentClusterMatches
						.slice(0, 5)
						.map((m) => ({ memberId: m.memberId, similarity: m.similarity }))}
					width={800}
					height={450}
					showDimensionSelectors={true}
					title=""
					showLegend={true}
					compact={false}
					collapsible={true}
					collapsedLabel="📍 あなたの位置を表示"
					expandedLabel="グラフを隠す"
				/>
			</div>
		</div>
	</div>

	<div class="action-area">
		<button onclick={onSaveAndContinue} disabled={isLoading} class="btn-primary btn-large">
			{#if isLoading}
				<span class="loading-spinner"><Hourglass size={14} /></span>
				読み込み中...
			{:else if isLastClusterInSession}
				総合結果を見る <PartyPopper size={14} class="inline-icon" />
			{:else}
				次の分野へ進む →
			{/if}
		</button>
	</div>
</div>

<style>
	.cluster-review-container {
		max-width: 800px;
		margin: 0 auto;
	}

	.section-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1f2937;
		text-align: center;
		margin-bottom: 2rem;
	}

	.review-content {
		display: flex;
		flex-direction: column;
		gap: 2rem;
		margin-bottom: 2rem;
	}

	.rating-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1rem;
		background: #f9fafb;
		border-radius: 1rem;
	}

	.section-description {
		text-align: center;
		color: #6b7280;
		margin-bottom: 1rem;
	}

	.star-rating {
		display: flex;
		justify-content: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.star-btn {
		background: none;
		border: none;
		font-size: 2.5rem;
		color: #d1d5db;
		cursor: pointer;
		transition: all 0.2s ease;
		padding: 0.25rem;
	}

	.star-btn:hover {
		transform: scale(1.1);
	}

	.star-btn.selected {
		color: #fbbf24;
	}

	.importance-label {
		text-align: center;
		font-size: 1rem;
		font-weight: 500;
		color: #6366f1;
		min-height: 1.5rem;
	}

	.viz-section {
		margin-top: 1rem;
		padding-top: 2rem;
		border-top: 1px dashed #e5e7eb;
	}

	.viz-container {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Override visualization styles to remove container look */
	.viz-container :global(.latent-space-viz) {
		background: transparent !important;
		border-radius: 0 !important;
	}

	/* Action Area */
	.action-area {
		margin-top: 1rem;
		max-width: 400px;
		margin-left: auto;
		margin-right: auto;
	}

	.btn-primary {
		width: 100%;
		background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
		color: white;
		border: none;
		padding: 1rem 2rem;
		border-radius: 12px;
		font-size: 1.125rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
		box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.3);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}

	.btn-primary:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 8px 12px -2px rgba(99, 102, 241, 0.4);
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		transform: none;
	}

	.loading-spinner {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.fade-in-up {
		animation: fadeInUp 0.6s ease both;
	}

	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(30px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
