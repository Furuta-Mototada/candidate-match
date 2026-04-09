<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import {
		getAnswerLabel as baseAnswerLabel,
		getAnswerClass as baseAnswerClass
	} from '$lib/utils/vote-helpers.js';
	import LatentSpaceVisualization from '$lib/components/match/LatentSpaceVisualization.svelte';
	import type { ClusterResult, BaseClusterResult } from '$lib/types/index.js';
	import { formatBillRef } from '$lib/types/index.js';
	import { ThumbsUp, ThumbsDown, CircleQuestionMark, Handshake } from '@lucide/svelte';

	interface Props {
		clusterResults: BaseClusterResult[];
		onMemberClick: (m: { memberId: number; name: string; group: string | null }) => void;
	}

	let { clusterResults, onMemberClick }: Props = $props();

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

	// Track which clusters have expanded bill lists
	let expandedBillClusters = new SvelteSet<number>();

	function getStars(importance: number): string {
		return '★'.repeat(importance) + '☆'.repeat(5 - importance);
	}

	function getAnswerText(score: number, source?: 'direct' | 'delegated'): string {
		return baseAnswerLabel(score, { source, skipLabel: 'どちらでもない' });
	}

	function getAnswerColor(score: number, source?: 'direct' | 'delegated'): string {
		if (source === 'delegated') return 'answer-delegated';
		return baseAnswerClass(score);
	}
</script>

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
										onMemberClick={(m) => onMemberClick(m)}
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
											<span class="bill-card-badge {getAnswerColor(bill.answer, bill.source)}">
												{getAnswerText(bill.answer, bill.source)}
											</span>
											{#if formatBillRef(bill.billType, bill.submissionSession, bill.billNumber)}
												<span class="bill-card-ref">
													{formatBillRef(bill.billType, bill.submissionSession, bill.billNumber)}
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
										if (isExpanded) expandedBillClusters.delete(result.clusterLabel);
										else expandedBillClusters.add(result.clusterLabel);
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

<style>
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

	.viz-container-flush {
		width: 100%;
		overflow: hidden;
	}

	/* Bill Collection Cards */
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

	.fade-in {
		animation: fadeIn 0.4s ease both;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (max-width: 768px) {
		.cluster-content-grid {
			grid-template-columns: 1fr;
		}
		.bill-collection-grid {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
