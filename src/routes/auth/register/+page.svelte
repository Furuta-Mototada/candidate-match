<script lang="ts">
	import type { ActionData, PageData } from './$types.js';

	let { form, data }: { form: ActionData; data: PageData } = $props();
</script>

<div class="auth-container">
	<div class="auth-card">
		<h1>新規登録</h1>

		{#if form?.error}
			<div class="error-message">{form.error}</div>
		{/if}

		<form method="POST">
			{#if data.redirectTo}
				<input type="hidden" name="redirectTo" value={data.redirectTo} />
			{/if}
			<div class="form-group">
				<label for="username">ユーザー名</label>
				<input
					type="text"
					id="username"
					name="username"
					value={form?.username ?? ''}
					required
					autocomplete="username"
					minlength="3"
					maxlength="32"
					pattern="[a-zA-Z0-9_-]+"
				/>
				<small>3〜32文字（英数字、ハイフン、アンダースコア）</small>
			</div>

			<div class="form-group">
				<label for="password">パスワード</label>
				<input
					type="password"
					id="password"
					name="password"
					required
					autocomplete="new-password"
					minlength="8"
					maxlength="128"
				/>
				<small>8文字以上</small>
			</div>

			<div class="form-group">
				<label for="confirmPassword">パスワード確認</label>
				<input
					type="password"
					id="confirmPassword"
					name="confirmPassword"
					required
					autocomplete="new-password"
				/>
			</div>

			<button type="submit" class="btn-primary">登録</button>
		</form>

		<p class="auth-link">
			すでにアカウントをお持ちの方は <a
				href="/auth/login{data.redirectTo
					? `?redirect=${encodeURIComponent(data.redirectTo)}`
					: ''}">ログイン</a
			>
		</p>
	</div>
</div>

<style>
	.auth-container {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #fafbfc;
		padding: 1rem;
	}

	.auth-card {
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
		padding: 2.5rem;
		width: 100%;
		max-width: 420px;
		box-shadow:
			0 1px 3px rgba(0, 0, 0, 0.04),
			0 8px 24px rgba(0, 0, 0, 0.06);
	}

	h1 {
		color: #1e293b;
		font-size: 1.5rem;
		font-weight: 700;
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.error-message {
		background: #fef2f2;
		border: 1px solid #fecaca;
		color: #dc2626;
		padding: 0.75rem 1rem;
		border-radius: 0.375rem;
		margin-bottom: 1rem;
		font-size: 0.8125rem;
	}

	.form-group {
		margin-bottom: 1.25rem;
	}

	label {
		display: block;
		color: #64748b;
		font-size: 0.8125rem;
		font-weight: 500;
		margin-bottom: 0.375rem;
	}

	input {
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.375rem;
		color: #1e293b;
		font-size: 0.9375rem;
		transition: all 0.15s ease;
	}

	input:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
		background: white;
	}

	small {
		display: block;
		color: #94a3b8;
		font-size: 0.75rem;
		margin-top: 0.25rem;
	}

	.btn-primary {
		width: 100%;
		padding: 0.625rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s ease;
		margin-top: 0.5rem;
	}

	.btn-primary:hover {
		background: #4f46e5;
	}

	.auth-link {
		text-align: center;
		color: #94a3b8;
		font-size: 0.8125rem;
		margin-top: 1.5rem;
	}

	.auth-link a {
		color: #6366f1;
		text-decoration: none;
		font-weight: 500;
	}

	.auth-link a:hover {
		text-decoration: underline;
	}
</style>
