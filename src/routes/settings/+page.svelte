<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>設定 - Candidate Match</title>
</svelte:head>

<div class="settings-page">
	<div class="settings-container">
		<h1 class="settings-title">ユーザー設定</h1>

		<!-- Username Section -->
		<section class="settings-card">
			<h2 class="card-heading">ユーザー名</h2>

			<form method="POST" action="?/updateUsername" use:enhance class="form-body">
				<div class="field">
					<label for="username">ユーザー名</label>
					<input
						type="text"
						id="username"
						name="username"
						value={data.profile.username}
						required
						minlength={3}
						maxlength={32}
						pattern="[a-zA-Z0-9_-]+"
					/>
					<small>英数字、ハイフン、アンダースコア（3〜32文字）</small>
				</div>

				{#if form?.usernameError}
					<div class="msg msg-error">{form.usernameError}</div>
				{/if}
				{#if form?.usernameSuccess}
					<div class="msg msg-success">ユーザー名を更新しました</div>
				{/if}

				<button type="submit" class="btn-submit">変更を保存</button>
			</form>
		</section>

		<!-- Password Section -->
		<section class="settings-card">
			<h2 class="card-heading">パスワード変更</h2>

			<form method="POST" action="?/updatePassword" use:enhance class="form-body">
				<div class="field">
					<label for="currentPassword">現在のパスワード</label>
					<input
						type="password"
						id="currentPassword"
						name="currentPassword"
						required
						autocomplete="current-password"
					/>
				</div>

				<div class="field">
					<label for="newPassword">新しいパスワード</label>
					<input
						type="password"
						id="newPassword"
						name="newPassword"
						required
						minlength={8}
						maxlength={128}
						autocomplete="new-password"
					/>
					<small>8〜128文字</small>
				</div>

				<div class="field">
					<label for="confirmPassword">パスワード確認</label>
					<input
						type="password"
						id="confirmPassword"
						name="confirmPassword"
						required
						minlength={8}
						maxlength={128}
						autocomplete="new-password"
					/>
				</div>

				{#if form?.passwordError}
					<div class="msg msg-error">{form.passwordError}</div>
				{/if}
				{#if form?.passwordSuccess}
					<div class="msg msg-success">パスワードを変更しました</div>
				{/if}

				<button type="submit" class="btn-submit">パスワードを変更</button>
			</form>
		</section>
	</div>
</div>

<style>
	.settings-page {
		min-height: 100vh;
		background: #fafbfc;
		padding: 2.5rem 1rem 4rem;
	}

	.settings-container {
		max-width: 540px;
		margin: 0 auto;
	}

	.settings-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1e293b;
		margin-bottom: 1.5rem;
	}

	.settings-card {
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
		padding: 1.5rem;
		margin-bottom: 1rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
	}

	.card-heading {
		font-size: 1rem;
		font-weight: 600;
		color: #334155;
		margin-bottom: 1.25rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid #f1f5f9;
	}

	.form-body {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	label {
		font-size: 0.8125rem;
		font-weight: 500;
		color: #64748b;
	}

	input {
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
		color: #94a3b8;
		font-size: 0.75rem;
	}

	.msg {
		font-size: 0.8125rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
	}

	.msg-error {
		background: #fef2f2;
		color: #dc2626;
		border: 1px solid #fecaca;
	}

	.msg-success {
		background: #f0fdf4;
		color: #16a34a;
		border: 1px solid #bbf7d0;
	}

	.btn-submit {
		align-self: flex-start;
		padding: 0.5rem 1.25rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 0.375rem;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.btn-submit:hover {
		background: #4f46e5;
	}
</style>
