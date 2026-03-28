<script lang="ts">
	import {
		Bell,
		User,
		Handshake,
		Frown,
		MailOpen,
		CircleX,
		ArrowUpRight,
		Vote,
		Undo2,
		PartyPopper
	} from '@lucide/svelte';

	interface Notification {
		id: number;
		type: string;
		actorId: string | null;
		actorUsername: string | null;
		resourceId: number | null;
		billId: number | null;
		message: string;
		read: boolean;
		createdAt: string;
	}

	let { unreadCount = 0 }: { unreadCount: number } = $props();

	let open = $state(false);
	let notifications = $state<Notification[]>([]);
	let loading = $state(false);
	let hasMore = $state(false);
	let localAdjust = $state(0);
	let localUnread = $derived(Math.max(0, unreadCount + localAdjust));

	async function fetchNotifications() {
		loading = true;
		try {
			const res = await fetch('/api/notifications?action=list&limit=20');
			const data = await res.json();
			notifications = data.notifications ?? [];
			hasMore = data.hasMore ?? false;
		} finally {
			loading = false;
		}
	}

	async function loadMore() {
		if (!hasMore || loading || notifications.length === 0) return;
		const lastId = notifications[notifications.length - 1].id;
		loading = true;
		try {
			const res = await fetch(`/api/notifications?action=list&limit=20&before=${lastId}`);
			const data = await res.json();
			notifications = [...notifications, ...(data.notifications ?? [])];
			hasMore = data.hasMore ?? false;
		} finally {
			loading = false;
		}
	}

	async function markRead(id: number) {
		const notif = notifications.find((n) => n.id === id);
		if (notif && !notif.read) {
			notif.read = true;
			localAdjust -= 1;
			await fetch('/api/notifications', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'mark-read', notificationId: id })
			});
		}
	}

	async function markAllRead() {
		notifications = notifications.map((n) => ({ ...n, read: true }));
		localAdjust = -unreadCount;
		await fetch('/api/notifications', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'mark-all-read' })
		});
	}

	function toggle() {
		open = !open;
		if (open && notifications.length === 0) {
			fetchNotifications();
		}
	}

	function close() {
		open = false;
	}

	function getNotifLink(n: Notification): string | null {
		if (n.type.startsWith('friend_')) return '/friends';
		if (n.type.startsWith('delegation_')) return '/match/saved?tab=delegations';
		return null;
	}

	function timeAgo(dateStr: string): string {
		const now = Date.now();
		const then = new Date(dateStr).getTime();
		const diff = now - then;
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'たった今';
		if (mins < 60) return `${mins}分前`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours}時間前`;
		const days = Math.floor(hours / 24);
		if (days < 7) return `${days}日前`;
		return new Date(dateStr).toLocaleDateString('ja-JP');
	}

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.notif-wrapper')) {
			close();
		}
	}
</script>

<svelte:document onclick={handleClickOutside} />

{#snippet notifIcon(type: string)}
	{#if type === 'friend_request_received'}
		<User size={16} />
	{:else if type === 'friend_request_accepted'}
		<Handshake size={16} />
	{:else if type === 'friend_request_rejected'}
		<Frown size={16} />
	{:else if type === 'delegation_received'}
		<MailOpen size={16} />
	{:else if type === 'delegation_rejected'}
		<CircleX size={16} />
	{:else if type === 'delegation_redelegated'}
		<ArrowUpRight size={16} />
	{:else if type === 'delegation_voted'}
		<Vote size={16} />
	{:else if type === 'delegation_retracted'}
		<Undo2 size={16} />
	{:else if type === 'welcome'}
		<PartyPopper size={16} />
	{:else}
		<Bell size={16} />
	{/if}
{/snippet}

<div class="notif-wrapper">
	<button class="notif-bell" onclick={toggle} aria-label="通知">
		<Bell size={18} />
		{#if localUnread > 0}
			<span class="notif-badge">{localUnread > 99 ? '99+' : localUnread}</span>
		{/if}
	</button>

	{#if open}
		<div class="notif-dropdown" role="menu">
			<div class="notif-header">
				<span class="notif-title">通知</span>
				{#if localUnread > 0}
					<button class="notif-mark-all" onclick={markAllRead}>すべて既読</button>
				{/if}
			</div>

			<div class="notif-list">
				{#if loading && notifications.length === 0}
					<div class="notif-empty">読み込み中...</div>
				{:else if notifications.length === 0}
					<div class="notif-empty">通知はありません</div>
				{:else}
					{#each notifications as notif (notif.id)}
						{@const link = getNotifLink(notif)}
						{#if link}
							<a
								href={link}
								class="notif-item"
								class:notif-unread={!notif.read}
								role="menuitem"
								onclick={() => {
									markRead(notif.id);
									close();
								}}
							>
								<span class="notif-icon">{@render notifIcon(notif.type)}</span>
								<div class="notif-content">
									<span class="notif-message">{notif.message}</span>
									<span class="notif-time">{timeAgo(notif.createdAt)}</span>
								</div>
								{#if !notif.read}
									<span class="notif-dot"></span>
								{/if}
							</a>
						{:else}
							<button
								class="notif-item notif-item-btn"
								class:notif-unread={!notif.read}
								role="menuitem"
								onclick={() => markRead(notif.id)}
							>
								<span class="notif-icon">{@render notifIcon(notif.type)}</span>
								<div class="notif-content">
									<span class="notif-message">{notif.message}</span>
									<span class="notif-time">{timeAgo(notif.createdAt)}</span>
								</div>
								{#if !notif.read}
									<span class="notif-dot"></span>
								{/if}
							</button>
						{/if}
					{/each}
					{#if hasMore}
						<button class="notif-load-more" onclick={loadMore} disabled={loading}>
							{loading ? '読み込み中...' : 'もっと見る'}
						</button>
					{/if}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.notif-wrapper {
		position: relative;
	}

	.notif-bell {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 1px solid #e2e8f0;
		background: #f8fafc;
		color: #64748b;
		cursor: pointer;
		transition: all 0.15s ease;
		position: relative;
	}

	.notif-bell:hover {
		background: #e2e8f0;
		color: #334155;
	}

	.notif-badge {
		position: absolute;
		top: -4px;
		right: -4px;
		min-width: 1rem;
		height: 1rem;
		padding: 0 0.25rem;
		border-radius: 9999px;
		background: #ef4444;
		color: white;
		font-size: 0.5625rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
		border: 2px solid white;
	}

	.notif-dropdown {
		position: absolute;
		top: calc(100% + 0.375rem);
		right: 0;
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 0.625rem;
		box-shadow:
			0 4px 16px rgba(0, 0, 0, 0.08),
			0 1px 3px rgba(0, 0, 0, 0.04);
		width: 22rem;
		max-height: 28rem;
		display: flex;
		flex-direction: column;
		z-index: 200;
		animation: notif-in 0.15s ease;
	}

	@keyframes notif-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.notif-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.625rem 0.75rem;
		border-bottom: 1px solid #f1f5f9;
	}

	.notif-title {
		font-size: 0.8125rem;
		font-weight: 700;
		color: #1e293b;
	}

	.notif-mark-all {
		font-size: 0.6875rem;
		font-weight: 500;
		color: #6366f1;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		transition: background 0.1s;
	}

	.notif-mark-all:hover {
		background: #eef2ff;
	}

	.notif-list {
		overflow-y: auto;
		flex: 1;
	}

	.notif-item {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		text-decoration: none;
		color: inherit;
		cursor: pointer;
		transition: background 0.1s;
		border-bottom: 1px solid #f8fafc;
		position: relative;
	}

	.notif-item:hover {
		background: #f8fafc;
	}

	.notif-item-btn {
		text-align: left;
	}

	.notif-unread {
		background: #f0f4ff;
	}

	.notif-unread:hover {
		background: #e8edfc;
	}

	.notif-icon {
		font-size: 1rem;
		flex-shrink: 0;
		margin-top: 0.0625rem;
	}

	.notif-content {
		flex: 1;
		min-width: 0;
	}

	.notif-message {
		font-size: 0.75rem;
		color: #334155;
		line-height: 1.4;
		display: block;
	}

	.notif-time {
		font-size: 0.625rem;
		color: #94a3b8;
		margin-top: 0.125rem;
		display: block;
	}

	.notif-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #6366f1;
		flex-shrink: 0;
		margin-top: 0.25rem;
	}

	.notif-empty {
		padding: 2rem 1rem;
		text-align: center;
		color: #94a3b8;
		font-size: 0.8125rem;
	}

	.notif-load-more {
		display: block;
		width: 100%;
		padding: 0.5rem;
		text-align: center;
		font-size: 0.75rem;
		color: #6366f1;
		background: none;
		border: none;
		border-top: 1px solid #f1f5f9;
		cursor: pointer;
		transition: background 0.1s;
	}

	.notif-load-more:hover {
		background: #f8fafc;
	}

	.notif-load-more:disabled {
		color: #94a3b8;
		cursor: default;
	}

	@media (max-width: 480px) {
		.notif-dropdown {
			width: calc(100vw - 2rem);
			right: -1rem;
		}
	}
</style>
