<script lang="ts">
	import LatentSpaceVisualization from '$lib/components/match/LatentSpaceVisualization.svelte';
	import EnrichedBillCard from '$lib/components/match/EnrichedBillCard.svelte';
	import BillDetailPanel from '$lib/components/match/BillDetailPanel.svelte';
	import DelegationModal from '$lib/components/match/DelegationModal.svelte';
	import {
		ThumbsUp,
		ThumbsDown,
		CircleQuestionMark,
		Pencil,
		X,
		CircleCheck,
		Hourglass,
		Handshake,
		TriangleAlert,
		Search,
		User,
		ChevronLeft,
		ChevronRight,
		Info,
		Maximize2,
		Minimize2,
		Star
	} from '@lucide/svelte';
	import type {
		Bill,
		MemberMatch,
		MemberVectorForViz,
		EnrichedBillData
	} from '$lib/types/index.js';
	import { formatBillRef } from '$lib/types/index.js';

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
		currentClusterBillCount: number;
		currentQuestion: Bill | null;
		isLoading: boolean;
		isEditingAnswer: boolean;
		topMatches: MemberMatch[];
		memberVectorsForViz: MemberVectorForViz[];
		explainedVariance: number[];
		xDimension: number;
		yDimension: number;
		userVector: number[];
		userVectorHistory: number[][];
		highlightedMembersForViz: Array<{ memberId: number; similarity: number }>;
		currentClusterAnsweredBills: AnsweredBill[];
		onSubmitAnswer: (vote: number) => void;
		onSkipQuestion: () => void;
		onDelegateBill: (billId: number) => void;
		isLoggedIn: boolean;
		onSelectBillToEdit: (bill: AnsweredBill) => void;
		onCancelEditing: () => void;
		onAdvanceCluster: () => void;
		pendingImportance: number;
		confidence: number;
		isLastClusterInSession: boolean;
		nextClusterDisplayName: string | null;
	}

	let {
		answeredCount,
		currentQuestion,
		isLoading,
		isEditingAnswer = false,
		topMatches,
		memberVectorsForViz,
		explainedVariance,
		xDimension = $bindable(),
		yDimension = $bindable(),
		userVector,
		userVectorHistory,
		highlightedMembersForViz,
		currentClusterAnsweredBills = [],
		onSubmitAnswer,
		onSkipQuestion,
		onDelegateBill,
		isLoggedIn = false,
		onSelectBillToEdit,
		onCancelEditing,
		onAdvanceCluster,
		pendingImportance = $bindable(),
		confidence = 0,
		isLastClusterInSession = false,
		nextClusterDisplayName = null,
		...rest
	}: Props = $props();
	void rest; // Consume unused props (currentClusterDisplayName, currentClusterBillCount)

	function getImportanceLabel(importance: number): string {
		const labels = ['', 'あまり重要ではない', '少し重要', '普通に重要', 'かなり重要', '最も重要'];
		return labels[importance] || '';
	}

	// Enrichment data cache
	let enrichmentCache = $state<Record<number, EnrichedBillData>>({});
	let enrichmentLoading = $state<Record<number, boolean>>({});

	// Track if user has expanded to see all answered bills
	let showAllAnsweredBills = $state(false);
	const INITIAL_VISIBLE_COUNT = 4;
	let visibleAnsweredBills = $derived(
		showAllAnsweredBills
			? currentClusterAnsweredBills
			: currentClusterAnsweredBills.slice(-INITIAL_VISIBLE_COUNT)
	);
	let hasMoreBills = $derived(currentClusterAnsweredBills.length > INITIAL_VISIBLE_COUNT);

	// Get current bill's enrichment data
	let currentEnrichmentData = $derived(
		currentQuestion ? enrichmentCache[currentQuestion.billId] || null : null
	);
	let currentEnrichmentLoading = $derived(
		currentQuestion ? enrichmentLoading[currentQuestion.billId] || false : false
	);

	async function loadEnrichment(billId: number) {
		if (enrichmentCache[billId] || enrichmentLoading[billId]) return;

		enrichmentLoading[billId] = true;

		try {
			const response = await fetch(`/api/bill-enrichment?billId=${billId}`);
			if (response.ok) {
				const data = await response.json();
				enrichmentCache[billId] = data;
			}
		} catch (error) {
			console.error('Failed to load enrichment:', error);
		} finally {
			enrichmentLoading[billId] = false;
		}
	}

	// Auto-load enrichment when question changes
	$effect(() => {
		if (currentQuestion && !enrichmentCache[currentQuestion.billId]) {
			loadEnrichment(currentQuestion.billId);
		}
	});

	// Delegation modal state
	let showDelegationModal = $state(false);

	// Check if current bill is delegated
	let currentBillDelegation = $derived(
		currentQuestion
			? (currentClusterAnsweredBills.find(
					(b) => b.billId === currentQuestion.billId && b.source === 'delegated'
				) ?? null)
			: null
	);

	// Current delegate ID for the bill (to visually indicate in modal)
	let currentDelegateId = $derived(currentBillDelegation?.delegateId ?? null);
	let currentDelegationStatus = $derived(currentBillDelegation?.delegationStatus ?? null);

	// Confirmation state for voting on a delegated bill (retracts delegation)
	let pendingRetractVote = $state<number | null>(null);

	function confirmRetractVote() {
		if (pendingRetractVote !== null) {
			const vote = pendingRetractVote;
			pendingRetractVote = null;
			onSubmitAnswer(vote);
		}
	}

	function cancelRetractVote() {
		pendingRetractVote = null;
	}

	// Ref for voting card to scroll into view when editing
	let votingCardEl = $state<HTMLElement | null>(null);

	// Auto-scroll to voting card when entering edit mode
	$effect(() => {
		if (isEditingAnswer && votingCardEl) {
			votingCardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	});

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

	// Disclaimer tooltip state
	let showPartyDisclaimer = $state(false);
	let showGroupDisclaimer = $state(false);

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
	let memberDetail = $state<MemberDetail | null>(null);
	let memberDetailLoading = $state(false);

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

	function handleMemberClick(m: { memberId: number; name: string; group: string | null }) {
		selectedMember = m;
		loadMemberDetail(m.memberId);
	}

	function closeMemberDetail() {
		selectedMember = null;
		memberDetail = null;
	}

	// Detail panel state
	let billDetailLevel = $state(1);
	let showDetailPanel = $derived(billDetailLevel >= 2);
	let isDetailFullscreen = $state(false);

	// Reset detail level when question changes
	$effect(() => {
		if (currentQuestion) {
			// Access billId to track changes
			void currentQuestion.billId;
			billDetailLevel = 1;
			isDetailFullscreen = false;
		}
	});

	function handleDetailLevelChange(level: number) {
		billDetailLevel = level;
	}

	function closeDetailPanel() {
		billDetailLevel = 1;
		isDetailFullscreen = false;
	}

	function toggleDetailFullscreen() {
		isDetailFullscreen = !isDetailFullscreen;
	}

	function openDelegationModal() {
		showDelegationModal = true;
	}

	function closeDelegationModal() {
		showDelegationModal = false;
	}

	function handleDelegated() {
		if (currentQuestion) {
			onDelegateBill(currentQuestion.billId);
		}
	}

	// Long-press vote state
	const HOLD_DURATION = 600; // ms to hold before vote casts
	let holdingVote = $state<number | null>(null);
	let holdProgress = $state(0);
	let holdTimer: ReturnType<typeof setInterval> | null = null;
	let holdStartTime = 0;

	function startHold(vote: number) {
		if (isLoading) return;
		holdingVote = vote;
		holdProgress = 0;
		holdStartTime = Date.now();
		holdTimer = setInterval(() => {
			const elapsed = Date.now() - holdStartTime;
			holdProgress = Math.min(elapsed / HOLD_DURATION, 1);
			if (holdProgress >= 1) {
				cancelHold();
				if (currentBillDelegation) {
					pendingRetractVote = vote;
				} else {
					onSubmitAnswer(vote);
				}
			}
		}, 16);
	}

	function cancelHold() {
		if (holdTimer) {
			clearInterval(holdTimer);
			holdTimer = null;
		}
		holdingVote = null;
		holdProgress = 0;
	}

	function getAnswerLabel(bill: AnsweredBill): string {
		if (bill.source === 'delegated') {
			if (bill.delegationStatus === 'voted') {
				if (bill.answer === 1) return '委任: 賛成';
				if (bill.answer === -1) return '委任: 反対';
				return '委任済';
			}
			return '委任中';
		}
		if (bill.answer === 1) return '賛成';
		if (bill.answer === -1) return '反対';
		return 'スキップ';
	}

	function getAnswerClass(bill: AnsweredBill): string {
		if (bill.source === 'delegated') {
			return bill.delegationStatus === 'voted'
				? 'answer-delegated-voted'
				: 'answer-delegated-pending';
		}
		if (bill.answer === 1) return 'answer-agree';
		if (bill.answer === -1) return 'answer-disagree';
		return 'answer-neutral';
	}

	// Delegation for answered bills (reuses the main delegation modal via edit flow)
	let delegatingBill = $state<AnsweredBill | null>(null);

	function closeDelegationForBill() {
		delegatingBill = null;
	}

	function handleDelegatedForBill() {
		if (delegatingBill) {
			onDelegateBill(delegatingBill.billId);
			delegatingBill = null;
		}
	}
</script>

<div class="questioning-container" class:detail-open={showDetailPanel}>
	{#if currentQuestion}
		<div class="question-layout" class:expanded={showDetailPanel}>
			<!-- Left: Voting Card -->
			<div class="question-card-wrapper" bind:this={votingCardEl}>
				<div class="question-card fade-in-up" class:editing-mode={isEditingAnswer}>
					{#if isEditingAnswer}
						<div class="editing-banner">
							<span class="editing-banner-text"
								><Pencil size={14} class="inline-icon" /> 回答を変更中</span
							>
							<button class="cancel-edit-btn" onclick={onCancelEditing} disabled={isLoading}>
								<X size={14} class="inline-icon" /> キャンセル
							</button>
						</div>
					{/if}

					<!-- Enriched Bill Card (basic view only) -->
					<EnrichedBillCard
						billId={currentQuestion.billId}
						title={currentQuestion.title}
						description={currentQuestion.description}
						passed={currentQuestion.passed}
						result={currentQuestion.result}
						enrichmentData={currentEnrichmentData}
						isLoading={currentEnrichmentLoading}
						onLoadEnrichment={() => loadEnrichment(currentQuestion.billId)}
						detailLevel={billDetailLevel}
						onDetailLevelChange={handleDetailLevelChange}
						billRef={formatBillRef(
							currentQuestion.billType,
							currentQuestion.submissionSession,
							currentQuestion.billNumber
						)}
					/>

					<!-- Vote Buttons -->
					<hr class="vote-divider" />
					<div class="vote-buttons">
						<button
							onpointerdown={() => startHold(1)}
							onpointerup={cancelHold}
							onpointerleave={cancelHold}
							disabled={isLoading}
							class="vote-btn vote-agree"
							class:holding={holdingVote === 1}
						>
							<span
								class="vote-fill vote-fill-agree"
								style="transform: scaleY({holdingVote === 1 ? holdProgress : 0})"
							></span>
							<span class="vote-emoji"
								><ThumbsUp size={28} color={holdingVote === 1 ? '#166534' : '#22c55e'} /></span
							>
							<span class="vote-label" class:vote-label-active={holdingVote === 1}>賛成</span>
						</button>
						<button
							onpointerdown={() => startHold(0)}
							onpointerup={cancelHold}
							onpointerleave={cancelHold}
							disabled={isLoading}
							class="vote-btn vote-neutral"
							class:holding={holdingVote === 0}
						>
							<span
								class="vote-fill vote-fill-neutral"
								style="transform: scaleY({holdingVote === 0 ? holdProgress : 0})"
							></span>
							<span class="vote-emoji"
								><CircleQuestionMark
									size={28}
									color={holdingVote === 0 ? '#1e40af' : '#3b82f6'}
								/></span
							>
							<span class="vote-label" class:vote-label-active={holdingVote === 0}>わからない</span>
						</button>
						<button
							onpointerdown={() => startHold(-1)}
							onpointerup={cancelHold}
							onpointerleave={cancelHold}
							disabled={isLoading}
							class="vote-btn vote-disagree"
							class:holding={holdingVote === -1}
						>
							<span
								class="vote-fill vote-fill-disagree"
								style="transform: scaleY({holdingVote === -1 ? holdProgress : 0})"
							></span>
							<span class="vote-emoji"
								><ThumbsDown size={28} color={holdingVote === -1 ? '#991b1b' : '#ef4444'} /></span
							>
							<span class="vote-label" class:vote-label-active={holdingVote === -1}>反対</span>
						</button>
					</div>
					<p class="vote-hint">長押しで投票</p>

					<!-- Retract delegation confirmation -->
					{#if pendingRetractVote !== null}
						<div class="retract-warning">
							<p class="retract-warning-text">
								<TriangleAlert size={14} class="inline-icon" color="#f59e0b" />
								この法案は委任中です。投票すると委任が取り消されます。
							</p>
							<div class="retract-warning-actions">
								<button class="retract-btn retract-btn-cancel" onclick={cancelRetractVote}>
									キャンセル
								</button>
								<button class="retract-btn retract-btn-confirm" onclick={confirmRetractVote}>
									委任を取り消して投票
								</button>
							</div>
						</div>
					{/if}

					<!-- Actions -->
					<div class="question-actions">
						{#if isLoggedIn}
							<button
								onclick={openDelegationModal}
								disabled={isLoading}
								class="action-btn-delegate"
							>
								<Handshake size={14} class="inline-icon" />
								{currentBillDelegation ? '委任先を変える' : 'フレンドに委任'}
							</button>
						{:else if !isEditingAnswer}
							<button onclick={onSkipQuestion} disabled={isLoading} class="action-btn-secondary">
								スキップ →
							</button>
						{/if}
					</div>
				</div>
			</div>

			<!-- Right: Detail Panel (slides in from right) -->
			{#if showDetailPanel}
				<div class="detail-panel-wrapper" class:fullscreen-wrapper={isDetailFullscreen}>
					<BillDetailPanel
						enrichmentData={currentEnrichmentData}
						isLoading={currentEnrichmentLoading}
						detailLevel={billDetailLevel}
						isFullscreen={isDetailFullscreen}
						onClose={closeDetailPanel}
						onDetailLevelChange={handleDetailLevelChange}
						onToggleFullscreen={toggleDetailFullscreen}
					/>
				</div>
			{/if}
		</div>
	{:else if !isEditingAnswer}
		<div class="empty-question">
			<p>
				<CircleCheck size={16} class="inline-icon" color="#22c55e" /> このクラスターの質問が完了しました
			</p>
			<p class="empty-question-hint">
				下の回答済みリストから回答を変更するか、右の矢印で次に進めます
			</p>
		</div>
	{/if}

	<!-- Answered Bills Collection -->
	{#if currentClusterAnsweredBills.length > 0}
		<div class="collection-section">
			<div class="collection-header">
				<span class="collection-title">回答済み法案</span>
				<span class="collection-count">{currentClusterAnsweredBills.length}件</span>
			</div>
			<div class="collection-grid">
				{#each visibleAnsweredBills as bill (bill.billId)}
					{@const isBeingEdited = isEditingAnswer && currentQuestion?.billId === bill.billId}
					<div class="collect-card {getAnswerClass(bill)}" class:card-editing={isBeingEdited}>
						<div class="card-accent"></div>
						<div class="card-top-row">
							<span class="card-icon-sm">
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
							<span class="card-badge {getAnswerClass(bill)}">{getAnswerLabel(bill)}</span>
						</div>
						{#if formatBillRef(bill.billType, bill.submissionSession, bill.billNumber)}
							<div class="card-ref">
								{formatBillRef(bill.billType, bill.submissionSession, bill.billNumber)}
							</div>
						{/if}
						<div class="card-title">{bill.title}</div>
						{#if isBeingEdited}
							<div class="card-editing-label">
								<Pencil size={11} /> 変更中
							</div>
						{:else if !isEditingAnswer}
							<button
								class="card-overlay"
								onclick={() => onSelectBillToEdit(bill)}
								disabled={isLoading}
							>
								<span class="card-overlay-btn">
									<Pencil size={14} /> 変更
								</span>
							</button>
						{/if}
					</div>
				{/each}
				{#if hasMoreBills && !showAllAnsweredBills}
					<button class="show-more-card" onclick={() => (showAllAnsweredBills = true)}>
						<span class="show-more-count"
							>+{currentClusterAnsweredBills.length - INITIAL_VISIBLE_COUNT}</span
						>
						<span class="show-more-label">すべて表示</span>
					</button>
				{/if}
			</div>
			{#if showAllAnsweredBills && hasMoreBills}
				<button class="show-less-btn" onclick={() => (showAllAnsweredBills = false)}>
					折りたたむ
				</button>
			{/if}
		</div>
	{/if}
</div>

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
			<h3 class="interim-panel-title">暫定マッチング結果</h3>
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

		<!-- Importance & Advance Bar -->
		<div class="panel-action-bar">
			<div class="panel-importance">
				<span class="panel-importance-label">重要度</span>
				<div class="panel-star-rating">
					{#each [1, 2, 3, 4, 5] as star (star)}
						<button
							onclick={() => (pendingImportance = star)}
							class="panel-star-btn"
							class:selected={star <= pendingImportance}
						>
							<Star
								size={16}
								fill={star <= pendingImportance ? '#fbbf24' : 'none'}
								color={star <= pendingImportance ? '#fbbf24' : '#d1d5db'}
							/>
						</button>
					{/each}
				</div>
				<span class="panel-importance-text">{getImportanceLabel(pendingImportance)}</span>
			</div>
			<button
				class="panel-advance-btn"
				onclick={() => {
					closePanel();
					onAdvanceCluster();
				}}
				disabled={isLoading}
			>
				{#if isLoading}
					<Hourglass size={14} /> 読み込み中...
				{:else if isLastClusterInSession}
					重要度を確認する <ChevronRight size={14} />
				{:else if nextClusterDisplayName}
					「{nextClusterDisplayName}」分野へ <ChevronRight size={14} />
				{:else}
					次の分野へ <ChevronRight size={14} />
				{/if}
			</button>
		</div>

		<div class="interim-panel-body">
			<!-- Top 3 Spotlight -->
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
						<div class="spotlight-score">{(match.similarity * 100).toFixed(1)}%</div>
					</button>
				{/each}
			</div>

			<!-- Searchable Member Table -->
			<div class="interim-search-section">
				<h4 class="interim-section-title">全議員検索</h4>
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
									class="table-col-score score-{match.similarity >= 0.7
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

<!-- Delegation Modal for current question -->
{#if currentQuestion}
	<DelegationModal
		show={showDelegationModal}
		billId={currentQuestion.billId}
		billTitle={currentQuestion.title}
		billRef={formatBillRef(
			currentQuestion.billType,
			currentQuestion.submissionSession,
			currentQuestion.billNumber
		)}
		hasExistingVote={currentClusterAnsweredBills.some(
			(b) => b.billId === currentQuestion?.billId && b.answer !== 0
		)}
		{currentDelegateId}
		{currentDelegationStatus}
		onClose={closeDelegationModal}
		onDelegated={handleDelegated}
	/>
{/if}

<!-- Delegation Modal for already-answered bills -->
{#if delegatingBill}
	<DelegationModal
		show={true}
		billId={delegatingBill.billId}
		billTitle={delegatingBill.title}
		billRef={formatBillRef(
			delegatingBill.billType,
			delegatingBill.submissionSession,
			delegatingBill.billNumber
		)}
		hasExistingVote={delegatingBill.answer !== 0}
		onClose={closeDelegationForBill}
		onDelegated={handleDelegatedForBill}
	/>
{/if}

<style>
	/* Container */
	.questioning-container {
		max-width: 800px;
		margin: 0 auto;
		transition: max-width 0.4s ease;
	}

	.questioning-container.detail-open {
		max-width: 1200px;
	}

	/* Side-by-side layout */
	.question-layout {
		display: flex;
		gap: 1.5rem;
		align-items: flex-start;
		margin-bottom: 1.5rem;
	}

	.question-card-wrapper {
		flex: 1;
		min-width: 0;
		transition: flex 0.4s ease;
		scroll-margin-top: 6rem;
	}

	.question-layout.expanded .question-card-wrapper {
		flex: 0 0 50%;
	}

	.detail-panel-wrapper {
		flex: 0 0 48%;
		min-width: 0;
		position: sticky;
		top: 1rem;
	}

	.detail-panel-wrapper.fullscreen-wrapper {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 1000;
		flex: none;
		width: 100%;
	}

	/* Cluster Info - removed, using parent progress */

	/* Question Card */
	.question-card {
		background: white;
		border-radius: 16px;
		padding: 2rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
		transition: all 0.3s ease;
	}

	.question-card.editing-mode {
		border: 1.5px solid #e5e7eb;
		border-top: 3px solid #6366f1;
	}

	.editing-banner {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: #f5f3ff;
		margin: -2rem -2rem 1.5rem -2rem;
		padding: 0.625rem 1.5rem;
		border-radius: 14px 14px 0 0;
		border-bottom: 1px solid #e9e5ff;
	}

	.editing-banner-text {
		font-weight: 600;
		color: #4f46e5;
		font-size: 0.9rem;
	}

	.cancel-edit-btn {
		padding: 0.4rem 0.875rem;
		background: white;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-size: 0.85rem;
		font-weight: 500;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.2s;
	}

	.cancel-edit-btn:hover:not(:disabled) {
		background: #f9fafb;
		border-color: #9ca3af;
		color: #374151;
	}

	.cancel-edit-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.question-header {
		display: flex;
		justify-content: flex-start;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}

	.bill-status {
		padding: 0.5rem 1rem;
		border-radius: 20px;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.bill-status.passed {
		background: rgba(34, 197, 94, 0.15);
		color: #047857;
	}

	.bill-status.not-passed {
		background: rgba(251, 191, 36, 0.15);
		color: #b45309;
	}

	.question-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1a1a2e;
		line-height: 1.4;
		margin-bottom: 1rem;
	}

	.question-description {
		color: #64748b;
		line-height: 1.7;
		margin-bottom: 2rem;
	}

	/* Vote Buttons */
	.vote-buttons {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		margin-bottom: 0.25rem;
	}

	.vote-divider {
		border: none;
		border-top: 1px solid #e5e7eb;
		margin: 1.25rem 0;
	}

	.vote-btn {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1.25rem 1rem;
		border: 2px solid transparent;
		border-radius: 12px;
		background: #f9fafb;
		cursor: pointer;
		transition: all 0.3s ease;
		font-weight: 600;
		overflow: hidden;
		-webkit-user-select: none;
		user-select: none;
		-webkit-touch-callout: none;
	}

	.vote-btn:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 8px 16px rgba(0, 0, 0, 0.08);
	}

	.vote-btn.holding {
		transform: scale(0.97);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
	}

	.vote-agree.holding {
		border-color: #22c55e;
	}

	.vote-neutral.holding {
		border-color: #3b82f6;
	}

	.vote-disagree.holding {
		border-color: #ef4444;
	}

	.vote-fill {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 100%;
		transform-origin: bottom;
		transform: scaleY(0);
		pointer-events: none;
		z-index: 0;
	}

	.vote-fill-agree {
		background: rgba(34, 197, 94, 0.35);
	}

	.vote-fill-neutral {
		background: rgba(59, 130, 246, 0.3);
	}

	.vote-fill-disagree {
		background: rgba(239, 68, 68, 0.3);
	}

	.vote-hint {
		text-align: center;
		font-size: 0.75rem;
		color: #9ca3af;
		margin: 0.25rem 0 1rem;
	}

	/* Retract delegation warning */
	.retract-warning {
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-radius: 10px;
		padding: 0.875rem 1rem;
		margin-bottom: 1rem;
	}

	.retract-warning-text {
		font-size: 0.9rem;
		color: #92400e;
		margin: 0 0 0.75rem;
		line-height: 1.5;
	}

	.retract-warning-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	.retract-btn {
		padding: 0.5rem 1rem;
		border-radius: 8px;
		border: none;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.retract-btn-cancel {
		background: #f3f4f6;
		color: #374151;
	}

	.retract-btn-cancel:hover {
		background: #e5e7eb;
	}

	.retract-btn-confirm {
		background: #dc2626;
		color: white;
	}

	.retract-btn-confirm:hover {
		background: #b91c1c;
	}

	.vote-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.vote-agree {
		border-color: rgba(34, 197, 94, 0.3);
	}

	.vote-agree:hover:not(:disabled) {
		background: rgba(34, 197, 94, 0.1);
		border-color: #22c55e;
	}

	.vote-neutral {
		border-color: rgba(59, 130, 246, 0.3);
	}

	.vote-neutral:hover:not(:disabled) {
		background: rgba(59, 130, 246, 0.1);
		border-color: #3b82f6;
	}

	.vote-disagree {
		border-color: rgba(239, 68, 68, 0.3);
	}

	.vote-disagree:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.1);
		border-color: #ef4444;
	}

	.vote-emoji {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.vote-label {
		position: relative;
		z-index: 1;
		font-size: 1rem;
		color: #374151;
		transition:
			color 0.15s,
			font-weight 0.15s;
	}

	.vote-label-active {
		color: #111827;
		font-weight: 700;
	}

	/* Question Actions */
	.question-actions {
		display: flex;
		gap: 1rem;
		flex-direction: column;
	}

	.action-btn-secondary,
	.action-btn-primary {
		padding: 0.875rem 1.5rem;
		border-radius: 10px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
		border: none;
	}

	.action-btn-secondary {
		background: #f3f4f6;
		color: #4b5563;
	}

	.action-btn-secondary:hover:not(:disabled) {
		background: #e5e7eb;
	}

	.action-btn-delegate {
		padding: 0.875rem 1.5rem;
		border-radius: 10px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		background: #f9fafb;
		color: #6b7280;
		border: 1px solid #e5e7eb;
	}

	.action-btn-delegate:hover:not(:disabled) {
		background: #f3f4f6;
		border-color: #d1d5db;
		color: #374151;
	}

	.action-btn-primary {
		background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
		color: white;
		box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.3);
	}

	.action-btn-primary:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 8px 12px -2px rgba(99, 102, 241, 0.4);
	}

	.action-btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.empty-question {
		text-align: center;
		padding: 3rem;
		color: #1f2937;
		background: linear-gradient(135deg, #f0fdf4, #dcfce7);
		border-radius: 16px;
		margin-bottom: 1.5rem;
		border: 2px solid #86efac;
	}

	.empty-question p:first-child {
		font-size: 1.25rem;
		font-weight: 600;
		color: #166534;
		margin-bottom: 0.5rem;
	}

	.empty-question-hint {
		font-size: 0.9rem;
		color: #6b7280;
		margin-top: 0.5rem;
	}

	.empty-question-actions {
		margin-top: 1.5rem;
	}

	.empty-question-actions .action-btn-primary {
		padding: 0.75rem 2rem;
		font-size: 1rem;
	}

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

	/* ===== Panel Action Bar ===== */
	.panel-action-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 1.25rem;
		background: linear-gradient(135deg, #fefce8, #fef3c7);
		border-bottom: 1px solid #fde68a;
		flex-shrink: 0;
	}

	.panel-importance {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.panel-importance-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #92400e;
		white-space: nowrap;
	}

	.panel-star-rating {
		display: flex;
		gap: 0.125rem;
	}

	.panel-star-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.125rem;
		display: flex;
		align-items: center;
		border-radius: 4px;
		transition: transform 0.15s ease;
	}

	.panel-star-btn:hover {
		transform: scale(1.2);
	}

	.panel-star-btn.selected {
		filter: drop-shadow(0 0 2px rgba(251, 191, 36, 0.5));
	}

	.panel-importance-text {
		font-size: 0.7rem;
		color: #b45309;
		white-space: nowrap;
	}

	.panel-advance-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		background: #059669;
		color: white;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.panel-advance-btn:hover {
		background: #047857;
		box-shadow: 0 2px 8px rgba(5, 150, 105, 0.3);
	}

	.panel-advance-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
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

	/* ===== Searchable Member Table ===== */
	.interim-search-section {
		background: white;
		border-radius: 12px;
		padding: 1rem;
		border: 1px solid #e5e7eb;
	}

	.interim-section-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: #6b7280;
		margin-bottom: 0.75rem;
	}

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
		max-height: 420px;
		display: flex;
		flex-direction: column;
	}

	/* Full-screen panel: side-by-side layout */
	.panel-full .interim-viz-row {
		flex-direction: row;
		align-items: flex-start;
	}

	.panel-full .interim-viz.has-detail {
		flex: 1;
		min-width: 0;
	}

	.panel-full .interim-detail-panel {
		width: 360px;
		max-height: 520px;
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

	/* ===== Collection Section ===== */
	.collection-section {
		margin-top: 1.5rem;
	}

	.collection-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0 0.25rem;
		margin-bottom: 0.75rem;
	}

	.collection-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-secondary);
		letter-spacing: 0.02em;
	}

	.collection-count {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-tertiary);
		background: var(--surface-secondary);
		padding: 0.125rem 0.5rem;
		border-radius: 100px;
	}

	.collection-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.5rem;
	}

	/* Collectible Card */
	.collect-card {
		position: relative;
		min-height: 130px;
		border-radius: 10px;
		background: white;
		border: 1.5px solid #e5e7eb;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
		cursor: default;
	}

	.collect-card:hover:not(.card-editing) {
		transform: translateY(-3px);
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1);
	}

	.collect-card.card-editing {
		border-color: #6366f1;
		box-shadow:
			0 0 0 2px rgba(99, 102, 241, 0.25),
			0 4px 12px rgba(99, 102, 241, 0.15);
		transform: translateY(-2px);
	}

	.card-editing-label {
		position: absolute;
		top: 0;
		right: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.2rem 0.5rem;
		font-size: 0.65rem;
		font-weight: 700;
		color: white;
		background: #6366f1;
		border-radius: 0 8px 0 6px;
	}

	/* Accent stripe at top */
	.card-accent {
		height: 4px;
		flex-shrink: 0;
	}

	.collect-card.answer-agree {
		border-color: rgba(34, 197, 94, 0.3);
	}
	.collect-card.answer-agree .card-accent {
		background: linear-gradient(90deg, #22c55e, #4ade80);
	}
	.collect-card.answer-agree .card-icon-sm {
		color: #16a34a;
	}

	.collect-card.answer-disagree {
		border-color: rgba(239, 68, 68, 0.3);
	}
	.collect-card.answer-disagree .card-accent {
		background: linear-gradient(90deg, #ef4444, #f87171);
	}
	.collect-card.answer-disagree .card-icon-sm {
		color: #dc2626;
	}

	.collect-card.answer-neutral {
		border-color: rgba(148, 163, 184, 0.3);
	}
	.collect-card.answer-neutral .card-accent {
		background: linear-gradient(90deg, #94a3b8, #cbd5e1);
	}
	.collect-card.answer-neutral .card-icon-sm {
		color: #64748b;
	}

	.collect-card.answer-delegated-voted {
		border-color: rgba(139, 92, 246, 0.3);
	}
	.collect-card.answer-delegated-voted .card-accent {
		background: linear-gradient(90deg, #8b5cf6, #a78bfa);
	}
	.collect-card.answer-delegated-voted .card-icon-sm {
		color: #7c3aed;
	}

	.collect-card.answer-delegated-pending {
		border-color: rgba(245, 158, 11, 0.3);
	}
	.collect-card.answer-delegated-pending .card-accent {
		background: linear-gradient(90deg, #f59e0b, #fbbf24);
	}
	.collect-card.answer-delegated-pending .card-icon-sm {
		color: #d97706;
	}

	.card-top-row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.625rem 0;
	}

	.card-icon-sm {
		display: flex;
		align-items: center;
	}

	.card-title {
		flex: 1;
		padding: 0.25rem 0.625rem 0.5rem;
		font-size: 0.78rem;
		font-weight: 500;
		color: var(--text-primary);
		line-height: 1.35;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.card-ref {
		padding: 0.125rem 0.625rem 0;
		font-size: 0.6rem;
		color: #9ca3af;
		font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card-badge {
		display: inline-flex;
		align-items: center;
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		letter-spacing: 0.02em;
	}

	.card-badge.answer-agree {
		background: rgba(34, 197, 94, 0.12);
		color: #15803d;
	}
	.card-badge.answer-disagree {
		background: rgba(239, 68, 68, 0.1);
		color: #dc2626;
	}
	.card-badge.answer-neutral {
		background: rgba(107, 114, 128, 0.08);
		color: #6b7280;
	}
	.card-badge.answer-delegated-voted {
		background: rgba(139, 92, 246, 0.1);
		color: #7c3aed;
	}
	.card-badge.answer-delegated-pending {
		background: rgba(245, 158, 11, 0.1);
		color: #b45309;
	}

	/* Hover overlay for actions */
	.card-overlay {
		position: absolute;
		inset: 0;
		background: rgba(255, 255, 255, 0.9);
		backdrop-filter: blur(2px);
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		transition: opacity 0.15s ease;
		border-radius: 10px;
		border: none;
		cursor: pointer;
	}

	.collect-card:hover .card-overlay {
		opacity: 1;
	}

	.card-overlay:disabled {
		cursor: not-allowed;
	}

	.card-overlay-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.5rem 1rem;
		font-size: 0.85rem;
		font-weight: 600;
		border-radius: 8px;
		border: 1.5px solid #d1d5db;
		background: white;
		color: #374151;
		pointer-events: none;
		transition: all 0.15s;
	}

	.card-overlay:hover:not(:disabled) .card-overlay-btn {
		background: #f5f3ff;
		border-color: #a5b4fc;
		color: #4f46e5;
	}

	/* Show more card */
	.show-more-card {
		min-height: 130px;
		border-radius: 10px;
		background: var(--surface-secondary);
		border: 1.5px dashed #d1d5db;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.show-more-card:hover {
		background: var(--surface-tertiary);
		border-color: #9ca3af;
	}

	.show-more-count {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--text-secondary);
	}

	.show-more-label {
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	.show-less-btn {
		display: block;
		margin: 0.5rem auto 0;
		padding: 0.4rem 1.25rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: #6b7280;
		background: #f3f4f6;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.15s;
	}

	.show-less-btn:hover {
		background: #e5e7eb;
		color: #374151;
		border-color: #d1d5db;
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
		.question-layout {
			flex-direction: column;
		}

		.question-layout.expanded .question-card-wrapper {
			flex: 1;
		}

		.detail-panel-wrapper {
			flex: 1;
			position: static;
			width: 100%;
		}

		.questioning-container.detail-open {
			max-width: 800px;
		}

		.vote-buttons {
			grid-template-columns: 1fr;
		}

		.question-actions {
			flex-direction: column;
			gap: 0.75rem;
		}

		.collection-grid {
			grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
			gap: 0.375rem;
		}

		.collect-card,
		.show-more-card {
			min-height: 110px;
		}

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

		.panel-action-bar {
			flex-direction: column;
			gap: 0.5rem;
		}

		.interim-viz-row {
			flex-direction: column;
		}

		.interim-detail-panel {
			width: 100%;
		}
	}
</style>
