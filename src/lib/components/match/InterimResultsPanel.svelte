<script lang="ts">
	import { fetchMemberDetail } from '$lib/utils/member-detail-loader.js';
	import type { MemberDetail } from '$lib/types/index.js';
	import LatentSpaceVisualization from '$lib/components/match/LatentSpaceVisualization.svelte';
	import { formatBillRef } from '$lib/types/index.js';
	import type { MemberMatch, MemberVectorForViz, PartyScores } from '$lib/types/index.js';
	import {
		Search,
		X,
		ChevronLeft,
		ChevronRight,
		User,
		Info,
		Maximize2,
		Minimize2,
		Star,
		Hourglass
	} from '@lucide/svelte';

	interface AnsweredBill {
		billId: number;
		title: string;
		answer: number;
		source?: 'direct' | 'delegated';
		delegationStatus?: 'pending' | 'voted';
		delegateId?: string;
		billType?: string;
		submissionSession?: number;
		billNumber?: number;
	}

	interface Props {
		currentClusterDisplayName: string | null;
		answeredCount: number;
		confidence: number;
		isLoading: boolean;
		isLastClusterInSession: boolean;
		nextClusterDisplayName: string | null;
		topMatches: MemberMatch[];
		memberVectorsForViz: MemberVectorForViz[];
		explainedVariance: number[];
		xDimension: number;
		yDimension: number;
		userVector: number[];
		userVectorHistory: number[][];
		highlightedMembersForViz: Array<{ memberId: number; similarity: number }>;
		currentClusterAnsweredBills: AnsweredBill[];
		pendingImportance: number;
		interimPartyScores: PartyScores | null;
		onAdvanceCluster: () => void;
	}

	let {
		currentClusterDisplayName = null,
		answeredCount,
		confidence = 0,
		isLoading,
		isLastClusterInSession = false,
		nextClusterDisplayName = null,
		topMatches,
		memberVectorsForViz,
		explainedVariance,
		xDimension = $bindable(),
		yDimension = $bindable(),
		userVector,
		userVectorHistory,
		highlightedMembersForViz,
		currentClusterAnsweredBills = [],
		pendingImportance = $bindable(),
		interimPartyScores = null,
		onAdvanceCluster
	}: Props = $props();

	function getImportanceLabel(importance: number): string {
		const labels = ['', 'あまり重要ではない', '少し重要', '普通に重要', 'かなり重要', '最も重要'];
		return labels[importance] || '';
	}

	// Interim results panel state: 'closed' | 'narrow' | 'full'
	let panelMode = $state<'closed' | 'narrow' | 'full'>('closed');
	let showInterimPanel = $derived(panelMode !== 'closed');

	function togglePanel() {
		if (panelMode === 'closed') panelMode = 'narrow';
		else if (panelMode === 'narrow') panelMode = 'full';
		else panelMode = 'closed';
	}

	function closePanel() {
		panelMode = 'closed';
	}

	// Party search/mode state
	let partySearchQuery = $state('');
	let partyMode = $state<'current' | 'historical'>('current');

	let activePartyScores = $derived.by(() => {
		if (!interimPartyScores) return [];
		const list =
			partyMode === 'current' ? interimPartyScores.current : interimPartyScores.historical;
		return (list ?? []).map((p, i) => ({ ...p, rank: i + 1 }));
	});

	let filteredPartyScores = $derived.by(() => {
		if (!partySearchQuery.trim()) return activePartyScores;
		const q = partySearchQuery.toLowerCase();
		return activePartyScores.filter((p) => p.partyName.toLowerCase().includes(q));
	});

	// Member search in interim panel
	let memberSearchQuery = $state('');

	// Build full ranked member list from viz vectors + user vector (cosine similarity)
	let allMembersRanked = $derived.by(() => {
		if (memberVectorsForViz.length === 0 || userVector.length === 0) return topMatches;
		const scored = memberVectorsForViz.map((m) => {
			const v = m.latentVector;
			let dot = 0,
				normA = 0,
				normB = 0;
			for (let i = 0; i < userVector.length && i < v.length; i++) {
				dot += userVector[i] * v[i];
				normA += userVector[i] * userVector[i];
				normB += v[i] * v[i];
			}
			const denom = Math.sqrt(normA) * Math.sqrt(normB);
			const similarity = denom === 0 ? 0 : dot / denom;
			return {
				memberId: m.memberId,
				name: m.name,
				group: m.group,
				similarity,
				rank: 0
			};
		});
		scored.sort((a, b) => b.similarity - a.similarity);
		scored.forEach((m, i) => (m.rank = i + 1));
		return scored;
	});

	let filteredTopMatches = $derived.by(() => {
		if (!memberSearchQuery.trim()) return allMembersRanked;
		const q = memberSearchQuery.toLowerCase();
		return allMembersRanked.filter(
			(m) => m.name.toLowerCase().includes(q) || (m.group && m.group.toLowerCase().includes(q))
		);
	});

	// Member detail state
	let selectedMember = $state<{ memberId: number; name: string; group: string | null } | null>(
		null
	);
	let memberDetail = $state<MemberDetail | null>(null);
	let memberDetailLoading = $state(false);

	// Disclaimer tooltip state
	let showPartyDisclaimer = $state(false);
	let showGroupDisclaimer = $state(false);

	// Get similarity for selected member
	let selectedMemberSimilarity = $derived(
		selectedMember
			? (topMatches.find((m) => m.memberId === selectedMember!.memberId)?.similarity ?? null)
			: null
	);

	async function loadMemberDetail(memberId: number) {
		memberDetailLoading = true;
		memberDetail = null;
		try {
			const billIds = currentClusterAnsweredBills.map((b) => b.billId);
			memberDetail = await fetchMemberDetail(memberId, billIds);
		} catch (err) {
			console.error('Failed to load member detail:', err);
		} finally {
			memberDetailLoading = false;
		}
	}

	function handleMemberClick(m: { memberId: number; name: string; group: string | null }) {
		selectedMember = m;
		loadMemberDetail(m.memberId);
	}

	function closeMemberDetail() {
		selectedMember = null;
		memberDetail = null;
	}
</script>

<!-- Right Side Navigation Arrow -->
<div
	class="cluster-nav cluster-nav-right"
	class:panel-open={showInterimPanel}
	class:panel-full={panelMode === 'full'}
>
	{#if answeredCount >= 2}
		<button
			class="cluster-nav-circle"
			class:confidence-high={confidence >= 70}
			class:confidence-mid={confidence >= 40 && confidence < 70}
			class:confidence-low={confidence > 0 && confidence < 40}
			class:active={showInterimPanel}
			onclick={togglePanel}
			disabled={isLoading && !showInterimPanel}
			title={isLastClusterInSession
				? '重要度を確認する'
				: nextClusterDisplayName
					? `${nextClusterDisplayName}に進む`
					: '次へ'}
		>
			<ChevronRight size={24} />
		</button>
		<span class="cluster-nav-label">
			{#if isLastClusterInSession}
				重要度確認へ
			{:else if nextClusterDisplayName}
				{nextClusterDisplayName}
			{:else}
				次へ
			{/if}
		</span>
	{:else}
		<button class="cluster-nav-circle" disabled title="質問に回答すると次の分野へ進めます">
			<ChevronRight size={24} />
		</button>
		<span class="cluster-nav-label cluster-nav-hint">
			質問に回答して<br />次の分野へ
		</span>
	{/if}
</div>

<!-- Interim Results Right Panel -->
{#if showInterimPanel}
	<div class="interim-overlay" onclick={closePanel} role="presentation"></div>
	<div class="interim-panel" class:panel-full={panelMode === 'full'}>
		<div class="interim-panel-header">
			<h3 class="interim-panel-title">{currentClusterDisplayName || '分野'}</h3>
			<div class="interim-panel-header-actions">
				<button
					class="interim-panel-expand"
					onclick={() => (panelMode = panelMode === 'full' ? 'narrow' : 'full')}
					title={panelMode === 'full' ? '縮小' : '全画面'}
				>
					{#if panelMode === 'full'}
						<Minimize2 size={16} />
					{:else}
						<Maximize2 size={16} />
					{/if}
				</button>
				<button class="interim-panel-close" onclick={closePanel}>
					<X size={18} />
				</button>
			</div>
		</div>

		<div class="interim-panel-body">
			<!-- Importance & Advance Card -->
			<div class="panel-action-card">
				<div class="action-card-cluster-name">
					{currentClusterDisplayName || 'この分野'}
				</div>
				<div class="action-card-importance-row">
					<span class="action-card-importance-label">重要度</span>
					<div class="action-card-stars">
						{#each [1, 2, 3, 4, 5] as star (star)}
							<button
								onclick={() => (pendingImportance = star)}
								class="action-star-btn"
								class:selected={star <= pendingImportance}
							>
								<Star
									size={22}
									fill={star <= pendingImportance ? '#fbbf24' : 'none'}
									color={star <= pendingImportance ? '#f59e0b' : '#d1d5db'}
									strokeWidth={star <= pendingImportance ? 2.5 : 1.5}
								/>
							</button>
						{/each}
						<span class="action-card-importance-text">{getImportanceLabel(pendingImportance)}</span>
					</div>
				</div>
				<button
					class="action-card-advance-btn"
					onclick={() => {
						closePanel();
						onAdvanceCluster();
					}}
					disabled={isLoading}
				>
					{#if isLoading}
						<Hourglass size={16} /> 読み込み中...
					{:else if isLastClusterInSession}
						重要度を確認する <ChevronRight size={18} />
					{:else if nextClusterDisplayName}
						「{nextClusterDisplayName}」分野へ <ChevronRight size={18} />
					{:else}
						次の分野へ <ChevronRight size={18} />
					{/if}
				</button>
			</div>

			<!-- Section Divider -->
			<div class="interim-section-divider">
				<div class="interim-section-divider-line"></div>
				<span class="interim-section-divider-label">暫定マッチング結果</span>
				<div class="interim-section-divider-line"></div>
			</div>

			<!-- Results Grid (adapts to full-screen) -->
			<div class="interim-results-grid">
				<!-- Top 3 Spotlight -->
				<div class="interim-results-card">
					<h4 class="interim-card-title"><User size={15} /> 上位マッチ議員</h4>
					<div class="interim-spotlight">
						{#each topMatches.slice(0, 3) as match, idx (match.memberId)}
							<button
								class="spotlight-member"
								class:rank-gold={idx === 0}
								class:rank-silver={idx === 1}
								class:rank-bronze={idx === 2}
								class:active={selectedMember?.memberId === match.memberId}
								onclick={() => handleMemberClick(match)}
							>
								<div class="spotlight-rank">{idx + 1}</div>
								<div class="spotlight-info">
									<span class="spotlight-name">{match.name}</span>
									<span class="spotlight-group">{match.group || '無所属'}</span>
								</div>
								<div class="spotlight-score" class:score-negative={match.similarity < 0}>
									{(match.similarity * 100).toFixed(1)}%
								</div>
							</button>
						{/each}
					</div>
				</div>

				<!-- Party Ranking -->
				{#if activePartyScores.length > 0}
					<div class="interim-results-card">
						<h4 class="interim-card-title">政党マッチ</h4>

						<div class="interim-party-mode-toggle">
							<button
								class="interim-party-mode-btn"
								class:active={partyMode === 'current'}
								onclick={() => (partyMode = 'current')}
							>
								現在の所属議員
							</button>
							<button
								class="interim-party-mode-btn"
								class:active={partyMode === 'historical'}
								onclick={() => (partyMode = 'historical')}
							>
								在籍期間の行動
							</button>
						</div>

						<div class="interim-search-box">
							<Search size={14} class="interim-search-icon" />
							<input
								type="text"
								bind:value={partySearchQuery}
								placeholder="政党名で検索..."
								class="interim-search-input"
							/>
							{#if partySearchQuery}
								<button class="interim-search-clear" onclick={() => (partySearchQuery = '')}>
									<X size={14} />
								</button>
							{/if}
						</div>

						<div class="interim-member-table">
							<div class="member-table-header">
								<span class="table-col-rank">#</span>
								<span class="table-col-name">政党名</span>
								<span class="table-col-group">人数</span>
								<span class="table-col-score">マッチ度</span>
							</div>
							<div class="member-table-body">
								{#each filteredPartyScores as partyItem (partyItem.partyId)}
									<div
										class="member-table-row party-table-row"
										class:rank-gold={partyItem.rank === 1}
										class:rank-silver={partyItem.rank === 2}
										class:rank-bronze={partyItem.rank === 3}
									>
										<span class="table-col-rank">{partyItem.rank}</span>
										<span class="table-col-name">{partyItem.partyName}</span>
										<span class="table-col-group">{partyItem.memberCount}名</span>
										<span
											class="table-col-score score-{partyItem.globalScore < 0
												? 'neg'
												: partyItem.globalScore >= 0.7
													? 'high'
													: partyItem.globalScore >= 0.5
														? 'med'
														: 'low'}"
										>
											{(partyItem.globalScore * 100).toFixed(1)}%
										</span>
									</div>
								{/each}
								{#if filteredPartyScores.length === 0}
									<div class="member-table-empty">該当する政党がありません</div>
								{/if}
							</div>
						</div>
					</div>
				{/if}

				<!-- Full Member Search -->
				<div class="interim-results-card interim-results-card-wide">
					<h4 class="interim-card-title"><Search size={15} /> 全議員検索</h4>
					<div class="interim-search-box">
						<Search size={14} class="interim-search-icon" />
						<input
							type="text"
							bind:value={memberSearchQuery}
							placeholder="名前・会派で検索..."
							class="interim-search-input"
						/>
						{#if memberSearchQuery}
							<button class="interim-search-clear" onclick={() => (memberSearchQuery = '')}>
								<X size={14} />
							</button>
						{/if}
					</div>
					<div class="interim-member-table">
						<div class="member-table-header">
							<span class="table-col-rank">#</span>
							<span class="table-col-name">氏名</span>
							<span class="table-col-group">会派</span>
							<span class="table-col-score">マッチ度</span>
						</div>
						<div class="member-table-body">
							{#each filteredTopMatches as match (match.memberId)}
								<button
									class="member-table-row"
									class:active={selectedMember?.memberId === match.memberId}
									onclick={() => handleMemberClick(match)}
								>
									<span class="table-col-rank">{match.rank}</span>
									<span class="table-col-name">{match.name}</span>
									<span class="table-col-group">{match.group || '無所属'}</span>
									<span
										class="table-col-score score-{match.similarity < 0
											? 'neg'
											: match.similarity >= 0.7
												? 'high'
												: match.similarity >= 0.5
													? 'med'
													: 'low'}">{(match.similarity * 100).toFixed(1)}%</span
									>
								</button>
							{/each}
							{#if filteredTopMatches.length === 0}
								<div class="member-table-empty">該当する議員がいません</div>
							{/if}
						</div>
					</div>
				</div>
			</div>

			<!-- Visualization + Detail Side by Side -->
			<div class="interim-viz-row">
				<div class="interim-viz" class:has-detail={selectedMember}>
					<h4 class="interim-viz-title">
						あなたの立ち位置 <span class="viz-click-hint">(議員をクリックで詳細)</span>
					</h4>
					<LatentSpaceVisualization
						members={memberVectorsForViz}
						{explainedVariance}
						bind:xDimension
						bind:yDimension
						{userVector}
						{userVectorHistory}
						highlightedMembers={highlightedMembersForViz}
						width={520}
						height={380}
						showDimensionSelectors={userVector.length > 2}
						title=""
						showLegend={true}
						compact={true}
						collapsible={false}
						onMemberClick={handleMemberClick}
					/>
				</div>

				{#if selectedMember}
					<div class="interim-detail-panel">
						<div class="interim-detail-panel-header">
							<button class="interim-detail-back" onclick={closeMemberDetail}>
								<ChevronLeft size={14} />
							</button>
							<h4 class="interim-detail-panel-name">{selectedMember.name}</h4>
							<button class="interim-detail-panel-close" onclick={closeMemberDetail}>
								<X size={14} />
							</button>
						</div>

						<div class="interim-detail-panel-body">
							<div class="member-detail-header">
								<div class="member-detail-avatar">
									<User size={24} />
								</div>
								<div class="member-detail-basic">
									<span class="member-detail-group">{selectedMember.group || '無所属'}</span>
									{#if selectedMemberSimilarity !== null}
										<div class="member-detail-match">
											<span class="match-label">マッチ度</span>
											<span class="match-value">{(selectedMemberSimilarity * 100).toFixed(1)}%</span
											>
										</div>
									{/if}
								</div>
							</div>

							{#if memberDetailLoading}
								<div class="member-detail-loading">
									<Hourglass size={18} class="inline-icon" /> 読み込み中...
								</div>
							{:else if memberDetail}
								<!-- Name variants -->
								{#if memberDetail.names.length > 1}
									<div class="detail-section">
										<h4 class="detail-section-title">名前の表記</h4>
										<div class="detail-tags">
											{#each memberDetail.names as name, i (i)}
												<span class="detail-tag">{name}</span>
											{/each}
										</div>
										{#if memberDetail.nameReading}
											<span class="detail-reading">{memberDetail.nameReading}</span>
										{/if}
									</div>
								{/if}

								<!-- Party History -->
								{#if memberDetail.partyHistory.length > 0}
									<div class="detail-section">
										<h4 class="detail-section-title">
											政党歴
											<button
												class="disclaimer-btn"
												onclick={() => (showPartyDisclaimer = !showPartyDisclaimer)}
												title="データについて"
											>
												<Info size={13} />
											</button>
										</h4>
										{#if showPartyDisclaimer}
											<div class="disclaimer-box">
												政党所属期間は国会議員白書の各期データに基づいています。所属開始・終了日は議員の任期に対応しており、任期中の政党変更は反映されない場合があります。
											</div>
										{/if}
										<div class="history-timeline">
											{#each memberDetail.partyHistory as entry, i (i)}
												<div class="timeline-entry">
													<div class="timeline-dot"></div>
													<div class="timeline-content">
														<span class="timeline-label">{entry.partyName}</span>
														<span class="timeline-meta">
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
									<div class="detail-section">
										<h4 class="detail-section-title">
											会派歴
											<button
												class="disclaimer-btn"
												onclick={() => (showGroupDisclaimer = !showGroupDisclaimer)}
												title="データについて"
											>
												<Info size={13} />
											</button>
										</h4>
										{#if showGroupDisclaimer}
											<div class="disclaimer-box">
												会派所属は国会議事録API（国立国会図書館）の発言記録から推定しています。所属開始・終了日は各会派での初回・最終発言日に基づくため、発言のない期間のデータは含まれません。
											</div>
										{/if}
										<div class="history-timeline">
											{#each memberDetail.groupHistory as entry, i (i)}
												<div class="timeline-entry">
													<div class="timeline-dot group-dot"></div>
													<div class="timeline-content">
														<span class="timeline-label">{entry.groupName}</span>
														<span class="timeline-meta">
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

								<!-- Bill Score Records -->
								{#if memberDetail.billScoreRecords.length > 0}
									<div class="detail-section">
										<h4 class="detail-section-title">回答済み法案へのスコア</h4>
										<div class="bill-vote-list">
											{#each memberDetail.billScoreRecords as record (record.billId)}
												{@const userBill = currentClusterAnsweredBills.find(
													(b) => b.billId === record.billId
												)}
												{@const userAnswer = userBill?.answer}
												{@const score = record.normalizedScore}
												{@const isPositive = score !== null ? score >= 0 : record.approved}
												{@const agrees =
													score !== null && userAnswer !== undefined && userAnswer !== 0
														? (userAnswer === 1 && score > 0) || (userAnswer === -1 && score < 0)
														: userAnswer !== undefined &&
															record.approved !== null &&
															((userAnswer === 1 && record.approved) ||
																(userAnswer === -1 && !record.approved))}
												<div
													class="bill-vote-item"
													class:vote-match={userAnswer !== undefined && userAnswer !== 0 && agrees}
													class:vote-mismatch={userAnswer !== undefined &&
														userAnswer !== 0 &&
														!agrees}
												>
													<div
														class="bill-vote-stance"
														class:approved={isPositive}
														class:no-data={score === null && record.approved === null}
													>
														{#if score !== null}
															<span class="vote-score"
																>{score >= 0 ? '+' : ''}{score.toFixed(2)}</span
															>
														{:else if record.approved !== null}
															<span class="vote-score">{record.approved ? '+1' : '-1'}</span>
															{record.approved ? '賛成' : '反対'}
														{:else}
															<span class="vote-score">N/A</span>
														{/if}
													</div>
													<div class="bill-vote-info">
														<span class="bill-vote-title"
															>{record.billTitle ||
																userBill?.title ||
																`法案 #${record.billId}`}</span
														>
														{#if formatBillRef(record.billType, record.submissionSession, record.billNumber)}
															<span class="bill-vote-ref"
																>{formatBillRef(
																	record.billType,
																	record.submissionSession,
																	record.billNumber
																)}</span
															>
														{/if}
														{#if userAnswer !== undefined && userAnswer !== 0}
															<span class="bill-vote-comparison">
																あなた: {userAnswer === 1 ? '+1 賛成' : '-1 反対'}
																{agrees ? '✓ 一致' : '✗ 不一致'}
															</span>
														{/if}
													</div>
												</div>
											{/each}
										</div>
									</div>
								{:else if currentClusterAnsweredBills.length > 0}
									<div class="detail-section">
										<h4 class="detail-section-title">回答済み法案へのスコア</h4>
										<p class="detail-empty">この議員のスコアデータはありません</p>
									</div>
								{/if}
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* ===== Right Navigation Circle (mirrors left circle in +page.svelte) ===== */
	.cluster-nav {
		position: fixed;
		top: 50%;
		transform: translateY(-50%);
		z-index: 90;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
	}

	.cluster-nav-right {
		right: 2rem;
		transition: right 0.3s ease;
	}

	.cluster-nav-right.panel-open {
		right: calc(560px + 2rem);
	}

	.cluster-nav-right.panel-full {
		display: none;
	}

	.cluster-nav-circle {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		border: 2px solid #d1d5db;
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(8px);
		color: #6b7280;
		cursor: pointer;
		transition: all 0.2s ease;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.cluster-nav-circle:hover:not(:disabled) {
		transform: scale(1.1);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}

	.cluster-nav-circle:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.cluster-nav-circle.confidence-high {
		border-color: #22c55e;
		background: rgba(34, 197, 94, 0.1);
		color: #15803d;
	}

	.cluster-nav-circle.confidence-high:hover:not(:disabled) {
		background: rgba(34, 197, 94, 0.2);
		box-shadow: 0 4px 16px rgba(34, 197, 94, 0.3);
	}

	.cluster-nav-circle.confidence-mid {
		border-color: #f59e0b;
		background: rgba(245, 158, 11, 0.1);
		color: #b45309;
	}

	.cluster-nav-circle.confidence-mid:hover:not(:disabled) {
		background: rgba(245, 158, 11, 0.2);
		box-shadow: 0 4px 16px rgba(245, 158, 11, 0.3);
	}

	.cluster-nav-circle.confidence-low {
		border-color: #ef4444;
		background: rgba(239, 68, 68, 0.08);
		color: #dc2626;
	}

	.cluster-nav-circle.confidence-low:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.15);
		box-shadow: 0 4px 16px rgba(239, 68, 68, 0.3);
	}

	.cluster-nav-circle.active {
		background: #6366f1;
		border-color: #6366f1;
		color: white;
	}

	.cluster-nav-circle.active:hover:not(:disabled) {
		background: #4f46e5;
		box-shadow: 0 4px 16px rgba(99, 102, 241, 0.4);
	}

	.cluster-nav-label {
		font-size: 0.7rem;
		font-weight: 500;
		color: #6b7280;
		max-width: 80px;
		text-align: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cluster-nav-hint {
		white-space: normal;
		overflow: visible;
		max-width: 90px;
		font-size: 0.65rem;
		color: #9ca3af;
		line-height: 1.3;
	}

	/* ===== Panel Action Card ===== */
	.panel-action-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 16px;
		padding: 1.25rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
	}

	.action-card-cluster-name {
		font-size: 1.125rem;
		font-weight: 700;
		color: #1a1a2e;
		text-align: center;
		padding-bottom: 0.25rem;
	}

	.action-card-importance-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.action-card-importance-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: #6b7280;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.action-card-stars {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex: 1;
	}

	.action-star-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.25rem;
		display: flex;
		align-items: center;
		border-radius: 6px;
		transition: all 0.15s ease;
	}

	.action-star-btn:hover {
		transform: scale(1.2);
		background: rgba(251, 191, 36, 0.1);
	}

	.action-star-btn.selected {
		filter: drop-shadow(0 0 3px rgba(251, 191, 36, 0.5));
	}

	.action-card-importance-text {
		font-size: 0.75rem;
		font-weight: 500;
		color: #b45309;
		white-space: nowrap;
		min-width: 5rem;
	}

	.action-card-advance-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.75rem 1.25rem;
		border: none;
		border-radius: 10px;
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
		transition: all 0.2s ease;
		background: linear-gradient(135deg, #059669 0%, #047857 100%);
		color: white;
		box-shadow: 0 2px 8px rgba(5, 150, 105, 0.25);
	}

	.action-card-advance-btn:hover:not(:disabled) {
		background: linear-gradient(135deg, #047857 0%, #065f46 100%);
		box-shadow: 0 4px 16px rgba(5, 150, 105, 0.35);
		transform: translateY(-1px);
	}

	.action-card-advance-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* ===== Section Divider ===== */
	.interim-section-divider {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.25rem 0;
	}

	.interim-section-divider-line {
		flex: 1;
		height: 1px;
		background: #e5e7eb;
	}

	.interim-section-divider-label {
		font-size: 0.75rem;
		font-weight: 700;
		color: #9ca3af;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	/* ===== Results Grid ===== */
	.interim-results-grid {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.interim-results-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1rem;
	}

	.interim-card-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		font-weight: 700;
		color: #374151;
		margin-bottom: 0.75rem;
	}

	/* ===== Interim Results Panel ===== */
	.interim-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.15);
		z-index: 190;
	}

	.interim-panel {
		position: fixed;
		top: 0;
		right: 0;
		width: 560px;
		height: 100vh;
		background: #fafbfc;
		border-left: 1px solid #e5e7eb;
		box-shadow: -4px 0 24px rgba(0, 0, 0, 0.1);
		z-index: 195;
		display: flex;
		flex-direction: column;
		animation: slideInRight 0.3s ease;
		transition: width 0.3s ease;
	}

	.interim-panel.panel-full {
		width: 100vw;
	}

	@keyframes slideInRight {
		from {
			transform: translateX(100%);
		}
		to {
			transform: translateX(0);
		}
	}

	.interim-panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.25rem;
		background: white;
		border-bottom: 1px solid #e5e7eb;
		flex-shrink: 0;
	}

	.interim-panel-title {
		font-size: 1rem;
		font-weight: 700;
		color: #1a1a2e;
	}

	.interim-panel-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: none;
		background: #f3f4f6;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.15s;
	}

	.interim-panel-close:hover {
		background: #e5e7eb;
		color: #374151;
	}

	.interim-panel-header-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.interim-panel-expand {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: none;
		background: #f3f4f6;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.15s;
	}

	.interim-panel-expand:hover {
		background: #e5e7eb;
		color: #374151;
	}

	.interim-panel-body {
		flex: 1;
		overflow-y: auto;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* Spotlight Section */
	.interim-spotlight {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.spotlight-member {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: white;
		border-radius: 12px;
		border: 1.5px solid #e5e7eb;
		transition: all 0.2s;
		cursor: pointer;
		width: 100%;
		text-align: left;
	}

	.spotlight-member:hover {
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
		transform: translateY(-1px);
	}

	.spotlight-member.active {
		border-color: #6366f1;
		box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
	}

	.spotlight-member.rank-gold {
		border-color: #fbbf24;
		background: linear-gradient(135deg, #fffbeb, #fef3c7);
	}

	.spotlight-member.rank-silver {
		border-color: #d1d5db;
		background: linear-gradient(135deg, #f9fafb, #f3f4f6);
	}

	.spotlight-member.rank-bronze {
		border-color: #d97706;
		background: linear-gradient(135deg, #fffbeb, #fef9c3);
	}

	.spotlight-rank {
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		font-size: 0.8rem;
		font-weight: 800;
		flex-shrink: 0;
	}

	.rank-gold .spotlight-rank {
		background: #fbbf24;
		color: #78350f;
	}

	.rank-silver .spotlight-rank {
		background: #d1d5db;
		color: #374151;
	}

	.rank-bronze .spotlight-rank {
		background: #d97706;
		color: white;
	}

	.spotlight-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.spotlight-name {
		font-size: 0.95rem;
		font-weight: 700;
		color: #1a1a2e;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.spotlight-group {
		font-size: 0.75rem;
		color: #6b7280;
	}

	.spotlight-score {
		font-size: 1.1rem;
		font-weight: 800;
		color: #6366f1;
		flex-shrink: 0;
	}

	/* Visualization Section */
	.interim-viz {
		background: white;
		border-radius: 12px;
		padding: 1rem;
		border: 1px solid #e5e7eb;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.interim-viz-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: #6b7280;
		margin-bottom: 0.75rem;
		align-self: flex-start;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.viz-click-hint {
		font-size: 0.7rem;
		font-weight: 400;
		color: #9ca3af;
	}

	/* ===== Interim Party Ranking ===== */
	.interim-party-mode-toggle {
		display: flex;
		gap: 2px;
		background: #f3f4f6;
		border-radius: 8px;
		padding: 2px;
		margin-bottom: 0.75rem;
	}

	.interim-party-mode-btn {
		flex: 1;
		padding: 0.35rem 0.5rem;
		border: none;
		border-radius: 6px;
		font-size: 0.75rem;
		font-weight: 600;
		color: #6b7280;
		background: transparent;
		cursor: pointer;
		transition: all 0.15s;
	}

	.interim-party-mode-btn.active {
		background: white;
		color: #4f46e5;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
	}

	.party-table-row.rank-gold {
		background: #fffbeb;
	}
	.party-table-row.rank-silver {
		background: #f9fafb;
	}
	.party-table-row.rank-bronze {
		background: #fffbeb;
	}

	/* ===== Search Box ===== */

	.interim-search-box {
		position: relative;
		display: flex;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.interim-search-box :global(.interim-search-icon) {
		position: absolute;
		left: 0.625rem;
		color: #9ca3af;
		pointer-events: none;
	}

	.interim-search-input {
		width: 100%;
		padding: 0.5rem 2rem 0.5rem 2rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 0.85rem;
		color: #374151;
		background: #f9fafb;
		transition: all 0.15s;
	}

	.interim-search-input:focus {
		outline: none;
		border-color: #a5b4fc;
		box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
		background: white;
	}

	.interim-search-clear {
		position: absolute;
		right: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: none;
		background: #e5e7eb;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.15s;
	}

	.interim-search-clear:hover {
		background: #d1d5db;
		color: #374151;
	}

	.interim-member-table {
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		overflow: hidden;
	}

	.member-table-header {
		display: flex;
		align-items: center;
		padding: 0.5rem 0.75rem;
		background: #f9fafb;
		border-bottom: 1px solid #e5e7eb;
		font-size: 0.7rem;
		font-weight: 700;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.member-table-body {
		max-height: 50vh;
		overflow-y: scroll;
	}

	.member-table-row {
		display: flex;
		align-items: center;
		padding: 0.5rem 0.75rem;
		width: 100%;
		border: none;
		border-bottom: 1px solid #f3f4f6;
		background: white;
		cursor: pointer;
		transition: background 0.1s;
		text-align: left;
		font-size: 0.8rem;
	}

	.member-table-row:hover {
		background: #f5f3ff;
	}

	.member-table-row.active {
		background: #ede9fe;
		border-left: 3px solid #6366f1;
	}

	.member-table-row:last-child {
		border-bottom: none;
	}

	.table-col-rank {
		width: 2rem;
		flex-shrink: 0;
		color: #9ca3af;
		font-weight: 600;
		font-size: 0.75rem;
	}

	.table-col-name {
		flex: 1;
		min-width: 0;
		font-weight: 600;
		color: #1a1a2e;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.table-col-group {
		flex: 1;
		min-width: 0;
		color: #6b7280;
		font-size: 0.75rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.table-col-score {
		width: 3.5rem;
		flex-shrink: 0;
		text-align: right;
		font-weight: 700;
		font-size: 0.8rem;
	}

	.score-high {
		color: #059669;
	}

	.score-med {
		color: #2563eb;
	}

	.score-low {
		color: #dc2626;
	}

	.score-neg,
	.score-negative {
		color: #991b1b;
	}

	.member-table-empty {
		padding: 1.5rem;
		text-align: center;
		color: #9ca3af;
		font-size: 0.85rem;
	}

	/* ===== Viz Row + Detail Panel Side by Side ===== */
	.interim-viz-row {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		align-items: stretch;
	}

	.interim-viz.has-detail {
		min-width: 0;
	}

	.interim-detail-panel {
		width: 100%;
		flex-shrink: 0;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		overflow: hidden;
		max-height: 60vh;
		display: flex;
		flex-direction: column;
	}

	/* Full-screen panel: side-by-side layout */
	.panel-full .interim-results-grid {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 1rem;
		align-items: start;
	}

	.panel-full .interim-results-card-wide {
		grid-column: 1 / -1;
	}

	.panel-full .interim-viz-row {
		flex-direction: row;
		align-items: stretch;
	}

	.panel-full .interim-viz {
		flex-shrink: 0;
		width: auto;
	}

	.panel-full .interim-detail-panel {
		flex: 1;
		min-width: 0;
		width: auto;
		max-height: none;
	}

	.interim-detail-panel-header {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.625rem 0.75rem;
		background: #6366f1;
		color: white;
		flex-shrink: 0;
	}

	.interim-detail-back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.15);
		color: white;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
		transition: background 0.15s;
	}

	.interim-detail-back:hover {
		background: rgba(255, 255, 255, 0.25);
	}

	.interim-detail-panel-name {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
	}

	.interim-detail-panel-close {
		background: none;
		border: none;
		color: white;
		cursor: pointer;
		opacity: 0.8;
		padding: 0;
		line-height: 1;
		flex-shrink: 0;
	}

	.interim-detail-panel-close:hover {
		opacity: 1;
	}

	.interim-detail-panel-body {
		flex: 1;
		overflow-y: auto;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	/* ===== Member Detail View ===== */

	.member-detail-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		background: linear-gradient(135deg, #f5f3ff, #eef2ff);
		border-radius: 10px;
		border: 1px solid #e0e7ff;
	}

	.member-detail-avatar {
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: white;
		color: #6366f1;
		border: 2px solid #a5b4fc;
		flex-shrink: 0;
	}

	.member-detail-basic {
		flex: 1;
		min-width: 0;
	}

	.member-detail-group {
		font-size: 0.75rem;
		color: #6b7280;
	}

	.member-detail-match {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		margin-top: 0.375rem;
	}

	.match-label {
		font-size: 0.7rem;
		color: #9ca3af;
		font-weight: 600;
	}

	.match-value {
		font-size: 1.15rem;
		font-weight: 800;
		color: #6366f1;
	}

	.member-detail-loading {
		text-align: center;
		padding: 2rem;
		color: #6b7280;
		font-size: 0.9rem;
	}

	.detail-section {
		background: white;
		border-radius: 8px;
		padding: 0.75rem;
		border: 1px solid #e5e7eb;
	}

	.detail-section-title {
		font-size: 0.75rem;
		font-weight: 700;
		color: #374151;
		margin-bottom: 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.disclaimer-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1px solid #d1d5db;
		background: #f9fafb;
		color: #9ca3af;
		cursor: pointer;
		transition: all 0.15s;
		padding: 0;
	}

	.disclaimer-btn:hover {
		background: #e5e7eb;
		color: #6b7280;
		border-color: #9ca3af;
	}

	.disclaimer-box {
		font-size: 0.7rem;
		color: #6b7280;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 6px;
		padding: 0.5rem 0.625rem;
		margin-bottom: 0.5rem;
		line-height: 1.5;
	}

	.detail-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.detail-tag {
		padding: 0.25rem 0.625rem;
		background: #f3f4f6;
		border-radius: 6px;
		font-size: 0.8rem;
		color: #374151;
	}

	.detail-reading {
		display: block;
		font-size: 0.75rem;
		color: #9ca3af;
		margin-top: 0.375rem;
	}

	/* Timeline */
	.history-timeline {
		display: flex;
		flex-direction: column;
		gap: 0;
		position: relative;
		padding-left: 1rem;
	}

	.timeline-entry {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.375rem 0;
		position: relative;
	}

	.timeline-entry:not(:last-child)::after {
		content: '';
		position: absolute;
		left: 3px;
		top: 1rem;
		bottom: -0.375rem;
		width: 1.5px;
		background: #e5e7eb;
	}

	.timeline-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #6366f1;
		flex-shrink: 0;
		margin-top: 0.35rem;
	}

	.timeline-dot.group-dot {
		background: #f59e0b;
	}

	.timeline-content {
		display: flex;
		flex-direction: column;
	}

	.timeline-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: #1f2937;
	}

	.timeline-meta {
		font-size: 0.7rem;
		color: #9ca3af;
	}

	/* Bill Vote List */
	.bill-vote-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.bill-vote-item {
		display: flex;
		align-items: flex-start;
		gap: 0.625rem;
		padding: 0.5rem 0.625rem;
		border-radius: 8px;
		border: 1px solid #f3f4f6;
		background: #fafbfc;
		transition: all 0.15s;
	}

	.bill-vote-item.vote-match {
		background: rgba(34, 197, 94, 0.04);
		border-color: rgba(34, 197, 94, 0.2);
	}

	.bill-vote-item.vote-mismatch {
		background: rgba(239, 68, 68, 0.04);
		border-color: rgba(239, 68, 68, 0.15);
	}

	.bill-vote-stance {
		flex-shrink: 0;
		padding: 0.2rem 0.5rem;
		border-radius: 6px;
		font-size: 0.7rem;
		font-weight: 700;
		background: rgba(239, 68, 68, 0.1);
		color: #dc2626;
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.vote-score {
		font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
		font-size: 0.65rem;
		opacity: 0.8;
	}

	.bill-vote-stance.approved {
		background: rgba(34, 197, 94, 0.1);
		color: #15803d;
	}

	.bill-vote-stance.no-data {
		background: rgba(156, 163, 175, 0.1);
		color: #6b7280;
	}

	.bill-vote-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.bill-vote-title {
		font-size: 0.8rem;
		font-weight: 500;
		color: #374151;
		line-height: 1.35;
	}

	.bill-vote-ref {
		display: block;
		font-size: 0.65rem;
		color: #9ca3af;
		font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
		margin-top: 0.0625rem;
	}

	.bill-vote-comparison {
		font-size: 0.7rem;
		color: #6b7280;
		margin-top: 0.125rem;
	}

	.detail-empty {
		font-size: 0.85rem;
		color: #9ca3af;
		text-align: center;
		padding: 1rem 0;
	}

	@media (max-width: 768px) {
		.interim-panel {
			width: 100vw;
		}

		.cluster-nav-right.panel-open {
			display: none;
		}

		.cluster-nav-label {
			display: none;
		}

		.cluster-nav-circle {
			width: 44px;
			height: 44px;
		}

		.panel-action-card {
			padding: 1rem;
		}

		.action-card-importance-row {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.5rem;
		}

		.action-card-advance-btn {
			font-size: 0.9rem;
			padding: 0.75rem 1rem;
		}

		.interim-results-grid {
			gap: 0.75rem;
		}

		.interim-viz-row {
			flex-direction: column;
		}

		.interim-detail-panel {
			width: 100%;
		}
	}
</style>
