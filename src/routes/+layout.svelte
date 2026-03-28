<script lang="ts">
	import '../app.css';
	import type { LayoutData } from './$types.js';
	import NotificationDropdown from '$lib/components/NotificationDropdown.svelte';
	import { ChevronDown, Users, Settings, LogOut } from '@lucide/svelte';

	let { data, children }: { data: LayoutData; children: any } = $props();

	let dropdownOpen = $state(false);

	function toggleDropdown() {
		dropdownOpen = !dropdownOpen;
	}

	function closeDropdown() {
		dropdownOpen = false;
	}

	function handleClickOutside(event: MouseEvent) {
		const target = event.target as HTMLElement;
		if (!target.closest('.user-dropdown-wrapper')) {
			closeDropdown();
		}
	}
</script>

<svelte:document onclick={handleClickOutside} />

<nav class="navbar">
	<div class="navbar-inner">
		<a href="/" class="brand">
			<img src="/favicon.svg" alt="" class="brand-icon" />
			<span class="brand-name">Candidate Match</span>
		</a>

		<div class="navbar-actions">
			{#if data.user}
				<a href="/match/saved" class="btn-nav">保存済み</a>
				<NotificationDropdown unreadCount={data.unreadNotifications} />
				<div class="user-dropdown-wrapper">
					<button
						class="user-chip"
						onclick={toggleDropdown}
						aria-expanded={dropdownOpen}
						aria-haspopup="true"
					>
						<span class="user-chip-avatar">
							{data.user.username.charAt(0).toUpperCase()}
						</span>
						<span class="user-chip-name">{data.user.username}</span>
						{#if data.user.role === 'admin'}
							<span class="badge-admin">Admin</span>
						{/if}
						{#if data.pendingFriendRequests > 0}
							<span class="badge-pending-dot"></span>
						{/if}
						<span class="chevron" class:chevron-open={dropdownOpen}>
							<ChevronDown size={12} />
						</span>
					</button>

					{#if dropdownOpen}
						<div class="dropdown-menu" role="menu">
							<a href="/friends" class="dropdown-item" role="menuitem" onclick={closeDropdown}>
								<Users size={16} />
								<span>フレンド</span>
								{#if data.pendingFriendRequests > 0}
									<span class="badge-pending">{data.pendingFriendRequests}</span>
								{/if}
							</a>
							<a href="/settings" class="dropdown-item" role="menuitem" onclick={closeDropdown}>
								<Settings size={16} />
								<span>設定</span>
							</a>
							<div class="dropdown-divider"></div>
							<form method="POST" action="/auth/logout">
								<button type="submit" class="dropdown-item dropdown-item-danger" role="menuitem">
									<LogOut size={16} />
									<span>ログアウト</span>
								</button>
							</form>
						</div>
					{/if}
				</div>
			{:else}
				<a href="/auth/login" class="btn-nav">ログイン</a>
				<a href="/auth/register" class="btn-nav btn-nav-primary">新規登録</a>
			{/if}
		</div>
	</div>
</nav>

{@render children()}

<style>
	.navbar {
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
		position: sticky;
		top: 0;
		z-index: 100;
		padding: 0 1.25rem;
	}

	.navbar-inner {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		justify-content: space-between;
		align-items: center;
		height: 3.25rem;
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		text-decoration: none;
		color: #1e293b;
		font-weight: 700;
		font-size: 0.9375rem;
		letter-spacing: -0.02em;
	}

	.brand:hover {
		color: #6366f1;
	}

	.brand-icon {
		width: 1.375rem;
		height: 1.375rem;
	}

	.navbar-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* User chip (now a button) */
	.user-chip {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem 0.25rem 0.25rem;
		background: #f1f5f9;
		border: 1px solid #e2e8f0;
		border-radius: 9999px;
		color: #334155;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s ease;
		position: relative;
	}

	.user-chip:hover {
		background: #e2e8f0;
		border-color: #cbd5e1;
	}

	.user-chip-avatar {
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 50%;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.6875rem;
		font-weight: 700;
		line-height: 1;
	}

	.user-chip-name {
		max-width: 7rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.badge-admin {
		background: #6366f1;
		color: white;
		font-size: 0.5625rem;
		font-weight: 700;
		text-transform: uppercase;
		padding: 0.0625rem 0.3125rem;
		border-radius: 9999px;
		letter-spacing: 0.04em;
	}

	.badge-pending-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #ef4444;
		position: absolute;
		top: 0;
		right: 0;
		border: 2px solid white;
	}

	.chevron {
		transition: transform 0.2s ease;
		color: #94a3b8;
		flex-shrink: 0;
		display: inline-flex;
	}

	.chevron-open {
		transform: rotate(180deg);
	}

	/* Dropdown */
	.user-dropdown-wrapper {
		position: relative;
	}

	.dropdown-menu {
		position: absolute;
		top: calc(100% + 0.375rem);
		right: 0;
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 0.625rem;
		box-shadow:
			0 4px 16px rgba(0, 0, 0, 0.08),
			0 1px 3px rgba(0, 0, 0, 0.04);
		min-width: 11rem;
		padding: 0.25rem;
		z-index: 200;
		animation: dropdown-in 0.15s ease;
	}

	@keyframes dropdown-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		border-radius: 0.375rem;
		text-decoration: none;
		color: #334155;
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.1s ease;
		width: 100%;
		background: none;
		border: none;
		text-align: left;
	}

	.dropdown-item:hover {
		background: #f1f5f9;
	}

	.dropdown-item svg {
		color: #94a3b8;
		flex-shrink: 0;
	}

	.dropdown-item:hover svg {
		color: #64748b;
	}

	.dropdown-item-danger:hover {
		background: #fef2f2;
		color: #ef4444;
	}

	.dropdown-item-danger:hover svg {
		color: #ef4444;
	}

	.dropdown-divider {
		height: 1px;
		background: #e2e8f0;
		margin: 0.25rem 0.375rem;
	}

	/* Nav buttons */
	.btn-nav {
		font-size: 0.8125rem;
		font-weight: 500;
		padding: 0.3125rem 0.75rem;
		border-radius: 0.375rem;
		text-decoration: none;
		color: #64748b;
		transition: all 0.15s ease;
	}

	.btn-nav:hover {
		color: #334155;
		background: #f1f5f9;
	}

	.btn-nav-primary {
		background: #6366f1;
		color: white;
	}

	.btn-nav-primary:hover {
		background: #4f46e5;
		color: white;
	}

	.badge-pending {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.125rem;
		height: 1.125rem;
		padding: 0 0.3125rem;
		border-radius: 9999px;
		background: #ef4444;
		color: white;
		font-size: 0.625rem;
		font-weight: 700;
		line-height: 1;
		margin-left: auto;
	}

	@media (max-width: 480px) {
		.brand-name {
			display: none;
		}

		.user-chip-name {
			display: none;
		}

		.user-chip {
			padding: 0.25rem;
		}
	}
</style>
