<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types.js';
	import type { SnapshotListItem, AnsweredBill, BillListItem } from '$lib/types/index.js';
	import DelegationModal from '$lib/components/match/DelegationModal.svelte';
	import BillDetailModal from '$lib/components/match/BillDetailModal.svelte';

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
	let allBills: BillListItem[] = $state([]);
	let incomingDelegations: IncomingDelegation[] = $state([]);
	let outgoingDelegations: OutgoingDelegation[] = $state([]);
	let isLoading: boolean = $state(false);
	let error: string | null = $state(null);
	let mounted: boolean = $state(false);
	let activeTab: 'snapshots' | 'answers' | 'delegations' = $state('snapshots');

	// Lazy-load flags
	let delegationsLoaded = $state(false);
	let delegationsLoading = $state(false);
	let allBillsLoaded = $state(false);
	let allBillsLoading = $state(false);

	async function loadDelegations() {
		if (delegationsLoaded) return;
		delegationsLoading = true;
		try {
			const res = await fetch('/api/delegations?action=all');
			const data = await res.json();
			if (data.success) {
				incomingDelegations = data.incoming || [];
				outgoingDelegations = data.outgoing || [];
			}
		} catch (e) {
			console.error('Error loading delegations:', e);
		}
		delegationsLoaded = true;
		delegationsLoading = false;
	}

	async function loadAllBills() {
		if (allBillsLoaded) return;
		allBillsLoading = true;
		try {
			const res = await fetch('/api/bills/all');
			const data = await res.json();
			if (data.success) {
				allBills = data.bills || [];
			}
		} catch (e) {
			console.error('Error loading bills:', e);
		}
		allBillsLoaded = true;
		allBillsLoading = false;
	}

	async function switchTab(tab: typeof activeTab) {
		activeTab = tab;
		if (tab === 'delegations') {
			await loadDelegations();
		} else if (tab === 'answers') {
			await loadAllBills();
		}
	}

	// ── Bills tab search & filter state ──
	let billSearchQuery: string = $state('');
	let billStatusFilter: 'all' | 'answered' | 'unanswered' | 'delegated' = $state('all');
	let billTypeFilter: string = $state('all');
	let billSessionFilter: string = $state('all');
	let billResultFilter: string = $state('all');
	let billAnswerFilter: string = $state('all'); // 'all' | 'agree' | 'disagree' | 'skip'

	// Derive unique sessions and types for filter dropdowns
	let availableSessions = $derived(
		[...new Set(allBills.map((b) => b.submissionSession))].sort((a, b) => b - a)
	);
	let availableTypes = $derived([...new Set(allBills.map((b) => b.type))].sort());

	// Filtered bills
	let filteredBills = $derived.by(() => {
		let result = allBills;

		// Search filter
		if (billSearchQuery.trim()) {
			const q = billSearchQuery.trim().toLowerCase();
			result = result.filter(
				(b) =>
					(b.title && b.title.toLowerCase().includes(q)) ||
					`第${b.submissionSession}回 ${b.type} 第${b.number}号`.includes(q)
			);
		}

		// Status filter
		if (billStatusFilter === 'answered') {
			result = result.filter((b) => b.answerScore !== null);
		} else if (billStatusFilter === 'unanswered') {
			result = result.filter((b) => b.answerScore === null && !b.delegation);
		} else if (billStatusFilter === 'delegated') {
			result = result.filter((b) => b.delegation !== null);
		}

		// Answer value filter
		if (billAnswerFilter === 'agree') {
			result = result.filter((b) => b.answerScore === 1);
		} else if (billAnswerFilter === 'disagree') {
			result = result.filter((b) => b.answerScore === -1);
		} else if (billAnswerFilter === 'skip') {
			result = result.filter((b) => b.answerScore === 0);
		}

		// Type filter
		if (billTypeFilter !== 'all') {
			result = result.filter((b) => b.type === billTypeFilter);
		}

		// Session filter
		if (billSessionFilter !== 'all') {
			result = result.filter((b) => b.submissionSession === parseInt(billSessionFilter));
		}

		// Result filter
		if (billResultFilter !== 'all') {
			if (billResultFilter === 'none') {
				result = result.filter((b) => !b.result);
			} else {
				result = result.filter((b) => b.result === billResultFilter);
			}
		}

		return result;
	});

	let answeredCount = $derived(allBills.filter((b) => b.answerScore !== null).length);
	let delegatedCount = $derived(allBills.filter((b) => b.delegation !== null).length);

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

	// Bill detail modal
	let selectedBill: BillListItem | null = $state(null);

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

	/** Force-reload delegations from server to keep client state consistent */
	async function reloadDelegations() {
		delegationsLoaded = false;
		await loadDelegations();
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

			votingDelegation = null;
			await reloadDelegations();
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

			await reloadDelegations();
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

			redelegatingDelegation = null;
			await reloadDelegations();
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

			await reloadDelegations();
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

			await reloadDelegations();
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

			await reloadDelegations();
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	function openDelegateFromBill(b: BillListItem) {
		delegatingBill = { billId: b.id, title: b.title, hasExistingVote: b.answerScore !== null };
	}

	async function handleModalVote(billId: number, score: number) {
		const res = await fetch('/api/match', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'direct-vote', billId, score })
		});
		const data = await res.json();
		if (!res.ok || !data.success) {
			throw new Error(data.error || '投票に失敗しました');
		}
		const normalizedScore = data.score as number;
		allBills = allBills.map((b) => (b.id === billId ? { ...b, answerScore: normalizedScore } : b));
		if (selectedBill && selectedBill.id === billId) {
			selectedBill = { ...selectedBill, answerScore: normalizedScore };
		}
	}

	async function handleModalRetract(billId: number) {
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
		allBills = allBills.map((b) => (b.id === billId ? { ...b, answerScore: null } : b));
		if (selectedBill && selectedBill.id === billId) {
			selectedBill = { ...selectedBill, answerScore: null };
		}
	}

	// Delegate-from-bill-list modal
	let delegatingBill: { billId: number; title: string; hasExistingVote: boolean } | null =
		$state(null);

	async function onDelegatedFromBill() {
		if (delegatingBill) {
			const bill = delegatingBill;
			if (bill.hasExistingVote) {
				// Retract existing answer since user is delegating instead
				try {
					await fetch('/api/match', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ action: 'retract-answer', billId: bill.billId })
					});
				} catch {
					// Best-effort retract
				}
				answers = answers.filter((a) => a.billId !== bill.billId);
				allBills = allBills.map((b) => (b.id === bill.billId ? { ...b, answerScore: null } : b));
			}
			// Refresh delegation status for this bill
			try {
				const res = await fetch(`/api/delegations?action=for-bill&billId=${bill.billId}`);
				const data = await res.json();
				if (data.success && data.delegation) {
					allBills = allBills.map((b) =>
						b.id === bill.billId
							? {
									...b,
									delegation: {
										id: data.delegation.id,
										status: data.delegation.status,
										delegateUsername: data.delegation.delegateUsername
									}
								}
							: b
					);
				}
			} catch {
				// Best-effort refresh
			}
			delegatingBill = null;
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
				onclick={() => switchTab('snapshots')}
			>
				📸 スナップショット ({snapshots.length})
			</button>
			<button
				class="tab-btn"
				class:active={activeTab === 'answers'}
				onclick={() => switchTab('answers')}
			>
				📝 回答履歴 ({allBillsLoaded ? `${answeredCount}/${allBills.length}` : '...'})
			</button>
			<button
				class="tab-btn"
				class:active={activeTab === 'delegations'}
				onclick={() => switchTab('delegations')}
			>
				🤝 委任 ({delegationsLoaded ? totalDelegationCount : '...'})
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
			{#if allBillsLoading}
				<div class="loading-state animate-in" style="--delay: 1">
					<div class="loading-spinner"></div>
					<p>法案データを読み込み中...</p>
				</div>
			{:else}
				<div class="bills-section animate-in" style="--delay: 1">
					<!-- Search bar -->
					<div class="bills-search-bar">
						<span class="search-icon">🔍</span>
						<input
							type="text"
							class="bills-search-input"
							placeholder="法案名で検索..."
							bind:value={billSearchQuery}
						/>
						{#if billSearchQuery}
							<button class="search-clear-btn" onclick={() => (billSearchQuery = '')}>✕</button>
						{/if}
					</div>

					<!-- Filters -->
					<div class="bills-filters">
						<div class="filter-group">
							<label class="filter-label" for="filter-status">ステータス</label>
							<select id="filter-status" class="filter-select" bind:value={billStatusFilter}>
								<option value="all">すべて</option>
								<option value="answered">回答済み ({answeredCount})</option>
								<option value="unanswered">未回答</option>
								<option value="delegated">委任済み ({delegatedCount})</option>
							</select>
						</div>

						{#if billStatusFilter === 'answered' || billStatusFilter === 'all'}
							<div class="filter-group">
								<label class="filter-label" for="filter-answer">回答</label>
								<select id="filter-answer" class="filter-select" bind:value={billAnswerFilter}>
									<option value="all">すべて</option>
									<option value="agree">賛成</option>
									<option value="disagree">反対</option>
									<option value="skip">スキップ</option>
								</select>
							</div>
						{/if}

						<div class="filter-group">
							<label class="filter-label" for="filter-type">種類</label>
							<select id="filter-type" class="filter-select" bind:value={billTypeFilter}>
								<option value="all">すべて</option>
								{#each availableTypes as type (type)}
									<option value={type}>{type}</option>
								{/each}
							</select>
						</div>

						<div class="filter-group">
							<label class="filter-label" for="filter-session">回次</label>
							<select id="filter-session" class="filter-select" bind:value={billSessionFilter}>
								<option value="all">すべて</option>
								{#each availableSessions as session (session)}
									<option value={session.toString()}>第{session}回</option>
								{/each}
							</select>
						</div>

						<div class="filter-group">
							<label class="filter-label" for="filter-result">結果</label>
							<select id="filter-result" class="filter-select" bind:value={billResultFilter}>
								<option value="all">すべて</option>
								<option value="可決">可決</option>
								<option value="否決">否決</option>
								<option value="撤回">撤回</option>
								<option value="未了">未了</option>
								<option value="none">審議中</option>
							</select>
						</div>
					</div>

					<!-- Results summary -->
					<p class="bills-summary">
						{filteredBills.length} 件表示 / 全 {allBills.length} 件（回答済み {answeredCount} 件、委任
						{delegatedCount} 件）
					</p>

					<!-- Bill list -->
					{#if filteredBills.length === 0}
						<div class="empty-state-inline">
							<p>該当する法案がありません</p>
						</div>
					{:else}
						<div class="bills-list">
							{#each filteredBills as b (b.id)}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="bill-item bill-item-clickable"
									class:bill-item-answered={b.answerScore !== null}
									class:bill-item-delegated={b.delegation !== null && b.answerScore === null}
									onclick={() => (selectedBill = b)}
								>
									<div class="bill-item-header">
										<span class="bill-item-id">
											第{b.submissionSession}回 {b.type} 第{b.number}号
										</span>
										{#if b.result}
											<span
												class="bill-result-badge"
												class:result-passed={b.result === '可決'}
												class:result-rejected={b.result === '否決'}
												class:result-withdrawn={b.result === '撤回'}
												class:result-expired={b.result === '未了'}
											>
												{b.result}
											</span>
										{:else}
											<span class="bill-result-badge result-pending">審議中</span>
										{/if}
									</div>

									<div class="bill-item-main">
										<span class="bill-item-title">{b.title || `法案 #${b.id}`}</span>
									</div>

									<div class="bill-item-status-row">
										<!-- Answer status -->
										{#if b.answerScore !== null}
											<span class="answer-badge {getAnswerClass(b.answerScore)}">
												{getAnswerLabel(b.answerScore)}
											</span>
										{:else if b.delegation}
											<!-- Delegation status with no direct answer -->
											<span
												class="delegation-badge {getDelegationStatusClass(b.delegation.status)}"
											>
												🤝 {b.delegation.delegateUsername}に委任 ({getDelegationStatusLabel(
													b.delegation.status
												)})
											</span>
										{:else}
											<span class="answer-badge answer-none">未回答</span>
										{/if}

										<!-- If answered AND also delegated, show delegation info too -->
										{#if b.answerScore !== null && b.delegation}
											<span
												class="delegation-badge {getDelegationStatusClass(b.delegation.status)}"
											>
												🤝 {b.delegation.delegateUsername}に委任 ({getDelegationStatusLabel(
													b.delegation.status
												)})
											</span>
										{/if}

										<span class="bill-item-chevron">›</span>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		{/if}

		<!-- Delegations Tab -->
		{#if activeTab === 'delegations'}
			{#if delegationsLoading}
				<div class="loading-state animate-in" style="--delay: 1">
					<div class="loading-spinner"></div>
					<p>委任データを読み込み中...</p>
				</div>
			{:else}
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
												<!-- Source branches (incoming delegators) -->
												<div class="chain-sources">
													{#each incomingList as incoming (incoming.id)}
														<div class="chain-source-row">
															{#if incoming.upstreamChain && incoming.upstreamChain.length > 0}
																{#each incoming.upstreamChain as link, i (i)}
																	<span class="chain-node chain-node-upstream">{link.username}</span
																	>
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

									<!-- Outgoing actions (retract available for ALL statuses) -->
									{#if outgoing}
										<div class="delegation-actions">
											<button
												class="btn-retract"
												onclick={() => retractDelegation(outgoing.id)}
												disabled={isLoading}
											>
												↩️ {isMiddleman ? '転送を取り消す' : outgoing.status === 'voted' ? '委任を取り消す' : outgoing.status === 'rejected' ? '拒否された委任を削除する' : '取り消して自分で投票する'}
											</button>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
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

	<!-- Bill detail modal -->
	{#if selectedBill}
		<BillDetailModal
			billId={selectedBill.id}
			billTitle={selectedBill.title || `法案 #${selectedBill.id}`}
			billType={selectedBill.type}
			billSubmissionSession={selectedBill.submissionSession}
			billNumber={selectedBill.number}
			billResult={selectedBill.result}
			answerScore={selectedBill.answerScore}
			hasDelegation={selectedBill.delegation !== null && selectedBill.answerScore === null}
			delegateUsername={selectedBill.delegation?.delegateUsername ?? null}
			onClose={() => (selectedBill = null)}
			onVote={handleModalVote}
			onRetract={handleModalRetract}
			onDelegate={(billId) => {
				selectedBill = null;
				openDelegateFromBill(allBills.find((bb) => bb.id === billId)!);
			}}
			onGoToDelegations={() => {
				selectedBill = null;
				switchTab('delegations');
			}}
		/>
	{/if}

	<!-- Delegate from bill list modal -->
	{#if delegatingBill}
		<DelegationModal
			show={true}
			billId={delegatingBill.billId}
			billTitle={delegatingBill.title}
			hasExistingVote={delegatingBill.hasExistingVote}
			onClose={() => (delegatingBill = null)}
			onDelegated={onDelegatedFromBill}
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

	/* ── Bills Section (Answer History Tab) ── */
	.bills-section {
		background: white;
		border-radius: 16px;
		padding: 1.5rem;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
		border: 1px solid #e5e7eb;
	}

	.bills-search-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		padding: 0.5rem 0.75rem;
		margin-bottom: 1rem;
		transition: border-color 0.2s ease;
	}

	.bills-search-bar:focus-within {
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
	}

	.search-icon {
		font-size: 1rem;
		flex-shrink: 0;
	}

	.bills-search-input {
		flex: 1;
		border: none;
		background: transparent;
		font-size: 0.95rem;
		outline: none;
		color: #1f2937;
	}

	.bills-search-input::placeholder {
		color: #9ca3af;
	}

	.search-clear-btn {
		background: none;
		border: none;
		color: #9ca3af;
		cursor: pointer;
		font-size: 1rem;
		padding: 0.1rem 0.3rem;
		border-radius: 4px;
	}

	.search-clear-btn:hover {
		color: #6b7280;
		background: #e5e7eb;
	}

	.bills-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.filter-group {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.filter-label {
		font-size: 0.7rem;
		color: #6b7280;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.filter-select {
		padding: 0.35rem 0.6rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		background: white;
		font-size: 0.85rem;
		color: #374151;
		cursor: pointer;
		outline: none;
		transition: border-color 0.2s ease;
	}

	.filter-select:focus {
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
	}

	.bills-summary {
		font-size: 0.85rem;
		color: #6b7280;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid #f3f4f6;
	}

	.empty-state-inline {
		text-align: center;
		padding: 2rem;
		color: #9ca3af;
		font-size: 0.95rem;
	}

	.bills-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.bill-item {
		padding: 0.75rem;
		border: 1px solid #f3f4f6;
		border-radius: 10px;
		transition: all 0.2s ease;
	}

	.bill-item-clickable {
		cursor: pointer;
	}

	.bill-item:hover {
		background: #f3f4ff;
		border-color: #c7d2fe;
	}

	.bill-item-answered {
		border-left: 3px solid #6366f1;
	}

	.bill-item-delegated {
		border-left: 3px solid #f59e0b;
	}

	.bill-item-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.25rem;
	}

	.bill-item-id {
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.bill-result-badge {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.1rem 0.5rem;
		border-radius: 100px;
	}

	.result-passed {
		background: #d1fae5;
		color: #065f46;
	}

	.result-rejected {
		background: #fee2e2;
		color: #991b1b;
	}

	.result-withdrawn {
		background: #f3f4f6;
		color: #6b7280;
	}

	.result-expired {
		background: #fef3c7;
		color: #92400e;
	}

	.result-pending {
		background: #eff6ff;
		color: #2563eb;
	}

	.bill-item-main {
		margin-bottom: 0.4rem;
	}

	.bill-item-title {
		font-size: 0.9rem;
		color: #1f2937;
		font-weight: 500;
		line-height: 1.4;
	}

	.bill-item-status-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}

	.bill-item-chevron {
		margin-left: auto;
		font-size: 1.25rem;
		color: #9ca3af;
		font-weight: 300;
		transition: transform 0.15s;
	}

	.bill-item-clickable:hover .bill-item-chevron {
		transform: translateX(2px);
		color: #6b7280;
	}

	.answer-none {
		background: #f9fafb;
		color: #9ca3af;
		border: 1px dashed #d1d5db;
	}

	.delegation-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.6rem;
		border-radius: 100px;
		font-size: 0.75rem;
		font-weight: 600;
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

		.bills-filters {
			flex-direction: column;
		}

		.filter-group {
			width: 100%;
		}

		.filter-select {
			width: 100%;
		}
	}

	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 4rem 2rem;
		color: #64748b;
		font-size: 0.95rem;
	}

	.loading-spinner {
		width: 2rem;
		height: 2rem;
		border: 3px solid #e5e7eb;
		border-top-color: #6366f1;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
