<script lang="ts">
	import '../app.css';
	import type { LayoutData } from './$types.js';

	let { data, children }: { data: LayoutData; children: any } = $props();
</script>

<nav class="navbar">
	<div class="navbar-inner">
		<a href="/" class="brand">
			<img src="/favicon.svg" alt="" class="brand-icon" />
			<span class="brand-name">Candidate Match</span>
		</a>

		<div class="navbar-actions">
			{#if data.user}
				<a href="/settings" class="user-chip" title="設定">
					<span class="user-chip-avatar">
						{data.user.username.charAt(0).toUpperCase()}
					</span>
					<span class="user-chip-name">{data.user.username}</span>
					{#if data.user.role === 'admin'}
						<span class="badge-admin">Admin</span>
					{/if}
				</a>
				<form method="POST" action="/auth/logout" style="display:inline">
					<button type="submit" class="btn-logout">ログアウト</button>
				</form>
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

	/* User chip */
	.user-chip {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.625rem 0.25rem 0.25rem;
		background: #f1f5f9;
		border: 1px solid #e2e8f0;
		border-radius: 9999px;
		text-decoration: none;
		color: #334155;
		font-size: 0.8125rem;
		font-weight: 500;
		transition: all 0.15s ease;
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

	.btn-logout {
		background: none;
		border: none;
		color: #94a3b8;
		font-size: 0.75rem;
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-logout:hover {
		color: #ef4444;
		background: #fef2f2;
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
