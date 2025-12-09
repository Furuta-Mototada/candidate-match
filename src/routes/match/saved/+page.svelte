<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types.js';
	import type { SavedSessionListItem } from '$lib/types/index.js';

	let { data }: { data: PageData } = $props();

	let sessions: SavedSessionListItem[] = $state(data.sessions || []);
	let isLoading: boolean = $state(false);
	let loadingSessionId: number | null = $state(null); // Track which session is loading
	let loadingAction: 'view' | 'resume' | 'delete' | null = $state(null); // Track which action
	let error: string | null = $state(null);
	let mounted: boolean = $state(false);

	// Delete confirmation
	let deleteConfirmId: number | null = $state(null);

	async function navigateToDetails(sessionId: number) {
		loadingSessionId = sessionId;
		loadingAction = 'view';
		await goto(`/match/saved/${sessionId}`);
	}

	async function navigateToResume(sessionId: number) {
		loadingSessionId = sessionId;
		loadingAction = 'resume';
		await goto(`/match?resume=${sessionId}`);
	}

	async function deleteSession(sessionId: number) {
		isLoading = true;
		loadingSessionId = sessionId;
		loadingAction = 'delete';
		error = null;

		try {
			const response = await fetch('/api/saved-sessions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'delete',
					sessionId
				})
			});

			const result = await response.json();

			if (!response.ok || !result.success) {
				throw new Error(result.error || '削除に失敗しました');
			}

			// Remove from list
			sessions = sessions.filter((s) => s.id !== sessionId);
			deleteConfirmId = null;
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
			loadingSessionId = null;
			loadingAction = null;
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

	function getStatusLabel(status: string): string {
		return status === 'completed' ? '完了' : '進行中';
	}

	function getStatusClass(status: string): string {
		return status === 'completed' ? 'status-completed' : 'status-in-progress';
	}

	function getProgressPercent(answered: number, total: number): number {
		if (total === 0) return 0;
		return Math.round((answered / total) * 100);
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
					<h1 class="page-title">📋 保存済みマッチング結果</h1>
					<p class="page-subtitle">過去のマッチング結果を確認・続行できます</p>
				</div>
				<a href="/match" class="btn-primary">
					<span>➕</span>
					新規マッチング
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

		{#if sessions.length === 0}
			<div class="empty-state animate-in" style="--delay: 0">
				<div class="empty-icon">📭</div>
				<h2 class="empty-title">保存済みの結果がありません</h2>
				<p class="empty-desc">マッチングを完了すると、ここに結果が保存されます。</p>
				<a href="/match" class="btn-primary"> マッチングを開始 </a>
			</div>
		{:else}
			<div class="sessions-grid">
				{#each sessions as session, idx (session.id)}
					<article class="session-card animate-in" style="--delay: {idx}">
						<div class="session-header">
							<div class="session-meta">
								<span class="session-status {getStatusClass(session.status)}">
									{getStatusLabel(session.status)}
								</span>
								<span class="session-date">{formatDate(session.createdAt)}</span>
							</div>
							<h3 class="session-name">{session.name}</h3>
							{#if session.description}
								<p class="session-desc">{session.description}</p>
							{/if}
						</div>

						<div class="session-stats">
							<div class="stat-row">
								<span class="stat-label">回答進捗</span>
								<div class="progress-container">
									<div class="progress-bar-small">
										<div
											class="progress-fill"
											style="width: {getProgressPercent(
												session.totalAnswered,
												session.totalBills
											)}%"
										></div>
									</div>
									<span class="progress-text">
										{session.totalAnswered}/{session.totalBills}
										({getProgressPercent(session.totalAnswered, session.totalBills)}%)
									</span>
								</div>
							</div>

							<div class="stat-row">
								<span class="stat-label">クラスター数</span>
								<span class="stat-value">{session.clusterCount}</span>
							</div>

							{#if session.latestSnapshotDate}
								<div class="stat-row">
									<span class="stat-label">最新スナップショット</span>
									<span class="stat-value">{formatDate(session.latestSnapshotDate)}</span>
								</div>
							{/if}
						</div>

						<div class="session-actions">
							<button
								class="btn-view"
								onclick={() => navigateToDetails(session.id)}
								disabled={loadingSessionId === session.id}
							>
								{#if loadingSessionId === session.id && loadingAction === 'view'}
									<span>⏳</span>
									読み込み中...
								{:else}
									<span>👁️</span>
									詳細を見る
								{/if}
							</button>

							{#if session.status !== 'completed'}
								<button
									class="btn-continue"
									onclick={() => navigateToResume(session.id)}
									disabled={loadingSessionId === session.id}
								>
									{#if loadingSessionId === session.id && loadingAction === 'resume'}
										<span>⏳</span>
										読み込み中...
									{:else}
										<span>▶️</span>
										続行
									{/if}
								</button>
							{:else if session.totalAnswered < session.totalBills}
								<button
									class="btn-add"
									onclick={() => navigateToResume(session.id)}
									disabled={loadingSessionId === session.id}
								>
									{#if loadingSessionId === session.id && loadingAction === 'resume'}
										<span>⏳</span>
										読み込み中...
									{:else}
										<span>➕</span>
										追加回答
									{/if}
								</button>
							{/if}

							{#if deleteConfirmId === session.id}
								<div class="delete-confirm">
									<span>本当に削除しますか？</span>
									<button
										class="btn-confirm-delete"
										onclick={() => deleteSession(session.id)}
										disabled={isLoading}
									>
										{#if loadingSessionId === session.id && loadingAction === 'delete'}
											⏳ 削除中...
										{:else}
											削除
										{/if}
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
									onclick={() => (deleteConfirmId = session.id)}
									disabled={loadingSessionId === session.id}
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

	/* Sessions Grid */
	.sessions-grid {
		display: grid;
		gap: 1.5rem;
	}

	.session-card {
		background: white;
		border-radius: 16px;
		padding: 1.5rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
		border: 1px solid #e5e7eb;
		transition: all 0.3s ease;
	}

	.session-card:hover {
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
		border-color: #c4b5fd;
	}

	.session-header {
		margin-bottom: 1rem;
	}

	.session-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.session-status {
		display: inline-flex;
		padding: 0.25rem 0.75rem;
		border-radius: 100px;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.status-completed {
		background: linear-gradient(135deg, #d1fae5, #a7f3d0);
		color: #065f46;
	}

	.status-in-progress {
		background: linear-gradient(135deg, #fef3c7, #fde68a);
		color: #92400e;
	}

	.session-date {
		font-size: 0.85rem;
		color: #6b7280;
	}

	.session-name {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 0.25rem;
	}

	.session-desc {
		color: #6b7280;
		font-size: 0.95rem;
	}

	/* Session Stats */
	.session-stats {
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

	.progress-container {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.progress-bar-small {
		width: 100px;
		height: 6px;
		background: #e5e7eb;
		border-radius: 100px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #6366f1, #a855f7);
		border-radius: 100px;
		transition: width 0.3s ease;
	}

	.progress-text {
		font-size: 0.85rem;
		font-weight: 600;
		color: #4b5563;
		font-variant-numeric: tabular-nums;
	}

	/* Session Actions */
	.session-actions {
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
		text-decoration: none;
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

	.btn-continue {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border-radius: 8px;
		border: none;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-continue:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
	}

	.btn-continue:disabled {
		opacity: 0.7;
		cursor: not-allowed;
		transform: none;
	}

	.btn-add {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: linear-gradient(135deg, #10b981, #059669);
		color: white;
		border-radius: 8px;
		border: none;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-add:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
	}

	.btn-add:disabled {
		opacity: 0.7;
		cursor: not-allowed;
		transform: none;
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

	@media (max-width: 640px) {
		.header-content {
			flex-direction: column;
			align-items: flex-start;
		}

		.session-actions {
			flex-direction: column;
		}

		.delete-confirm {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
