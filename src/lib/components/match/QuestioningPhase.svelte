<script lang="ts">
	import LatentSpaceVisualization from '$lib/components/match/LatentSpaceVisualization.svelte';
	import MemberRankingList from '$lib/components/match/MemberRankingList.svelte';
	import type { Bill, MemberMatch, MemberVectorForViz } from '$lib/types/index.js';

	interface Props {
		currentClusterDisplayName: string | null;
		answeredCount: number;
		currentClusterBillCount: number;
		currentQuestion: Bill | null;
		isLoading: boolean;
		topMatches: MemberMatch[];
		memberVectorsForViz: MemberVectorForViz[];
		explainedVariance: number[];
		xDimension: number;
		yDimension: number;
		userVector: number[];
		userVectorHistory: number[][];
		highlightedMembersForViz: Array<{ memberId: number; similarity: number }>;
		onSubmitAnswer: (vote: number) => void;
		onSkipQuestion: () => void;
		onFinishCluster: () => void;
	}

	let {
		currentClusterDisplayName,
		answeredCount,
		currentClusterBillCount,
		currentQuestion,
		isLoading,
		topMatches,
		memberVectorsForViz,
		explainedVariance,
		xDimension = $bindable(),
		yDimension = $bindable(),
		userVector,
		userVectorHistory,
		highlightedMembersForViz,
		onSubmitAnswer,
		onSkipQuestion,
		onFinishCluster
	}: Props = $props();

	function formatSimilarity(sim: number): string {
		return `${(sim * 100).toFixed(1)}%`;
	}
</script>

<div class="questioning-container">
	{#if currentQuestion}
		<!-- Question Card -->
		<div class="question-card fade-in-up">
			<div class="question-header">
				<span
					class="bill-status"
					class:passed={currentQuestion.passed}
					class:not-passed={!currentQuestion.passed}
				>
					{currentQuestion.passed ? '✓ 成立' : '⏳ 審議中/廃案'}
				</span>
			</div>

			<h2 class="question-title">
				{currentQuestion.title}
			</h2>

			{#if currentQuestion.description}
				<p class="question-description">
					{currentQuestion.description}
				</p>
			{/if}

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

			<!-- Skip / Actions -->
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
		</div>
	{:else}
		<div class="empty-question">
			<p>このクラスターの質問が完了しました</p>
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

	<!-- Member Ranking List - 新規追加 -->
	{#if answeredCount >= 2}
		<MemberRankingList
			{topMatches}
			highlightedMembers={highlightedMembersForViz}
			{userVector}
			memberVectors={memberVectorsForViz}
			{explainedVariance}
			{xDimension}
			{yDimension}
			width={800}
			height={300}
			margin={40}
			radius={6}
			showLegend={true}
			legendPosition="bottom"
			compact={false}
			collapsible={true}
			collapsedLabel="📊 マッチング順位を表示"
			expandedLabel="順位を隠す"
		/>
	{/if}
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
	}

	.question-header {
		display: flex;
		justify-content: flex-start;
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
		color: #6b7280;
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
	}
</style>
