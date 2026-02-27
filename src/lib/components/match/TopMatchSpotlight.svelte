<script lang="ts">
	import type { GlobalMemberScore, BaseClusterResult } from '$lib/types/index.js';

	interface Props {
		members: GlobalMemberScore[]; // Changed from single member to array
		clusterResults: BaseClusterResult[];
	}

	let { members, clusterResults }: Props = $props();

	// Take top 3
	let topMembers = $derived(members.slice(0, 3));

	function formatSimilarity(sim: number): string {
		return `${(sim * 100).toFixed(1)}%`;
	}

	function getSimilarityColor(sim: number): string {
		if (sim >= 0.7) return 'text-emerald-600 bg-emerald-50';
		if (sim >= 0.5) return 'text-blue-600 bg-blue-50';
		return 'text-red-600 bg-red-50';
	}

	function getBarColor(sim: number): string {
		if (sim >= 0.7) return 'bg-emerald-500';
		if (sim >= 0.5) return 'bg-blue-500';
		return 'bg-red-500';
	}
</script>

<div class="spotlight-container fade-in-up">
	{#each topMembers as member, idx (member.memberId)}
		<div
			class="spotlight-card"
			class:gold={idx === 0}
			class:silver={idx === 1}
			class:bronze={idx === 2}
		>
			<div class="spotlight-header">
				<div class="rank-badge-wrapper">
					<div class="rank-badge">
						{#if idx === 0}🏆{:else if idx === 1}🥈{:else}🥉{/if}
						{idx + 1}位
					</div>
				</div>
				<div class="member-info">
					<h2 class="member-name">{member.name}</h2>
					<p class="member-group">{member.group || '無所属'}</p>
				</div>
				<div class="total-score">
					<span class="score-label">総合マッチ度</span>
					<span class="score-value">{formatSimilarity(member.globalScore)}</span>
				</div>
			</div>

			<div class="spotlight-body">
				<h3 class="breakdown-title">分野別マッチ度</h3>
				<div class="cluster-breakdown">
					{#each clusterResults as result}
						{@const score = member.clusterScores[result.clusterLabel] || 0}
						<div class="cluster-row">
							<div class="cluster-info">
								<span class="cluster-name">
									{result.clusterLabelName || `クラスター${result.clusterLabel}`}
								</span>
								<span class="cluster-score">{formatSimilarity(score)}</span>
							</div>
							<div class="progress-bar-bg">
								<div
									class="progress-bar-fill {getBarColor(score)}"
									style="width: {score * 100}%"
								></div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/each}
</div>

<style>
	.spotlight-container {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		margin-bottom: 2rem;
	}

	.spotlight-card {
		background: white;
		border-radius: 16px;
		box-shadow:
			0 4px 6px -1px rgba(0, 0, 0, 0.1),
			0 2px 4px -1px rgba(0, 0, 0, 0.06);
		overflow: hidden;
		border: 1px solid #e5e7eb;
		transition: transform 0.2s;
	}

	/* Highlight the #1 match a bit more */
	.spotlight-card.gold {
		border: 2px solid #fbbf24;
		box-shadow:
			0 10px 15px -3px rgba(251, 191, 36, 0.1),
			0 4px 6px -2px rgba(251, 191, 36, 0.05);
	}

	.spotlight-header {
		background: linear-gradient(to right, #f8fafc, #ffffff);
		padding: 1.25rem 1.5rem;
		display: flex;
		align-items: center;
		gap: 1.5rem;
		border-bottom: 1px solid #f1f5f9;
	}

	.rank-badge-wrapper {
		flex-shrink: 0;
	}

	.rank-badge {
		font-weight: 800;
		padding: 0.5rem 1rem;
		border-radius: 9999px;
		font-size: 1rem;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: white;
	}

	.gold .rank-badge {
		background: linear-gradient(135deg, #fbbf24 0%, #d97706 100%);
		box-shadow: 0 2px 4px rgba(245, 158, 11, 0.3);
	}

	.silver .rank-badge {
		background: linear-gradient(135deg, #94a3b8 0%, #64748b 100%);
		box-shadow: 0 2px 4px rgba(100, 116, 139, 0.3);
	}

	.bronze .rank-badge {
		background: linear-gradient(135deg, #d97706 0%, #b45309 100%); /* Bronze-ish */
		box-shadow: 0 2px 4px rgba(180, 83, 9, 0.3);
	}

	.member-info {
		flex: 1;
	}

	.member-name {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1f2937;
		line-height: 1.2;
	}

	.gold .member-name {
		font-size: 1.5rem;
	}

	.member-group {
		color: #6b7280;
		font-size: 0.875rem;
		margin-top: 0.25rem;
	}

	.total-score {
		text-align: right;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}

	.score-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #6b7280;
		font-weight: 600;
	}

	.score-value {
		font-size: 1.5rem;
		font-weight: 800;
		color: #4f46e5;
		line-height: 1;
		margin-top: 0.25rem;
	}

	.gold .score-value {
		font-size: 2rem;
	}

	.spotlight-body {
		padding: 1.25rem 1.5rem;
	}

	/* Hide breakdown for 2nd and 3rd initially to save space? 
	   For now, let's show it but maybe more compact grid */

	.breakdown-title {
		font-size: 0.75rem;
		font-weight: 600;
		color: #9ca3af;
		margin-bottom: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.cluster-breakdown {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.75rem 1.5rem;
	}

	.cluster-row {
		margin-bottom: 0.25rem;
	}

	.cluster-info {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.25rem;
		font-size: 0.8125rem;
	}

	.cluster-name {
		font-weight: 500;
		color: #374151;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 70%;
	}

	.cluster-score {
		font-weight: 600;
		color: #4b5563;
	}

	.progress-bar-bg {
		height: 6px;
		background: #f3f4f6;
		border-radius: 3px;
		overflow: hidden;
	}

	.progress-bar-fill {
		height: 100%;
		border-radius: 3px;
		transition: width 1s ease-out;
	}

	.fade-in-up {
		animation: fadeInUp 0.6s ease both;
	}

	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (max-width: 640px) {
		.spotlight-header {
			flex-direction: column;
			text-align: center;
			gap: 0.75rem;
		}

		.total-score {
			align-items: center;
		}

		.cluster-breakdown {
			grid-template-columns: 1fr;
		}
	}
</style>
