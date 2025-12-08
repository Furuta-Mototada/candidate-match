<script lang="ts">
	import LatentSpaceVisualization from '$lib/components/LatentSpaceVisualization.svelte';
	import type { Bill, MemberMatch, MemberVectorForViz } from '$lib/types/index.js';

	interface Props {
		currentClusterDisplayName: string | null;
		answeredCount: number;
		currentClusterBillCount: number;
		confidence: number;
		currentQuestion: Bill | null;
		isLoading: boolean;
		topMatches: MemberMatch[];
		memberVectorsForViz: MemberVectorForViz[];
		showVisualization: boolean;
		explainedVariance: number[];
		xDimension: number;
		yDimension: number;
		userVector: number[];
		userVectorHistory: number[][];
		highlightedMembersForViz: Array<{ memberId: number; similarity: number }>;
		onSubmitAnswer: (vote: number) => void;
		onSkipQuestion: () => void;
		onFinishCluster: () => void;
		onToggleVisualization: (show: boolean) => void;
	}

	let {
		currentClusterDisplayName,
		answeredCount,
		currentClusterBillCount,
		confidence,
		currentQuestion,
		isLoading,
		topMatches,
		memberVectorsForViz,
		showVisualization = $bindable(),
		explainedVariance,
		xDimension = $bindable(),
		yDimension = $bindable(),
		userVector,
		userVectorHistory,
		highlightedMembersForViz,
		onSubmitAnswer,
		onSkipQuestion,
		onFinishCluster,
		onToggleVisualization
	}: Props = $props();

	function formatSimilarity(sim: number): string {
		return `${(sim * 100).toFixed(1)}%`;
	}
</script>

<div class="questioning-container">
	<div class="cluster-info-card">
		<h2 class="cluster-info-title">
			📂 {currentClusterDisplayName || 'クラスター'}
		</h2>
		<div class="cluster-stats">
			<span class="stat-item">
				<span class="stat-label">回答済み</span>
				<span class="stat-value">{answeredCount}/{currentClusterBillCount}</span>
			</span>
			<span class="stat-divider">•</span>
			<span class="stat-item">
				<span class="stat-label">信頼度</span>
				<span class="stat-value">{confidence.toFixed(0)}%</span>
			</span>
		</div>
	</div>

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
			<h3 class="preview-title">暫定マッチング TOP3</h3>
			<div class="preview-list">
				{#each topMatches.slice(0, 3) as match, idx (match.memberId)}
					<div class="preview-item">
						<span class="preview-rank">{idx + 1}</span>
						<span class="preview-name">{match.name}</span>
						<span
							class="preview-score"
							class:high={match.similarity >= 0.7}
							class:medium={match.similarity >= 0.5 && match.similarity < 0.7}
							class:low={match.similarity < 0.5}
						>
							{formatSimilarity(match.similarity)}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- 2D Position Visualization -->
	{#if memberVectorsForViz.length > 0 && showVisualization}
		<div class="position-viz">
			<div class="viz-top">
				<h3 class="viz-heading">📍 あなたの位置</h3>
				<button onclick={() => onToggleVisualization(false)} class="viz-close" title="閉じる">
					✕
				</button>
			</div>

			<LatentSpaceVisualization
				members={memberVectorsForViz}
				{explainedVariance}
				bind:xDimension
				bind:yDimension
				{userVector}
				{userVectorHistory}
				highlightedMembers={highlightedMembersForViz}
				width={600}
				height={450}
				showDimensionSelectors={userVector.length > 2}
				title=""
				showLegend={true}
				compact={false}
			/>

			<!-- Position info -->
			{#if answeredCount > 0 && userVector.length > 0 && userVector.some((v) => v !== 0)}
				<div class="viz-position active">
					<span class="pos-label">現在位置:</span>
					<span class="pos-value">
						[{userVector
							.slice(0, 3)
							.map((v) => v.toFixed(2))
							.join(', ')}{userVector.length > 3 ? '...' : ''}]
					</span>
					{#if userVectorHistory.length > 0}
						<span class="pos-moves">
							({userVectorHistory.length}回移動)
						</span>
					{/if}
				</div>
			{:else if answeredCount === 0}
				<div class="viz-position inactive">質問に回答すると、あなたの位置が可視化されます</div>
			{/if}
		</div>
	{:else if memberVectorsForViz.length > 0 && !showVisualization}
		<button onclick={() => onToggleVisualization(true)} class="show-viz-toggle">
			📍 可視化を表示
		</button>
	{/if}
</div>

<style>
	/* Container */
	.questioning-container {
		max-width: 800px;
		margin: 0 auto;
	}

	/* Cluster Info */
	.cluster-info-card {
		background: linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, rgba(168, 85, 247, 0.05) 100%);
		border-radius: 16px;
		padding: 1.5rem;
		margin-bottom: 2rem;
		border: 1px solid rgba(99, 102, 241, 0.2);
	}

	.cluster-info-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 0.75rem;
		text-align: center;
	}

	.cluster-stats {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 1rem;
		font-size: 0.875rem;
	}

	.stat-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
	}

	.stat-label {
		color: #6b7280;
		font-weight: 500;
	}

	.stat-value {
		color: #6366f1;
		font-weight: 700;
		font-size: 1.125rem;
	}

	.stat-divider {
		color: #d1d5db;
		font-size: 1.25rem;
	}

	/* Question Card */
	.question-card {
		background: white;
		border-radius: 20px;
		padding: 2.5rem;
		box-shadow:
			0 10px 40px rgba(0, 0, 0, 0.08),
			0 1px 3px rgba(0, 0, 0, 0.05);
		border: 1px solid #e5e7eb;
		margin-bottom: 2rem;
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

	/* Matches Preview */
	.matches-preview {
		margin: 2rem 0;
		padding: 1.5rem;
		background: linear-gradient(135deg, rgba(16, 185, 129, 0.05) 0%, rgba(5, 150, 105, 0.05) 100%);
		border-radius: 16px;
		border: 1px solid rgba(16, 185, 129, 0.2);
	}

	.preview-title {
		font-size: 1.125rem;
		font-weight: 600;
		color: #047857;
		margin-bottom: 1rem;
		text-align: center;
	}

	.preview-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.preview-item {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.875rem 1rem;
		background: white;
		border-radius: 10px;
		transition: all 0.3s ease;
	}

	.preview-item:hover {
		transform: translateX(4px);
		box-shadow: 0 4px 8px rgba(16, 185, 129, 0.15);
	}

	.preview-rank {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		background: linear-gradient(135deg, #10b981 0%, #059669 100%);
		color: white;
		border-radius: 50%;
		font-weight: 700;
		font-size: 0.875rem;
		flex-shrink: 0;
	}

	.preview-name {
		flex: 1;
		font-weight: 600;
		color: #1f2937;
	}

	.preview-score {
		font-weight: 700;
		font-size: 1rem;
		flex-shrink: 0;
	}

	.preview-score.high {
		color: #10b981;
	}

	.preview-score.medium {
		color: #3b82f6;
	}

	.preview-score.low {
		color: #ef4444;
	}

	/* Position Visualization */
	.position-viz {
		margin: 3rem 0;
		padding: 2rem;
		background: linear-gradient(135deg, rgba(99, 102, 241, 0.02) 0%, rgba(168, 85, 247, 0.02) 100%);
		border-radius: 20px;
		border: 2px solid rgba(99, 102, 241, 0.15);
	}

	.viz-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 2rem;
	}

	.viz-heading {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1f2937;
		background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.viz-close {
		background: rgba(239, 68, 68, 0.1);
		color: #dc2626;
		border: none;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
		cursor: pointer;
		font-size: 1.125rem;
		font-weight: 600;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.viz-close:hover {
		background: rgba(239, 68, 68, 0.2);
		transform: rotate(90deg);
	}

	.viz-position {
		margin-top: 1.5rem;
		padding: 1rem 1.5rem;
		border-radius: 12px;
		font-size: 0.9375rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.viz-position.active {
		background: linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(16, 185, 129, 0.1) 100%);
		border: 1px solid rgba(34, 197, 94, 0.3);
	}

	.viz-position.inactive {
		background: rgba(249, 250, 251, 0.8);
		border: 1px solid rgba(229, 231, 235, 0.5);
		color: #9ca3af;
		justify-content: center;
	}

	.pos-label {
		font-weight: 600;
		color: #047857;
	}

	.pos-value {
		font-family: 'Monaco', 'Courier New', monospace;
		color: #059669;
		font-weight: 500;
	}

	.pos-moves {
		color: #6b7280;
		font-size: 0.875rem;
	}

	.show-viz-toggle {
		display: block;
		margin: 2rem auto;
		background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
		color: white;
		border: none;
		padding: 0.875rem 2rem;
		border-radius: 12px;
		cursor: pointer;
		font-size: 1rem;
		font-weight: 600;
		transition: all 0.3s ease;
		box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.3);
	}

	.show-viz-toggle:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 12px -2px rgba(99, 102, 241, 0.4);
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
