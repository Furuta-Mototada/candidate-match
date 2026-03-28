<script lang="ts">
	import '../app.css';
	import type { LayoutData } from './$types.js';

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
						<svg
							class="chevron"
							class:chevron-open={dropdownOpen}
							width="12"
							height="12"
							viewBox="0 0 12 12"
							fill="none"
						>
							<path
								d="M3 4.5L6 7.5L9 4.5"
								stroke="currentColor"
								stroke-width="1.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>

					{#if dropdownOpen}
						<div class="dropdown-menu" role="menu">
							<a href="/friends" class="dropdown-item" role="menuitem" onclick={closeDropdown}>
								<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
									<path
										d="M6 7C7.38071 7 8.5 5.88071 8.5 4.5C8.5 3.11929 7.38071 2 6 2C4.61929 2 3.5 3.11929 3.5 4.5C3.5 5.88071 4.61929 7 6 7Z"
										stroke="currentColor"
										stroke-width="1.3"
									/>
									<path
										d="M1.5 13.5C1.5 11.0147 3.51472 9 6 9C8.48528 9 10.5 11.0147 10.5 13.5"
										stroke="currentColor"
										stroke-width="1.3"
										stroke-linecap="round"
									/>
									<path
										d="M11 6.5C12.1046 6.5 13 5.60457 13 4.5C13 3.39543 12.1046 2.5 11 2.5"
										stroke="currentColor"
										stroke-width="1.3"
										stroke-linecap="round"
									/>
									<path
										d="M11.5 9C13.433 9 15 10.567 15 12.5"
										stroke="currentColor"
										stroke-width="1.3"
										stroke-linecap="round"
									/>
								</svg>
								<span>フレンド</span>
								{#if data.pendingFriendRequests > 0}
									<span class="badge-pending">{data.pendingFriendRequests}</span>
								{/if}
							</a>
							<a href="/settings" class="dropdown-item" role="menuitem" onclick={closeDropdown}>
								<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
									<path
										d="M8 10C9.10457 10 10 9.10457 10 8C10 6.89543 9.10457 6 8 6C6.89543 6 6 6.89543 6 8C6 9.10457 6.89543 10 8 10Z"
										stroke="currentColor"
										stroke-width="1.3"
									/>
									<path
										d="M13.05 10.13C12.95 10.35 12.95 10.61 13.08 10.82L13.42 11.39C13.58 11.65 13.52 11.99 13.29 12.18L12.18 13.08C11.97 13.26 11.66 13.27 11.43 13.12L10.82 12.73C10.61 12.6 10.35 12.58 10.12 12.67L10.05 12.7C9.83 12.79 9.68 13 9.66 13.24L9.58 13.93C9.55 14.22 9.3 14.44 9.01 14.44H7.53C7.24 14.44 6.99 14.22 6.96 13.93L6.88 13.24C6.86 13 6.71 12.79 6.49 12.7L6.42 12.67C6.19 12.58 5.93 12.6 5.72 12.73L5.11 13.12C4.88 13.27 4.57 13.26 4.36 13.08L3.25 12.18C3.02 11.99 2.96 11.65 3.12 11.39L3.46 10.82C3.59 10.61 3.59 10.35 3.49 10.13L3.47 10.08C3.37 9.86 3.17 9.71 2.93 9.69L2.24 9.62C1.95 9.59 1.73 9.34 1.73 9.05V7.57C1.73 7.28 1.95 7.03 2.24 7L2.93 6.93C3.17 6.91 3.37 6.76 3.47 6.54L3.49 6.49C3.59 6.27 3.59 6.01 3.46 5.8L3.12 5.23C2.96 4.97 3.02 4.63 3.25 4.44L4.36 3.54C4.57 3.36 4.88 3.35 5.11 3.5L5.72 3.89C5.93 4.02 6.19 4.04 6.42 3.95L6.49 3.92C6.71 3.83 6.86 3.62 6.88 3.38L6.96 2.69C6.99 2.4 7.24 2.18 7.53 2.18H9.01C9.3 2.18 9.55 2.4 9.58 2.69L9.66 3.38C9.68 3.62 9.83 3.83 10.05 3.92L10.12 3.95C10.35 4.04 10.61 4.02 10.82 3.89L11.43 3.5C11.66 3.35 11.97 3.36 12.18 3.54L13.29 4.44C13.52 4.63 13.58 4.97 13.42 5.23L13.08 5.8C12.95 6.01 12.95 6.27 13.05 6.49L13.07 6.54C13.17 6.76 13.37 6.91 13.61 6.93L14.3 7C14.59 7.03 14.81 7.28 14.81 7.57V9.05C14.81 9.34 14.59 9.59 14.3 9.62L13.61 9.69C13.37 9.71 13.17 9.86 13.07 10.08L13.05 10.13Z"
										stroke="currentColor"
										stroke-width="1.3"
									/>
								</svg>
								<span>設定</span>
							</a>
							<div class="dropdown-divider"></div>
							<form method="POST" action="/auth/logout">
								<button type="submit" class="dropdown-item dropdown-item-danger" role="menuitem">
									<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
										<path
											d="M6 14H3.5C3.10218 14 2.72064 13.842 2.43934 13.5607C2.15804 13.2794 2 12.8978 2 12.5V3.5C2 3.10218 2.15804 2.72064 2.43934 2.43934C2.72064 2.15804 3.10218 2 3.5 2H6"
											stroke="currentColor"
											stroke-width="1.3"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
										<path
											d="M10.5 11.5L14 8L10.5 4.5"
											stroke="currentColor"
											stroke-width="1.3"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
										<path
											d="M14 8H6"
											stroke="currentColor"
											stroke-width="1.3"
											stroke-linecap="round"
											stroke-linejoin="round"
										/>
									</svg>
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
