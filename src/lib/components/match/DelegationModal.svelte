<script lang="ts">
	import { Handshake, Hourglass, TriangleAlert, X } from '@lucide/svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { createHoldGesture } from '$lib/utils/hold-gesture.svelte.js';

	type Friend = {
		requestId: number;
		friendId: string;
		friendUsername: string;
		friendAvatarUrl: string | null;
		since: string;
	};

	interface Props {
		show: boolean;
		billId: number;
		billTitle: string;
		billRef?: string | null;
		hasExistingVote?: boolean;
		currentDelegateId?: string | null;
		currentDelegationStatus?: 'pending' | 'voted' | null;
		onClose: () => void;
		onDelegated: () => void;
	}

	let {
		show,
		billId,
		billTitle,
		billRef = null,
		hasExistingVote = false,
		currentDelegateId = null,
		currentDelegationStatus = null,
		onClose,
		onDelegated
	}: Props = $props();

	let isChangingDelegate = $derived(!!currentDelegateId);

	let friends: Friend[] = $state([]);
	let loading = $state(false);
	let submitting = $state(false);
	let error: string | null = $state(null);
	let successMessage: string | null = $state(null);
	let confirmingFriend: Friend | null = $state(null);

	// Long-press state for friend delegation
	const friendHold = createHoldGesture<string>({
		onComplete: (friendId) => {
			const friend = friends.find((f) => f.friendId === friendId);
			if (friend) handleFriendClick(friend);
		},
		disabled: () => submitting
	});

	$effect(() => {
		if (show) {
			loadFriends();
			error = null;
			successMessage = null;
			confirmingFriend = null;
			friendHold.cancel();
		}
	});

	async function loadFriends() {
		loading = true;
		try {
			const res = await fetch('/api/friends?action=list');
			const data = await res.json();
			friends = data.friends ?? [];
		} catch {
			error = 'フレンド一覧の取得に失敗しました';
		}
		loading = false;
	}

	async function delegateTo(friendId: string) {
		submitting = true;
		error = null;
		successMessage = null;
		confirmingFriend = null;

		try {
			const res = await fetch('/api/delegations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'delegate',
					delegateId: friendId,
					billId
				})
			});

			const data = await res.json();

			if (!res.ok || !data.success) {
				throw new Error(data.error || '委任に失敗しました');
			}

			successMessage = data.message;
			setTimeout(() => {
				onDelegated();
				onClose();
			}, 1000);
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			submitting = false;
		}
	}

	function handleFriendClick(friend: Friend) {
		if (hasExistingVote || isChangingDelegate) {
			confirmingFriend = friend;
		} else {
			delegateTo(friend.friendId);
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}
</script>

{#if show}
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="modal-backdrop"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
		role="dialog"
		aria-modal="true"
		aria-label="委任先を選ぶ"
	>
		<div class="modal-content">
			<div class="modal-header">
				<h3 class="modal-title">
					<Handshake size={16} class="inline-icon" />
					{isChangingDelegate ? '委任先を変更' : '投票を委任する'}
				</h3>
				<button class="modal-close" onclick={onClose} aria-label="閉じる"><X size={16} /></button>
			</div>

			<div class="modal-bill-info">
				<span class="bill-label">対象法案:</span>
				<span class="bill-name">{billTitle}</span>
				{#if billRef}
					<span class="bill-ref">{billRef}</span>
				{/if}
			</div>

			{#if error}
				<div class="modal-error">{error}</div>
			{/if}

			{#if successMessage}
				<div class="modal-success">{successMessage}</div>
			{/if}

			<div class="modal-body">
				{#if loading}
					<div class="modal-loading">
						<Hourglass size={14} class="inline-icon" /> フレンドを読み込み中...
					</div>
				{:else if friends.length === 0}
					<div class="modal-empty">
						<p>フレンドがいません</p>
						<p class="modal-empty-hint">
							<a href="/friends">フレンドページ</a>でフレンドを追加してください
						</p>
					</div>
				{:else if confirmingFriend}
					<div class="confirm-message">
						{#if isChangingDelegate && currentDelegationStatus === 'voted'}
							<div class="caution-box">
								<p>
									<TriangleAlert size={14} class="inline-icon" color="#dc2626" />
									現在の委任先は既に投票済みです。委任先を変えると、結果が変わる可能性があります。
								</p>
							</div>
						{:else if isChangingDelegate}
							<p>
								<TriangleAlert size={14} class="inline-icon" color="#f59e0b" />
								現在の委任を取り消して、新しいフレンドに委任します。
							</p>
						{:else}
							<p>
								<TriangleAlert size={14} class="inline-icon" color="#f59e0b" />
								この法案にはすでに投票があります。委任すると投票が削除されます。
							</p>
						{/if}
						<p class="confirm-target">
							新しい委任先: <strong>{confirmingFriend.friendUsername}</strong>
						</p>
						<div class="confirm-actions">
							<button
								class="confirm-btn confirm-btn-cancel"
								onclick={() => (confirmingFriend = null)}
								disabled={submitting}
							>
								キャンセル
							</button>
							<button
								class="confirm-btn confirm-btn-ok"
								onclick={() => delegateTo(confirmingFriend!.friendId)}
								disabled={submitting}
							>
								{isChangingDelegate ? '委任先を変更する' : '投票を削除して委任する'}
							</button>
						</div>
					</div>
				{:else}
					<p class="modal-desc">
						委任先のフレンドを長押しで選んでください。フレンドがあなたの代わりに投票します。
					</p>
					<div class="friends-list">
						{#each friends as friend (friend.requestId)}
							{@const isCurrentDelegate = currentDelegateId === friend.friendId}
							<button
								class="friend-item"
								class:holding={friendHold.holdingId === friend.friendId}
								class:current-delegate={isCurrentDelegate}
								onpointerdown={() => friendHold.start(friend.friendId)}
								onpointerup={friendHold.cancel}
								onpointerleave={friendHold.cancel}
								disabled={submitting || isCurrentDelegate}
							>
								<span
									class="friend-fill"
									style="transform: scaleX({friendHold.holdingId === friend.friendId
										? friendHold.progress
										: 0})"
								></span>
								<span class="friend-avatar"
									><Avatar
										username={friend.friendUsername}
										avatarUrl={friend.friendAvatarUrl}
										size="sm"
									/></span
								>
								<span class="friend-name">{friend.friendUsername}</span>
								{#if isCurrentDelegate}
									<span class="current-delegate-badge">現在の委任先</span>
								{:else}
									<span class="delegate-action">長押しで委任</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
		animation: fadeIn 0.2s ease;
	}

	.modal-content {
		background: white;
		border-radius: 16px;
		padding: 0;
		max-width: 480px;
		width: 100%;
		max-height: 80vh;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
		animation: slideUp 0.3s ease;
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.modal-title {
		font-size: 1.2rem;
		font-weight: 700;
		color: #1f2937;
	}

	.modal-close {
		background: none;
		border: none;
		font-size: 1.2rem;
		cursor: pointer;
		color: #6b7280;
		padding: 0.25rem;
		border-radius: 6px;
		transition: all 0.2s;
	}

	.modal-close:hover {
		background: #f3f4f6;
		color: #1f2937;
	}

	.modal-bill-info {
		padding: 0.75rem 1.5rem;
		background: #f9fafb;
		border-bottom: 1px solid #e5e7eb;
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
	}

	.bill-label {
		font-size: 0.8rem;
		color: #6b7280;
		flex-shrink: 0;
	}

	.bill-name {
		font-size: 0.9rem;
		font-weight: 600;
		color: #1f2937;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.bill-ref {
		display: block;
		font-size: 0.7rem;
		color: #9ca3af;
		font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
	}

	.modal-body {
		padding: 1.5rem;
		overflow-y: auto;
	}

	.modal-desc {
		font-size: 0.9rem;
		color: #6b7280;
		margin-bottom: 1rem;
		line-height: 1.5;
	}

	.modal-loading {
		text-align: center;
		padding: 2rem;
		color: #6b7280;
	}

	.modal-empty {
		text-align: center;
		padding: 2rem;
		color: #6b7280;
	}

	.modal-empty-hint {
		font-size: 0.85rem;
		margin-top: 0.5rem;
	}

	.modal-empty-hint a {
		color: #6366f1;
		text-decoration: underline;
	}

	.modal-error {
		margin: 0.75rem 1.5rem 0;
		padding: 0.75rem 1rem;
		background: #fee2e2;
		color: #991b1b;
		border-radius: 8px;
		font-size: 0.9rem;
	}

	.modal-success {
		margin: 0.75rem 1.5rem 0;
		padding: 0.75rem 1rem;
		background: #d1fae5;
		color: #065f46;
		border-radius: 8px;
		font-size: 0.9rem;
	}

	.friends-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.friend-item {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		cursor: pointer;
		transition: all 0.2s ease;
		width: 100%;
		text-align: left;
		overflow: hidden;
		-webkit-user-select: none;
		user-select: none;
	}

	.friend-item:hover:not(:disabled) {
		background: #f3f4f6;
		border-color: #d1d5db;
	}

	.friend-item.holding {
		border-color: #6366f1;
		transform: scale(0.98);
	}

	.friend-fill {
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;
		width: 100%;
		background: rgba(99, 102, 241, 0.15);
		transform-origin: left;
		transform: scaleX(0);
		pointer-events: none;
		z-index: 0;
	}

	.friend-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.friend-avatar {
		position: relative;
		z-index: 1;
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.friend-name {
		position: relative;
		z-index: 1;
		flex: 1;
		font-weight: 600;
		color: #1f2937;
		font-size: 0.95rem;
	}

	.delegate-action {
		position: relative;
		z-index: 1;
		font-size: 0.8rem;
		color: #9ca3af;
		font-weight: 500;
		transition: color 0.2s;
	}

	.friend-item.holding .delegate-action {
		color: #6366f1;
		font-weight: 600;
	}

	.friend-item.current-delegate {
		background: #f3f4f6;
		border-color: #d1d5db;
		opacity: 0.6;
		cursor: not-allowed;
	}

	.current-delegate-badge {
		position: relative;
		z-index: 1;
		font-size: 0.75rem;
		color: #6366f1;
		font-weight: 600;
		background: #eef2ff;
		padding: 0.2rem 0.5rem;
		border-radius: 6px;
		white-space: nowrap;
	}

	.confirm-message {
		text-align: center;
		padding: 0.5rem 0;
	}

	.confirm-message p {
		margin: 0 0 0.75rem;
		color: #92400e;
		font-size: 0.95rem;
	}

	.caution-box {
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin-bottom: 0.75rem;
	}

	.caution-box p {
		color: #991b1b;
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.confirm-target {
		color: #1f2937 !important;
	}

	.confirm-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
		margin-top: 1rem;
	}

	.confirm-btn {
		padding: 0.6rem 1.2rem;
		border-radius: 8px;
		border: none;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.confirm-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.confirm-btn-cancel {
		background: #f3f4f6;
		color: #374151;
	}

	.confirm-btn-ok {
		background: #dc2626;
		color: white;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
