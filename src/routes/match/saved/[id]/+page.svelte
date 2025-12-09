<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types.js';
	import type {
		SavedSessionWithDetails,
		GlobalMemberScore,
		ResultSnapshotData
	} from '$lib/types/index.js';

	let { data }: { data: PageData } = $props();

	let session: SavedSessionWithDetails = $state(data.session);
	let mounted: boolean = $state(false);
	let activeTab: 'results' | 'clusters' | 'snapshots' | 'answers' = $state('results');
	let selectedClusterLabel: number | null = $state(null);
	let error: string | null = $state(null);
	let isNavigating: boolean = $state(false);

	// Snapshot viewing state
	let selectedSnapshotId: number | null = $state(null);
	let viewingSnapshot: ResultSnapshotData | null = $state(null);

	async function navigateToResume() {
		isNavigating = true;
		await goto(`/match?resume=${session.id}`);
	}

	// Get sorted global scores - from selected snapshot or current session
	let topGlobalScores = $derived.by(() => {
		if (viewingSnapshot) {
			return (viewingSnapshot.globalScores || []).slice(0, 20);
		}
		return (session.globalScores || []).slice(0, 20);
	});

	// Get cluster results sorted by label - from selected snapshot or current session
	let sortedClusterResults = $derived.by(() => {
		if (viewingSnapshot && viewingSnapshot.clusterResults) {
			return [...viewingSnapshot.clusterResults].sort(
				(a: any, b: any) => a.clusterLabel - b.clusterLabel
			);
		}
		return [...session.clusterResults].sort((a, b) => a.clusterLabel - b.clusterLabel);
	});

	// Get selected cluster result
	let selectedClusterResult = $derived.by(() => {
		if (selectedClusterLabel === null) return null;

		if (viewingSnapshot && viewingSnapshot.clusterResults) {
			return viewingSnapshot.clusterResults.find(
				(cr: any) => cr.clusterLabel === selectedClusterLabel
			);
		}
		return session.clusterResults.find((cr) => cr.clusterLabel === selectedClusterLabel);
	});

	// Calculate remaining bills
	let remainingBills = $derived(session.totalBills - session.totalAnswered);

	// Select a snapshot to view its details
	function selectSnapshot(snapshot: ResultSnapshotData | null) {
		if (snapshot) {
			selectedSnapshotId = snapshot.id;
			viewingSnapshot = snapshot;
			// Switch to results tab to show the snapshot data
			activeTab = 'results';
		} else {
			selectedSnapshotId = null;
			viewingSnapshot = null;
		}
	}

	// Clear snapshot view and show current results
	function viewCurrentResults() {
		selectedSnapshotId = null;
		viewingSnapshot = null;
	}

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString('ja-JP', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatSimilarity(sim: number): string {
		return (sim * 100).toFixed(1) + '%';
	}

	function getSimilarityColor(sim: number): string {
		if (sim >= 0.8) return 'text-green-600';
		if (sim >= 0.6) return 'text-blue-600';
		if (sim >= 0.4) return 'text-yellow-600';
		return 'text-red-600';
	}

	function getStars(count: number): string {
		return '★'.repeat(count) + '☆'.repeat(5 - count);
	}

	function getAnswerLabel(answer: number): string {
		if (answer === 1) return '賛成';
		if (answer === -1) return '反対';
		return 'スキップ';
	}

	function getAnswerClass(answer: number): string {
		if (answer === 1) return 'answer-agree';
		if (answer === -1) return 'answer-disagree';
		return 'answer-skip';
	}

	onMount(() => {
		setTimeout(() => {
			mounted = true;
		}, 100);
	});
</script>

<svelte:head>
	<title>{session.name} | 保存済み結果</title>
</svelte:head>

<div class="page" class:mounted>
	<header class="page-header">
		<div class="container">
			<div class="breadcrumb">
				<a href="/match/saved" class="breadcrumb-link">📋 保存済み結果</a>
				<span class="breadcrumb-sep">/</span>
				<span class="breadcrumb-current">{session.name}</span>
			</div>

			<div class="header-content">
				<div>
					<h1 class="page-title">{session.name}</h1>
					{#if session.description}
						<p class="page-subtitle">{session.description}</p>
					{/if}
					<div class="session-meta">
						<span class="meta-item">
							<span class="meta-label">作成日:</span>
							{formatDate(session.createdAt)}
						</span>
						<span class="meta-divider">|</span>
						<span class="meta-item">
							<span class="meta-label">回答:</span>
							{session.totalAnswered}/{session.totalBills}
						</span>
						<span class="meta-divider">|</span>
						<span class="meta-item">
							<span class="meta-label">スナップショット:</span>
							{session.snapshots.length}件
						</span>
					</div>
				</div>

				<div class="header-actions">
					{#if remainingBills > 0}
						<button class="btn-continue" onclick={navigateToResume} disabled={isNavigating}>
							{#if isNavigating}
								<span>⏳</span>
								読み込み中...
							{:else}
								<span>➕</span>
								追加回答 ({remainingBills}件)
							{/if}
						</button>
					{/if}
				</div>
			</div>
		</div>
	</header>

	<main class="main-container">
		{#if error}
			<div class="error-alert animate-in">
				<div class="error-icon">⚠️</div>
				<div>
					<span class="error-title">エラー</span>
					<p class="error-message">{error}</p>
				</div>
				<button class="close-btn" onclick={() => (error = null)}>×</button>
			</div>
		{/if}

		<!-- Snapshot viewing banner -->
		{#if viewingSnapshot}
			<div class="snapshot-banner animate-in">
				<div class="snapshot-banner-content">
					<span class="snapshot-banner-icon">📸</span>
					<span class="snapshot-banner-text">
						スナップショット「{viewingSnapshot.name ||
							`#${viewingSnapshot.snapshotNumber}`}」を表示中
						<span class="snapshot-banner-date">({formatDate(viewingSnapshot.createdAt)})</span>
					</span>
				</div>
				<button class="snapshot-banner-close" onclick={viewCurrentResults}>
					最新の結果を表示
				</button>
			</div>
		{/if}

		<!-- Tabs -->
		<div class="tabs animate-in" style="--delay: 0">
			<button
				class="tab-btn"
				class:active={activeTab === 'results'}
				onclick={() => (activeTab = 'results')}
			>
				🏆 総合結果
			</button>
			<button
				class="tab-btn"
				class:active={activeTab === 'clusters'}
				onclick={() => (activeTab = 'clusters')}
			>
				📊 分野別
			</button>
			<button
				class="tab-btn"
				class:active={activeTab === 'answers'}
				onclick={() => (activeTab = 'answers')}
			>
				📝 回答履歴
			</button>
			<button
				class="tab-btn"
				class:active={activeTab === 'snapshots'}
				onclick={() => (activeTab = 'snapshots')}
			>
				📸 スナップショット ({session.snapshots.length})
			</button>
		</div>

		<!-- Results Tab -->
		{#if activeTab === 'results'}
			<section class="results-section animate-in" style="--delay: 1">
				<h2 class="section-title">🏆 総合マッチング結果</h2>

				{#if topGlobalScores.length === 0}
					<div class="empty-state-small">
						<p>まだ結果がありません。質問に回答してください。</p>
					</div>
				{:else}
					<div class="results-list">
						{#each topGlobalScores as member, idx (member.memberId)}
							<div class="result-item" class:top={idx < 3}>
								<div
									class="rank-badge"
									class:gold={idx === 0}
									class:silver={idx === 1}
									class:bronze={idx === 2}
								>
									{idx + 1}
								</div>
								<div class="member-info">
									<span class="member-name">{member.name}</span>
									{#if member.group}
										<span class="member-group">{member.group}</span>
									{/if}
								</div>
								<div class="member-score {getSimilarityColor(member.globalScore)}">
									{formatSimilarity(member.globalScore)}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		{/if}

		<!-- Clusters Tab -->
		{#if activeTab === 'clusters'}
			<section class="clusters-section animate-in" style="--delay: 1">
				<h2 class="section-title">📊 分野別結果</h2>

				<div class="clusters-grid">
					{#each sortedClusterResults as result (result.clusterLabel)}
						<button
							class="cluster-card"
							class:selected={selectedClusterLabel === result.clusterLabel}
							onclick={() =>
								(selectedClusterLabel =
									selectedClusterLabel === result.clusterLabel ? null : result.clusterLabel)}
						>
							<div class="cluster-header">
								<span class="cluster-name">
									{result.clusterLabelName || `クラスター${result.clusterLabel}`}
								</span>
								<span class="cluster-importance" title="重要度">
									{getStars(result.importance)}
								</span>
							</div>
							<div class="cluster-stats">
								<span>回答: {result.answeredCount}件</span>
							</div>
							{#if result.matches.length > 0}
								<div class="cluster-top-match">
									<span class="top-label">1位:</span>
									<span class="top-name">{result.matches[0].name}</span>
									<span class="top-score {getSimilarityColor(result.matches[0].similarity)}">
										{formatSimilarity(result.matches[0].similarity)}
									</span>
								</div>
							{/if}
						</button>
					{/each}
				</div>

				{#if selectedClusterResult}
					<div class="cluster-detail">
						<h3 class="detail-title">
							{selectedClusterResult.clusterLabelName ||
								`クラスター${selectedClusterResult.clusterLabel}`}
							の結果
						</h3>

						<div class="detail-matches">
							{#each selectedClusterResult.matches.slice(0, 10) as match, idx (match.memberId)}
								<div class="match-row">
									<span class="match-rank">{idx + 1}</span>
									<span class="match-name">{match.name}</span>
									{#if match.group}
										<span class="match-group">{match.group}</span>
									{/if}
									<span class="match-score {getSimilarityColor(match.similarity)}">
										{formatSimilarity(match.similarity)}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</section>
		{/if}

		<!-- Answers Tab -->
		{#if activeTab === 'answers'}
			<section class="answers-section animate-in" style="--delay: 1">
				<h2 class="section-title">📝 回答履歴</h2>

				{#each sortedClusterResults as result (result.clusterLabel)}
					{@const answeredBills = result.answeredBills || []}
					{#if answeredBills.length > 0}
						<div class="answer-cluster">
							<h3 class="answer-cluster-title">
								{result.clusterLabelName || `クラスター${result.clusterLabel}`}
							</h3>
							<div class="answers-list">
								{#each answeredBills as bill (bill.billId)}
									<div class="answer-item">
										<span class="answer-badge {getAnswerClass(bill.answer)}">
											{getAnswerLabel(bill.answer)}
										</span>
										<span class="answer-title">{bill.title}</span>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/each}

				{#if viewingSnapshot ? viewingSnapshot.totalAnswered === 0 : session.totalAnswered === 0}
					<div class="empty-state-small">
						<p>まだ回答がありません。</p>
					</div>
				{/if}
			</section>
		{/if}

		<!-- Snapshots Tab -->
		{#if activeTab === 'snapshots'}
			<section class="snapshots-section animate-in" style="--delay: 1">
				<h2 class="section-title">📸 スナップショット履歴</h2>

				{#if session.snapshots.length === 0}
					<div class="empty-state-small">
						<p>まだスナップショットがありません。追加回答を行うと自動的に作成されます。</p>
					</div>
				{:else}
					<div class="snapshots-list">
						{#each session.snapshots as snapshot (snapshot.id)}
							<div class="snapshot-card" class:selected={selectedSnapshotId === snapshot.id}>
								<div class="snapshot-header">
									<span class="snapshot-number">#{snapshot.snapshotNumber}</span>
									<span class="snapshot-name"
										>{snapshot.name || `スナップショット ${snapshot.snapshotNumber}`}</span
									>
									<span class="snapshot-date">{formatDate(snapshot.createdAt)}</span>
								</div>
								<div class="snapshot-stats">
									<span>回答数: {snapshot.totalAnswered}件</span>
								</div>
								<div class="snapshot-top">
									<span class="top-label">トップ3:</span>
									<div class="snapshot-top-list">
										{#each snapshot.globalScores.slice(0, 3) as score, idx (score.memberId)}
											<span class="snapshot-member">
												{idx + 1}. {score.name} ({formatSimilarity(score.globalScore)})
											</span>
										{/each}
									</div>
								</div>
								<div class="snapshot-actions">
									<button
										class="btn-view-snapshot"
										onclick={() => selectSnapshot(snapshot)}
										class:active={selectedSnapshotId === snapshot.id}
									>
										{#if selectedSnapshotId === snapshot.id}
											✓ 表示中
										{:else}
											📊 詳細を見る
										{/if}
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	</main>
</div>

<style>
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

	.page {
		min-height: 100vh;
		background: #fafbfc;
	}

	.animate-in {
		opacity: 0;
		transform: translateY(20px);
	}

	.page.mounted .animate-in {
		animation: fadeInUp 0.6s ease forwards;
		animation-delay: calc(var(--delay, 0) * 0.1s);
	}

	.page-header {
		background: white;
		border-bottom: 1px solid #e5e7eb;
		padding: 1.5rem 0 2rem;
	}

	.container {
		max-width: 1024px;
		margin: 0 auto;
		padding: 0 1rem;
	}

	.breadcrumb {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		margin-bottom: 1rem;
	}

	.breadcrumb-link {
		color: #6366f1;
		text-decoration: none;
	}

	.breadcrumb-link:hover {
		text-decoration: underline;
	}

	.breadcrumb-sep {
		color: #d1d5db;
	}

	.breadcrumb-current {
		color: #6b7280;
	}

	.header-content {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.page-title {
		font-size: 1.75rem;
		font-weight: 700;
		color: #1a1a2e;
		margin-bottom: 0.25rem;
	}

	.page-subtitle {
		color: #6b7280;
		font-size: 1rem;
		margin-bottom: 0.5rem;
	}

	.session-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: #6b7280;
		flex-wrap: wrap;
	}

	.meta-label {
		font-weight: 600;
	}

	.meta-divider {
		color: #e5e7eb;
	}

	.header-actions {
		display: flex;
		gap: 0.75rem;
	}

	.btn-continue {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem;
		background: linear-gradient(135deg, #10b981, #059669);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-continue:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
	}

	.btn-continue:disabled {
		opacity: 0.7;
		cursor: not-allowed;
		transform: none;
	}

	.btn-snapshot {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem;
		background: #f3f4f6;
		color: #4b5563;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-snapshot:hover {
		background: #e5e7eb;
	}

	.main-container {
		max-width: 1024px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	/* Error Alert */
	.error-alert {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		background: linear-gradient(135deg, #fee2e2, #fecaca);
		border: 1px solid #fca5a5;
		border-radius: 12px;
		padding: 1rem 1.5rem;
		margin-bottom: 1.5rem;
		position: relative;
	}

	.error-icon {
		font-size: 1.5rem;
	}

	.error-title {
		display: block;
		font-weight: 700;
		color: #991b1b;
		margin-bottom: 0.25rem;
	}

	.error-message {
		color: #7f1d1d;
		font-size: 0.95rem;
	}

	.close-btn {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		background: none;
		border: none;
		font-size: 1.25rem;
		color: #991b1b;
		cursor: pointer;
	}

	/* Tabs */
	.tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 2rem;
		flex-wrap: wrap;
	}

	.tab-btn {
		padding: 0.75rem 1.25rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-weight: 600;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.tab-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.tab-btn:hover:not(:disabled) {
		border-color: #c4b5fd;
		color: #6366f1;
	}

	.tab-btn.active {
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		border-color: transparent;
		color: white;
	}

	/* Sections */
	.section-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 1.5rem;
	}

	/* Results */
	.results-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.result-item {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem;
		background: white;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
	}

	.result-item.top {
		border-color: #c4b5fd;
		background: linear-gradient(135deg, #faf5ff, #f3e8ff);
	}

	.rank-badge {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #f3f4f6;
		border-radius: 50%;
		font-weight: 700;
		font-size: 0.9rem;
		color: #6b7280;
	}

	.rank-badge.gold {
		background: linear-gradient(135deg, #fbbf24, #f59e0b);
		color: white;
	}

	.rank-badge.silver {
		background: linear-gradient(135deg, #9ca3af, #6b7280);
		color: white;
	}

	.rank-badge.bronze {
		background: linear-gradient(135deg, #d97706, #b45309);
		color: white;
	}

	.member-info {
		flex: 1;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.member-name {
		font-weight: 600;
		color: #1f2937;
	}

	.member-group {
		font-size: 0.85rem;
		color: #6b7280;
	}

	.member-score {
		font-size: 1.125rem;
		font-weight: 700;
	}

	.text-green-600 {
		color: #059669;
	}
	.text-blue-600 {
		color: #2563eb;
	}
	.text-yellow-600 {
		color: #d97706;
	}
	.text-red-600 {
		color: #dc2626;
	}

	/* Clusters */
	.clusters-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.cluster-card {
		padding: 1rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		text-align: left;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.cluster-card:hover {
		border-color: #c4b5fd;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
	}

	.cluster-card.selected {
		border-color: #6366f1;
		background: linear-gradient(135deg, #eef2ff, #e0e7ff);
	}

	.cluster-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.cluster-name {
		font-weight: 700;
		color: #1f2937;
	}

	.cluster-importance {
		color: #f59e0b;
		font-size: 0.85rem;
	}

	.cluster-stats {
		font-size: 0.85rem;
		color: #6b7280;
		margin-bottom: 0.5rem;
	}

	.cluster-top-match {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}

	.top-label {
		color: #6b7280;
	}

	.top-name {
		font-weight: 600;
		color: #1f2937;
	}

	.top-score {
		font-weight: 700;
		margin-left: auto;
	}

	.cluster-detail {
		background: white;
		border-radius: 12px;
		padding: 1.5rem;
		border: 1px solid #e5e7eb;
	}

	.detail-title {
		font-size: 1.125rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 1rem;
	}

	.detail-matches {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.match-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem;
		background: #f9fafb;
		border-radius: 6px;
	}

	.match-rank {
		width: 24px;
		font-weight: 700;
		color: #6b7280;
		text-align: center;
	}

	.match-name {
		font-weight: 600;
		color: #1f2937;
	}

	.match-group {
		font-size: 0.85rem;
		color: #6b7280;
	}

	.match-score {
		margin-left: auto;
		font-weight: 700;
	}

	/* Answers */
	.answer-cluster {
		margin-bottom: 2rem;
	}

	.answer-cluster-title {
		font-size: 1rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 0.75rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.answers-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.answer-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem;
		background: white;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
	}

	.answer-badge {
		padding: 0.25rem 0.75rem;
		border-radius: 100px;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.answer-agree {
		background: #d1fae5;
		color: #065f46;
	}

	.answer-disagree {
		background: #fee2e2;
		color: #991b1b;
	}

	.answer-skip {
		background: #f3f4f6;
		color: #6b7280;
	}

	.answer-title {
		color: #1f2937;
		font-size: 0.95rem;
	}

	/* Snapshots */
	.snapshots-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.snapshot-card {
		padding: 1.25rem;
		background: white;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
	}

	.snapshot-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
		flex-wrap: wrap;
	}

	.snapshot-number {
		background: #6366f1;
		color: white;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.snapshot-name {
		font-weight: 700;
		color: #1f2937;
	}

	.snapshot-date {
		margin-left: auto;
		font-size: 0.85rem;
		color: #6b7280;
	}

	.snapshot-stats {
		font-size: 0.9rem;
		color: #6b7280;
		margin-bottom: 0.75rem;
	}

	.snapshot-top {
		padding: 0.75rem;
		background: #f9fafb;
		border-radius: 8px;
	}

	.snapshot-top-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-top: 0.5rem;
	}

	.snapshot-member {
		font-size: 0.9rem;
		color: #1f2937;
	}

	.snapshot-card.selected {
		border-color: #6366f1;
		box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
	}

	.snapshot-actions {
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid #e5e7eb;
	}

	.btn-view-snapshot {
		width: 100%;
		padding: 0.5rem 1rem;
		background: #f3f4f6;
		color: #374151;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-view-snapshot:hover {
		background: #e5e7eb;
	}

	.btn-view-snapshot.active {
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border-color: transparent;
	}

	/* Snapshot viewing banner */
	.snapshot-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: linear-gradient(135deg, #fef3c7, #fde68a);
		border: 1px solid #f59e0b;
		border-radius: 8px;
		margin-bottom: 1rem;
	}

	.snapshot-banner-content {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.snapshot-banner-icon {
		font-size: 1.2rem;
	}

	.snapshot-banner-text {
		font-weight: 600;
		color: #92400e;
	}

	.snapshot-banner-date {
		font-weight: 400;
		opacity: 0.8;
	}

	.snapshot-banner-close {
		padding: 0.375rem 0.75rem;
		background: white;
		color: #92400e;
		border: 1px solid #f59e0b;
		border-radius: 6px;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		white-space: nowrap;
	}

	.snapshot-banner-close:hover {
		background: #fef3c7;
	}

	/* Empty State */
	.empty-state-small {
		text-align: center;
		padding: 2rem;
		background: white;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
		color: #6b7280;
	}

	.btn-primary-small {
		margin-top: 1rem;
		padding: 0.5rem 1rem;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
	}

	/* Modal */
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
		max-width: 400px;
		border-radius: 16px;
		padding: 2rem;
		position: relative;
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
	}

	.modal-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
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

	.btn-primary {
		padding: 0.75rem 1.25rem;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	@media (max-width: 640px) {
		.header-content {
			flex-direction: column;
		}

		.header-actions {
			width: 100%;
			flex-direction: column;
		}

		.session-meta {
			flex-direction: column;
			gap: 0.25rem;
		}

		.meta-divider {
			display: none;
		}

		.snapshot-date {
			margin-left: 0;
			width: 100%;
		}
	}
</style>
