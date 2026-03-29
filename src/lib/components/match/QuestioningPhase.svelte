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
		Handshake
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

	// Track if user has manually toggled the answered bills section
	let userToggledAnsweredBills = $state(false);
	// Show answered bills expanded by default when no current question (all answered)
	let showAnsweredBills = $derived(userToggledAnsweredBills ? true : currentQuestion === null);

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
				onSubmitAnswer(vote);
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

	function toggleAnsweredBills() {
		userToggledAnsweredBills = !userToggledAnsweredBills;
	}

	function getAnswerLabel(answer: number): string {
		if (answer === 1) return '賛成';
		if (answer === -1) return '反対';
		return 'わからない';
	}

	function getAnswerClass(answer: number): string {
		if (answer === 1) return 'answer-agree';
		if (answer === -1) return 'answer-disagree';
		return 'answer-neutral';
	}
</script>

<div class="questioning-container" class:detail-open={showDetailPanel}>
	{#if currentQuestion}
		<div class="question-layout" class:expanded={showDetailPanel}>
			<!-- Left: Voting Card -->
			<div class="question-card-wrapper">
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

					<!-- Actions (hide when editing, show cancel instead) -->
					{#if !isEditingAnswer}
						<div class="question-actions">
							{#if isLoggedIn}
								<button
									onclick={openDelegationModal}
									disabled={isLoading}
									class="action-btn-delegate"
								>
									<Handshake size={14} class="inline-icon" /> フレンドに委任
								</button>
							{:else}
								<button onclick={onSkipQuestion} disabled={isLoading} class="action-btn-secondary">
									スキップ →
								</button>
							{/if}
						</div>
					{/if}
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

	<!-- Answered Bills List - always show when not editing, even if no current question -->
	{#if currentClusterAnsweredBills.length > 0 && !isEditingAnswer}
		<div class="answered-bills-section">
			<button class="answered-bills-toggle" onclick={toggleAnsweredBills}>
				<span class="toggle-icon">{showAnsweredBills ? '▼' : '▶'}</span>
				<span>回答済み ({currentClusterAnsweredBills.length}件) - クリックで変更可能</span>
			</button>
			{#if showAnsweredBills}
				<div class="answered-bills-list">
					{#each currentClusterAnsweredBills as bill (bill.billId)}
						<button
							class="answered-bill-item"
							onclick={() => onSelectBillToEdit(bill)}
							disabled={isLoading}
						>
							<div class="answered-bill-content">
								<span class="answered-bill-title">{bill.title}</span>
								<span class={`answered-bill-vote ${getAnswerClass(bill.answer)}`}>
									{getAnswerLabel(bill.answer)}
								</span>
							</div>
							<span class="edit-hint"><Pencil size={12} class="inline-icon" /> 変更</span>
						</button>
					{/each}
				</div>
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

<!-- Delegation Modal -->
{#if currentQuestion}
	<DelegationModal
		show={showDelegationModal}
		billId={currentQuestion.billId}
		billTitle={currentQuestion.title}
		hasExistingVote={currentClusterAnsweredBills.some(
			(b) => b.billId === currentQuestion?.billId && b.answer !== 0
		)}
		onClose={closeDelegationModal}
		onDelegated={handleDelegated}
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
		background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
		border: 2px solid #f59e0b;
		box-shadow: 0 4px 12px rgba(245, 158, 11, 0.2);
	}

	.editing-banner {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: rgba(245, 158, 11, 0.2);
		margin: -2rem -2rem 1.5rem -2rem;
		padding: 0.75rem 1.5rem;
		border-radius: 14px 14px 0 0;
		border-bottom: 1px solid rgba(245, 158, 11, 0.3);
	}

	.editing-banner-text {
		font-weight: 600;
		color: #92400e;
		font-size: 0.95rem;
	}

	.cancel-edit-btn {
		padding: 0.5rem 1rem;
		background: white;
		border: 1px solid #d97706;
		border-radius: 8px;
		font-size: 0.85rem;
		font-weight: 500;
		color: #92400e;
		cursor: pointer;
		transition: all 0.2s;
	}

	.cancel-edit-btn:hover:not(:disabled) {
		background: #fef3c7;
		border-color: #b45309;
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

	/* Answered Bills Section */
	.answered-bills-section {
		margin-top: 1.5rem;
		background: var(--surface-secondary);
		border-radius: 12px;
		overflow: hidden;
	}

	.answered-bills-toggle {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem 1.25rem;
		background: transparent;
		border: none;
		font-size: 0.95rem;
		font-weight: 500;
		color: var(--text-primary);
		cursor: pointer;
		transition: background 0.2s;
	}

	.answered-bills-toggle:hover {
		background: var(--surface-tertiary);
	}

	.toggle-icon {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.answered-bills-list {
		padding: 0 1.25rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.answered-bill-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: var(--surface-primary);
		border-radius: 8px;
		border: 1px solid var(--border-light);
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
		width: 100%;
	}

	.answered-bill-item:hover:not(:disabled) {
		background: #fef3c7;
		border-color: #f59e0b;
		transform: translateX(4px);
	}

	.answered-bill-item:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.answered-bill-content {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
		min-width: 0;
	}

	.answered-bill-title {
		font-size: 0.9rem;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.answered-bill-vote {
		font-size: 0.8rem;
		font-weight: 500;
	}

	.answered-bill-vote.answer-agree {
		color: var(--accent-success);
	}

	.answered-bill-vote.answer-disagree {
		color: var(--accent-error);
	}

	.answered-bill-vote.answer-neutral {
		color: var(--text-secondary);
	}

	.edit-hint {
		font-size: 0.8rem;
		color: var(--text-tertiary);
		opacity: 0;
		transition: opacity 0.2s;
		white-space: nowrap;
	}

	.answered-bill-item:hover .edit-hint {
		opacity: 1;
		color: #92400e;
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

		.answered-bill-item {
			flex-direction: column;
			align-items: flex-start;
		}

		.edit-answer-btn {
			align-self: flex-end;
		}
	}
</style>
