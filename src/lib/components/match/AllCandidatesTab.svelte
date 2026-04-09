<script lang="ts">
	import type { BaseClusterResult, GlobalMemberScore } from '$lib/types/index.js';
	import { Search } from '@lucide/svelte';

	interface Props {
		globalScores: GlobalMemberScore[];
		clusterResults: BaseClusterResult[];
		onMemberClick: (m: { memberId: number; name: string; group: string | null }) => void;
	}

	let { globalScores, clusterResults, onMemberClick }: Props = $props();

	let searchQuery = $state('');
	let debouncedQuery = $state('');
	let sortField = $state('score');
	let sortDirection = $state('desc');

	$effect(() => {
		const query = searchQuery;
		const timer = setTimeout(() => {
			debouncedQuery = query;
		}, 200);
		return () => clearTimeout(timer);
	});

	let filteredMembers = $derived.by(() => {
		let members = [...globalScores];

		if (debouncedQuery) {
			const q = debouncedQuery.toLowerCase();
			members = members.filter(
				(m) => m.name.toLowerCase().includes(q) || (m.group && m.group.toLowerCase().includes(q))
			);
		}

		members.sort((a, b) => {
			let valA: string | number, valB: string | number;

			if (sortField === 'score') {
				valA = a.globalScore;
				valB = b.globalScore;
			} else if (sortField === 'name') {
				valA = a.name;
				valB = b.name;
			} else if (sortField === 'group') {
				valA = a.group || '';
				valB = b.group || '';
			} else if (sortField.startsWith('cluster_')) {
				const clusterId = parseInt(sortField.split('_')[1]);
				valA = a.clusterScores[clusterId] || 0;
				valB = b.clusterScores[clusterId] || 0;
			} else {
				valA = 0;
				valB = 0;
			}

			if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
			if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
			return 0;
		});

		return members;
	});

	function toggleSort(field: string) {
		if (sortField === field) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortField = field;
			sortDirection = 'desc';
			if (field === 'name' || field === 'group') sortDirection = 'asc';
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

<div class="all-candidates-tab fade-in">
	<div class="filters-bar">
		<div class="search-box">
			<span class="search-icon"><Search size={16} /></span>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="名前や政党で検索..."
				class="search-input"
			/>
		</div>
		<div class="count-badge">
			{filteredMembers.length}名
		</div>
	</div>

	<div class="table-container">
		<div class="table-scroll">
			<table class="members-table">
				<thead>
					<tr>
						<th onclick={() => toggleSort('score')} class="sortable sticky-col">
							順位 {sortField === 'score' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
						</th>
						<th onclick={() => toggleSort('name')} class="sortable sticky-col">
							氏名 {sortField === 'name' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
						</th>
						<th onclick={() => toggleSort('group')} class="sortable">
							所属 {sortField === 'group' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
						</th>
						<th onclick={() => toggleSort('score')} class="sortable highlight-col text-right">
							総合 {sortField === 'score' ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
						</th>
						{#each clusterResults as result (result.clusterLabel)}
							<th
								onclick={() => toggleSort(`cluster_${result.clusterLabel}`)}
								class="sortable cluster-col text-right"
								title={result.clusterLabelName || `クラスター${result.clusterLabel}`}
							>
								<div class="th-content">
									<span class="cluster-short-name">
										{result.clusterLabelName
											? result.clusterLabelName.slice(0, 4)
											: `C${result.clusterLabel}`}
									</span>
									{sortField === `cluster_${result.clusterLabel}`
										? sortDirection === 'asc'
											? '↑'
											: '↓'
										: ''}
								</div>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each filteredMembers as member, idx (member.memberId)}
						<tr
							class="member-row-clickable"
							onclick={() =>
								onMemberClick({
									memberId: member.memberId,
									name: member.name,
									group: member.group
								})}
						>
							<td class="rank-cell sticky-col">
								{#if searchQuery === ''}
									<span class="rank-num">{idx + 1}</span>
								{:else}
									<span class="rank-num">-</span>
								{/if}
							</td>
							<td class="name-cell sticky-col">{member.name}</td>
							<td class="group-cell">
								<span class="group-badge">{member.group || '無所属'}</span>
							</td>
							<td class="score-cell highlight-col {getSimilarityColor(member.globalScore)}">
								{formatSimilarity(member.globalScore)}
							</td>
							{#each clusterResults as result (result.clusterLabel)}
								{@const score = member.clusterScores[result.clusterLabel] || 0}
								<td class="score-cell cluster-cell {getSimilarityColor(score)}">
									{(score * 100).toFixed(0)}%
								</td>
							{/each}
						</tr>
					{/each}

					{#if filteredMembers.length === 0}
						<tr>
							<td colspan={4 + clusterResults.length} class="empty-state">
								該当する議員が見つかりませんでした
							</td>
						</tr>
					{/if}
				</tbody>
			</table>
		</div>
	</div>
</div>

<style>
	.all-candidates-tab {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

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

	.group-badge {
		display: inline-block;
		padding: 0.25rem 0.75rem;
		background: #f3f4f6;
		border-radius: 9999px;
		font-size: 0.75rem;
		color: #4b5563;
		font-weight: 500;
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

	.member-row-clickable {
		cursor: pointer;
		transition: background 0.15s;
	}

	.member-row-clickable:hover {
		background: #f0f4ff !important;
	}

	.member-row-clickable:hover .sticky-col {
		background: #f0f4ff !important;
	}

	.fade-in {
		animation: fadeIn 0.3s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
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
</style>
