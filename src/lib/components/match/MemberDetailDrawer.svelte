<script lang="ts">
	import { fetchMemberDetail } from '$lib/utils/member-detail-loader.js';
	import type { BaseClusterResult, GlobalMemberScore, MemberDetail } from '$lib/types/index.js';
	import { formatBillRef } from '$lib/types/index.js';
	import { ChevronLeft, X, User, Hourglass, Info } from '@lucide/svelte';

	interface Props {
		selectedMember: { memberId: number; name: string; group: string | null };
		clusterResults: BaseClusterResult[];
		globalScores: GlobalMemberScore[];
		allAnsweredBills: NonNullable<BaseClusterResult['answeredBills']>;
		onClose: () => void;
	}

	let { selectedMember, clusterResults, globalScores, allAnsweredBills, onClose }: Props = $props();

	let memberDetail = $state<MemberDetail | null>(null);
	let memberDetailLoading = $state(false);
	let showPartyDisclaimer = $state(false);
	let showGroupDisclaimer = $state(false);

	let selectedMemberGlobalScore = $derived(
		globalScores.find((m) => m.memberId === selectedMember.memberId)?.globalScore ?? null
	);

	let selectedMemberClusterScores = $derived(
		globalScores.find((m) => m.memberId === selectedMember.memberId)?.clusterScores ?? {}
	);

	$effect(() => {
		memberDetailLoading = true;
		memberDetail = null;
		showPartyDisclaimer = false;
		showGroupDisclaimer = false;

		let billIds: number[] = [];
		for (const cr of clusterResults) {
			if (cr.answeredBills) billIds.push(...cr.answeredBills.map((b) => b.billId));
		}

		fetchMemberDetail(selectedMember.memberId, billIds)
			.then((detail) => {
				memberDetail = detail;
			})
			.catch((err) => {
				console.error('Failed to load member detail:', err);
			})
			.finally(() => {
				memberDetailLoading = false;
			});
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

	/** Portal action: moves the element to document.body so position:fixed works
	 *  even when an ancestor has transform (which creates a containing block). */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div use:portal style="display: contents;">
	<div class="member-detail-overlay" onclick={onClose}></div>
	<div class="member-detail-drawer">
		<div class="drawer-header">
			<button class="drawer-back" onclick={onClose}>
				<ChevronLeft size={16} />
			</button>
			<h3 class="drawer-title">{selectedMember.name}</h3>
			<button class="drawer-close" onclick={onClose}>
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
															→ {#if !memberHasData}<span class="comparison-nodata">データなし</span
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
</div>

<style>
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

	.drawer-score-bar-fill.negative-bg {
		background: #991b1b;
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
</style>
