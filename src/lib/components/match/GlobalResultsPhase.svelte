<script lang="ts">
	import LatentSpaceVisualization from '$lib/components/match/LatentSpaceVisualization.svelte';
	import MemberRankingList from '$lib/components/match/MemberRankingList.svelte';
	import TopMatchSpotlight from '$lib/components/match/TopMatchSpotlight.svelte';
	import ClusterInsightCard from '$lib/components/match/ClusterInsightCard.svelte';
	import type { ClusterResult, GlobalMemberScore } from '$lib/types/index.js';

	interface Props {
		clusterResults: ClusterResult[];
		globalScores: GlobalMemberScore[];
		onReset: () => void;
		// Save functionality
		onSave?: (name: string, description: string) => Promise<void>;
		isSaving?: boolean;
		savedSessionId?: number | null;
		isResumeMode?: boolean;
		// Continue answering functionality
		onContinue?: () => void;
		totalUnansweredBills?: number;
		isContinuing?: boolean;
	}

	let {
		clusterResults,
		globalScores,
		onReset,
		onSave,
		isSaving = false,
		savedSessionId = null,
		isResumeMode = false,
		onContinue,
		totalUnansweredBills = 0,
		isContinuing = false
	}: Props = $props();

	let activeTab = $state('overview'); // 'overview' | 'analysis' | 'all-candidates'
	let searchQuery = $state('');
	let sortField = $state('score'); // 'score' | 'name' | 'group'
	let sortDirection = $state('desc'); // 'asc' | 'desc'

	// Save modal state
	let showSaveModal = $state(false);
	let saveName = $state('');
	let saveDescription = $state('');
	let saveError = $state<string | null>(null);

	// Derived state
	let topMembers = $derived(globalScores.slice(0, 3));

	let filteredMembers = $derived.by(() => {
		let members = [...globalScores];

		// Filter
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			members = members.filter(
				(m) => m.name.toLowerCase().includes(q) || (m.group && m.group.toLowerCase().includes(q))
			);
		}

		// Sort
		members.sort((a, b) => {
			let valA, valB;

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

	function toggleSort(field: string) {
		if (sortField === field) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
		} else {
			sortField = field;
			sortDirection = 'desc'; // Default to desc for new field (usually score)
			if (field === 'name' || field === 'group') sortDirection = 'asc';
		}
	}

	function getAnswerText(score: number): string {
		if (score === 1) return '賛成';
		if (score === -1) return '反対';
		return 'どちらでもない';
	}

	function getAnswerColor(score: number): string {
		if (score === 1) return 'answer-agree';
		if (score === -1) return 'answer-disagree';
		return 'answer-neutral';
	}

	async function handleSave() {
		if (!onSave) return;
		if (!saveName.trim()) {
			saveError = '名前を入力してください';
			return;
		}

		saveError = null;
		try {
			await onSave(saveName.trim(), saveDescription.trim());
			showSaveModal = false;
			saveName = '';
			saveDescription = '';
		} catch (e) {
			saveError = e instanceof Error ? e.message : '保存に失敗しました';
		}
	}

	function openSaveModal() {
		// Set default name with date
		const now = new Date();
		saveName = `マッチング結果 ${now.toLocaleDateString('ja-JP')}`;
		saveDescription = '';
		saveError = null;
		showSaveModal = true;
	}
</script>

<div class="results-container">
	<!-- Simple Header -->
	<div class="results-header fade-in-up">
		<div class="header-top">
			<h2 class="results-title">マッチング結果</h2>
			<div class="header-actions">
				{#if totalUnansweredBills > 0 && onContinue}
					<button class="btn-continue" onclick={onContinue} disabled={isContinuing}>
						<span>{isContinuing ? '⏳' : '➕'}</span>
						{isContinuing ? '読み込み中...' : `追加回答 (${totalUnansweredBills}件)`}
					</button>
				{/if}
				{#if savedSessionId}
					<a href="/match/saved/{savedSessionId}" class="btn-view-saved">
						<span>📋</span>
						保存済み結果を見る
					</a>
				{:else if onSave}
					<button class="btn-save" onclick={openSaveModal} disabled={isSaving}>
						<span>💾</span>
						{isSaving ? '保存中...' : '結果を保存'}
					</button>
				{/if}
				<button class="btn-reset" onclick={onReset}>
					<span>🔄</span>
					最初から
				</button>
			</div>
		</div>

		<div class="tabs-container">
			<div class="tabs-nav">
				<button
					class="tab-btn"
					class:active={activeTab === 'overview'}
					onclick={() => (activeTab = 'overview')}
				>
					概要
				</button>
				<button
					class="tab-btn"
					class:active={activeTab === 'analysis'}
					onclick={() => (activeTab = 'analysis')}
				>
					回答記録
				</button>
				<button
					class="tab-btn"
					class:active={activeTab === 'all-candidates'}
					onclick={() => (activeTab = 'all-candidates')}
				>
					全議員リスト
				</button>
			</div>
		</div>
	</div>

	<!-- Tab Content -->
	<div class="tab-content">
		{#if activeTab === 'overview'}
			<!-- OVERVIEW TAB -->
			<div class="overview-tab fade-in">
				{#if topMembers.length > 0}
					<TopMatchSpotlight members={topMembers} {clusterResults} />
				{/if}

				<h3 class="section-heading">分野別トップマッチ</h3>
				<div class="cluster-grid">
					{#each clusterResults as result (result.clusterLabel)}
						<ClusterInsightCard {result} />
					{/each}
				</div>
			</div>
		{:else if activeTab === 'analysis'}
			<!-- HISTORY TAB (Formerly Analysis) -->
			<div class="analysis-tab fade-in">
				<div class="trajectories-list">
					{#each clusterResults as result (result.clusterLabel)}
						<div class="trajectory-item">
							<div class="trajectory-header">
								<span class="trajectory-name">
									{result.clusterLabelName || `クラスター${result.clusterLabel}`}
								</span>
								<span class="trajectory-stars">{getStars(result.importance)}</span>
							</div>

							<div class="cluster-content-grid">
								<!-- Graph Column -->
								<div class="viz-section">
									<h4 class="subsection-title">あなたの立ち位置</h4>
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
											width={400}
											height={300}
											showDimensionSelectors={false}
											title=""
											showLegend={true}
											compact={true}
											collapsible={false}
										/>
									</div>
								</div>

								<!-- Answers Column -->
								<div class="answers-section">
									<h4 class="subsection-title">回答した法案</h4>
									{#if result.answeredBills && result.answeredBills.length > 0}
										<ul class="answers-list">
											{#each result.answeredBills as bill}
												<li class="answer-item">
													<span class="answer-badge {getAnswerColor(bill.answer)}">
														{getAnswerText(bill.answer)}
													</span>
													<span class="bill-title">{bill.title}</span>
												</li>
											{/each}
										</ul>
									{:else}
										<p class="no-answers">回答データがありません</p>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{:else if activeTab === 'all-candidates'}
			<!-- ALL CANDIDATES TAB -->
			<div class="all-candidates-tab fade-in">
				<div class="filters-bar">
					<div class="search-box">
						<span class="search-icon">🔍</span>
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
									<!-- Cluster Columns -->
									{#each clusterResults as result}
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
									<tr>
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
										<!-- Cluster Scores -->
										{#each clusterResults as result}
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
		{/if}
	</div>

	<!-- Actions -->
	<div class="final-actions">
		{#if savedSessionId}
			<a href="/match/saved/{savedSessionId}" class="view-saved-button"> 📋 保存済み結果を見る </a>
		{:else if onSave}
			<button onclick={openSaveModal} class="save-button" disabled={isSaving}>
				💾 {isSaving ? '保存中...' : '結果を保存する'}
			</button>
		{/if}
		<button onclick={onReset} class="restart-button"> 🔄 最初からやり直す </button>
	</div>

	<!-- Save Modal -->
	{#if showSaveModal}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-overlay" onclick={() => (showSaveModal = false)}>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<!-- svelte-ignore a11y_interactive_supports_focus -->
			<div class="modal-container" onclick={(e) => e.stopPropagation()} role="dialog">
				<button class="modal-close-btn" onclick={() => (showSaveModal = false)}>×</button>

				<h2 class="modal-title">💾 結果を保存</h2>
				<p class="modal-desc">
					マッチング結果を保存して、後で確認したり追加の回答をしたりできます。
				</p>

				{#if saveError}
					<div class="modal-error">{saveError}</div>
				{/if}

				<div class="form-group">
					<label for="save-name">名前 *</label>
					<input
						type="text"
						id="save-name"
						bind:value={saveName}
						placeholder="例: 2024年マッチング結果"
					/>
				</div>

				<div class="form-group">
					<label for="save-description">説明（任意）</label>
					<textarea
						id="save-description"
						bind:value={saveDescription}
						placeholder="メモや覚え書きなど..."
						rows="3"
					></textarea>
				</div>

				<div class="modal-actions">
					<button class="btn-cancel" onclick={() => (showSaveModal = false)}> キャンセル </button>
					<button
						class="btn-save-confirm"
						onclick={handleSave}
						disabled={isSaving || !saveName.trim()}
					>
						{isSaving ? '保存中...' : '保存する'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.results-container {
		max-width: 900px;
		margin: 0 auto;
		padding-bottom: 4rem;
	}

	/* HEADER & TABS */
	.results-header {
		text-align: center;
		margin-bottom: 2rem;
	}

	.header-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.header-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.btn-save {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: linear-gradient(135deg, #10b981, #059669);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-save:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
	}

	.btn-save:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-continue {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: linear-gradient(135deg, #f59e0b, #d97706);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-continue:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
	}

	.btn-view-saved {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.875rem;
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.btn-view-saved:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
	}

	.btn-reset {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: #f3f4f6;
		color: #4b5563;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-reset:hover {
		background: #e5e7eb;
	}

	.results-title {
		font-size: 1.75rem;
		font-weight: 800;
		color: #1f2937;
		margin: 0;
	}

	.tabs-container {
		display: flex;
		justify-content: center;
		padding-bottom: 1rem;
	}

	.tabs-nav {
		display: inline-flex;
		border-bottom: 1px solid #e5e7eb;
		gap: 2rem;
		padding: 0 1rem;
	}

	.tab-btn {
		background: transparent;
		border: none;
		color: #6b7280;
		padding: 0.75rem 0.5rem;
		font-weight: 600;
		font-size: 0.9375rem;
		cursor: pointer;
		transition: all 0.2s;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}

	.tab-btn:hover {
		color: #1f2937;
	}

	.tab-btn.active {
		color: #4f46e5;
		border-bottom-color: #4f46e5;
	}

	/* COMMON SECTION STYLES */
	.section-heading {
		font-size: 1.125rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.section-desc {
		color: #6b7280;
		margin-bottom: 1.5rem;
		line-height: 1.6;
	}

	/* OVERVIEW TAB */
	.cluster-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1.5rem;
	}

	/* HISTORY TAB (Formerly Analysis) */
	.trajectories-list {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.trajectory-item {
		background: white;
		border-radius: 12px;
		padding: 1.5rem;
		border: 1px solid #e5e7eb;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
	}

	.trajectory-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid #f3f4f6;
	}

	.trajectory-name {
		font-size: 1.125rem;
		font-weight: 700;
		color: #1f2937;
	}

	.trajectory-stars {
		color: #fbbf24;
		font-size: 1rem;
	}

	.cluster-content-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2rem;
	}

	.subsection-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: #6b7280;
		margin-bottom: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.viz-section {
		display: flex;
		flex-direction: column;
	}

	.viz-container {
		width: 100%;
		border: 1px solid #f3f4f6;
		border-radius: 8px;
		overflow: hidden;
	}

	.answers-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.answer-item {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.75rem;
		background: #f9fafb;
		border-radius: 8px;
		font-size: 0.875rem;
	}

	.answer-badge {
		flex-shrink: 0;
		font-weight: 700;
		font-size: 0.75rem;
		padding: 0.125rem 0.5rem;
		border-radius: 4px;
		background: white;
		border: 1px solid currentColor;
	}

	.answer-agree {
		color: #059669;
	}
	.answer-disagree {
		color: #dc2626;
	}
	.answer-neutral {
		color: #6b7280;
	}

	.bill-title {
		color: #1f2937;
		line-height: 1.4;
	}

	.no-answers {
		color: #9ca3af;
		font-style: italic;
		font-size: 0.875rem;
	}

	@media (max-width: 768px) {
		.cluster-content-grid {
			grid-template-columns: 1fr;
		}
	}

	/* ALL CANDIDATES TAB */
	.filters-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
		gap: 1rem;
	}

	.search-box {
		flex: 1;
		position: relative;
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
		border-collapse: separate; /* Required for sticky positioning */
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

	/* Sticky Columns */
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

	/* Adjust sticky positions */
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

	/* FINAL ACTIONS */
	.final-actions {
		display: flex;
		justify-content: center;
		gap: 1rem;
		margin-top: 3rem;
		flex-wrap: wrap;
	}

	.save-button {
		background: linear-gradient(135deg, #10b981, #059669);
		color: white;
		border: none;
		padding: 0.875rem 2rem;
		border-radius: 8px;
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
	}

	.save-button:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 6px 16px rgba(16, 185, 129, 0.3);
	}

	.save-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.view-saved-button {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		padding: 0.875rem 2rem;
		border-radius: 8px;
		font-size: 0.9375rem;
		font-weight: 600;
		text-decoration: none;
		transition: all 0.2s ease;
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
	}

	.view-saved-button:hover {
		transform: translateY(-2px);
		box-shadow: 0 6px 16px rgba(99, 102, 241, 0.3);
	}

	.restart-button {
		background: white;
		color: #4b5563;
		border: 1px solid #d1d5db;
		padding: 0.75rem 2rem;
		border-radius: 8px;
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}

	.restart-button:hover {
		background: #f9fafb;
		border-color: #9ca3af;
		color: #1f2937;
	}

	/* MODAL */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.modal-container {
		background: white;
		width: 100%;
		max-width: 450px;
		border-radius: 16px;
		padding: 2rem;
		position: relative;
		box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
	}

	.modal-close-btn {
		position: absolute;
		top: 1rem;
		right: 1rem;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: #f3f4f6;
		border: none;
		font-size: 1.25rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.modal-close-btn:hover {
		background: #e5e7eb;
	}

	.modal-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 0.5rem;
	}

	.modal-desc {
		color: #6b7280;
		margin-bottom: 1.5rem;
		font-size: 0.95rem;
	}

	.modal-error {
		background: #fee2e2;
		border: 1px solid #fca5a5;
		color: #991b1b;
		padding: 0.75rem 1rem;
		border-radius: 8px;
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}

	.form-group {
		margin-bottom: 1.25rem;
	}

	.form-group label {
		display: block;
		font-weight: 600;
		color: #1f2937;
		margin-bottom: 0.5rem;
		font-size: 0.9rem;
	}

	.form-group input,
	.form-group textarea {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 1rem;
		font-family: inherit;
	}

	.form-group input:focus,
	.form-group textarea:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
	}

	.form-group textarea {
		resize: vertical;
		min-height: 80px;
	}

	.modal-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		margin-top: 1.5rem;
	}

	.btn-cancel {
		padding: 0.75rem 1.25rem;
		background: #f3f4f6;
		color: #4b5563;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-cancel:hover {
		background: #e5e7eb;
	}

	.btn-save-confirm {
		padding: 0.75rem 1.5rem;
		background: linear-gradient(135deg, #10b981, #059669);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-save-confirm:hover:not(:disabled) {
		box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
	}

	.btn-save-confirm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* UTILS */
	.high {
		color: #059669;
	}
	.medium {
		color: #2563eb;
	}
	.low {
		color: #dc2626;
	}

	.fade-in-up {
		animation: fadeInUp 0.6s ease both;
	}

	.fade-in {
		animation: fadeIn 0.4s ease both;
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

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (max-width: 640px) {
		.results-title {
			font-size: 1.5rem;
		}
		.tab-btn {
			padding: 0.75rem 1rem;
			font-size: 0.875rem;
		}
		.cluster-grid {
			grid-template-columns: 1fr;
		}
		.filters-bar {
			flex-direction: column;
			align-items: stretch;
		}
		.search-box {
			max-width: none;
		}
	}
</style>
