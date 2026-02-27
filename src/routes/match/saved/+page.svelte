<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types.js';
	import type { SnapshotListItem, AnsweredBill } from '$lib/types/index.js';

	let { data }: { data: PageData } = $props();

	let snapshots: SnapshotListItem[] = $state(data.snapshots || []);
	let answers: AnsweredBill[] = $state(data.answers || []);
	let totalAnswers: number = $state(data.totalAnswers || 0);
	let isLoading: boolean = $state(false);
	let error: string | null = $state(null);
	let mounted: boolean = $state(false);
	let activeTab: 'snapshots' | 'answers' = $state('snapshots');

	// Delete confirmation
	let deleteConfirmId: number | null = $state(null);

	async function navigateToSnapshot(snapshotId: number) {
		isLoading = true;
		await goto(`/match/saved/${snapshotId}`);
	}

	async function deleteSnapshot(snapshotId: number) {
		isLoading = true;
		error = null;

		try {
			const response = await fetch('/api/saved-sessions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'delete',
					snapshotId
				})
			});

			const result = await response.json();

			if (!response.ok || !result.success) {
				throw new Error(result.error || '削除に失敗しました');
			}

			snapshots = snapshots.filter((s) => s.id !== snapshotId);
			deleteConfirmId = null;
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
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
	<title>保存済み結果 | Candidate Match</title>
</svelte:head>

<div class="page" class:mounted>
	<header class="page-header">
		<div class="container">
			<div class="header-content">
				<div>
					<h1 class="page-title">📋 保存済みデータ</h1>
					<p class="page-subtitle">スナップショットや回答履歴を確認できます</p>
				</div>
				<a href="/match" class="btn-primary">
					<span>🗳️</span>
					マッチングへ
				</a>
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
			</div>
		{/if}

		<!-- Tabs -->
		<div class="tabs animate-in" style="--delay: 0">
			<button
				class="tab-btn"
				class:active={activeTab === 'snapshots'}
				onclick={() => (activeTab = 'snapshots')}
			>
				📸 スナップショット ({snapshots.length})
			</button>
			<button
				class="tab-btn"
				class:active={activeTab === 'answers'}
				onclick={() => (activeTab = 'answers')}
			>
				📝 回答履歴 ({totalAnswers})
			</button>
		</div>

		<!-- Snapshots Tab -->
		{#if activeTab === 'snapshots'}
			{#if snapshots.length === 0}
				<div class="empty-state animate-in" style="--delay: 1">
					<div class="empty-icon">📭</div>
					<h2 class="empty-title">スナップショットがありません</h2>
					<p class="empty-desc">マッチングでスナップショットを保存すると、ここに表示されます。</p>
					<a href="/match" class="btn-primary"> マッチングへ </a>
				</div>
			{:else}
				<div class="snapshots-grid">
					{#each snapshots as snapshot, idx (snapshot.id)}
						<article class="snapshot-card animate-in" style="--delay: {idx + 1}">
							<div class="snapshot-header">
								<div class="snapshot-meta">
									<span class="snapshot-date">{formatDate(snapshot.createdAt)}</span>
								</div>
								<h3 class="snapshot-name">{snapshot.name}</h3>
							</div>

							<div class="snapshot-stats">
								<div class="stat-row">
									<span class="stat-label">回答数</span>
									<span class="stat-value">{snapshot.totalAnswered}件</span>
								</div>
								{#if snapshot.topMatch}
									<div class="stat-row">
										<span class="stat-label">トップマッチ</span>
										<span class="stat-value">
											{snapshot.topMatch.name} ({formatSimilarity(snapshot.topMatch.score)})
										</span>
									</div>
								{/if}
							</div>

							<div class="snapshot-actions">
								<button
									class="btn-view"
									onclick={() => navigateToSnapshot(snapshot.id)}
									disabled={isLoading}
								>
									<span>👁️</span>
									詳細を見る
								</button>

								{#if deleteConfirmId === snapshot.id}
									<div class="delete-confirm">
										<span>本当に削除しますか？</span>
										<button
											class="btn-confirm-delete"
											onclick={() => deleteSnapshot(snapshot.id)}
											disabled={isLoading}
										>
											削除
										</button>
										<button
											class="btn-cancel"
											onclick={() => (deleteConfirmId = null)}
											disabled={isLoading}
										>
											キャンセル
										</button>
									</div>
								{:else}
									<button
										class="btn-delete"
										onclick={() => (deleteConfirmId = snapshot.id)}
										disabled={isLoading}
									>
										<span>🗑️</span>
										削除
									</button>
								{/if}
							</div>
						</article>
					{/each}
				</div>
			{/if}
		{/if}

		<!-- Answers Tab -->
		{#if activeTab === 'answers'}
			{#if answers.length === 0}
				<div class="empty-state animate-in" style="--delay: 1">
					<div class="empty-icon">📝</div>
					<h2 class="empty-title">回答がありません</h2>
					<p class="empty-desc">マッチングで法案に回答すると、ここに履歴が表示されます。</p>
					<a href="/match" class="btn-primary"> マッチングへ </a>
				</div>
			{:else}
				<div class="answers-section animate-in" style="--delay: 1">
					<p class="answers-summary">合計 {totalAnswers} 件の回答</p>
					<div class="answers-list">
						{#each answers as bill (bill.billId)}
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
		padding: 2rem 0;
	}

	.container {
		max-width: 1024px;
		margin: 0 auto;
		padding: 0 1rem;
	}

	.header-content {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 1rem;
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
	}

	.main-container {
		max-width: 1024px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	/* Tabs */
	.tabs {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
		border-bottom: 2px solid #e5e7eb;
		padding-bottom: 0;
	}

	.tab-btn {
		padding: 0.75rem 1.25rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		margin-bottom: -2px;
		font-weight: 600;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.tab-btn:hover {
		color: #4b5563;
	}

	.tab-btn.active {
		color: #6366f1;
		border-bottom-color: #6366f1;
	}

	/* Empty State */
	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		background: white;
		border-radius: 16px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: 1.5rem;
	}

	.empty-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 0.5rem;
	}

	.empty-desc {
		color: #6b7280;
		margin-bottom: 2rem;
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

	/* Snapshots Grid */
	.snapshots-grid {
		display: grid;
		gap: 1.5rem;
	}

	.snapshot-card {
		background: white;
		border-radius: 16px;
		padding: 1.5rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
		border: 1px solid #e5e7eb;
		transition: all 0.3s ease;
	}

	.snapshot-card:hover {
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
		border-color: #c4b5fd;
	}

	.snapshot-header {
		margin-bottom: 1rem;
	}

	.snapshot-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.snapshot-date {
		font-size: 0.85rem;
		color: #6b7280;
	}

	.snapshot-name {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1f2937;
	}

	/* Snapshot Stats */
	.snapshot-stats {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: #f9fafb;
		border-radius: 12px;
		margin-bottom: 1rem;
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.stat-label {
		font-size: 0.9rem;
		color: #6b7280;
	}

	.stat-value {
		font-size: 0.9rem;
		font-weight: 600;
		color: #1f2937;
	}

	/* Actions */
	.snapshot-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.5rem;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border-radius: 100px;
		font-weight: 600;
		text-decoration: none;
		transition: all 0.3s ease;
		border: none;
		cursor: pointer;
	}

	.btn-primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
	}

	.btn-view {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: #f3f4f6;
		color: #4b5563;
		border-radius: 8px;
		border: none;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-view:hover:not(:disabled) {
		background: #e5e7eb;
		color: #1f2937;
	}

	.btn-view:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.btn-delete {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: #fee2e2;
		color: #dc2626;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-delete:hover:not(:disabled) {
		background: #fecaca;
	}

	.btn-delete:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.delete-confirm {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: #dc2626;
	}

	.btn-confirm-delete {
		padding: 0.5rem 1rem;
		background: #dc2626;
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-confirm-delete:hover:not(:disabled) {
		background: #b91c1c;
	}

	.btn-confirm-delete:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-cancel {
		padding: 0.5rem 1rem;
		background: #f3f4f6;
		color: #4b5563;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-cancel:hover {
		background: #e5e7eb;
	}

	/* Answers Section */
	.answers-section {
		background: white;
		border-radius: 16px;
		padding: 1.5rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
		border: 1px solid #e5e7eb;
	}

	.answers-summary {
		font-size: 0.95rem;
		color: #6b7280;
		margin-bottom: 1rem;
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
		padding: 0.5rem 0;
		border-bottom: 1px solid #f3f4f6;
	}

	.answer-item:last-child {
		border-bottom: none;
	}

	.answer-badge {
		display: inline-flex;
		padding: 0.2rem 0.6rem;
		border-radius: 100px;
		font-size: 0.75rem;
		font-weight: 600;
		flex-shrink: 0;
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
		font-size: 0.9rem;
		color: #374151;
	}

	@media (max-width: 640px) {
		.header-content {
			flex-direction: column;
			align-items: flex-start;
		}

		.snapshot-actions {
			flex-direction: column;
		}

		.delete-confirm {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
