<script lang="ts">
	import { Handshake, Hourglass, TriangleAlert, X, User } from '@lucide/svelte';

	type Friend = {
		requestId: number;
		friendId: string;
		friendUsername: string;
		since: string;
	};

	interface Props {
		show: boolean;
		billId: number;
		billTitle: string;
		hasExistingVote?: boolean;
		onClose: () => void;
		onDelegated: () => void;
	}

	let { show, billId, billTitle, hasExistingVote = false, onClose, onDelegated }: Props = $props();

	let friends: Friend[] = $state([]);
	let loading = $state(false);
	let submitting = $state(false);
	let error: string | null = $state(null);
	let successMessage: string | null = $state(null);
	let confirmingFriend: Friend | null = $state(null);

	$effect(() => {
		if (show) {
			loadFriends();
			error = null;
			successMessage = null;
			confirmingFriend = null;
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
		if (hasExistingVote) {
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
				<h3 class="modal-title"><Handshake size={16} class="inline-icon" /> 投票を委任する</h3>
				<button class="modal-close" onclick={onClose} aria-label="閉じる"><X size={16} /></button>
			</div>

			<div class="modal-bill-info">
				<span class="bill-label">対象法案:</span>
				<span class="bill-name">{billTitle}</span>
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
						<p>
							<TriangleAlert size={14} class="inline-icon" color="#f59e0b" /> この法案にはすでに投票があります。委任すると投票が削除されます。
						</p>
						<p class="confirm-target">委任先: <strong>{confirmingFriend.friendUsername}</strong></p>
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
								投票を削除して委任する
							</button>
						</div>
					</div>
				{:else}
					<p class="modal-desc">
						委任先のフレンドを選んでください。フレンドがあなたの代わりに投票します。
					</p>
					<div class="friends-list">
						{#each friends as friend (friend.requestId)}
							<button
								class="friend-item"
								onclick={() => handleFriendClick(friend)}
								disabled={submitting}
							>
								<span class="friend-avatar"><User size={16} /></span>
								<span class="friend-name">{friend.friendUsername}</span>
								<span class="delegate-action">委任 →</span>
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
	}

	.friend-item:hover:not(:disabled) {
		background: #ede9fe;
		border-color: #c4b5fd;
		transform: translateX(4px);
	}

	.friend-item:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.friend-avatar {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.friend-name {
		flex: 1;
		font-weight: 600;
		color: #1f2937;
		font-size: 0.95rem;
	}

	.delegate-action {
		font-size: 0.85rem;
		color: #6366f1;
		font-weight: 600;
		opacity: 0;
		transition: opacity 0.2s;
	}

	.friend-item:hover .delegate-action {
		opacity: 1;
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
