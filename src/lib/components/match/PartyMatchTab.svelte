<script lang="ts">
	import type { BaseClusterResult, PartyScores } from '$lib/types/index.js';
	import { Search, Info } from '@lucide/svelte';

	interface Props {
		partyScores: PartyScores;
		clusterResults: BaseClusterResult[];
	}

	let { partyScores, clusterResults }: Props = $props();

	let partyMode = $state<'current' | 'historical'>('current');
	let partySearchQuery = $state('');
	let partySortField = $state('score');
	let partySortDirection = $state('desc');

	let activePartyScores = $derived.by(() => {
		return partyMode === 'current' ? partyScores.current : partyScores.historical;
	});

	let filteredParties = $derived.by(() => {
		let parties = [...activePartyScores];

		if (partySearchQuery) {
			const q = partySearchQuery.toLowerCase();
			parties = parties.filter((p) => p.partyName.toLowerCase().includes(q));
		}

		parties.sort((a, b) => {
			let valA: string | number, valB: string | number;

			if (partySortField === 'score') {
				valA = a.globalScore;
				valB = b.globalScore;
			} else if (partySortField === 'name') {
				valA = a.partyName;
				valB = b.partyName;
			} else if (partySortField === 'members') {
				valA = a.memberCount;
				valB = b.memberCount;
			} else if (partySortField.startsWith('cluster_')) {
				const cl = parseInt(partySortField.split('_')[1]);
				valA = a.clusterScores[cl] || 0;
				valB = b.clusterScores[cl] || 0;
			} else {
				valA = 0;
				valB = 0;
			}

			if (valA < valB) return partySortDirection === 'asc' ? -1 : 1;
			if (valA > valB) return partySortDirection === 'asc' ? 1 : -1;
			return 0;
		});

		return parties;
	});

	let topParties = $derived(activePartyScores.slice(0, 3));

	function togglePartySort(field: string) {
		if (partySortField === field) {
			partySortDirection = partySortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			partySortField = field;
			partySortDirection = 'desc';
			if (field === 'name') partySortDirection = 'asc';
		}
	}

	function formatSimilarity(sim: number): string {
		return `${(sim * 100).toFixed(1)}%`;
	}

	function getSimilarityColor(sim: number): string {
		if (sim < 0) return 'negative';
		if (sim >= 0.7) return 'high';
		if (sim >= 0.5) return 'medium';
		return 'low';
	}
</script>

<div class="party-match-tab fade-in">
	<!-- Mode Toggle -->
	<div class="party-mode-toggle">
		<button
			class="party-mode-btn"
			class:active={partyMode === 'current'}
			onclick={() => (partyMode = 'current')}
		>
			現在の所属議員
		</button>
		<button
			class="party-mode-btn"
			class:active={partyMode === 'historical'}
			onclick={() => (partyMode = 'historical')}
			disabled={partyScores.historical.length === 0}
		>
			在籍期間の行動
		</button>
	</div>
	<p class="party-mode-desc">
		{#if partyMode === 'current'}
			現在所属している議員のマッチ度を平均して政党スコアを算出しています。
		{:else}
			各法案の提出時期における議員の所属政党を基に、在籍期間に応じた重み付け平均で算出しています。
		{/if}
	</p>

	<!-- Top Party Spotlight -->
	{#if topParties.length > 0}
		<div class="party-spotlight">
			{#each topParties as partyItem, idx (partyItem.partyId)}
				<div
					class="party-spotlight-card"
					class:gold={idx === 0}
					class:silver={idx === 1}
					class:bronze={idx === 2}
				>
					<div class="party-spotlight-rank">
						{idx + 1}位
					</div>
					<div class="party-spotlight-info">
						<span class="party-spotlight-name">{partyItem.partyName}</span>
						<span class="party-spotlight-members">{partyItem.memberCount}名</span>
					</div>
					<div class="party-spotlight-score {getSimilarityColor(partyItem.globalScore)}">
						{formatSimilarity(partyItem.globalScore)}
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Party Table -->
	<div class="filters-bar">
		<div class="search-box">
			<span class="search-icon"><Search size={16} /></span>
			<input
				type="text"
				bind:value={partySearchQuery}
				placeholder="政党名で検索..."
				class="search-input"
			/>
		</div>
		<div class="count-badge">
			{filteredParties.length}党
		</div>
	</div>

	<div class="table-container">
		<div class="table-scroll">
			<table class="members-table">
				<thead>
					<tr>
						<th onclick={() => togglePartySort('score')} class="sortable sticky-col">
							順位 {partySortField === 'score' ? (partySortDirection === 'asc' ? '↑' : '↓') : ''}
						</th>
						<th onclick={() => togglePartySort('name')} class="sortable sticky-col">
							政党名 {partySortField === 'name' ? (partySortDirection === 'asc' ? '↑' : '↓') : ''}
						</th>
						<th onclick={() => togglePartySort('members')} class="sortable">
							議員数 {partySortField === 'members'
								? partySortDirection === 'asc'
									? '↑'
									: '↓'
								: ''}
						</th>
						<th onclick={() => togglePartySort('score')} class="sortable highlight-col text-right">
							総合 {partySortField === 'score' ? (partySortDirection === 'asc' ? '↑' : '↓') : ''}
						</th>
						{#each clusterResults as result (result.clusterLabel)}
							<th
								onclick={() => togglePartySort(`cluster_${result.clusterLabel}`)}
								class="sortable cluster-col text-right"
								title={result.clusterLabelName || `クラスター${result.clusterLabel}`}
							>
								<div class="th-content">
									<span class="cluster-short-name">
										{result.clusterLabelName
											? result.clusterLabelName.slice(0, 4)
											: `C${result.clusterLabel}`}
									</span>
									{partySortField === `cluster_${result.clusterLabel}`
										? partySortDirection === 'asc'
											? '↑'
											: '↓'
										: ''}
								</div>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each filteredParties as partyItem, idx (partyItem.partyId)}
						<tr>
							<td class="rank-cell sticky-col">
								{#if partySearchQuery === ''}
									<span class="rank-num">{idx + 1}</span>
								{:else}
									<span class="rank-num">-</span>
								{/if}
							</td>
							<td class="name-cell sticky-col">{partyItem.partyName}</td>
							<td class="group-cell">
								<span class="member-count-badge">{partyItem.memberCount}名</span>
							</td>
							<td class="score-cell highlight-col {getSimilarityColor(partyItem.globalScore)}">
								{formatSimilarity(partyItem.globalScore)}
							</td>
							{#each clusterResults as result (result.clusterLabel)}
								{@const score = partyItem.clusterScores[result.clusterLabel] || 0}
								<td class="score-cell cluster-cell {getSimilarityColor(score)}">
									{(score * 100).toFixed(0)}%
								</td>
							{/each}
						</tr>
					{/each}

					{#if filteredParties.length === 0}
						<tr>
							<td colspan={4 + clusterResults.length} class="empty-state">
								該当する政党が見つかりませんでした
							</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Explanation Section -->
	<details class="party-explanation">
		<summary class="party-explanation-summary">
			<Info size={16} />
			<span>政党マッチの計算方法について</span>
			<span class="expand-icon">▼</span>
		</summary>
		<div class="party-explanation-content">
			<div class="explanation-mode">
				<h4>現在の所属議員モード</h4>
				<p>
					各政党に<strong>現在所属している議員</strong>のマッチ度を単純平均して算出します。
				</p>
				<div class="explanation-formula">政党スコア = 所属議員のマッチ度の平均値</div>
				<p class="explanation-note">最近入党した議員も同じ重みでカウントされます。</p>
			</div>

			<div class="explanation-mode">
				<h4>在籍期間の行動モード</h4>
				<p>
					各法案の<strong>提出日～審議完了日</strong
					>の期間と、議員の政党在籍期間の重なりに基づく重み付き平均です。
				</p>
				<div class="explanation-steps">
					<div class="explanation-step">
						<span class="step-num">1</span>
						<span>各法案の活動期間（提出日～審議完了日）を特定</span>
					</div>
					<div class="explanation-step">
						<span class="step-num">2</span>
						<span>議員の政党在籍期間との重複を計算</span>
					</div>
					<div class="explanation-step">
						<span class="step-num">3</span>
						<span>重複割合で重み付けした議員マッチ度の加重平均を算出</span>
					</div>
				</div>
				<p class="explanation-note">
					途中で党を移った議員は、在籍していた両方の政党にそれぞれ貢献します。
				</p>
			</div>

			<div class="explanation-note-box">
				<p>
					議員数が少ない政党のスコアは、個人のばらつきが大きくなります。議員数を参考にしてください。
				</p>
				<p>
					各議員のスコアは法案への関与（提出・採決）に基づいて計算されています。詳しくは <a
						href="/legislation-scores">議案別スコア分析</a
					> の「スコア計算方法について」をご覧ください。
				</p>
			</div>
		</div>
	</details>
</div>

<style>
	.party-match-tab {
		display: flex;
		flex-direction: column;
	}

	.party-mode-toggle {
		display: inline-flex;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		overflow: hidden;
		margin-bottom: 0.75rem;
	}

	.party-mode-btn {
		padding: 0.625rem 1.25rem;
		background: white;
		border: none;
		font-size: 0.875rem;
		font-weight: 600;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.party-mode-btn:first-child {
		border-right: 1px solid #e5e7eb;
	}

	.party-mode-btn.active {
		background: #4f46e5;
		color: white;
	}

	.party-mode-btn:hover:not(.active):not(:disabled) {
		background: #f3f4f6;
		color: #1f2937;
	}

	.party-mode-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.party-mode-desc {
		color: #9ca3af;
		font-size: 0.8125rem;
		margin-bottom: 1.5rem;
		line-height: 1.5;
	}

	.party-spotlight {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.party-spotlight-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
		transition:
			transform 0.15s ease,
			box-shadow 0.15s ease;
	}

	.party-spotlight-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
	}

	.party-spotlight-card.gold {
		border-color: #fbbf24;
		background: linear-gradient(135deg, #fffbeb, white);
	}

	.party-spotlight-card.silver {
		border-color: #d1d5db;
		background: linear-gradient(135deg, #f9fafb, white);
	}

	.party-spotlight-card.bronze {
		border-color: #d97706;
		background: linear-gradient(135deg, #fffbeb, white);
	}

	.party-spotlight-rank {
		font-size: 0.875rem;
		font-weight: 800;
		color: #6b7280;
		min-width: 2rem;
	}

	.party-spotlight-card.gold .party-spotlight-rank {
		color: #d97706;
	}

	.party-spotlight-card.silver .party-spotlight-rank {
		color: #6b7280;
	}

	.party-spotlight-card.bronze .party-spotlight-rank {
		color: #92400e;
	}

	.party-spotlight-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.party-spotlight-name {
		font-weight: 700;
		color: #1f2937;
		font-size: 0.9375rem;
	}

	.party-spotlight-members {
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.party-spotlight-score {
		font-size: 1.25rem;
		font-weight: 800;
		font-feature-settings: 'tnum';
	}

	/* Table styles (shared pattern) */
	.filters-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.search-box {
		position: relative;
		flex: 1;
		max-width: 400px;
	}

	.search-icon {
		position: absolute;
		left: 12px;
		top: 50%;
		transform: translateY(-50%);
		color: #9ca3af;
		pointer-events: none;
	}

	.search-input {
		width: 100%;
		padding: 0.75rem 1rem 0.75rem 2.5rem;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 0.9375rem;
		transition: border-color 0.2s;
	}

	.search-input:focus {
		outline: none;
		border-color: #4f46e5;
		box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
	}

	.count-badge {
		background: #f3f4f6;
		padding: 0.5rem 1rem;
		border-radius: 9999px;
		font-size: 0.875rem;
		font-weight: 600;
		color: #4b5563;
	}

	.table-container {
		background: white;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
		overflow: hidden;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
	}

	.table-scroll {
		overflow-x: auto;
		max-width: 100%;
	}

	.members-table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
	}

	.members-table th {
		background: #f9fafb;
		padding: 1rem 0.75rem;
		text-align: left;
		font-weight: 600;
		color: #4b5563;
		font-size: 0.8125rem;
		border-bottom: 1px solid #e5e7eb;
		cursor: pointer;
		user-select: none;
		transition: background 0.2s;
		white-space: nowrap;
	}

	.members-table th:hover {
		background: #f3f4f6;
		color: #1f2937;
	}

	.members-table th.text-right {
		text-align: right;
	}

	.members-table td {
		padding: 0.75rem;
		border-bottom: 1px solid #f3f4f6;
		color: #1f2937;
		white-space: nowrap;
	}

	.members-table tr:last-child td {
		border-bottom: none;
	}

	.members-table tr:hover {
		background: #f9fafb;
	}

	.sticky-col {
		position: sticky;
		left: 0;
		background: white;
		z-index: 1;
	}

	.members-table th.sticky-col {
		background: #f9fafb;
		z-index: 2;
	}

	.members-table tr:hover .sticky-col {
		background: #f9fafb;
	}

	.members-table th:nth-child(1),
	.members-table td:nth-child(1) {
		left: 0;
		width: 50px;
		border-right: 1px solid #f3f4f6;
	}

	.members-table th:nth-child(2),
	.members-table td:nth-child(2) {
		left: 50px;
		border-right: 1px solid #e5e7eb;
		box-shadow: 2px 0 5px -2px rgba(0, 0, 0, 0.05);
	}

	.rank-cell {
		text-align: center;
		color: #6b7280;
		font-weight: 500;
	}

	.name-cell {
		font-weight: 600;
	}

	.member-count-badge {
		display: inline-block;
		padding: 0.25rem 0.75rem;
		background: #eef2ff;
		border-radius: 9999px;
		font-size: 0.75rem;
		color: #4f46e5;
		font-weight: 600;
	}

	.score-cell {
		text-align: right;
		font-weight: 700;
		font-feature-settings: 'tnum';
	}

	.highlight-col {
		background: #f8fafc;
		border-left: 1px solid #f1f5f9;
		border-right: 1px solid #f1f5f9;
	}

	.cluster-col {
		min-width: 80px;
	}

	.cluster-cell {
		font-weight: 500;
		color: #6b7280;
		font-size: 0.875rem;
	}

	.empty-state {
		text-align: center;
		padding: 3rem !important;
		color: #6b7280;
	}

	/* Party Explanation */
	.party-explanation {
		margin-top: 1.5rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		overflow: hidden;
	}

	.party-explanation[open] .expand-icon {
		transform: rotate(180deg);
	}

	.party-explanation-summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.875rem 1rem;
		cursor: pointer;
		background: #f9fafb;
		font-size: 0.9rem;
		font-weight: 600;
		color: #374151;
		list-style: none;
		user-select: none;
	}

	.party-explanation-summary::-webkit-details-marker {
		display: none;
	}

	.party-explanation-summary .expand-icon {
		margin-left: auto;
		font-size: 0.75rem;
		color: #9ca3af;
		transition: transform 0.2s;
	}

	.party-explanation-content {
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		font-size: 0.85rem;
		line-height: 1.6;
		color: #4b5563;
	}

	.explanation-mode h4 {
		font-size: 0.9rem;
		font-weight: 700;
		color: #1a1a2e;
		margin-bottom: 0.4rem;
	}

	.explanation-mode p {
		margin: 0.25rem 0;
	}

	.explanation-formula {
		background: #eef2ff;
		border-radius: 8px;
		padding: 0.6rem 1rem;
		font-weight: 600;
		color: #4338ca;
		text-align: center;
		margin: 0.5rem 0;
		font-size: 0.85rem;
	}

	.explanation-steps {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin: 0.5rem 0;
	}

	.explanation-step {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.step-num {
		width: 22px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: #4f46e5;
		color: white;
		font-size: 0.75rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	.explanation-note {
		font-size: 0.8rem;
		color: #6b7280;
		font-style: italic;
	}

	.explanation-note-box {
		background: #fffbeb;
		border-left: 3px solid #f59e0b;
		border-radius: 0 8px 8px 0;
		padding: 0.75rem 1rem;
		font-size: 0.8rem;
		color: #78350f;
	}

	.explanation-note-box p {
		margin: 0.25rem 0;
	}

	.explanation-note-box a {
		color: #4f46e5;
		text-decoration: underline;
		font-weight: 600;
	}

	.explanation-note-box a:hover {
		color: #4338ca;
	}

	.fade-in {
		animation: fadeIn 0.3s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	:global(.high) {
		color: #059669;
	}
	:global(.medium) {
		color: #d97706;
	}
	:global(.low) {
		color: #6b7280;
	}
	:global(.negative) {
		color: #dc2626;
	}

	@media (max-width: 640px) {
		.filters-bar {
			flex-direction: column;
			align-items: stretch;
		}
		.search-box {
			max-width: none;
		}
		.party-spotlight {
			grid-template-columns: 1fr;
		}
	}
</style>
