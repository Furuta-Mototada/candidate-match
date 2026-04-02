<script lang="ts">
	import { Users, Mailbox, Search } from '@lucide/svelte';
	import { LoadingSpinner } from '$lib/components/index.js';
	import Avatar from '$lib/components/Avatar.svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	type SearchUser = {
		id: string;
		username: string;
		avatarUrl: string | null;
		friendStatus: 'none' | 'pending_sent' | 'pending_received' | 'accepted' | 'rejected';
	};

	type Friend = {
		requestId: number;
		friendId: string;
		friendUsername: string;
		friendAvatarUrl: string | null;
		since: string;
	};

	type IncomingRequest = {
		id: number;
		senderId: string;
		senderUsername: string;
		senderAvatarUrl: string | null;
		createdAt: string;
	};

	type OutgoingRequest = {
		id: number;
		receiverId: string;
		receiverUsername: string;
		receiverAvatarUrl: string | null;
		createdAt: string;
	};

	let tab: 'friends' | 'requests' | 'search' = $state('friends');
	let friends: Friend[] = $state([]);
	let incoming: IncomingRequest[] = $state([]);
	let outgoing: OutgoingRequest[] = $state([]);
	let searchQuery = $state('');
	let searchResults: SearchUser[] = $state([]);
	let loading = $state(false);
	let pageDataLoading = $state(true);
	let searchLoading = $state(false);
	let message: { text: string; type: 'success' | 'error' } | null = $state(null);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;

	// Resolve streamed data
	$effect(() => {
		const promise = data.streamed;
		if (promise && typeof promise.then === 'function') {
			pageDataLoading = true;
			promise.then((resolved: { friends: Friend[]; incoming: IncomingRequest[]; outgoing: OutgoingRequest[] }) => {
				friends = resolved.friends || [];
				incoming = resolved.incoming || [];
				outgoing = resolved.outgoing || [];
				pageDataLoading = false;
			}).catch(() => {
				pageDataLoading = false;
			});
		}
	});

	function showMessage(text: string, type: 'success' | 'error') {
		message = { text, type };
		setTimeout(() => (message = null), 3000);
	}

	async function loadFriends() {
		loading = true;
		try {
			const res = await fetch('/api/friends?action=list');
			const data = await res.json();
			friends = data.friends ?? [];
		} catch {
			showMessage('フレンド一覧の取得に失敗しました', 'error');
		}
		loading = false;
	}

	async function loadRequests() {
		loading = true;
		try {
			const res = await fetch('/api/friends?action=requests');
			const data = await res.json();
			incoming = data.incoming ?? [];
			outgoing = data.outgoing ?? [];
		} catch {
			showMessage('リクエストの取得に失敗しました', 'error');
		}
		loading = false;
	}

	function handleSearchInput() {
		if (searchTimeout) clearTimeout(searchTimeout);
		if (!searchQuery.trim()) {
			searchResults = [];
			return;
		}
		searchTimeout = setTimeout(searchUsers, 300);
	}

	async function searchUsers() {
		if (!searchQuery.trim()) return;
		searchLoading = true;
		try {
			const res = await fetch(`/api/friends?action=search&q=${encodeURIComponent(searchQuery)}`);
			const data = await res.json();
			searchResults = data.users ?? [];
		} catch {
			showMessage('検索に失敗しました', 'error');
		}
		searchLoading = false;
	}

	async function sendRequest(receiverId: string) {
		try {
			const res = await fetch('/api/friends', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'send', receiverId })
			});
			const data = await res.json();
			if (data.success) {
				showMessage(data.message, 'success');
				// Refresh search results to update status
				await searchUsers();
				await loadRequests();
			} else {
				showMessage(data.error, 'error');
			}
		} catch {
			showMessage('リクエストの送信に失敗しました', 'error');
		}
	}

	async function respondToRequest(requestId: number, response: 'accepted' | 'rejected') {
		try {
			const res = await fetch('/api/friends', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'respond', requestId, response })
			});
			const data = await res.json();
			if (data.success) {
				showMessage(data.message, 'success');
				await loadRequests();
				await loadFriends();
			} else {
				showMessage(data.error, 'error');
			}
		} catch {
			showMessage('応答に失敗しました', 'error');
		}
	}

	async function cancelRequest(requestId: number) {
		try {
			const res = await fetch('/api/friends', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'cancel', requestId })
			});
			const data = await res.json();
			if (data.success) {
				showMessage(data.message, 'success');
				await loadRequests();
			} else {
				showMessage(data.error, 'error');
			}
		} catch {
			showMessage('取り消しに失敗しました', 'error');
		}
	}

	async function removeFriend(friendId: string) {
		if (!confirm('このフレンドを削除しますか？')) return;
		try {
			const res = await fetch('/api/friends', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'remove', friendId })
			});
			const data = await res.json();
			if (data.success) {
				showMessage(data.message, 'success');
				await loadFriends();
			} else {
				showMessage(data.error, 'error');
			}
		} catch {
			showMessage('削除に失敗しました', 'error');
		}
	}

	function switchTab(newTab: typeof tab) {
		tab = newTab;
		if (newTab === 'friends') loadFriends();
		else if (newTab === 'requests') loadRequests();
		else {
			searchQuery = '';
			searchResults = [];
		}
	}

	let pendingCount = $derived(incoming.length);
</script>

<svelte:head>
	<title>フレンド - Candidate Match</title>
</svelte:head>

<div class="friends-page">
	<div class="friends-container">
		<h1 class="page-title">フレンド</h1>

		{#if pageDataLoading}
			<LoadingSpinner message="データを読み込み中..." size="large" />
		{:else}

		{#if message}
			<div class="toast toast-{message.type}">{message.text}</div>
		{/if}

		<!-- Tabs -->
		<div class="tabs">
			<button class="tab" class:tab-active={tab === 'friends'} onclick={() => switchTab('friends')}>
				フレンド一覧
				{#if friends.length > 0}
					<span class="tab-count">{friends.length}</span>
				{/if}
			</button>
			<button
				class="tab"
				class:tab-active={tab === 'requests'}
				onclick={() => switchTab('requests')}
			>
				リクエスト
				{#if pendingCount > 0}
					<span class="tab-count tab-count-alert">{pendingCount}</span>
				{/if}
			</button>
			<button class="tab" class:tab-active={tab === 'search'} onclick={() => switchTab('search')}>
				ユーザー検索
			</button>
		</div>

		<!-- Friends List -->
		{#if tab === 'friends'}
			<div class="panel">
				{#if loading}
					<div class="empty-state">読み込み中...</div>
				{:else if friends.length === 0}
					<div class="empty-state">
						<div class="empty-icon"><Users size={32} /></div>
						<p>まだフレンドがいません</p>
						<button class="btn-primary" onclick={() => switchTab('search')}>
							ユーザーを検索する
						</button>
					</div>
				{:else}
					<ul class="user-list">
						{#each friends as friend (friend.friendId)}
							<li class="user-item">
								<div class="user-info">
									<Avatar
										username={friend.friendUsername}
										avatarUrl={friend.friendAvatarUrl}
										size="md"
									/>
									<div>
										<span class="username">{friend.friendUsername}</span>
										<span class="meta">
											{new Date(friend.since).toLocaleDateString('ja-JP')} から
										</span>
									</div>
								</div>
								<button class="btn-danger-ghost" onclick={() => removeFriend(friend.friendId)}>
									削除
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}

		<!-- Requests -->
		{#if tab === 'requests'}
			<div class="panel">
				{#if loading}
					<div class="empty-state">読み込み中...</div>
				{:else}
					{#if incoming.length > 0}
						<h3 class="section-heading">受信リクエスト</h3>
						<ul class="user-list">
							{#each incoming as req (req.id)}
								<li class="user-item">
									<div class="user-info">
										<Avatar
											username={req.senderUsername}
											avatarUrl={req.senderAvatarUrl}
											size="md"
										/>
										<div>
											<span class="username">{req.senderUsername}</span>
											<span class="meta">
												{new Date(req.createdAt).toLocaleDateString('ja-JP')}
											</span>
										</div>
									</div>
									<div class="action-group">
										<button
											class="btn-primary btn-sm"
											onclick={() => respondToRequest(req.id, 'accepted')}
										>
											承認
										</button>
										<button
											class="btn-ghost btn-sm"
											onclick={() => respondToRequest(req.id, 'rejected')}
										>
											拒否
										</button>
									</div>
								</li>
							{/each}
						</ul>
					{/if}

					{#if outgoing.length > 0}
						<h3 class="section-heading" class:mt={incoming.length > 0}>送信リクエスト</h3>
						<ul class="user-list">
							{#each outgoing as req (req.id)}
								<li class="user-item">
									<div class="user-info">
										<Avatar
											username={req.receiverUsername}
											avatarUrl={req.receiverAvatarUrl}
											size="md"
										/>
										<div>
											<span class="username">{req.receiverUsername}</span>
											<span class="meta">
												{new Date(req.createdAt).toLocaleDateString('ja-JP')}
											</span>
										</div>
									</div>
									<button class="btn-ghost btn-sm" onclick={() => cancelRequest(req.id)}>
										取り消す
									</button>
								</li>
							{/each}
						</ul>
					{/if}

					{#if incoming.length === 0 && outgoing.length === 0}
						<div class="empty-state">
							<div class="empty-icon"><Mailbox size={32} /></div>
							<p>リクエストはありません</p>
						</div>
					{/if}
				{/if}
			</div>
		{/if}

		<!-- Search -->
		{#if tab === 'search'}
			<div class="panel">
				<div class="search-box">
					<input
						type="text"
						placeholder="ユーザー名で検索..."
						bind:value={searchQuery}
						oninput={handleSearchInput}
						class="search-input"
					/>
					{#if searchLoading}
						<span class="search-spinner"></span>
					{/if}
				</div>

				{#if searchResults.length > 0}
					<ul class="user-list">
						{#each searchResults as user (user.id)}
							<li class="user-item">
								<div class="user-info">
									<Avatar username={user.username} avatarUrl={user.avatarUrl} size="md" />
									<span class="username">{user.username}</span>
								</div>
								{#if user.friendStatus === 'accepted'}
									<span class="status-badge status-friend">フレンド</span>
								{:else if user.friendStatus === 'pending_sent'}
									<span class="status-badge status-pending">リクエスト済み</span>
								{:else if user.friendStatus === 'pending_received'}
									<button
										class="btn-primary btn-sm"
										onclick={() => respondToRequest(0, 'accepted')}
									>
										承認する
									</button>
								{:else}
									<button class="btn-primary btn-sm" onclick={() => sendRequest(user.id)}>
										リクエスト送信
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{:else if searchQuery.trim() && !searchLoading}
					<div class="empty-state">
						<p>「{searchQuery}」に一致するユーザーが見つかりません</p>
					</div>
				{:else if !searchQuery.trim()}
					<div class="empty-state">
						<div class="empty-icon"><Search size={32} /></div>
						<p>ユーザー名を入力して検索</p>
					</div>
				{/if}
			</div>
		{/if}
		{/if}
	</div>
</div>

<style>
	.friends-page {
		min-height: 100vh;
		background: #fafbfc;
		padding: 2.5rem 1rem 4rem;
	}

	.friends-container {
		max-width: 600px;
		margin: 0 auto;
	}

	.page-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1e293b;
		margin-bottom: 1.5rem;
	}

	/* Toast */
	.toast {
		padding: 0.625rem 1rem;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 500;
		margin-bottom: 1rem;
		animation: slideIn 0.2s ease;
	}

	.toast-success {
		background: #f0fdf4;
		color: #16a34a;
		border: 1px solid #bbf7d0;
	}

	.toast-error {
		background: #fef2f2;
		color: #dc2626;
		border: 1px solid #fecaca;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-0.5rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* Tabs */
	.tabs {
		display: flex;
		gap: 0.25rem;
		background: #f1f5f9;
		padding: 0.25rem;
		border-radius: 0.625rem;
		margin-bottom: 1rem;
	}

	.tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		background: none;
		border: none;
		border-radius: 0.5rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: #64748b;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.tab:hover {
		color: #334155;
	}

	.tab-active {
		background: white;
		color: #1e293b;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	.tab-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.25rem;
		height: 1.25rem;
		padding: 0 0.375rem;
		border-radius: 9999px;
		background: #e2e8f0;
		font-size: 0.6875rem;
		font-weight: 700;
		color: #475569;
	}

	.tab-count-alert {
		background: #ef4444;
		color: white;
	}

	/* Panel */
	.panel {
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
		overflow: hidden;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
	}

	/* User List */
	.user-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.user-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.875rem 1.25rem;
		border-bottom: 1px solid #f1f5f9;
		transition: background 0.1s ease;
	}

	.user-item:last-child {
		border-bottom: none;
	}

	.user-item:hover {
		background: #fafbfc;
	}

	.user-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.username {
		font-size: 0.9375rem;
		font-weight: 600;
		color: #1e293b;
	}

	.meta {
		display: block;
		font-size: 0.75rem;
		color: #94a3b8;
		margin-top: 0.125rem;
	}

	/* Section Heading */
	.section-heading {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
		padding: 0.75rem 1.25rem 0.375rem;
		border-bottom: 1px solid #f1f5f9;
	}

	.mt {
		margin-top: 0.25rem;
		border-top: 2px solid #e2e8f0;
	}

	/* Action Group */
	.action-group {
		display: flex;
		gap: 0.375rem;
	}

	/* Buttons */
	.btn-primary {
		padding: 0.4375rem 1rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.btn-primary:hover {
		background: #4f46e5;
	}

	.btn-sm {
		padding: 0.3125rem 0.75rem;
		font-size: 0.75rem;
	}

	.btn-ghost {
		padding: 0.4375rem 1rem;
		background: none;
		color: #64748b;
		border: 1px solid #e2e8f0;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-ghost:hover {
		background: #f1f5f9;
		color: #334155;
	}

	.btn-danger-ghost {
		padding: 0.3125rem 0.75rem;
		background: none;
		color: #94a3b8;
		border: 1px solid transparent;
		border-radius: 0.375rem;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-danger-ghost:hover {
		color: #ef4444;
		background: #fef2f2;
		border-color: #fecaca;
	}

	/* Status Badges */
	.status-badge {
		font-size: 0.75rem;
		font-weight: 500;
		padding: 0.25rem 0.625rem;
		border-radius: 9999px;
	}

	.status-friend {
		background: #f0fdf4;
		color: #16a34a;
		border: 1px solid #bbf7d0;
	}

	.status-pending {
		background: #fffbeb;
		color: #d97706;
		border: 1px solid #fde68a;
	}

	/* Search */
	.search-box {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #f1f5f9;
	}

	.search-input {
		flex: 1;
		padding: 0.5rem 0.75rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
		color: #1e293b;
		font-size: 0.9375rem;
		transition: all 0.15s ease;
	}

	.search-input:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
		background: white;
	}

	.search-spinner {
		width: 1.25rem;
		height: 1.25rem;
		border: 2px solid #e2e8f0;
		border-top-color: #6366f1;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Empty State */
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 3rem 1.5rem;
		color: #94a3b8;
		font-size: 0.875rem;
		text-align: center;
		gap: 0.75rem;
	}

	.empty-icon {
		font-size: 2.5rem;
		line-height: 1;
	}

	@media (max-width: 480px) {
		.friends-page {
			padding: 1.5rem 0.75rem 3rem;
		}

		.tab {
			font-size: 0.75rem;
			padding: 0.4375rem 0.5rem;
		}

		.user-item {
			padding: 0.75rem 1rem;
		}
	}
</style>
