<script lang="ts">
	import LatentSpaceVisualization from '$lib/components/match/LatentSpaceVisualization.svelte';
	import MemberRankingList from '$lib/components/match/MemberRankingList.svelte';
	import EnrichedBillCard from '$lib/components/match/EnrichedBillCard.svelte';
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
		onFinishCluster: () => void;
		onSelectBillToEdit: (bill: AnsweredBill) => void;
		onCancelEditing: () => void;
	}

	let {
		currentClusterDisplayName,
		answeredCount,
		currentClusterBillCount,
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
		onFinishCluster,
		onSelectBillToEdit,
		onCancelEditing
	}: Props = $props();

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

	function toggleAnsweredBills() {
		userToggledAnsweredBills = !userToggledAnsweredBills;
	}

	function formatSimilarity(sim: number): string {
		return `${(sim * 100).toFixed(1)}%`;
	}

	function getAnswerLabel(answer: number): string {
		if (answer === 1) return '👍 賛成';
		if (answer === -1) return '👎 反対';
		return '🤔 わからない';
	}

	function getAnswerClass(answer: number): string {
		if (answer === 1) return 'answer-agree';
		if (answer === -1) return 'answer-disagree';
		return 'answer-neutral';
	}
</script>

<div class="questioning-container">
	{#if currentQuestion}
		<!-- Question Card with Enriched Bill Information -->
		<div class="question-card fade-in-up" class:editing-mode={isEditingAnswer}>
			{#if isEditingAnswer}
				<div class="editing-banner">
					<span class="editing-banner-text">✏️ 回答を変更中</span>
					<button class="cancel-edit-btn" onclick={onCancelEditing} disabled={isLoading}>
						✕ キャンセル
					</button>
				</div>
			{/if}

			<!-- Enriched Bill Card with expandable details -->
			<EnrichedBillCard
				billId={currentQuestion.billId}
				title={currentQuestion.title}
				description={currentQuestion.description}
				passed={currentQuestion.passed}
				enrichmentData={currentEnrichmentData}
				isLoading={currentEnrichmentLoading}
				onLoadEnrichment={() => loadEnrichment(currentQuestion.billId)}
			/>

			<!-- Vote Buttons -->
			<div class="vote-buttons">
				<button onclick={() => onSubmitAnswer(1)} disabled={isLoading} class="vote-btn vote-agree">
					<span class="vote-emoji">👍</span>
					<span class="vote-label">賛成</span>
				</button>
				<button
					onclick={() => onSubmitAnswer(0)}
					disabled={isLoading}
					class="vote-btn vote-neutral"
				>
					<span class="vote-emoji">🤔</span>
					<span class="vote-label">わからない</span>
				</button>
				<button
					onclick={() => onSubmitAnswer(-1)}
					disabled={isLoading}
					class="vote-btn vote-disagree"
				>
					<span class="vote-emoji">👎</span>
					<span class="vote-label">反対</span>
				</button>
			</div>

			<!-- Skip / Actions (hide skip when editing, show cancel instead) -->
			{#if !isEditingAnswer}
				<div class="question-actions">
					<button onclick={onSkipQuestion} disabled={isLoading} class="action-btn-secondary">
						スキップ →
					</button>
					<button
						onclick={onFinishCluster}
						disabled={isLoading || answeredCount < 2}
						class="action-btn-primary"
					>
						{answeredCount >= 2
							? 'このクラスターを終了'
							: `あと${2 - answeredCount}問回答してください`}
					</button>
				</div>
			{/if}
		</div>
	{:else if !isEditingAnswer}
		<div class="empty-question">
			<p>✅ このクラスターの質問が完了しました</p>
			<p class="empty-question-hint">下の回答済みリストから回答を変更できます</p>
			<div class="empty-question-actions">
				<button onclick={onFinishCluster} disabled={isLoading} class="action-btn-primary">
					{#if isLoading}
						⏳ 読み込み中...
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
					{#each currentClusterAnsweredBills as bill}
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
							<span class="edit-hint">✏️ 変更</span>
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

<style>
	/* Container */
	.questioning-container {
		max-width: 800px;
		margin: 0 auto;
	}

	/* Cluster Info - removed, using parent progress */

	/* Question Card */
	.question-card {
		background: white;
		border-radius: 16px;
		padding: 2rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
		margin-bottom: 1.5rem;
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
		margin-bottom: 1.5rem;
	}

	.vote-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem 1rem;
		border: 2px solid transparent;
		border-radius: 16px;
		background: #f9fafb;
		cursor: pointer;
		transition: all 0.3s ease;
		font-weight: 600;
	}

	.vote-btn:hover:not(:disabled) {
		transform: translateY(-4px);
		box-shadow: 0 12px 24px rgba(0, 0, 0, 0.1);
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
		font-size: 2.5rem;
	}

	.vote-label {
		font-size: 1rem;
		color: #374151;
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
