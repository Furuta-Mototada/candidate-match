<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types.js';
	import type { SnapshotListItem, AnsweredBill } from '$lib/types/index.js';
	import DelegationModal from '$lib/components/match/DelegationModal.svelte';

	type IncomingDelegation = {
		id: number;
		delegatorId: string;
		delegatorUsername: string;
		billId: number;
		billTitle: string | null;
		billType: string;
		billSubmissionSession: number;
		billNumber: number;
		status: string;
		myExistingScore: number | null;
		upstreamChain: { username: string; status: string }[];
		createdAt: string;
		updatedAt: string;
	};

	type OutgoingDelegation = {
		id: number;
		delegateId: string;
		delegateUsername: string;
		billId: number;
		billTitle: string | null;
		billType: string;
		billSubmissionSession: number;
		billNumber: number;
		status: string;
		myVoteScore: number | null;
		chain: { username: string; status: string }[];
		createdAt: string;
		updatedAt: string;
	};

	type DelegationGroup = {
		billId: number;
		billTitle: string | null;
		billType: string;
		billSubmissionSession: number;
		billNumber: number;
		incomingList: IncomingDelegation[];
		outgoing: OutgoingDelegation | null;
	};

	let { data }: { data: PageData } = $props();

	let snapshots: SnapshotListItem[] = $state(data.snapshots || []);
	let answers: AnsweredBill[] = $state(data.answers || []);
	let totalAnswers: number = $state(data.totalAnswers || 0);
	let incomingDelegations: IncomingDelegation[] = $state(data.incomingDelegations || []);
	let outgoingDelegations: OutgoingDelegation[] = $state(data.outgoingDelegations || []);
	let isLoading: boolean = $state(false);
	let error: string | null = $state(null);
	let mounted: boolean = $state(false);
	let activeTab: 'snapshots' | 'answers' | 'delegations' = $state('snapshots');

	// Delete confirmation
	let deleteConfirmId: number | null = $state(null);

	// Delegation vote modal
	let votingDelegation: IncomingDelegation | null = $state(null);

	// Redelegate modal
	let redelegatingDelegation: IncomingDelegation | null = $state(null);
	let redelegateFriends: { friendId: string; friendUsername: string }[] = $state([]);
	let redelegateLoading: boolean = $state(false);
	let redelegateConfirmingFriend: { friendId: string; friendUsername: string } | null =
		$state(null);

	// Delegate-from-answer modal
	let delegatingAnswer: { billId: number; title: string } | null = $state(null);

	// Retract confirmation
	let retractAnswerConfirmId: number | null = $state(null);

	// Group delegations by bill for unified view
	let delegationGroups: DelegationGroup[] = $derived.by(() => {
		const groupMap = new Map<number, DelegationGroup>();

		for (const d of incomingDelegations) {
			if (!groupMap.has(d.billId)) {
				groupMap.set(d.billId, {
					billId: d.billId,
					billTitle: d.billTitle,
					billType: d.billType,
					billSubmissionSession: d.billSubmissionSession,
					billNumber: d.billNumber,
					incomingList: [d],
					outgoing: null
				});
			} else {
				groupMap.get(d.billId)!.incomingList.push(d);
			}
		}

		for (const d of outgoingDelegations) {
			if (!groupMap.has(d.billId)) {
				groupMap.set(d.billId, {
					billId: d.billId,
					billTitle: d.billTitle,
					billType: d.billType,
					billSubmissionSession: d.billSubmissionSession,
					billNumber: d.billNumber,
					incomingList: [],
					outgoing: d
				});
			} else {
				groupMap.get(d.billId)!.outgoing = d;
			}
		}

		return Array.from(groupMap.values());
	});

	let pendingIncomingCount = $derived(
		incomingDelegations.filter((d) => d.status === 'pending').length
	);
	let totalDelegationCount = $derived(delegationGroups.length);

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

	// ── Delegation functions ──

	function getDelegationStatusLabel(status: string): string {
		switch (status) {
			case 'pending':
				return '⏳ 保留中';
			case 'accepted':
				return '✅ 承認済み';
			case 'rejected':
				return '❌ 拒否';
			case 'redelegated':
				return '🔄 転送済み';
			case 'voted':
				return '🗳️ 投票済み';
			default:
				return status;
		}
	}

	function getDelegationStatusClass(status: string): string {
		switch (status) {
			case 'pending':
				return 'status-pending';
			case 'accepted':
			case 'voted':
				return 'status-accepted';
			case 'rejected':
				return 'status-rejected';
			case 'redelegated':
				return 'status-redelegated';
			default:
				return '';
		}
	}

	function getVoteScoreLabel(score: number | null): string {
		if (score === 1) return '👍 賛成';
		if (score === -1) return '👎 反対';
		if (score === 0) return '🤔 わからない';
		return '';
	}

	async function acceptDelegation(delegationId: number, score?: number) {
		isLoading = true;
		error = null;

		try {
			const payload: Record<string, unknown> = { action: 'accept', delegationId };
			if (score !== undefined) {
				payload.score = score;
			}

			const res = await fetch('/api/delegations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.error || '承認に失敗しました');
			}

			// Update local state — ALL incoming for this bill become voted
			const targetBillId = incomingDelegations.find((d) => d.id === delegationId)?.billId;
			const voteScore = score ?? null;
			if (targetBillId !== undefined) {
				incomingDelegations = incomingDelegations.map((d) =>
					d.billId === targetBillId && d.status === 'pending'
						? { ...d, status: 'voted', myExistingScore: voteScore ?? d.myExistingScore }
						: d
				);
			}
			votingDelegation = null;
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	async function rejectDelegation(delegationId: number) {
		isLoading = true;
		error = null;

		try {
			const res = await fetch('/api/delegations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'reject', delegationId })
			});

			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.error || '拒否に失敗しました');
			}

			// Update local state — ALL pending incoming for this bill become rejected
			const targetBillId = incomingDelegations.find((d) => d.id === delegationId)?.billId;
			if (targetBillId !== undefined) {
				incomingDelegations = incomingDelegations.map((d) =>
					d.billId === targetBillId && d.status === 'pending' ? { ...d, status: 'rejected' } : d
				);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	async function redelegateDelegation(delegationId: number, newDelegateId: string) {
		isLoading = true;
		error = null;

		try {
			const res = await fetch('/api/delegations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'redelegate', delegationId, delegateId: newDelegateId })
			});

			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.error || '転送に失敗しました');
			}

			// Update local state: mark ALL pending incoming for this bill as redelegated
			const targetBillId = incomingDelegations.find((d) => d.id === delegationId)?.billId;
			if (targetBillId !== undefined) {
				incomingDelegations = incomingDelegations.map((d) =>
					d.billId === targetBillId && d.status === 'pending' ? { ...d, status: 'redelegated' } : d
				);
			}
			redelegatingDelegation = null;
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	async function openRedelegateModal(delegation: IncomingDelegation) {
		redelegatingDelegation = delegation;
		redelegateLoading = true;
		redelegateConfirmingFriend = null;
		error = null;

		try {
			const res = await fetch('/api/friends');
			const data = await res.json();
			if (!res.ok) throw new Error('フレンド一覧の取得に失敗しました');
			// Exclude ALL users who have delegated this bill to you (would create a cycle)
			const delegatorIds = new Set(
				incomingDelegations.filter((d) => d.billId === delegation.billId).map((d) => d.delegatorId)
			);
			// Also exclude yourself (server would reject) and anyone in the upstream chain
			const upstreamIds = new Set((delegation.upstreamChain || []).map((link) => link.username));
			redelegateFriends = (data.friends || []).filter(
				(f: { friendId: string; friendUsername: string }) =>
					!delegatorIds.has(f.friendId) && !upstreamIds.has(f.friendUsername)
			);
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
			redelegatingDelegation = null;
		} finally {
			redelegateLoading = false;
		}
	}

	async function retractDelegation(delegationId: number) {
		isLoading = true;
		error = null;

		try {
			const res = await fetch('/api/delegations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'retract', delegationId })
			});

			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.error || '取り消しに失敗しました');
			}

			const outgoing = outgoingDelegations.find((d) => d.id === delegationId);
			outgoingDelegations = outgoingDelegations.filter((d) => d.id !== delegationId);
			// Restore any redelegated incoming delegations for this bill
			if (outgoing) {
				incomingDelegations = incomingDelegations.map((d) =>
					d.billId === outgoing.billId && d.status === 'redelegated'
						? { ...d, status: 'pending' }
						: d
				);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	async function undoVoteDelegation(delegationId: number) {
		isLoading = true;
		error = null;

		try {
			const res = await fetch('/api/delegations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'undo-vote', delegationId })
			});

			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.error || '取り消しに失敗しました');
			}

			// Update local state — ALL voted incoming for this bill revert to pending
			const targetBillId = incomingDelegations.find((d) => d.id === delegationId)?.billId;
			if (targetBillId !== undefined) {
				incomingDelegations = incomingDelegations.map((d) =>
					d.billId === targetBillId && d.status === 'voted'
						? { ...d, status: 'pending', myExistingScore: null }
						: d
				);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	async function undoRejectDelegation(delegationId: number) {
		isLoading = true;
		error = null;

		try {
			const res = await fetch('/api/delegations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'undo-reject', delegationId })
			});

			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.error || '取り消しに失敗しました');
			}

			// Update local state — ALL rejected incoming for this bill revert to pending
			const targetBillId = incomingDelegations.find((d) => d.id === delegationId)?.billId;
			if (targetBillId !== undefined) {
				incomingDelegations = incomingDelegations.map((d) =>
					d.billId === targetBillId && d.status === 'rejected' ? { ...d, status: 'pending' } : d
				);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	async function retractAnswer(billId: number) {
		isLoading = true;
		error = null;

		try {
			const res = await fetch('/api/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'retract-answer', billId })
			});

			const data = await res.json();
			if (!res.ok || !data.success) {
				throw new Error(data.error || '回答の取り消しに失敗しました');
			}

			answers = answers.filter((a) => a.billId !== billId);
			totalAnswers = answers.length;
			retractAnswerConfirmId = null;
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	function openDelegateFromAnswer(bill: AnsweredBill) {
		delegatingAnswer = { billId: bill.billId, title: bill.title };
	}

	async function onDelegatedFromAnswer() {
		if (delegatingAnswer) {
			// Retract the existing answer since user is delegating instead
			try {
				await fetch('/api/match', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ action: 'retract-answer', billId: delegatingAnswer.billId })
				});
			} catch {
				// Best-effort retract — delegation was already created
			}
			answers = answers.filter((a) => a.billId !== delegatingAnswer!.billId);
			totalAnswers = answers.length;
			delegatingAnswer = null;
		}
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
			<button
				class="tab-btn"
				class:active={activeTab === 'delegations'}
				onclick={() => (activeTab = 'delegations')}
			>
				🤝 委任 ({totalDelegationCount})
				{#if pendingIncomingCount > 0}
					<span class="tab-badge">{pendingIncomingCount}</span>
				{/if}
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
								<div class="answer-item-main">
									<span class="answer-badge {getAnswerClass(bill.answer)}">
										{getAnswerLabel(bill.answer)}
									</span>
									<span class="answer-title">{bill.title}</span>
								</div>
								<div class="answer-item-actions">
									{#if retractAnswerConfirmId === bill.billId}
										<div class="delete-confirm">
											<span>取り消しますか？</span>
											<button
												class="btn-confirm-delete"
												onclick={() => retractAnswer(bill.billId)}
												disabled={isLoading}
											>
												取り消す
											</button>
											<button
												class="btn-cancel"
												onclick={() => (retractAnswerConfirmId = null)}
												disabled={isLoading}
											>
												キャンセル
											</button>
										</div>
									{:else}
										<button
											class="btn-answer-action btn-retract-answer"
											onclick={() => (retractAnswerConfirmId = bill.billId)}
											disabled={isLoading}
											title="回答を取り消す"
										>
											↩️ 取り消す
										</button>
										<button
											class="btn-answer-action btn-delegate-answer"
											onclick={() => openDelegateFromAnswer(bill)}
											disabled={isLoading}
											title="フレンドに委任する"
										>
											🤝 委任する
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{/if}

		<!-- Delegations Tab -->
		{#if activeTab === 'delegations'}
			<div class="delegations-container animate-in" style="--delay: 1">
				{#if delegationGroups.length === 0}
					<div class="empty-state">
						<div class="empty-icon">🤝</div>
						<h2 class="empty-title">委任はありません</h2>
						<p class="empty-desc">マッチングで法案をフレンドに委任すると、ここに表示されます。</p>
						<a href="/match" class="btn-primary">マッチングへ</a>
					</div>
				{:else}
					<div class="delegation-list">
						{#each delegationGroups as group (group.billId)}
							{@const incomingList = group.incomingList}
							{@const outgoing = group.outgoing}
							{@const hasIncoming = incomingList.length > 0}
							{@const isMiddleman = hasIncoming && outgoing !== null}
							{@const hasPendingIncoming = incomingList.some((d) => d.status === 'pending')}
							{@const primaryStatus = hasPendingIncoming
								? 'pending'
								: (outgoing?.status ?? incomingList[0]?.status ?? '')}
							<div
								class="delegation-card"
								class:delegation-card-pending={primaryStatus === 'pending'}
							>
								<!-- Bill info -->
								<div class="delegation-bill-header">
									<span class="delegation-bill-id">
										第{group.billSubmissionSession}回 {group.billType} 第{group.billNumber}号
									</span>
									<span class="delegation-bill-title">
										{group.billTitle || `法案 #${group.billId}`}
									</span>
									{#if isMiddleman}
										<span class="delegation-role role-middleman">🔄 転送</span>
									{:else if hasIncoming}
										<span class="delegation-role role-incoming">📥 受信</span>
									{:else}
										<span class="delegation-role role-outgoing">📤 送信</span>
									{/if}
								</div>

								<!-- Chain visualization for outgoing-only -->
								{#if !hasIncoming && outgoing}
									<div class="delegation-chain">
										<span class="chain-label">委任経路:</span>
										<span class="chain-path">
											<span class="chain-node chain-node-me">あなた</span>
											<span class="chain-arrow">→</span>
											<span class="chain-node">{outgoing.delegateUsername}</span>
											{#if outgoing.chain && outgoing.chain.length > 0}
												{#each outgoing.chain as link, i (i)}
													<span class="chain-arrow">→</span>
													<span class="chain-node">{link.username}</span>
												{/each}
											{/if}
										</span>
									</div>
									<div class="delegation-status-row">
										<span class="delegation-status {getDelegationStatusClass(outgoing.status)}">
											{getDelegationStatusLabel(outgoing.status)}
										</span>
									</div>
									{#if outgoing.status === 'voted' && outgoing.myVoteScore !== null}
										<div class="delegation-vote-result">
											投票結果: {getVoteScoreLabel(outgoing.myVoteScore)}
										</div>
									{/if}
								{/if}

								<!-- Combined chain visualization for incoming -->
								{#if hasIncoming}
									<div class="delegation-chain-combined">
										<span class="chain-label">委任経路:</span>
										<div class="chain-combined-layout">
											<!-- Source branches (incoming delegators + own vote if redelegated) -->
											<div class="chain-sources">
												{#if outgoing}
													<div class="chain-source-row">
														<span class="chain-node chain-node-me">あなたの投票</span>
														<span class="chain-arrow">→</span>
													</div>
												{/if}
												{#each incomingList as incoming (incoming.id)}
													<div class="chain-source-row">
														{#if incoming.upstreamChain && incoming.upstreamChain.length > 0}
															{#each incoming.upstreamChain as link, i (i)}
																<span class="chain-node chain-node-upstream">{link.username}</span>
																<span class="chain-arrow">→</span>
															{/each}
														{/if}
														<span class="chain-node">{incoming.delegatorUsername}</span>
														<span class="chain-arrow">→</span>
													</div>
												{/each}
											</div>

											<!-- Convergence point: あなた -->
											<div class="chain-convergence">
												<span class="chain-node chain-node-me">あなた</span>
												{#if outgoing}
													<span class="chain-arrow">→</span>
													<span class="chain-node">{outgoing.delegateUsername}</span>
													{#if outgoing.chain && outgoing.chain.length > 0}
														{#each outgoing.chain as link, i (i)}
															<span class="chain-arrow">→</span>
															<span class="chain-node">{link.username}</span>
														{/each}
													{/if}
												{/if}
											</div>
										</div>
									</div>

									<!-- Combined status row -->
									<div class="delegation-status-row">
										{#each incomingList as incoming (incoming.id)}
											<span class="delegation-status {getDelegationStatusClass(incoming.status)}">
												{incoming.delegatorUsername}: {getDelegationStatusLabel(incoming.status)}
											</span>
										{/each}
										{#if outgoing}
											<span class="delegation-status {getDelegationStatusClass(outgoing.status)}">
												転送先: {getDelegationStatusLabel(outgoing.status)}
											</span>
										{/if}
									</div>

									{#if incomingList.some((d) => d.status === 'voted' && d.myExistingScore !== null)}
										{@const votedIncoming = incomingList.find(
											(d) => d.status === 'voted' && d.myExistingScore !== null
										)}
										{#if votedIncoming}
											<div class="delegation-vote-result">
												投票結果: {getVoteScoreLabel(votedIncoming.myExistingScore)}
											</div>
										{/if}
									{/if}
								{/if}

								<!-- Bill-level incoming actions (apply to ALL incoming for this bill) -->
								{#if hasPendingIncoming}
									{@const firstPending = incomingList.find((d) => d.status === 'pending')}
									{#if firstPending}
										<div class="delegation-actions">
											{#if firstPending.myExistingScore !== null}
												<button
													class="btn-vote-for"
													onclick={() => acceptDelegation(firstPending.id)}
													disabled={isLoading}
												>
													✅ 既存の投票で承認（{getVoteScoreLabel(firstPending.myExistingScore)}）
												</button>
											{:else}
												<button
													class="btn-vote-for"
													onclick={() => (votingDelegation = firstPending)}
													disabled={isLoading}
												>
													🗳️ 代理投票する
												</button>
											{/if}
											<button
												class="btn-redelegate"
												onclick={() => openRedelegateModal(firstPending)}
												disabled={isLoading}
											>
												🔄 別のフレンドに転送
											</button>
											<button
												class="btn-reject-delegation"
												onclick={() => rejectDelegation(firstPending.id)}
												disabled={isLoading}
											>
												拒否する
											</button>
										</div>
									{/if}
								{/if}
								{#if hasIncoming && incomingList.every((d) => d.status === 'voted')}
									<div class="delegation-actions">
										<button
											class="btn-undo"
											onclick={() => undoVoteDelegation(incomingList[0].id)}
											disabled={isLoading}
										>
											↩️ 投票を取り消す
										</button>
									</div>
								{/if}
								{#if hasIncoming && incomingList.every((d) => d.status === 'rejected')}
									<div class="delegation-actions">
										<button
											class="btn-undo"
											onclick={() => undoRejectDelegation(incomingList[0].id)}
											disabled={isLoading}
										>
											↩️ 拒否を取り消す
										</button>
									</div>
								{/if}

								<!-- Outgoing actions -->
								{#if outgoing && (outgoing.status === 'pending' || outgoing.status === 'accepted')}
									<div class="delegation-actions">
										<button
											class="btn-retract"
											onclick={() => retractDelegation(outgoing.id)}
											disabled={isLoading}
										>
											↩️ {isMiddleman ? '転送を取り消す' : '取り消して自分で投票する'}
										</button>
									</div>
								{/if}
								{#if outgoing && outgoing.status === 'voted'}
									<div class="delegation-actions">
										<button
											class="btn-retract"
											onclick={() => retractDelegation(outgoing.id)}
											disabled={isLoading}
										>
											↩️ 委任を取り消す
										</button>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</main>

	<!-- Voting Modal for accepting a delegation -->
	{#if votingDelegation}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			class="vote-modal-backdrop"
			onclick={(e) => {
				if (e.target === e.currentTarget) votingDelegation = null;
			}}
			onkeydown={(e) => {
				if (e.key === 'Escape') votingDelegation = null;
			}}
			role="dialog"
			aria-modal="true"
			aria-label="代理投票"
		>
			<div class="vote-modal">
				<div class="vote-modal-header">
					<h3>🗳️ 代理投票</h3>
					<button class="modal-close-btn" onclick={() => (votingDelegation = null)}>✕</button>
				</div>
				<div class="vote-modal-body">
					<p class="vote-modal-delegator">
						<strong>{votingDelegation.delegatorUsername}</strong> さんの代わりに投票します
					</p>
					<p class="vote-modal-bill">
						法案: <strong>{votingDelegation.billTitle || `#${votingDelegation.billId}`}</strong>
					</p>
					<div class="vote-modal-buttons">
						<button
							class="vote-modal-btn vote-agree"
							onclick={() => acceptDelegation(votingDelegation!.id, 1)}
							disabled={isLoading}
						>
							👍 賛成
						</button>
						<button
							class="vote-modal-btn vote-neutral"
							onclick={() => acceptDelegation(votingDelegation!.id, 0)}
							disabled={isLoading}
						>
							🤔 わからない
						</button>
						<button
							class="vote-modal-btn vote-disagree"
							onclick={() => acceptDelegation(votingDelegation!.id, -1)}
							disabled={isLoading}
						>
							👎 反対
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Redelegate Modal for choosing a friend to forward delegation to -->
	{#if redelegatingDelegation}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			class="vote-modal-backdrop"
			onclick={(e) => {
				if (e.target === e.currentTarget) redelegatingDelegation = null;
			}}
			onkeydown={(e) => {
				if (e.key === 'Escape') redelegatingDelegation = null;
			}}
			role="dialog"
			aria-modal="true"
			aria-label="委任を転送"
		>
			<div class="vote-modal">
				<div class="vote-modal-header">
					<h3>🔄 委任を転送</h3>
					<button class="modal-close-btn" onclick={() => (redelegatingDelegation = null)}>✕</button>
				</div>
				<div class="vote-modal-body">
					<p class="vote-modal-delegator">
						<strong>{redelegatingDelegation.delegatorUsername}</strong> さんからの委任を別のフレンドに転送します
					</p>
					<p class="vote-modal-bill">
						法案: <strong
							>{redelegatingDelegation.billTitle || `#${redelegatingDelegation.billId}`}</strong
						>
					</p>
					{#if redelegateLoading}
						<p>読み込み中...</p>
					{:else if redelegateFriends.length === 0}
						<p>転送可能なフレンドがいません</p>
					{:else if redelegateConfirmingFriend}
						<div class="redelegate-confirm">
							<p class="redelegate-confirm-warning">
								⚠️ この法案にはすでに投票があります。転送すると投票が削除されます。
							</p>
							<p>転送先: <strong>{redelegateConfirmingFriend.friendUsername}</strong></p>
							<div class="redelegate-confirm-actions">
								<button
									class="redelegate-confirm-btn redelegate-confirm-cancel"
									onclick={() => (redelegateConfirmingFriend = null)}
									disabled={isLoading}
								>
									キャンセル
								</button>
								<button
									class="redelegate-confirm-btn redelegate-confirm-ok"
									onclick={() => {
										redelegateDelegation(
											redelegatingDelegation!.id,
											redelegateConfirmingFriend!.friendId
										);
										redelegateConfirmingFriend = null;
									}}
									disabled={isLoading}
								>
									投票を削除して転送する
								</button>
							</div>
						</div>
					{:else}
						<div class="redelegate-friends-list">
							{#each redelegateFriends as friend (friend.friendId)}
								<button
									class="redelegate-friend-btn"
									onclick={() => {
										if (redelegatingDelegation?.myExistingScore != null) {
											redelegateConfirmingFriend = friend;
										} else {
											redelegateDelegation(redelegatingDelegation!.id, friend.friendId);
										}
									}}
									disabled={isLoading}
								>
									👤 {friend.friendUsername}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- Delegate from answer modal -->
	{#if delegatingAnswer}
		<DelegationModal
			show={true}
			billId={delegatingAnswer.billId}
			billTitle={delegatingAnswer.title}
			hasExistingVote={true}
			onClose={() => (delegatingAnswer = null)}
			onDelegated={onDelegatedFromAnswer}
		/>
	{/if}
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
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid #f3f4f6;
	}

	.answer-item:last-child {
		border-bottom: none;
	}

	.answer-item-main {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.answer-item-actions {
		display: flex;
		gap: 0.5rem;
		padding-left: 0.25rem;
	}

	.btn-answer-action {
		padding: 0.25rem 0.6rem;
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		background: white;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-retract-answer:hover {
		background: #fef2f2;
		border-color: #fca5a5;
		color: #991b1b;
	}

	.btn-delegate-answer:hover {
		background: #eef2ff;
		border-color: #a5b4fc;
		color: #4338ca;
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

	/* Tab Badge */
	.tab-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.25rem;
		height: 1.25rem;
		padding: 0 0.4rem;
		background: #ef4444;
		color: white;
		border-radius: 100px;
		font-size: 0.7rem;
		font-weight: 700;
		margin-left: 0.4rem;
	}

	/* Delegations */
	.delegations-container {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.delegation-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.delegation-card {
		padding: 1rem 1.25rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		transition: all 0.2s ease;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
	}

	.delegation-card:hover {
		border-color: #c4b5fd;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
	}

	.delegation-card-pending {
		border-left: 3px solid #f59e0b;
	}

	.delegation-bill-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 0.5rem;
		gap: 0.25rem 0.5rem;
	}

	.delegation-bill-id {
		font-size: 0.8rem;
		color: #6b7280;
		width: 100%;
	}

	.delegation-bill-header .delegation-bill-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: #1f2937;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}

	.delegation-role {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.2rem 0.6rem;
		border-radius: 100px;
		flex-shrink: 0;
	}

	.role-incoming {
		background: #ede9fe;
		color: #6d28d9;
	}

	.role-outgoing {
		background: #e0f2fe;
		color: #0369a1;
	}

	.role-middleman {
		background: #fef3c7;
		color: #92400e;
	}

	.delegation-status-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
		flex-wrap: wrap;
	}

	.delegation-status {
		font-size: 0.8rem;
		font-weight: 600;
		padding: 0.2rem 0.6rem;
		border-radius: 100px;
	}

	.status-pending {
		background: #fef3c7;
		color: #92400e;
	}

	.status-accepted {
		background: #d1fae5;
		color: #065f46;
	}

	.status-rejected {
		background: #fee2e2;
		color: #991b1b;
	}

	.status-redelegated {
		background: #eff6ff;
		color: #2563eb;
	}

	.delegation-chain {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin: 0.5rem 0;
		padding: 0.5rem 0.75rem;
		background: #f0f9ff;
		border-radius: 8px;
		border: 1px solid #bae6fd;
		font-size: 0.8rem;
		flex-wrap: wrap;
	}

	.delegation-chain-combined {
		margin: 0.5rem 0;
		padding: 0.5rem 0.75rem;
		background: #f0f9ff;
		border-radius: 8px;
		border: 1px solid #bae6fd;
		font-size: 0.8rem;
	}

	.chain-combined-layout {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-top: 0.4rem;
	}

	.chain-sources {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		border-right: 2px solid #93c5fd;
		padding-right: 0.5rem;
		margin-right: 0.25rem;
	}

	.chain-source-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.chain-convergence {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.chain-node-upstream {
		background: #f3f4f6;
		border-color: #d1d5db;
		color: #6b7280;
	}

	.chain-label {
		color: #0369a1;
		font-weight: 600;
		margin-right: 0.25rem;
		flex-shrink: 0;
	}

	.chain-path {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-wrap: wrap;
	}

	.chain-node {
		padding: 0.15rem 0.5rem;
		background: white;
		border: 1px solid #93c5fd;
		border-radius: 12px;
		color: #1e40af;
		font-weight: 500;
		white-space: nowrap;
	}

	.chain-node-me {
		background: #6366f1;
		border-color: #6366f1;
		color: white;
	}

	.chain-arrow {
		color: #93c5fd;
		font-weight: 700;
	}

	.delegation-vote-result {
		font-size: 0.85rem;
		color: #4b5563;
		margin-top: 0.25rem;
		font-weight: 500;
	}

	.delegation-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.75rem;
		flex-wrap: wrap;
	}

	.btn-vote-for {
		padding: 0.5rem 1rem;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: 0.85rem;
	}

	.btn-vote-for:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 8px rgba(99, 102, 241, 0.3);
	}

	.btn-vote-for:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-reject-delegation {
		padding: 0.5rem 1rem;
		background: #fee2e2;
		color: #dc2626;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: 0.85rem;
	}

	.btn-reject-delegation:hover:not(:disabled) {
		background: #fecaca;
	}

	.btn-reject-delegation:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-redelegate {
		padding: 0.5rem 1rem;
		background: #eff6ff;
		color: #2563eb;
		border: 1px solid #bfdbfe;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: 0.85rem;
	}

	.btn-redelegate:hover:not(:disabled) {
		background: #dbeafe;
	}

	.btn-redelegate:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.redelegate-friends-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.redelegate-friend-btn {
		padding: 0.75rem 1rem;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 0.9rem;
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: left;
	}

	.redelegate-friend-btn:hover:not(:disabled) {
		background: #eff6ff;
		border-color: #93c5fd;
	}

	.redelegate-friend-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.redelegate-confirm {
		text-align: center;
		padding: 0.5rem 0;
	}

	.redelegate-confirm p {
		margin: 0 0 0.75rem;
	}

	.redelegate-confirm-warning {
		color: #92400e;
		font-size: 0.95rem;
	}

	.redelegate-confirm-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
		margin-top: 1rem;
	}

	.redelegate-confirm-btn {
		padding: 0.6rem 1.2rem;
		border-radius: 8px;
		border: none;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.redelegate-confirm-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.redelegate-confirm-cancel {
		background: #f3f4f6;
		color: #374151;
	}

	.redelegate-confirm-ok {
		background: #dc2626;
		color: white;
	}

	.btn-retract {
		padding: 0.5rem 1rem;
		background: #f3f4f6;
		color: #4b5563;
		border: 1px solid #d1d5db;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: 0.85rem;
	}

	.btn-retract:hover:not(:disabled) {
		background: #e5e7eb;
		border-color: #9ca3af;
	}

	.btn-retract:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-undo {
		padding: 0.5rem 1rem;
		background: #fefce8;
		color: #854d0e;
		border: 1px solid #fde68a;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		font-size: 0.85rem;
	}

	.btn-undo:hover:not(:disabled) {
		background: #fef9c3;
		border-color: #fcd34d;
	}

	.btn-undo:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Vote Modal */
	.vote-modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
		animation: fadeInUp 0.2s ease forwards;
	}

	.vote-modal {
		background: white;
		border-radius: 16px;
		max-width: 420px;
		width: 100%;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
		overflow: hidden;
	}

	.vote-modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.vote-modal-header h3 {
		font-size: 1.15rem;
		font-weight: 700;
		color: #1f2937;
	}

	.modal-close-btn {
		background: none;
		border: none;
		font-size: 1.2rem;
		cursor: pointer;
		color: #6b7280;
		padding: 0.25rem;
		border-radius: 6px;
	}

	.modal-close-btn:hover {
		background: #f3f4f6;
		color: #1f2937;
	}

	.vote-modal-body {
		padding: 1.5rem;
	}

	.vote-modal-delegator {
		font-size: 0.95rem;
		color: #4b5563;
		margin-bottom: 0.5rem;
	}

	.vote-modal-bill {
		font-size: 0.9rem;
		color: #6b7280;
		margin-bottom: 1.5rem;
	}

	.vote-modal-buttons {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.75rem;
	}

	.vote-modal-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1.25rem 0.75rem;
		border: 2px solid transparent;
		border-radius: 12px;
		background: #f9fafb;
		cursor: pointer;
		transition: all 0.3s ease;
		font-weight: 600;
		font-size: 0.9rem;
	}

	.vote-modal-btn:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
	}

	.vote-modal-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.vote-modal-btn.vote-agree {
		border-color: rgba(34, 197, 94, 0.3);
	}

	.vote-modal-btn.vote-agree:hover:not(:disabled) {
		background: rgba(34, 197, 94, 0.1);
		border-color: #22c55e;
	}

	.vote-modal-btn.vote-neutral {
		border-color: rgba(59, 130, 246, 0.3);
	}

	.vote-modal-btn.vote-neutral:hover:not(:disabled) {
		background: rgba(59, 130, 246, 0.1);
		border-color: #3b82f6;
	}

	.vote-modal-btn.vote-disagree {
		border-color: rgba(239, 68, 68, 0.3);
	}

	.vote-modal-btn.vote-disagree:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.1);
		border-color: #ef4444;
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
