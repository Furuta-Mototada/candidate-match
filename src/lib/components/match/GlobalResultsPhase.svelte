<script lang="ts">
	import LatentSpaceVisualization from '$lib/components/match/LatentSpaceVisualization.svelte';
	import MemberRankingList from '$lib/components/match/MemberRankingList.svelte';
	import type { ClusterResult, GlobalMemberScore } from '$lib/types/index.js';

	interface Props {
		clusterResults: ClusterResult[];
		globalScores: GlobalMemberScore[];
		onReset: () => void;
	}

	let { clusterResults, globalScores, onReset }: Props = $props();

	function formatSimilarity(sim: number): string {
		return `${(sim * 100).toFixed(1)}%`;
	}

	function getSimilarityColor(sim: number): string {
		if (sim >= 0.7) return 'high';
		if (sim >= 0.5) return 'medium';
		return 'low';
	}

	function getStars(importance: number): string {
		return '★'.repeat(importance) + '☆'.repeat(5 - importance);
	}
</script>

<div class="results-container">
	<!-- Results Hero -->
	<div class="results-hero fade-in-up">
		<h2 class="results-title">🎉 総合マッチング結果</h2>
		<p class="results-subtitle">
			{clusterResults.length}つのクラスターの結果を重要度で加重平均しました。
		</p>

		<!-- Cluster importance summary -->
		<div class="cluster-importance-grid">
			{#each clusterResults as result (result.clusterLabel)}
				<div class="importance-item">
					<div
						class="importance-name"
						title={result.clusterLabelName || `クラスター${result.clusterLabel}`}
					>
						{result.clusterLabelName || `クラスター${result.clusterLabel}`}
					</div>
					<div class="importance-stars">{getStars(result.importance)}</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- All Cluster Trajectories Visualization -->
	<section class="trajectories-section">
		<h3 class="section-heading">📊 全クラスターの軌跡</h3>
		<div class="trajectories-list">
			{#each clusterResults as result (result.clusterLabel)}
				<div class="trajectory-item">
					<div class="trajectory-header">
						<span class="trajectory-name"
							>{result.clusterLabelName || `クラスター${result.clusterLabel}`}</span
						>
						<span class="trajectory-stars">{getStars(result.importance)}</span>
						<span class="trajectory-count">({result.answeredCount}問回答)</span>
					</div>

					<div class="viz-section">
						<div class="viz-container">
							<LatentSpaceVisualization
								members={result.memberVectorsForViz}
								explainedVariance={result.explainedVariance}
								xDimension={result.xDimension}
								yDimension={result.yDimension}
								userVector={result.userVector}
								userVectorHistory={result.userVectorHistory}
								highlightedMembers={result.matches
									.slice(0, 5)
									.map((m) => ({ memberId: m.memberId, similarity: m.similarity }))}
								width={500}
								height={380}
								showDimensionSelectors={result.userVector.length > 2}
								title=""
								showLegend={true}
								compact={true}
								collapsible={true}
								collapsedLabel="📍 軌跡を表示"
								expandedLabel="グラフを隠す"
							/>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- Global Top 10 -->
	<section class="top-members-section">
		<MemberRankingList
			title="🏆 総合マッチTOP10"
			members={globalScores.map((m) => ({ ...m, score: m.globalScore }))}
			limit={10}
			scoreLabel="総合スコア"
			extraContent={clusterChips}
		/>
	</section>

	{#snippet clusterChips(member: any)}
		<div class="cluster-chips">
			{#each clusterResults as result (result.clusterLabel)}
				{@const score = member.clusterScores[result.clusterLabel] || 0}
				{@const shortName = result.clusterLabelName
					? result.clusterLabelName.slice(0, 6)
					: `C${result.clusterLabel}`}
				<span
					class="cluster-chip"
					class:high-score={score >= 0.6}
					class:med-score={score >= 0.3 && score < 0.6}
					class:low-score={score < 0.3}
					title={result.clusterLabelName || `クラスター${result.clusterLabel}`}
				>
					{shortName}: {(score * 100).toFixed(0)}%
				</span>
			{/each}
		</div>
	{/snippet}

	<!-- Per-cluster details (collapsible) -->
	<details class="details-section">
		<summary class="details-summary"> クラスター別の詳細結果 </summary>
		<div class="details-content">
			{#each clusterResults as result (result.clusterLabel)}
				<div class="detail-group">
					<h4 class="detail-title">
						{result.clusterLabelName || `クラスター${result.clusterLabel}`}
						<span class="detail-stars">{getStars(result.importance)}</span>
					</h4>
					<MemberRankingList
						members={result.matches.map((m) => ({ ...m, score: m.similarity }))}
						limit={5}
						compact={true}
						showGroup={false}
					/>
				</div>
			{/each}
		</div>
	</details>

	<!-- All members table -->
	{#if globalScores.length > 10}
		<details class="details-section">
			<summary class="details-summary"> 全議員の総合スコア ({globalScores.length}名) </summary>
			<div class="all-members-table">
				<table>
					<thead>
						<tr>
							<th>順位</th>
							<th>氏名</th>
							<th>所属</th>
							<th>総合スコア</th>
						</tr>
					</thead>
					<tbody>
						{#each globalScores as member, idx (member.memberId)}
							<tr>
								<td>{idx + 1}</td>
								<td class="name-cell">{member.name}</td>
								<td class="group-cell">{member.group || '-'}</td>
								<td class="score-cell {getSimilarityColor(member.globalScore)}">
									{formatSimilarity(member.globalScore)}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{/if}

	<!-- Actions -->
	<div class="final-actions">
		<button onclick={onReset} class="restart-button"> 🔄 もう一度やり直す </button>
	</div>
</div>

<style>
	.results-container {
		max-width: 800px;
		margin: 0 auto;
	}

	.results-hero {
		background: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%);
		border-radius: 16px;
		padding: 2rem 1.5rem;
		text-align: center;
		margin-bottom: 2rem;
	}

	.results-title {
		font-size: 1.75rem;
		font-weight: 700;
		color: white;
		margin-bottom: 0.5rem;
	}

	.results-subtitle {
		font-size: 0.9375rem;
		color: rgba(255, 255, 255, 0.9);
		margin-bottom: 1.5rem;
	}

	.cluster-importance-grid {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}

	.importance-item {
		background: rgba(255, 255, 255, 0.15);
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		text-align: center;
	}

	.importance-item:hover {
		background: rgba(255, 255, 255, 0.2);
	}

	.importance-name {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.9);
		margin-bottom: 0.25rem;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.importance-stars {
		font-size: 0.8125rem;
		color: #fbbf24;
	}

	/* ===== TRAJECTORIES & TOP MEMBERS ===== */
	.trajectories-section,
	.top-members-section {
		margin: 2rem 0;
	}

	.section-heading {
		font-size: 0.875rem;
		font-weight: 600;
		color: #6b7280;
		margin-bottom: 1rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.trajectories-list {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.trajectory-item {
		background: #fafbfc;
		border-radius: 12px;
		padding: 1rem;
	}

	.trajectory-item:hover {
		background: #f3f4f6;
	}

	.trajectory-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.trajectory-name {
		font-size: 0.9375rem;
		font-weight: 600;
		color: #1f2937;
	}

	.trajectory-stars {
		color: #fbbf24;
		font-size: 0.875rem;
	}

	.trajectory-count {
		font-size: 0.8125rem;
		color: #6b7280;
		margin-left: auto;
	}

	/* ===== TOP MEMBERS LIST ===== */
	/* Styles removed - replaced by MemberRankingList component */

	.cluster-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		margin-top: 0.5rem;
		margin-left: 2.5rem;
	}

	.cluster-chip {
		padding: 0.1875rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 500;
		transition: all 0.2s ease;
	}

	.cluster-chip:hover {
		opacity: 0.8;
	}

	.cluster-chip.high-score {
		background: rgba(34, 197, 94, 0.1);
		color: #047857;
	}

	.cluster-chip.med-score {
		background: rgba(251, 191, 36, 0.1);
		color: #b45309;
	}

	.cluster-chip.low-score {
		background: rgba(239, 68, 68, 0.1);
		color: #b91c1c;
	}

	/* ===== DETAILS SECTIONS ===== */
	.details-section {
		margin: 1.5rem 0;
		padding: 1rem 0;
		border-top: 1px solid #f3f4f6;
	}

	.details-summary {
		cursor: pointer;
		font-size: 0.8125rem;
		font-weight: 600;
		color: #6b7280;
		list-style: none;
	}

	.details-summary:hover {
		color: #6366f1;
	}

	.details-summary::-webkit-details-marker {
		display: none;
	}

	.details-content {
		margin-top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	/* ===== ALL MEMBERS TABLE ===== */
	.all-members-table {
		margin-top: 1rem;
		max-height: 20rem;
		overflow-y: auto;
	}

	.all-members-table table {
		width: 100%;
		font-size: 0.875rem;
		border-collapse: collapse;
	}

	.all-members-table thead {
		position: sticky;
		top: 0;
		background: #f9fafb;
		z-index: 10;
	}

	.all-members-table th {
		padding: 0.75rem;
		text-align: left;
		font-weight: 600;
		color: #4b5563;
		border-bottom: 1px solid #e5e7eb;
	}

	.all-members-table th:last-child {
		text-align: right;
	}

	.all-members-table tbody tr {
		border-top: 1px solid #f3f4f6;
		transition: background-color 0.2s ease;
	}

	.all-members-table tbody tr:hover {
		background: #f9fafb;
	}

	.all-members-table td {
		padding: 0.75rem;
	}

	.all-members-table .name-cell {
		font-weight: 500;
		color: #1f2937;
	}

	.all-members-table .group-cell {
		color: #6b7280;
	}

	.all-members-table .score-cell {
		text-align: right;
		font-weight: 600;
	}

	/* ===== FINAL ACTIONS ===== */
	.final-actions {
		display: flex;
		justify-content: center;
		margin: 2rem 0;
	}

	.restart-button {
		background: #6b7280;
		color: white;
		border: none;
		padding: 0.75rem 1.5rem;
		border-radius: 8px;
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.restart-button:hover {
		background: #4b5563;
	}

	/* ===== SIMILARITY COLORS ===== */
	.high {
		color: #10b981;
	}

	.medium {
		color: #3b82f6;
	}

	.low {
		color: #ef4444;
	}

	/* ===== ANIMATIONS ===== */
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

	/* ===== VISUALIZATION ===== */
	.viz-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		margin-top: 1rem;
		gap: 1rem;
	}

	.viz-container {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	/* Override visualization styles to remove container look */
	.viz-container :global(.latent-space-viz) {
		background: transparent !important;
		border-radius: 0 !important;
	}

	/* ===== RESPONSIVE ===== */
	@media (max-width: 768px) {
		.results-hero {
			padding: 2rem 1.5rem;
		}

		.results-title {
			font-size: 1.75rem;
		}

		.cluster-importance-grid {
			grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		}

		.member-item {
			flex-direction: column;
			align-items: flex-start;
			gap: 1rem;
		}

		.score-display {
			text-align: left;
		}

		.cluster-chips {
			justify-content: flex-start;
		}
	}
</style>
