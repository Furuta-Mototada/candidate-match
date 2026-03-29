<script lang="ts">
	import {
		ClipboardList,
		Hourglass,
		Rocket,
		ChartColumn,
		Settings,
		Star,
		ChevronDown,
		ChevronUp
	} from '@lucide/svelte';
	import type { GroupedSavedVector } from '$lib/types/index.js';

	interface Props {
		groupedSavedVectors: GroupedSavedVector[];
		selectedSavedVectorKey: string | null;
		selectedGroupedVector: GroupedSavedVector | null;
		isLoading: boolean;
		isAdmin?: boolean;
		onStart: () => void;
	}

	let {
		groupedSavedVectors,
		selectedSavedVectorKey = $bindable(),
		selectedGroupedVector,
		isLoading,
		isAdmin = false,
		onStart
	}: Props = $props();

	let showAdvancedSettings = $state(false);

	// Check if the current selection is the default
	let isCurrentDefault = $derived(selectedGroupedVector?.isDefault ?? false);
</script>

<div class="setup-container animate-in" style="--delay: 3">
	<!-- Friendly header for all users -->
	<div class="setup-header">
		<h2 class="setup-title">
			<span class="icon"><Rocket size={20} /></span> あなたに合う政治家を見つけよう
		</h2>
		<a href="/match/saved" class="view-saved-link">
			<ClipboardList size={16} class="inline-icon" /> 過去の結果を見る
		</a>
	</div>

	<p class="setup-description">
		法案についての質問にいくつか回答するだけで、あなたの考えに近い政治家がわかります。
	</p>

	{#if groupedSavedVectors.length > 0}
		{#if selectedGroupedVector}
			<!-- Show selected config info and start button prominently -->
			<div class="ready-to-start">
				<div class="selected-config-summary">
					<div class="config-badge">
						{#if isCurrentDefault}
							<span class="default-badge"><Star size={12} /> おすすめ</span>
						{/if}
						<span class="config-name">{selectedGroupedVector.name}</span>
					</div>
					<div class="config-stats">
						<span class="stat">{selectedGroupedVector.clusterCount} テーマ</span>
						<span class="stat-divider">·</span>
						<span class="stat">{selectedGroupedVector.totalBills} 法案</span>
						<span class="stat-divider">·</span>
						<span class="stat">{selectedGroupedVector.totalMembers} 議員</span>
					</div>
					<div class="cluster-tags">
						{#each selectedGroupedVector.vectors.sort((a, b) => a.clusterLabel - b.clusterLabel) as v (v.id)}
							<span class="cluster-tag">
								{v.clusterLabelName || `クラスター${v.clusterLabel}`}
							</span>
						{/each}
					</div>
				</div>

				<button onclick={onStart} disabled={isLoading} class="btn-primary btn-large">
					{#if isLoading}
						<span class="loading-spinner"><Hourglass size={16} /></span>
						準備中...
					{:else}
						<Rocket size={18} class="inline-icon" /> マッチングを始める
					{/if}
				</button>
			</div>
		{:else}
			<!-- No selection yet and no default - prompt to pick one -->
			<div class="no-selection-prompt">
				<p class="prompt-text">下の設定を選択して始めましょう。</p>
			</div>
		{/if}

		<!-- Collapsible advanced settings -->
		<div class="advanced-settings-section">
			<button
				class="advanced-toggle"
				onclick={() => (showAdvancedSettings = !showAdvancedSettings)}
			>
				<Settings size={14} />
				{#if showAdvancedSettings}
					設定を変更
					<ChevronUp size={14} />
				{:else}
					設定を変更
					<ChevronDown size={14} />
				{/if}
			</button>

			{#if showAdvancedSettings}
				<div class="advanced-content">
					<select
						id="savedVector"
						class="vector-select"
						bind:value={selectedSavedVectorKey}
						disabled={isLoading}
					>
						<option value={null}>-- 設定を選択 --</option>
						{#each groupedSavedVectors as group (group.key)}
							<option value={group.key}>
								{group.name}
								{#if group.isDefault}(デフォルト){/if}
								— {group.clusterCount}テーマ, {group.totalBills}法案, {group.totalMembers}議員
							</option>
						{/each}
					</select>
					{#if isAdmin}
						<a href="/member-vectors" class="create-new-link"> 新しい設定を作成 → </a>
					{/if}
				</div>
			{/if}
		</div>
	{:else}
		<!-- No saved vectors available -->
		<div class="empty-state">
			<div class="empty-icon"><ChartColumn size={32} /></div>
			<h3 class="empty-title">まだ設定がありません</h3>
			<p class="empty-description">
				まずメンバーベクトルページでベクトル分析を実行し、結果を保存してください。
			</p>
			<a href="/member-vectors" class="btn-secondary btn-large"> メンバーベクトルページへ → </a>
		</div>
	{/if}
</div>

<style>
	.setup-container {
		max-width: 800px;
		margin: 0 auto;
	}

	.setup-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.setup-title {
		font-size: 1.875rem;
		font-weight: 700;
		color: #1f2937;
		margin: 0;
		background: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.setup-title .icon {
		background: none;
		-webkit-text-fill-color: initial;
		color: #6366f1;
	}

	.setup-description {
		font-size: 1.0625rem;
		color: #6b7280;
		line-height: 1.6;
		margin-bottom: 2rem;
	}

	.view-saved-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: linear-gradient(135deg, #f3f4f6, #e5e7eb);
		color: #4b5563;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.875rem;
		text-decoration: none;
		transition: all 0.2s ease;
		border: 1px solid #e5e7eb;
	}

	.view-saved-link:hover {
		background: linear-gradient(135deg, #e5e7eb, #d1d5db);
		color: #1f2937;
		border-color: #d1d5db;
	}

	/* Ready to start section */
	.ready-to-start {
		background: linear-gradient(135deg, #faf5ff 0%, #eff6ff 100%);
		border: 1px solid #e0e7ff;
		border-radius: 16px;
		padding: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.selected-config-summary {
		margin-bottom: 1.25rem;
	}

	.config-badge {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.default-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		background: linear-gradient(135deg, #fbbf24, #f59e0b);
		color: white;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.2rem 0.5rem;
		border-radius: 999px;
	}

	.config-name {
		font-size: 1.125rem;
		font-weight: 600;
		color: #1f2937;
	}

	.config-stats {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.stat {
		font-size: 0.875rem;
		color: #6b7280;
		font-weight: 500;
	}

	.stat-divider {
		color: #d1d5db;
	}

	.cluster-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.cluster-tag {
		padding: 0.375rem 0.75rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		font-size: 0.8125rem;
		color: #4b5563;
		font-weight: 500;
	}

	.no-selection-prompt {
		background: #f9fafb;
		border: 1px dashed #d1d5db;
		border-radius: 12px;
		padding: 1.5rem;
		text-align: center;
		margin-bottom: 1.5rem;
	}

	.prompt-text {
		color: #6b7280;
		font-size: 0.9375rem;
		margin: 0;
	}

	/* Advanced settings */
	.advanced-settings-section {
		border-top: 1px solid #e5e7eb;
		padding-top: 1rem;
	}

	.advanced-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		background: none;
		border: none;
		color: #6b7280;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		padding: 0.375rem 0;
		transition: color 0.2s ease;
	}

	.advanced-toggle:hover {
		color: #4b5563;
	}

	.advanced-content {
		margin-top: 1rem;
	}

	.create-new-link {
		display: inline-block;
		margin-top: 0.75rem;
		color: #6366f1;
		font-size: 0.875rem;
		font-weight: 500;
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.create-new-link:hover {
		color: #4f46e5;
		text-decoration: underline;
	}

	.vector-select {
		width: 100%;
		padding: 0.875rem 1rem;
		border: 2px solid #e5e7eb;
		border-radius: 12px;
		font-size: 1rem;
		color: #1f2937;
		background: white;
		transition: all 0.3s ease;
		cursor: pointer;
	}

	.vector-select:hover:not(:disabled) {
		border-color: #6366f1;
	}

	.vector-select:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
	}

	.vector-select:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-primary {
		width: 100%;
		background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
		color: white;
		border: none;
		padding: 1rem 2rem;
		border-radius: 12px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.3s ease;
		box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.3);
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}

	.btn-primary:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 8px 12px -2px rgba(99, 102, 241, 0.4);
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		transform: none;
	}

	.btn-large {
		padding: 1rem 2rem;
		font-size: 1rem;
	}

	.loading-spinner {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.empty-state {
		text-align: center;
		padding: 3rem 2rem;
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: 1rem;
	}

	.empty-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 0.75rem;
	}

	.empty-description {
		font-size: 1rem;
		color: #6b7280;
		line-height: 1.6;
		margin-bottom: 2rem;
	}

	.btn-secondary {
		display: inline-block;
		background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
		color: white;
		text-decoration: none;
		padding: 0.875rem 1.75rem;
		border-radius: 10px;
		font-weight: 600;
		transition: all 0.3s ease;
		box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3);
	}

	.btn-secondary:hover {
		transform: translateY(-2px);
		box-shadow: 0 8px 12px -2px rgba(59, 130, 246, 0.4);
	}

	.animate-in {
		animation: fadeInUp 0.6s ease calc(var(--delay, 0) * 0.1s) both;
	}

	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(30px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
