<script lang="ts">
	import LatentSpaceVisualization from '$lib/components/LatentSpaceVisualization.svelte';
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
						/>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- Global Top 10 -->
	<section class="top-members-section">
		<h3 class="section-heading">🏆 総合マッチTOP10</h3>

		<div class="top-members-list">
			{#each globalScores.slice(0, 10) as member, idx (member.memberId)}
				<div class="member-item" class:top-rank={idx === 0}>
					<div class="member-info">
						<div class="rank-badge" class:gold={idx === 0}>
							{idx + 1}
						</div>
						<div class="member-details">
							<div class="member-name">{member.name}</div>
							{#if member.group}
								<div class="member-group">{member.group}</div>
							{/if}
						</div>
					</div>
					<div class="score-display">
						<div class="score-value {getSimilarityColor(member.globalScore)}">
							{formatSimilarity(member.globalScore)}
						</div>
						<div class="score-label">総合スコア</div>
					</div>
				</div>

				<!-- Cluster breakdown chips -->
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
			{/each}
		</div>
	</section>

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
					<div class="detail-list">
						{#each result.matches.slice(0, 5) as match, idx (match.memberId)}
							<div class="detail-item">
								<span>{idx + 1}. {match.name}</span>
								<span class={getSimilarityColor(match.similarity)}>
									{formatSimilarity(match.similarity)}
								</span>
							</div>
						{/each}
					</div>
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
		max-width: 900px;
		margin: 0 auto;
	}

	.results-hero {
		background: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%);
		border-radius: 20px;
		padding: 3rem 2rem;
		text-align: center;
		margin-bottom: 2rem;
		box-shadow: 0 20px 60px rgba(99, 102, 241, 0.3);
	}

	.results-title {
		font-size: 2.25rem;
		font-weight: 800;
		color: white;
		margin-bottom: 0.75rem;
		text-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
	}

	.results-subtitle {
		font-size: 1.1rem;
		color: rgba(255, 255, 255, 0.95);
		margin-bottom: 2rem;
	}

	.cluster-importance-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 0.75rem;
	}

	.importance-item {
		background: rgba(255, 255, 255, 0.15);
		backdrop-filter: blur(10px);
		border-radius: 12px;
		padding: 1rem;
		text-align: center;
		border: 1px solid rgba(255, 255, 255, 0.2);
		transition: all 0.3s ease;
	}

	.importance-item:hover {
		background: rgba(255, 255, 255, 0.25);
		transform: translateY(-2px);
	}

	.importance-name {
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.9);
		margin-bottom: 0.5rem;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.importance-stars {
		font-size: 0.95rem;
		color: #fbbf24;
	}

	/* ===== TRAJECTORIES & TOP MEMBERS ===== */
	.trajectories-section,
	.top-members-section {
		margin: 3rem 0;
	}

	.section-heading {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 2rem;
		text-align: center;
		background: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.trajectories-list {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.trajectory-item {
		background: linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(249, 250, 251, 0.9) 100%);
		border-radius: 16px;
		padding: 1.5rem;
		border: 1px solid rgba(229, 231, 235, 0.5);
		transition: all 0.3s ease;
	}

	.trajectory-item:hover {
		transform: translateX(4px);
		border-color: rgba(99, 102, 241, 0.3);
		box-shadow: 0 8px 16px rgba(99, 102, 241, 0.1);
	}

	.trajectory-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid rgba(229, 231, 235, 0.5);
	}

	.trajectory-name {
		font-size: 1rem;
		font-weight: 600;
		color: #1f2937;
	}

	.trajectory-stars {
		color: #fbbf24;
		font-size: 1.125rem;
	}

	.trajectory-count {
		font-size: 0.875rem;
		color: #6b7280;
		margin-left: auto;
	}

	/* ===== TOP MEMBERS LIST ===== */
	.top-members-list {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.member-item {
		background: white;
		border-radius: 12px;
		padding: 1.25rem;
		border: 1px solid rgba(229, 231, 235, 0.5);
		transition: all 0.3s ease;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.member-item:hover {
		border-color: rgba(99, 102, 241, 0.3);
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.1);
		transform: translateY(-2px);
	}

	.member-item.top-rank {
		background: linear-gradient(135deg, rgba(251, 191, 36, 0.1) 0%, rgba(245, 158, 11, 0.1) 100%);
		border-color: rgba(251, 191, 36, 0.3);
	}

	.member-info {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.rank-badge {
		width: 2.5rem;
		height: 2.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		font-weight: 700;
		font-size: 1rem;
		background: #e5e7eb;
		color: #4b5563;
	}

	.rank-badge.gold {
		background: #fbbf24;
		color: white;
		box-shadow: 0 4px 8px rgba(251, 191, 36, 0.3);
	}

	.member-details {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.member-name {
		font-size: 1rem;
		font-weight: 600;
		color: #1f2937;
	}

	.member-group {
		font-size: 0.875rem;
		color: #6b7280;
	}

	.score-display {
		text-align: right;
	}

	.score-value {
		font-size: 1.25rem;
		font-weight: 700;
	}

	.score-label {
		font-size: 0.75rem;
		color: #6b7280;
		margin-top: 0.25rem;
	}

	.cluster-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.cluster-chip {
		padding: 0.25rem 0.625rem;
		border-radius: 6px;
		font-size: 0.75rem;
		font-weight: 500;
		transition: all 0.2s ease;
	}

	.cluster-chip:hover {
		transform: scale(1.05);
	}

	.cluster-chip.high-score {
		background: rgba(34, 197, 94, 0.15);
		color: #047857;
	}

	.cluster-chip.med-score {
		background: rgba(251, 191, 36, 0.15);
		color: #b45309;
	}

	.cluster-chip.low-score {
		background: rgba(239, 68, 68, 0.15);
		color: #b91c1c;
	}

	/* ===== DETAILS SECTIONS ===== */
	.details-section {
		background: white;
		border-radius: 12px;
		padding: 1.5rem;
		margin: 2rem 0;
		border: 1px solid rgba(229, 231, 235, 0.5);
	}

	.details-summary {
		cursor: pointer;
		font-size: 0.9375rem;
		font-weight: 600;
		color: #4b5563;
		list-style: none;
		transition: color 0.2s ease;
	}

	.details-summary:hover {
		color: #6366f1;
	}

	.details-summary::-webkit-details-marker {
		display: none;
	}

	.details-content {
		margin-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.detail-group {
		padding-top: 1rem;
		border-top: 1px solid rgba(229, 231, 235, 0.5);
	}

	.detail-title {
		font-size: 1rem;
		font-weight: 600;
		color: #1f2937;
		margin-bottom: 0.75rem;
	}

	.detail-stars {
		margin-left: 0.5rem;
		color: #fbbf24;
	}

	.detail-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.detail-item {
		display: flex;
		justify-content: space-between;
		font-size: 0.875rem;
		padding: 0.5rem 0;
	}

	/* ===== ALL MEMBERS TABLE ===== */
	.all-members-table {
		margin-top: 1.5rem;
		max-height: 24rem;
		overflow-y: auto;
		border-radius: 8px;
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
		margin: 3rem 0;
	}

	.restart-button {
		background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
		color: white;
		border: none;
		padding: 0.875rem 2rem;
		border-radius: 12px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
		box-shadow: 0 4px 6px -1px rgba(107, 114, 128, 0.3);
	}

	.restart-button:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 12px -2px rgba(107, 114, 128, 0.4);
		background: linear-gradient(135deg, #4b5563 0%, #374151 100%);
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
