<script lang="ts">
	import LatentSpaceVisualization from '$lib/components/match/LatentSpaceVisualization.svelte';
	import TopMatchSpotlight from '$lib/components/match/TopMatchSpotlight.svelte';
	import ClusterInsightCard from '$lib/components/match/ClusterInsightCard.svelte';
	import type { ClusterResult, BaseClusterResult, GlobalMemberScore } from '$lib/types/index.js';
	import { formatBillRef } from '$lib/types/index.js';
	import {
		ClipboardList,
		Save,
		Lock,
		RefreshCw,
		Hourglass,
		Plus,
		Search,
		X,
		ChevronLeft,
		User,
		Info,
		ThumbsUp,
		ThumbsDown,
		CircleQuestionMark,
		Handshake
	} from '@lucide/svelte';

	interface Props {
		clusterResults: BaseClusterResult[];
		globalScores: GlobalMemberScore[];
		onReset?: () => void;
		// Save functionality
		onSave?: (name: string) => Promise<void>;
		isSaving?: boolean;
		snapshotSaved?: boolean;
		// Continue answering functionality
		onContinue?: () => void;
		totalUnansweredBills?: number;
		isContinuing?: boolean;
		// Auth
		isLoggedIn?: boolean;
		onLoginToSave?: () => void;
		// Read-only mode (for snapshot display)
		readonly?: boolean;
	}

	let {
		clusterResults,
		globalScores,
		onReset,
		onSave,
		isSaving = false,
		snapshotSaved = false,
		onContinue,
		totalUnansweredBills = 0,
		isContinuing = false,
		isLoggedIn = false,
		onLoginToSave,
		readonly: isReadonly = false
	}: Props = $props();

	let activeTab = $state('overview'); // 'overview' | 'analysis' | 'all-candidates'
	let searchQuery = $state('');
	let sortField = $state('score'); // 'score' | 'name' | 'group'
	let sortDirection = $state('desc'); // 'asc' | 'desc'

	// Save modal state
	let showSaveModal = $state(false);
	let saveName = $state('');
	let saveError = $state<string | null>(null);

	// Derived state
	let topMembers = $derived(globalScores.slice(0, 3));

	/** Check if a BaseClusterResult is actually a full ClusterResult with viz data */
	function hasVizData(result: BaseClusterResult): result is ClusterResult {
		return 'memberVectorsForViz' in result && 'userVector' in result;
	}

	// Per-cluster dimension state for axis selectors
	let clusterDimensions = $state<Record<number, { x: number; y: number }>>({});

	// Initialize dimensions from cluster data
	$effect(() => {
		for (const result of clusterResults) {
			if (!(result.clusterLabel in clusterDimensions)) {
				if (hasVizData(result)) {
					clusterDimensions[result.clusterLabel] = {
						x: result.xDimension ?? 0,
						y: result.yDimension ?? 1
					};
				} else {
					clusterDimensions[result.clusterLabel] = { x: 0, y: 1 };
				}
			}
		}
	});

	// Member detail state
	interface MemberDetail {
		memberId: number;
		names: string[];
		nameReading: string | null;
		partyHistory: Array<{
			partyName: string;
			chamber: string | null;
			startDate: string | null;
			endDate: string | null;
		}>;
		groupHistory: Array<{
			groupName: string;
			chamber: string | null;
			startDate: string | null;
			endDate: string | null;
		}>;
		billScoreRecords: Array<{
			billId: number;
			billTitle: string | null;
			billType: string | null;
			submissionSession: number | null;
			billNumber: number | null;
			normalizedScore: number | null;
			hasVoteRecord: boolean;
			approved: boolean | null;
		}>;
	}

	let selectedMember = $state<{ memberId: number; name: string; group: string | null } | null>(
		null
	);
	let selectedMemberContext = $state<number | null>(null); // clusterLabel of context, or null for global
	let memberDetail = $state<MemberDetail | null>(null);
	let memberDetailLoading = $state(false);
	let showPartyDisclaimer = $state(false);
	let showGroupDisclaimer = $state(false);

	// Track which clusters have expanded bill lists in 回答記録 tab
	let expandedBillClusters = $state<Set<number>>(new Set());

	// Get global score for selected member
	let selectedMemberGlobalScore = $derived(
		selectedMember
			? (globalScores.find((m) => m.memberId === selectedMember!.memberId)?.globalScore ?? null)
			: null
	);

	// Get per-cluster scores for selected member
	let selectedMemberClusterScores = $derived(
		selectedMember
			? (globalScores.find((m) => m.memberId === selectedMember!.memberId)?.clusterScores ?? {})
			: {}
	);

	async function loadMemberDetail(memberId: number) {
		memberDetailLoading = true;
		memberDetail = null;
		try {
			// Always load ALL bill IDs across all clusters for category grouping
			let billIds: number[] = [];
			for (const cr of clusterResults) {
				if (cr.answeredBills) billIds.push(...cr.answeredBills.map((b) => b.billId));
			}
			let url = `/api/member-detail?memberId=${encodeURIComponent(String(memberId))}`;
			if (billIds.length > 0) url += `&billIds=${encodeURIComponent(billIds.join(','))}`;
			const res = await fetch(url);
			if (res.ok) {
				memberDetail = await res.json();
			}
		} catch (err) {
			console.error('Failed to load member detail:', err);
		} finally {
			memberDetailLoading = false;
		}
	}

	function handleMemberClick(
		m: { memberId: number; name: string; group: string | null },
		contextClusterLabel: number | null = null
	) {
		selectedMember = m;
		selectedMemberContext = contextClusterLabel;
		showPartyDisclaimer = false;
		showGroupDisclaimer = false;
		loadMemberDetail(m.memberId);
	}

	function closeMemberDetail() {
		selectedMember = null;
		selectedMemberContext = null;
		memberDetail = null;
	}

	// Get ALL answered bills across all clusters (for bill score comparison in drawer)
	let allAnsweredBills = $derived.by(() => {
		const bills: NonNullable<BaseClusterResult['answeredBills']> = [];
		for (const cr of clusterResults) {
			if (cr.answeredBills) bills.push(...cr.answeredBills);
		}
		return bills;
	});

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
		if (sim < 0) return 'negative';
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

	function getAnswerText(score: number, source?: 'direct' | 'delegated'): string {
		if (source === 'delegated') {
			if (score === 0) return '委任中';
			const label = score === 1 ? '賛成' : score === -1 ? '反対' : 'どちらでもない';
			return `委任(${label})`;
		}
		return score === 1 ? '賛成' : score === -1 ? '反対' : 'どちらでもない';
	}

	function getAnswerColor(score: number, source?: 'direct' | 'delegated'): string {
		if (source === 'delegated') return 'answer-delegated';
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
			await onSave(saveName.trim());
			showSaveModal = false;
			saveName = '';
		} catch (e) {
			saveError = e instanceof Error ? e.message : '保存に失敗しました';
		}
	}

	function openSaveModal() {
		// Set default name with date
		const now = new Date();
		saveName = `マッチング結果 ${now.toLocaleDateString('ja-JP')}`;
		saveError = null;
		showSaveModal = true;
	}
</script>

<div class="results-container">
	<!-- Simple Header -->
	<div class="results-header fade-in-up">
		{#if !isReadonly}
			<div class="header-top">
				<h2 class="results-title">マッチング結果</h2>
				<div class="header-actions">
					{#if totalUnansweredBills > 0 && onContinue}
						<button class="btn-continue" onclick={onContinue} disabled={isContinuing}>
							<span
								>{#if isContinuing}<Hourglass size={14} />{:else}<Plus size={14} />{/if}</span
							>
							{isContinuing ? '読み込み中...' : `追加回答 (${totalUnansweredBills}件)`}
						</button>
					{/if}
					{#if snapshotSaved}
						<a href="/match/saved" class="btn-view-saved">
							<span><ClipboardList size={14} /></span>
							保存済み結果を見る
						</a>
					{:else if onSave}
						<button class="btn-save" onclick={openSaveModal} disabled={isSaving}>
							<span><Save size={14} /></span>
							{isSaving ? '保存中...' : 'スナップショットを保存'}
						</button>
					{:else if !isLoggedIn}
						<button class="btn-login-to-save" onclick={onLoginToSave}>
							<span><Lock size={14} /></span>
							ログインして保存
						</button>
					{/if}
					{#if onReset}
						<button class="btn-reset" onclick={onReset}>
							<span><RefreshCw size={14} /></span>
							設定に戻る
						</button>
					{/if}
				</div>
			</div>
		{/if}

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
					<TopMatchSpotlight
						members={topMembers}
						{clusterResults}
						onMemberClick={(m) => handleMemberClick(m)}
					/>
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

							<div class="cluster-content-grid" class:no-viz={!hasVizData(result)}>
								<!-- Graph Column (only when viz data is available) -->
								{#if hasVizData(result)}
									<div class="viz-section">
										<h4 class="subsection-title">
											あなたの立ち位置 <span class="viz-click-hint">(議員をクリックで詳細)</span>
										</h4>
										<div class="viz-container-flush">
											{#if clusterDimensions[result.clusterLabel]}
												<LatentSpaceVisualization
													members={result.memberVectorsForViz}
													explainedVariance={result.explainedVariance}
													bind:xDimension={clusterDimensions[result.clusterLabel].x}
													bind:yDimension={clusterDimensions[result.clusterLabel].y}
													userVector={result.userVector}
													userVectorHistory={result.userVectorHistory}
													highlightedMembers={result.matches
														.slice(0, 5)
														.map((m) => ({ memberId: m.memberId, similarity: m.similarity }))}
													width={500}
													height={380}
													showDimensionSelectors={true}
													title=""
													showLegend={true}
													compact={false}
													collapsible={false}
													onMemberClick={(m) => handleMemberClick(m, result.clusterLabel)}
												/>
											{/if}
										</div>
									</div>
								{/if}

								<!-- Answers Column: Card Collection -->
								<div class="answers-section">
									<h4 class="subsection-title">回答した法案</h4>
									{#if result.answeredBills && result.answeredBills.length > 0}
										{@const maxVisible = 4}
										{@const isExpanded = expandedBillClusters.has(result.clusterLabel)}
										{@const visibleBills = isExpanded
											? result.answeredBills
											: result.answeredBills.slice(0, maxVisible)}
										<div class="bill-collection-grid">
											{#each visibleBills as bill (bill.billId)}
												<div class="bill-collect-card {getAnswerColor(bill.answer, bill.source)}">
													<div class="bill-card-accent"></div>
													<div class="bill-card-top-row">
														<span class="bill-card-icon">
															{#if bill.source === 'delegated'}
																<Handshake size={14} />
															{:else if bill.answer === 1}
																<ThumbsUp size={14} />
															{:else if bill.answer === -1}
																<ThumbsDown size={14} />
															{:else}
																<CircleQuestionMark size={14} />
															{/if}
														</span>
														<span
															class="bill-card-badge {getAnswerColor(bill.answer, bill.source)}"
														>
															{getAnswerText(bill.answer, bill.source)}
														</span>
														{#if formatBillRef(bill.billType, bill.submissionSession, bill.billNumber)}
															<span class="bill-card-ref">
																{formatBillRef(
																	bill.billType,
																	bill.submissionSession,
																	bill.billNumber
																)}
															</span>
														{/if}
													</div>
													<div class="bill-card-title">{bill.title}</div>
												</div>
											{/each}
										</div>
										{#if result.answeredBills.length > maxVisible}
											<button
												class="see-more-btn"
												onclick={() => {
													const next = new Set(expandedBillClusters);
													if (isExpanded) next.delete(result.clusterLabel);
													else next.add(result.clusterLabel);
													expandedBillClusters = next;
												}}
											>
												{isExpanded
													? '折りたたむ'
													: `他${result.answeredBills.length - maxVisible}件を表示`}
											</button>
										{/if}
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
									<!-- Cluster Columns -->
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
											handleMemberClick({
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
										<!-- Cluster Scores -->
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
		{/if}
	</div>

	<!-- Actions -->
	{#if !isReadonly}
		<div class="final-actions">
			{#if snapshotSaved}
				<a href="/match/saved" class="view-saved-button">
					<ClipboardList size={14} class="inline-icon" /> 保存済み結果を見る
				</a>
			{:else if onSave}
				<button onclick={openSaveModal} class="save-button" disabled={isSaving}>
					<Save size={14} class="inline-icon" />
					{isSaving ? '保存中...' : 'スナップショットを保存する'}
				</button>
			{:else if !isLoggedIn}
				<button onclick={onLoginToSave} class="save-button">
					<Lock size={14} class="inline-icon" /> ログインして保存
				</button>
			{/if}
			{#if onReset}
				<button onclick={onReset} class="restart-button">
					<RefreshCw size={14} class="inline-icon" /> 設定に戻る
				</button>
			{/if}
		</div>
	{/if}

	<!-- Member Detail Panel -->
	{#if selectedMember}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="member-detail-overlay" onclick={closeMemberDetail}></div>
		<div class="member-detail-drawer">
			<div class="drawer-header">
				<button class="drawer-back" onclick={closeMemberDetail}>
					<ChevronLeft size={16} />
				</button>
				<h3 class="drawer-title">{selectedMember.name}</h3>
				<button class="drawer-close" onclick={closeMemberDetail}>
					<X size={18} />
				</button>
			</div>

			<div class="drawer-body">
				<!-- Member Basic Info -->
				<div class="drawer-member-header">
					<div class="drawer-avatar">
						<User size={28} />
					</div>
					<div class="drawer-member-info">
						<span class="drawer-member-group">{selectedMember.group || '無所属'}</span>
						{#if selectedMemberGlobalScore !== null}
							<div class="drawer-match-info">
								<span class="drawer-match-label">総合マッチ度</span>
								<span class="drawer-match-value {getSimilarityColor(selectedMemberGlobalScore)}">
									{formatSimilarity(selectedMemberGlobalScore)}
								</span>
							</div>
						{/if}
					</div>
				</div>

				<!-- Per-cluster scores -->
				{#if Object.keys(selectedMemberClusterScores).length > 0}
					<div class="drawer-section">
						<h4 class="drawer-section-title">分野別マッチ度</h4>
						<div class="drawer-cluster-scores">
							{#each clusterResults as result (result.clusterLabel)}
								{@const score = selectedMemberClusterScores[result.clusterLabel] || 0}
								<div class="drawer-cluster-row">
									<span class="drawer-cluster-name">
										{result.clusterLabelName || `クラスター${result.clusterLabel}`}
									</span>
									<div class="drawer-score-bar-bg">
										<div
											class="drawer-score-bar-fill {getSimilarityColor(score)}-bg"
											style="width: {Math.abs(score) * 100}%"
										></div>
									</div>
									<span class="drawer-cluster-score {getSimilarityColor(score)}">
										{formatSimilarity(score)}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if memberDetailLoading}
					<div class="drawer-loading">
						<Hourglass size={18} /> 読み込み中...
					</div>
				{:else if memberDetail}
					<!-- Name variants -->
					{#if memberDetail.names.length > 1}
						<div class="drawer-section">
							<h4 class="drawer-section-title">名前の表記</h4>
							<div class="drawer-tags">
								{#each memberDetail.names as name, i (i)}
									<span class="drawer-tag">{name}</span>
								{/each}
							</div>
							{#if memberDetail.nameReading}
								<span class="drawer-reading">{memberDetail.nameReading}</span>
							{/if}
						</div>
					{/if}

					<!-- Party History -->
					{#if memberDetail.partyHistory.length > 0}
						<div class="drawer-section">
							<h4 class="drawer-section-title">
								政党歴
								<button
									class="drawer-disclaimer-btn"
									onclick={() => (showPartyDisclaimer = !showPartyDisclaimer)}
								>
									<Info size={13} />
								</button>
							</h4>
							{#if showPartyDisclaimer}
								<div class="drawer-disclaimer">
									政党所属期間は国会議員白書の各期データに基づいています。所属開始・終了日は議員の任期に対応しており、任期中の政党変更は反映されない場合があります。
								</div>
							{/if}
							<div class="drawer-timeline">
								{#each memberDetail.partyHistory as entry, i (i)}
									<div class="drawer-timeline-entry">
										<div class="drawer-timeline-dot"></div>
										<div class="drawer-timeline-content">
											<span class="drawer-timeline-label">{entry.partyName}</span>
											<span class="drawer-timeline-meta">
												{entry.chamber || ''}
												{#if entry.startDate}
													{entry.startDate}{entry.endDate ? ` ~ ${entry.endDate}` : ' ~ 現在'}
												{/if}
											</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Group History -->
					{#if memberDetail.groupHistory.length > 0}
						<div class="drawer-section">
							<h4 class="drawer-section-title">
								会派歴
								<button
									class="drawer-disclaimer-btn"
									onclick={() => (showGroupDisclaimer = !showGroupDisclaimer)}
								>
									<Info size={13} />
								</button>
							</h4>
							{#if showGroupDisclaimer}
								<div class="drawer-disclaimer">
									会派所属は国会議事録API（国立国会図書館）の発言記録から推定しています。所属開始・終了日は各会派での初回・最終発言日に基づくため、発言のない期間のデータは含まれません。
								</div>
							{/if}
							<div class="drawer-timeline">
								{#each memberDetail.groupHistory as entry, i (i)}
									<div class="drawer-timeline-entry">
										<div class="drawer-timeline-dot drawer-group-dot"></div>
										<div class="drawer-timeline-content">
											<span class="drawer-timeline-label">{entry.groupName}</span>
											<span class="drawer-timeline-meta">
												{entry.chamber || ''}
												{#if entry.startDate}
													{entry.startDate}{entry.endDate ? ` ~ ${entry.endDate}` : ' ~ 現在'}
												{/if}
											</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Bill Score Records (grouped by category) -->
					{#if memberDetail.billScoreRecords.length > 0}
						<div class="drawer-section">
							<h4 class="drawer-section-title">回答済み法案へのスコア</h4>
							{#each clusterResults as cluster (cluster.clusterLabel)}
								{@const clusterBillIds = new Set(cluster.answeredBills?.map((b) => b.billId) ?? [])}
								{@const clusterRecords = memberDetail.billScoreRecords.filter((r) =>
									clusterBillIds.has(r.billId)
								)}
								{#if clusterRecords.length > 0}
									<div class="drawer-bill-category">
										<h5 class="drawer-bill-category-title">
											{cluster.clusterLabelName || `クラスター${cluster.clusterLabel}`}
										</h5>
										<div class="drawer-bill-list">
											{#each clusterRecords as record (record.billId)}
												{@const userBill = allAnsweredBills.find((b) => b.billId === record.billId)}
												{@const userAnswer = userBill?.answer}
												{@const userSource = userBill?.source}
												{@const score = record.normalizedScore}
												{@const memberHasData = score !== null || record.approved !== null}
												{@const isPositive = score !== null ? score >= 0 : record.approved}
												{@const agrees =
													memberHasData && userAnswer !== undefined && userAnswer !== 0
														? score !== null
															? (userAnswer === 1 && score > 0) || (userAnswer === -1 && score < 0)
															: record.approved !== null &&
																((userAnswer === 1 && record.approved) ||
																	(userAnswer === -1 && !record.approved))
														: null}
												<div
													class="drawer-bill-item"
													class:vote-match={agrees === true}
													class:vote-mismatch={agrees === false}
												>
													<div
														class="drawer-bill-stance"
														class:approved={isPositive}
														class:no-data={!memberHasData}
													>
														{#if score !== null}
															<span class="drawer-bill-score"
																>{score >= 0 ? '+' : ''}{score.toFixed(2)}</span
															>
														{:else if record.approved !== null}
															<span class="drawer-bill-score">{record.approved ? '+1' : '-1'}</span>
															{record.approved ? '賛成' : '反対'}
														{:else}
															<span class="drawer-bill-score">N/A</span>
														{/if}
													</div>
													<div class="drawer-bill-info">
														<span class="drawer-bill-title">
															{record.billTitle || userBill?.title || `法案 #${record.billId}`}
														</span>
														{#if formatBillRef(record.billType, record.submissionSession, record.billNumber)}
															<span class="drawer-bill-ref"
																>{formatBillRef(
																	record.billType,
																	record.submissionSession,
																	record.billNumber
																)}</span
															>
														{/if}
														{#if userAnswer !== undefined && userAnswer !== 0}
															<span class="drawer-bill-comparison">
																あなた: {userSource === 'delegated' ? '委任 ' : ''}{userAnswer === 1
																	? '賛成'
																	: '反対'}
																→ {#if !memberHasData}<span class="comparison-nodata"
																		>データなし</span
																	>{:else if agrees}✓ 一致{:else}✗ 不一致{/if}
															</span>
														{:else if userAnswer === 0 && userSource === 'delegated'}
															<span class="drawer-bill-comparison comparison-skip">
																あなた: 委任中
															</span>
														{:else if userAnswer === 0}
															<span class="drawer-bill-comparison comparison-skip">
																あなた: スキップ
															</span>
														{/if}
													</div>
												</div>
											{/each}
										</div>
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{/if}

	<!-- Save Modal -->
	{#if showSaveModal}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-overlay" onclick={() => (showSaveModal = false)}>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div class="modal-container" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
				<button class="modal-close-btn" onclick={() => (showSaveModal = false)}>×</button>

				<h2 class="modal-title">� スナップショットを保存</h2>
				<p class="modal-desc">現在のマッチング結果をスナップショットとして保存します。</p>

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

	.btn-login-to-save {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.btn-login-to-save:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
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

	.cluster-content-grid.no-viz {
		grid-template-columns: 1fr;
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

	.viz-click-hint {
		font-size: 0.7rem;
		font-weight: 400;
		color: #9ca3af;
	}

	/* Bill Collection Cards (matching QuestioningPhase design) */
	.bill-collection-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.75rem;
	}

	.bill-collect-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 0.75rem 0.75rem 1rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		font-size: 0.8125rem;
		transition: all 0.15s ease;
		overflow: hidden;
	}

	.bill-collect-card:hover {
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
	}

	.bill-card-accent {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		border-radius: 4px 0 0 4px;
	}

	.bill-collect-card.answer-agree .bill-card-accent {
		background: #22c55e;
	}

	.bill-collect-card.answer-disagree .bill-card-accent {
		background: #ef4444;
	}

	.bill-collect-card.answer-neutral .bill-card-accent {
		background: #9ca3af;
	}

	.bill-collect-card.answer-delegated .bill-card-accent {
		background: #8b5cf6;
	}

	.bill-card-top-row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.bill-card-icon {
		display: flex;
		align-items: center;
		color: #6b7280;
	}

	.bill-collect-card.answer-agree .bill-card-icon {
		color: #22c55e;
	}

	.bill-collect-card.answer-disagree .bill-card-icon {
		color: #ef4444;
	}

	.bill-collect-card.answer-delegated .bill-card-icon {
		color: #8b5cf6;
	}

	.bill-card-title {
		font-weight: 500;
		color: #1f2937;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		flex: 1;
	}

	.bill-card-ref {
		font-size: 0.6rem;
		color: #9ca3af;
		font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
		margin-left: auto;
		white-space: nowrap;
	}

	.bill-card-badge {
		font-weight: 700;
		font-size: 0.6875rem;
		padding: 0.125rem 0.5rem;
		border-radius: 4px;
		background: white;
		border: 1px solid currentColor;
	}

	.bill-card-badge.answer-agree {
		color: #059669;
	}

	.bill-card-badge.answer-disagree {
		color: #dc2626;
	}

	.bill-card-badge.answer-neutral {
		color: #6b7280;
	}

	.bill-card-badge.answer-delegated {
		color: #8b5cf6;
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
		.bill-collection-grid {
			grid-template-columns: 1fr 1fr;
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

	.form-group input {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 1rem;
		font-family: inherit;
	}

	.form-group input:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
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

	/* CLICKABLE TABLE ROWS */
	.member-row-clickable {
		cursor: pointer;
		transition: background 0.15s;
	}

	.member-row-clickable:hover {
		background: #eef2ff !important;
	}

	.member-row-clickable:hover .sticky-col {
		background: #eef2ff !important;
	}

	/* MEMBER DETAIL DRAWER */
	.member-detail-overlay {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.3);
		backdrop-filter: blur(2px);
		z-index: 900;
	}

	.member-detail-drawer {
		position: fixed;
		top: 0;
		right: 0;
		width: 420px;
		max-width: 90vw;
		height: 100%;
		background: white;
		z-index: 910;
		display: flex;
		flex-direction: column;
		box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
		animation: slideInRight 0.25s ease both;
	}

	@keyframes slideInRight {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}

	.drawer-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid #e5e7eb;
		background: #f9fafb;
		flex-shrink: 0;
	}

	.drawer-back,
	.drawer-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		background: #f3f4f6;
		border: none;
		cursor: pointer;
		color: #4b5563;
		transition: all 0.15s;
	}

	.drawer-back:hover,
	.drawer-close:hover {
		background: #e5e7eb;
		color: #1f2937;
	}

	.drawer-title {
		flex: 1;
		font-size: 1.125rem;
		font-weight: 700;
		color: #1f2937;
		margin: 0;
	}

	.drawer-body {
		flex: 1;
		overflow-y: auto;
		padding: 1.25rem;
	}

	.drawer-member-header {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid #f3f4f6;
	}

	.drawer-avatar {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: #f3f4f6;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #9ca3af;
		flex-shrink: 0;
	}

	.drawer-member-info {
		flex: 1;
	}

	.drawer-member-group {
		display: block;
		font-size: 0.875rem;
		color: #6b7280;
		margin-bottom: 0.5rem;
	}

	.drawer-match-info {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.drawer-match-label {
		font-size: 0.75rem;
		color: #9ca3af;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.drawer-match-value {
		font-size: 1.25rem;
		font-weight: 800;
	}

	.drawer-section {
		margin-bottom: 1.25rem;
	}

	.drawer-section-title {
		font-size: 0.8125rem;
		font-weight: 600;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	/* Cluster scores in drawer */
	.drawer-cluster-scores {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.drawer-cluster-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.8125rem;
	}

	.drawer-cluster-name {
		min-width: 100px;
		color: #374151;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.drawer-score-bar-bg {
		flex: 1;
		height: 6px;
		background: #f3f4f6;
		border-radius: 3px;
		overflow: hidden;
	}

	.drawer-score-bar-fill {
		height: 100%;
		border-radius: 3px;
		transition: width 0.5s ease;
	}

	.drawer-score-bar-fill.high-bg {
		background: #10b981;
	}

	.drawer-score-bar-fill.medium-bg {
		background: #3b82f6;
	}

	.drawer-score-bar-fill.low-bg {
		background: #ef4444;
	}

	.drawer-cluster-score {
		min-width: 50px;
		text-align: right;
		font-weight: 700;
		font-feature-settings: 'tnum';
	}

	.drawer-loading {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 2rem 0;
		justify-content: center;
		color: #6b7280;
		font-size: 0.875rem;
	}

	.drawer-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.drawer-tag {
		display: inline-block;
		padding: 0.25rem 0.625rem;
		background: #f3f4f6;
		border-radius: 6px;
		font-size: 0.8125rem;
		color: #374151;
	}

	.drawer-reading {
		display: block;
		font-size: 0.8125rem;
		color: #9ca3af;
		margin-top: 0.375rem;
	}

	.drawer-disclaimer-btn {
		background: none;
		border: none;
		cursor: pointer;
		color: #9ca3af;
		padding: 0;
		display: inline-flex;
	}

	.drawer-disclaimer-btn:hover {
		color: #6b7280;
	}

	.drawer-disclaimer {
		font-size: 0.75rem;
		color: #9ca3af;
		background: #f9fafb;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		margin-bottom: 0.5rem;
		line-height: 1.5;
	}

	.drawer-timeline {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding-left: 0.5rem;
	}

	.drawer-timeline-entry {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.drawer-timeline-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #6366f1;
		margin-top: 0.375rem;
		flex-shrink: 0;
	}

	.drawer-timeline-dot.drawer-group-dot {
		background: #10b981;
	}

	.drawer-timeline-content {
		display: flex;
		flex-direction: column;
	}

	.drawer-timeline-label {
		font-size: 0.8125rem;
		font-weight: 600;
		color: #1f2937;
	}

	.drawer-timeline-meta {
		font-size: 0.75rem;
		color: #9ca3af;
	}

	/* Bill score records in drawer */
	.drawer-bill-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.drawer-bill-item {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		border-radius: 8px;
		background: #f9fafb;
		border: 1px solid #f3f4f6;
		font-size: 0.8125rem;
	}

	.drawer-bill-item.vote-match {
		background: #f0fdf4;
		border-color: #bbf7d0;
	}

	.drawer-bill-item.vote-mismatch {
		background: #fef2f2;
		border-color: #fecaca;
	}

	.drawer-bill-stance {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		min-width: 40px;
		padding: 0.25rem;
		border-radius: 4px;
		font-size: 0.6875rem;
		text-align: center;
		color: #059669;
	}

	.drawer-bill-stance.approved {
		color: #059669;
	}

	.drawer-bill-stance:not(.approved):not(.no-data) {
		color: #dc2626;
	}

	.drawer-bill-stance.no-data {
		color: #9ca3af;
	}

	.drawer-bill-score {
		font-weight: 700;
		font-size: 0.8125rem;
	}

	.drawer-bill-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.drawer-bill-title {
		font-weight: 500;
		color: #1f2937;
		line-height: 1.4;
	}

	.drawer-bill-ref {
		display: block;
		font-size: 0.65rem;
		color: #9ca3af;
		font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
		margin-top: 0.0625rem;
	}

	.drawer-bill-comparison {
		font-size: 0.75rem;
		color: #6b7280;
	}

	.drawer-bill-comparison .comparison-nodata {
		color: #9ca3af;
		font-style: italic;
	}

	.drawer-bill-comparison.comparison-skip {
		color: #9ca3af;
		font-style: italic;
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
	.negative {
		color: #991b1b;
	}

	/* Viz flush container (no card border) */
	.viz-container-flush {
		width: 100%;
		overflow: hidden;
	}

	/* See more button for bill collections */
	.see-more-btn {
		display: block;
		width: 100%;
		padding: 0.5rem;
		margin-top: 0.5rem;
		background: #f9fafb;
		border: 1px dashed #d1d5db;
		border-radius: 8px;
		color: #6b7280;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.see-more-btn:hover {
		background: #f3f4f6;
		color: #374151;
		border-color: #9ca3af;
	}

	/* Bill category headers in drawer */
	.drawer-bill-category {
		margin-bottom: 1rem;
	}

	.drawer-bill-category-title {
		font-size: 0.75rem;
		font-weight: 700;
		color: #4f46e5;
		margin: 0 0 0.5rem 0;
		padding: 0.25rem 0.5rem;
		background: #eef2ff;
		border-radius: 4px;
		display: inline-block;
	}

	/* Negative score bar */
	.drawer-score-bar-fill.negative-bg {
		background: #991b1b;
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
