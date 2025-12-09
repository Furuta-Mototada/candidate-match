<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Member {
		memberId: number;
		name: string;
		group?: string | null;
		score: number;
		// Optional extra data for custom rendering if needed
		[key: string]: any;
	}

	interface Props {
		title?: string;
		members: Member[];
		limit?: number;
		compact?: boolean;
		showGroup?: boolean;
		scoreLabel?: string;
		className?: string;
		extraContent?: Snippet<[Member]>;
	}

	let {
		title = '',
		members = [],
		limit = 10,
		compact = false,
		showGroup = true,
		scoreLabel = '',
		className = '',
		extraContent
	}: Props = $props();

	function formatSimilarity(sim: number): string {
		return (sim * 100).toFixed(1) + '%';
	}

	function getSimilarityColor(sim: number): string {
		if (sim >= 0.8) return 'high';
		if (sim >= 0.6) return 'medium';
		if (sim >= 0.4) return 'low'; // Adjusted to match QuestioningPhase logic (was < 0.5 is low)
		return 'low';
	}

	// Helper to match the logic in QuestioningPhase/ClusterReviewPhase
	// high >= 0.7, medium >= 0.5, low < 0.5
	function getScoreClass(score: number): string {
		if (score >= 0.7) return 'high';
		if (score >= 0.5) return 'medium';
		return 'low';
	}
</script>

<div class="ranking-container {className}" class:compact>
	{#if title}
		<h3 class="ranking-title">{title}</h3>
	{/if}

	<div class="ranking-list">
		{#each members.slice(0, limit) as member, idx (member.memberId)}
			<div class="ranking-item" class:top-rank={idx === 0 && !compact}>
				<div class="rank-section">
					<div
						class="rank-badge"
						class:gold={idx === 0}
						class:silver={idx === 1}
						class:bronze={idx === 2}
					>
						{idx + 1}
					</div>
				</div>

				<div class="info-section">
					<div class="member-name">
						{member.name}
						{#if showGroup && member.group}
							<span class="member-group">({member.group})</span>
						{/if}
					</div>
				</div>

				<div class="score-section">
					<div class="score-value {getScoreClass(member.score)}">
						{formatSimilarity(member.score)}
					</div>
					{#if scoreLabel && !compact}
						<div class="score-label">{scoreLabel}</div>
					{/if}
				</div>
			</div>
			{#if extraContent}
				{@render extraContent(member)}
			{/if}
		{/each}
	</div>
</div>

<style>
	.ranking-container {
		width: 100%;
	}

	.ranking-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: #6b7280;
		margin-bottom: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.ranking-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.ranking-item {
		display: flex;
		align-items: center;
		padding: 0.75rem 0;
		border-bottom: 1px solid #f3f4f6;
		transition: all 0.2s;
	}

	.ranking-item:last-child {
		border-bottom: none;
	}

	/* Compact mode styles (closer to QuestioningPhase preview) */
	.ranking-container.compact .ranking-item {
		padding: 0.5rem 0;
		gap: 0.75rem;
	}

	.ranking-container.compact .ranking-title {
		margin-bottom: 0.5rem;
	}

	.rank-section {
		margin-right: 0.75rem;
	}

	.rank-badge {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		background: #e5e7eb;
		color: #4b5563;
		border-radius: 50%;
		font-weight: 600;
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	.rank-badge.gold {
		background: #fef3c7;
		color: #d97706;
		border: 1px solid #fcd34d;
	}

	.rank-badge.silver {
		background: #f3f4f6;
		color: #4b5563;
		border: 1px solid #d1d5db;
	}

	.rank-badge.bronze {
		background: #fff7ed;
		color: #c2410c;
		border: 1px solid #fdba74;
	}

	/* In compact mode, maybe just use simple colors or the same */
	.ranking-container.compact .rank-badge {
		background: #6366f1;
		color: white;
		border: none;
	}

	.info-section {
		flex: 1;
		min-width: 0; /* Truncate text */
	}

	.member-name {
		font-weight: 600;
		color: #1f2937;
		font-size: 0.9375rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.member-group {
		color: #6b7280;
		font-weight: 400;
		font-size: 0.8125rem;
		margin-left: 0.25rem;
	}

	.score-section {
		text-align: right;
		margin-left: 0.5rem;
	}

	.score-value {
		font-weight: 700;
		font-size: 1rem;
	}

	.score-label {
		font-size: 0.7rem;
		color: #6b7280;
	}

	/* Score Colors */
	.high {
		color: #10b981;
	}

	.medium {
		color: #3b82f6;
	}

	.low {
		color: #ef4444;
	}
</style>
