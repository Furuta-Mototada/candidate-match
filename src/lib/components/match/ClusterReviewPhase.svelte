<script lang="ts">
	import LatentSpaceVisualization from '$lib/components/LatentSpaceVisualization.svelte';
	import type { MemberMatch, ClusterResult } from '$lib/types/index.js';

	interface Props {
		// Rating phase props
		showRating: boolean;
		currentClusterDisplayName: string | null;
		currentClusterMatches: MemberMatch[];
		pendingImportance: number;
		currentClusterIndex: number;
		totalClusters: number;
		// Cluster results phase props
		showResults: boolean;
		lastCompletedResult: ClusterResult | null;
		nextClusterName: string;
		allCompletedResults: ClusterResult[];
		isLoading: boolean;
		// Callbacks
		onSetImportance: (importance: number) => void;
		onSaveAndContinue: () => void;
		onContinueToNext: () => void;
	}

	let {
		showRating,
		currentClusterDisplayName,
		currentClusterMatches,
		pendingImportance = $bindable(),
		currentClusterIndex,
		totalClusters,
		showResults,
		lastCompletedResult,
		nextClusterName,
		allCompletedResults,
		isLoading,
		onSetImportance,
		onSaveAndContinue,
		onContinueToNext
	}: Props = $props();

	function formatSimilarity(sim: number): string {
		return `${(sim * 100).toFixed(1)}%`;
	}

	function getStars(importance: number): string {
		return '★'.repeat(importance) + '☆'.repeat(5 - importance);
	}

	function getImportanceLabel(importance: number): string {
		const labels = ['', 'あまり重要ではない', '少し重要', '普通に重要', 'かなり重要', '最も重要'];
		return labels[importance] || '';
	}
</script>

<div class="cluster-review-container">
	{#if showRating}
		<!-- Rating Section -->
		<div class="rating-section fade-in-up">
			<h2 class="section-title">📊 {currentClusterDisplayName} の重要度を設定</h2>
			<p class="section-description">この分野の法案はあなたにとってどれくらい重要ですか？</p>

			<!-- Star Rating -->
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

			<!-- Top matches preview -->
			<div class="matches-preview">
				<h3 class="preview-title">このクラスターでのトップ3</h3>
				<div class="preview-list">
					{#each currentClusterMatches.slice(0, 3) as match, idx (match.memberId)}
						<div class="preview-item">
							<span class="preview-rank">{idx + 1}</span>
							<span class="preview-name">
								{match.name}
								{#if match.group}
									<span class="preview-group">({match.group})</span>
								{/if}
							</span>
							<span
								class="preview-score"
								class:high={match.similarity >= 0.7}
								class:medium={match.similarity >= 0.5 && match.similarity < 0.7}
								class:low={match.similarity < 0.5}
							>
								{formatSimilarity(match.similarity)}
							</span>
						</div>
					{/each}
				</div>
			</div>

			<button onclick={onSaveAndContinue} class="btn-primary btn-large">
				{#if currentClusterIndex < totalClusters - 1}
					結果を見て次へ →
				{:else}
					総合結果を見る 🎉
				{/if}
			</button>
		</div>
	{:else if showResults && lastCompletedResult}
		<!-- Completed Cluster Results -->
		<div class="results-section fade-in-up">
			<div class="results-header">
				<h2 class="results-title">
					✅ {lastCompletedResult.clusterLabelName ||
						`クラスター${lastCompletedResult.clusterLabel}`} 完了
				</h2>

				<div class="results-stats">
					<div class="stat-box">
						<span class="stat-label">回答数</span>
						<span class="stat-value">{lastCompletedResult.answeredCount}問</span>
					</div>
					<div class="stat-box">
						<span class="stat-label">重要度</span>
						<span class="stat-stars">{getStars(lastCompletedResult.importance)}</span>
					</div>
				</div>
			</div>

			<!-- Visualization for completed cluster -->
			<div class="trajectory-visualization">
				<h3 class="viz-title">📍 あなたの位置の軌跡</h3>
				<LatentSpaceVisualization
					members={lastCompletedResult.memberVectorsForViz}
					explainedVariance={lastCompletedResult.explainedVariance}
					xDimension={lastCompletedResult.xDimension}
					yDimension={lastCompletedResult.yDimension}
					userVector={lastCompletedResult.userVector}
					userVectorHistory={lastCompletedResult.userVectorHistory}
					highlightedMembers={lastCompletedResult.matches
						.slice(0, 5)
						.map((m) => ({ memberId: m.memberId, similarity: m.similarity }))}
					width={600}
					height={450}
					showDimensionSelectors={lastCompletedResult.userVector.length > 2}
					title=""
					showLegend={true}
					compact={false}
				/>
			</div>

			{#if currentClusterIndex < totalClusters}
				<p class="next-cluster-info">次は「{nextClusterName}」を分析します。</p>

				<button onclick={onContinueToNext} disabled={isLoading} class="btn-primary btn-large">
					{#if isLoading}
						<span class="loading-spinner">⏳</span>
						読み込み中...
					{:else}
						{nextClusterName} を開始 →
					{/if}
				</button>
			{/if}

			<!-- Progress summary -->
			<div class="progress-summary">
				<h3 class="progress-title">完了したクラスター</h3>
				<div class="completed-list">
					{#each allCompletedResults as result (result.clusterLabel)}
						<div class="completed-item">
							<span class="completed-name"
								>{result.clusterLabelName || `クラスター${result.clusterLabel}`}</span
							>
							<span class="completed-stars">{getStars(result.importance)}</span>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.cluster-review-container {
		max-width: 800px;
		margin: 0 auto;
	}

	/* ===== RATING SECTION ===== */
	.rating-section {
		background: white;
		border-radius: 20px;
		padding: 2.5rem;
		box-shadow:
			0 10px 40px rgba(0, 0, 0, 0.08),
			0 1px 3px rgba(0, 0, 0, 0.05);
		border: 1px solid #e5e7eb;
	}

	.section-title {
		font-size: 1.75rem;
		font-weight: 700;
		color: #1f2937;
		text-align: center;
		margin-bottom: 0.75rem;
	}

	.section-description {
		text-align: center;
		color: #6b7280;
		margin-bottom: 2rem;
	}

	.star-rating {
		display: flex;
		justify-content: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.star-btn {
		background: none;
		border: none;
		font-size: 3rem;
		color: #d1d5db;
		cursor: pointer;
		transition: all 0.2s ease;
		padding: 0.25rem;
	}

	.star-btn:hover {
		transform: scale(1.15);
	}

	.star-btn.selected {
		color: #fbbf24;
		text-shadow: 0 2px 8px rgba(251, 191, 36, 0.4);
	}

	.importance-label {
		text-align: center;
		font-size: 1.125rem;
		font-weight: 600;
		color: #6366f1;
		margin-bottom: 2rem;
		min-height: 1.75rem;
	}

	.matches-preview {
		margin: 2rem 0;
		padding: 1.5rem;
		background: linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(168, 85, 247, 0.05) 100%);
		border-radius: 12px;
	}

	.preview-title {
		font-size: 1rem;
		font-weight: 600;
		color: #4b5563;
		margin-bottom: 1rem;
		text-align: center;
	}

	.preview-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.preview-item {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.875rem 1rem;
		background: white;
		border-radius: 10px;
	}

	.preview-rank {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
		color: white;
		border-radius: 50%;
		font-weight: 700;
		font-size: 0.875rem;
		flex-shrink: 0;
	}

	.preview-name {
		flex: 1;
		font-weight: 600;
		color: #1f2937;
	}

	.preview-group {
		color: #6b7280;
		font-weight: 400;
		font-size: 0.875rem;
	}

	.preview-score {
		font-weight: 700;
		font-size: 1rem;
		flex-shrink: 0;
	}

	.preview-score.high {
		color: #10b981;
	}

	.preview-score.medium {
		color: #3b82f6;
	}

	.preview-score.low {
		color: #ef4444;
	}

	/* ===== RESULTS SECTION ===== */
	.results-section {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.results-header {
		background: linear-gradient(135deg, rgba(34, 197, 94, 0.05) 0%, rgba(16, 185, 129, 0.05) 100%);
		padding: 2rem;
		border-radius: 16px;
		border: 1px solid rgba(34, 197, 94, 0.2);
	}

	.results-title {
		font-size: 1.875rem;
		font-weight: 700;
		color: #047857;
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.results-stats {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
	}

	.stat-box {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem;
		background: white;
		border-radius: 12px;
	}

	.stat-label {
		font-size: 0.875rem;
		color: #6b7280;
	}

	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: #059669;
	}

	.stat-stars {
		font-size: 1.25rem;
		color: #fbbf24;
	}

	.trajectory-visualization {
		padding: 2rem;
		background: linear-gradient(135deg, rgba(99, 102, 241, 0.02) 0%, rgba(168, 85, 247, 0.02) 100%);
		border-radius: 20px;
		border: 2px solid rgba(99, 102, 241, 0.15);
	}

	.viz-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 1.5rem;
		text-align: center;
		background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.next-cluster-info {
		text-align: center;
		padding: 1rem;
		background: rgba(249, 250, 251, 0.8);
		border-radius: 10px;
		color: #6b7280;
		font-weight: 500;
	}

	.progress-summary {
		padding: 1.5rem;
		background: rgba(249, 250, 251, 0.5);
		border-radius: 12px;
	}

	.progress-title {
		font-size: 1rem;
		font-weight: 600;
		color: #4b5563;
		margin-bottom: 1rem;
		text-align: center;
	}

	.completed-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		justify-content: center;
	}

	.completed-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: white;
		border-radius: 8px;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
	}

	.completed-name {
		font-weight: 500;
		color: #1f2937;
		font-size: 0.875rem;
	}

	.completed-stars {
		color: #fbbf24;
		font-size: 0.875rem;
	}

	/* ===== COMMON ===== */
	.btn-primary {
		width: 100%;
		background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
		color: white;
		border: none;
		padding: 1rem 2rem;
		border-radius: 12px;
		font-size: 1rem;
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

	.btn-large {
		padding: 1rem 2rem;
		font-size: 1rem;
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

	@media (max-width: 768px) {
		.rating-section,
		.results-section {
			padding: 1.5rem;
		}

		.section-title {
			font-size: 1.5rem;
		}

		.star-btn {
			font-size: 2.5rem;
		}

		.results-stats {
			grid-template-columns: 1fr;
		}
	}
</style>
