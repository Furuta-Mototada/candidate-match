<script lang="ts">
	import LatentSpaceVisualization from '$lib/components/match/LatentSpaceVisualization.svelte';
	import MemberRankingList from '$lib/components/match/MemberRankingList.svelte';
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
		TriangleAlert
	} from '@lucide/svelte';
	import type {
		Bill,
		MemberMatch,
		MemberVectorForViz,
		EnrichedBillData
	} from '$lib/types/index.js';

	interface AnsweredBill {
		billId: number;
		title: string;
		answer: number;
		source?: 'direct' | 'delegated';
		delegationStatus?: 'pending' | 'voted';
		delegateId?: string;
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
		onFinishCluster: () => void;
		onSelectBillToEdit: (bill: AnsweredBill) => void;
		onCancelEditing: () => void;
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
		onFinishCluster,
		onSelectBillToEdit,
		onCancelEditing,
		...rest
	}: Props = $props();
	void rest; // Consume unused props (currentClusterDisplayName, currentClusterBillCount)

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

				<!-- Cluster finish button - outside the voting card -->
				{#if !isEditingAnswer}
					<div class="cluster-finish-action">
						<button
							onclick={onFinishCluster}
							disabled={isLoading || answeredCount < 2}
							class="action-btn-finish"
						>
							{answeredCount >= 2
								? 'このクラスターを終了 →'
								: `あと${2 - answeredCount}問回答してください`}
						</button>
					</div>
				{/if}
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
			<p class="empty-question-hint">下の回答済みリストから回答を変更できます</p>
			<div class="empty-question-actions">
				<button onclick={onFinishCluster} disabled={isLoading} class="action-btn-primary">
					{#if isLoading}
						<Hourglass size={14} class="inline-icon" /> 読み込み中...
					{:else}
						このクラスターを終了 →
					{/if}
				</button>
			</div>
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
						<div class="card-icon">
							{#if bill.source === 'delegated'}
								<Handshake size={20} />
							{:else if bill.answer === 1}
								<ThumbsUp size={20} />
							{:else if bill.answer === -1}
								<ThumbsDown size={20} />
							{:else}
								<CircleQuestionMark size={20} />
							{/if}
						</div>
						<div class="card-title">{bill.title}</div>
						<div class="card-footer">
							<span class="card-badge {getAnswerClass(bill)}">{getAnswerLabel(bill)}</span>
						</div>
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

	<!-- Top Matches Preview -->
	{#if topMatches.length > 0 && answeredCount >= 2}
		<div class="matches-preview">
			<MemberRankingList
				title="暫定マッチング TOP3"
				members={topMatches.map((m) => ({ ...m, score: m.similarity }))}
				limit={3}
				compact={true}
				showGroup={false}
			/>
		</div>
	{/if}

	<!-- 2D Position Visualization -->
	<div class="viz-section">
		<div class="viz-container">
			<LatentSpaceVisualization
				members={memberVectorsForViz}
				{explainedVariance}
				bind:xDimension
				bind:yDimension
				{userVector}
				{userVectorHistory}
				highlightedMembers={highlightedMembersForViz}
				width={800}
				height={450}
				showDimensionSelectors={userVector.length > 2}
				title=""
				showLegend={true}
				compact={false}
				collapsible={true}
				collapsedLabel="📍 あなたの位置を表示"
				expandedLabel="グラフを隠す"
			/>
		</div>
	</div>
</div>

<!-- Delegation Modal for current question -->
{#if currentQuestion}
	<DelegationModal
		show={showDelegationModal}
		billId={currentQuestion.billId}
		billTitle={currentQuestion.title}
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

	.cluster-finish-action {
		margin-top: 0.75rem;
		text-align: center;
	}

	.action-btn-finish {
		padding: 0.75rem 1.5rem;
		border-radius: 10px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
		border: none;
		background: transparent;
		color: #6b7280;
		font-size: 0.9rem;
	}

	.action-btn-finish:hover:not(:disabled) {
		color: #6366f1;
		background: #f0f0ff;
	}

	.action-btn-finish:disabled {
		opacity: 0.4;
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

	/* Visualization Section */
	.viz-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		margin-top: 1rem;
		padding-top: 2rem;
		border-top: 1px dashed #e5e7eb;
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
	.collect-card.answer-agree .card-icon {
		color: #16a34a;
	}

	.collect-card.answer-disagree {
		border-color: rgba(239, 68, 68, 0.3);
	}
	.collect-card.answer-disagree .card-accent {
		background: linear-gradient(90deg, #ef4444, #f87171);
	}
	.collect-card.answer-disagree .card-icon {
		color: #dc2626;
	}

	.collect-card.answer-neutral {
		border-color: rgba(148, 163, 184, 0.3);
	}
	.collect-card.answer-neutral .card-accent {
		background: linear-gradient(90deg, #94a3b8, #cbd5e1);
	}
	.collect-card.answer-neutral .card-icon {
		color: #64748b;
	}

	.collect-card.answer-delegated-voted {
		border-color: rgba(139, 92, 246, 0.3);
	}
	.collect-card.answer-delegated-voted .card-accent {
		background: linear-gradient(90deg, #8b5cf6, #a78bfa);
	}
	.collect-card.answer-delegated-voted .card-icon {
		color: #7c3aed;
	}

	.collect-card.answer-delegated-pending {
		border-color: rgba(245, 158, 11, 0.3);
	}
	.collect-card.answer-delegated-pending .card-accent {
		background: linear-gradient(90deg, #f59e0b, #fbbf24);
	}
	.collect-card.answer-delegated-pending .card-icon {
		color: #d97706;
	}

	.card-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.625rem 0.75rem 0;
	}

	.card-title {
		flex: 1;
		padding: 0.375rem 0.75rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-primary);
		line-height: 1.35;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.card-footer {
		padding: 0 0.75rem 0.625rem;
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
	}
</style>
