<script lang="ts">
	import TopMatchSpotlight from '$lib/components/match/TopMatchSpotlight.svelte';
	import ClusterInsightCard from '$lib/components/match/ClusterInsightCard.svelte';
	import AllCandidatesTab from '$lib/components/match/AllCandidatesTab.svelte';
	import PartyMatchTab from '$lib/components/match/PartyMatchTab.svelte';
	import AnalysisTab from '$lib/components/match/AnalysisTab.svelte';
	import MemberDetailDrawer from '$lib/components/match/MemberDetailDrawer.svelte';
	import type { BaseClusterResult, GlobalMemberScore, PartyScores } from '$lib/types/index.js';
	import { ClipboardList, Save, Lock, RefreshCw, Hourglass, Plus } from '@lucide/svelte';

	interface Props {
		clusterResults: BaseClusterResult[];
		globalScores: GlobalMemberScore[];
		partyScores?: PartyScores | null;
		onReset?: () => void;
		onSave?: (name: string) => Promise<void>;
		isSaving?: boolean;
		snapshotSaved?: boolean;
		onContinue?: () => void;
		totalUnansweredBills?: number;
		isContinuing?: boolean;
		isLoggedIn?: boolean;
		onLoginToSave?: () => void;
		readonly?: boolean;
	}

	let {
		clusterResults,
		globalScores,
		partyScores = null,
		onReset,
		onSave,
		isSaving = false,
		snapshotSaved = false,
		onContinue,
		totalUnansweredBills = 0,
		isContinuing = false,
		isLoggedIn = false,
		onLoginToSave,
		readonly: isReadonly = false
	}: Props = $props();

	let activeTab = $state('overview');

	// Save modal state
	let showSaveModal = $state(false);
	let saveName = $state('');
	let saveError = $state<string | null>(null);

	let topMembers = $derived(globalScores.slice(0, 3));

	let selectedMember = $state<{ memberId: number; name: string; group: string | null } | null>(
		null
	);

	let allAnsweredBills = $derived.by(() => {
		const bills: NonNullable<BaseClusterResult['answeredBills']> = [];
		for (const cr of clusterResults) {
			if (cr.answeredBills) bills.push(...cr.answeredBills);
		}
		return bills;
	});

	function handleMemberClick(m: { memberId: number; name: string; group: string | null }) {
		selectedMember = m;
	}

	async function handleSave() {
		if (!onSave) return;
		if (!saveName.trim()) {
			saveError = '名前を入力してください';
			return;
		}

		saveError = null;
		try {
			await onSave(saveName.trim());
			showSaveModal = false;
			saveName = '';
		} catch (e) {
			saveError = e instanceof Error ? e.message : '保存に失敗しました';
		}
	}

	function openSaveModal() {
		const now = new Date();
		saveName = `マッチング結果 ${now.toLocaleDateString('ja-JP')}`;
		saveError = null;
		showSaveModal = true;
	}

	/** Portal action: moves the element to document.body so position:fixed works
	 *  even when an ancestor has transform (which creates a containing block). */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}
</script>

<div class="results-container">
	<!-- Simple Header -->
	<div class="results-header fade-in-up">
		{#if !isReadonly}
			<div class="header-top">
				<h2 class="results-title">マッチング結果</h2>
				<div class="header-actions">
					{#if totalUnansweredBills > 0 && onContinue}
						<button class="btn-continue" onclick={onContinue} disabled={isContinuing}>
							<span
								>{#if isContinuing}<Hourglass size={14} />{:else}<Plus size={14} />{/if}</span
							>
							{isContinuing ? '読み込み中...' : `追加回答 (${totalUnansweredBills}件)`}
						</button>
					{/if}
					{#if snapshotSaved}
						<a href="/match/saved" class="btn-view-saved">
							<span><ClipboardList size={14} /></span>
							保存済み結果を見る
						</a>
					{:else if onSave}
						<button class="btn-save" onclick={openSaveModal} disabled={isSaving}>
							<span><Save size={14} /></span>
							{isSaving ? '保存中...' : 'スナップショットを保存'}
						</button>
					{:else if !isLoggedIn}
						<button class="btn-login-to-save" onclick={onLoginToSave}>
							<span><Lock size={14} /></span>
							新規登録して保存
						</button>
					{/if}
					{#if onReset}
						<button class="btn-reset" onclick={onReset}>
							<span><RefreshCw size={14} /></span>
							設定に戻る
						</button>
					{/if}
				</div>
			</div>
		{/if}

		<div class="tabs-container">
			<div class="tabs-nav">
				<button
					class="tab-btn"
					class:active={activeTab === 'overview'}
					onclick={() => (activeTab = 'overview')}
				>
					概要
				</button>
				<button
					class="tab-btn"
					class:active={activeTab === 'analysis'}
					onclick={() => (activeTab = 'analysis')}
				>
					回答記録
				</button>
				<button
					class="tab-btn"
					class:active={activeTab === 'all-candidates'}
					onclick={() => (activeTab = 'all-candidates')}
				>
					全議員リスト
				</button>
				{#if partyScores}
					<button
						class="tab-btn"
						class:active={activeTab === 'party-match'}
						onclick={() => (activeTab = 'party-match')}
					>
						政党マッチ
					</button>
				{/if}
			</div>
		</div>
	</div>

	<!-- Tab Content -->
	<div class="tab-content">
		{#if activeTab === 'overview'}
			<!-- OVERVIEW TAB -->
			<div class="overview-tab fade-in">
				{#if topMembers.length > 0}
					<TopMatchSpotlight
						members={topMembers}
						{clusterResults}
						onMemberClick={(m) => handleMemberClick(m)}
					/>
				{/if}

				<h3 class="section-heading">分野別トップマッチ</h3>
				<div class="cluster-grid">
					{#each clusterResults as result (result.clusterLabel)}
						<ClusterInsightCard {result} />
					{/each}
				</div>
			</div>
		{:else if activeTab === 'analysis'}
			<AnalysisTab {clusterResults} onMemberClick={handleMemberClick} />
		{:else if activeTab === 'all-candidates'}
			<AllCandidatesTab {globalScores} {clusterResults} onMemberClick={handleMemberClick} />
		{:else if activeTab === 'party-match' && partyScores}
			<PartyMatchTab {partyScores} {clusterResults} />
		{/if}
	</div>

	<!-- Actions -->
	{#if !isReadonly}
		<div class="final-actions">
			{#if snapshotSaved}
				<a href="/match/saved" class="view-saved-button">
					<ClipboardList size={14} class="inline-icon" /> 保存済み結果を見る
				</a>
			{:else if onSave}
				<button onclick={openSaveModal} class="save-button" disabled={isSaving}>
					<Save size={14} class="inline-icon" />
					{isSaving ? '保存中...' : 'スナップショットを保存する'}
				</button>
			{:else if !isLoggedIn}
				<button onclick={onLoginToSave} class="save-button">
					<Lock size={14} class="inline-icon" /> 新規登録して保存
				</button>
			{/if}
			{#if onReset}
				<button onclick={onReset} class="restart-button">
					<RefreshCw size={14} class="inline-icon" /> 設定に戻る
				</button>
			{/if}
		</div>
	{/if}
</div>

{#if selectedMember}
	<MemberDetailDrawer
		{selectedMember}
		{clusterResults}
		{globalScores}
		{allAnsweredBills}
		onClose={() => (selectedMember = null)}
	/>
{/if}

<!-- Save Modal (portaled to body to escape ancestor transforms) -->
{#if showSaveModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div use:portal style="display: contents;">
		<div class="modal-overlay" onclick={() => (showSaveModal = false)}>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div class="modal-container" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
				<button class="modal-close-btn" onclick={() => (showSaveModal = false)}>×</button>

				<h2 class="modal-title">📋 スナップショットを保存</h2>
				<p class="modal-desc">現在のマッチング結果をスナップショットとして保存します。</p>

				{#if saveError}
					<div class="modal-error">{saveError}</div>
				{/if}

				<div class="form-group">
					<label for="save-name">名前 *</label>
					<input
						type="text"
						id="save-name"
						bind:value={saveName}
						placeholder="例: 2024年マッチング結果"
					/>
				</div>

				<div class="modal-actions">
					<button class="btn-cancel" onclick={() => (showSaveModal = false)}> キャンセル </button>
					<button
						class="btn-save-confirm"
						onclick={handleSave}
						disabled={isSaving || !saveName.trim()}
					>
						{isSaving ? '保存中...' : '保存する'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.results-container {
		max-width: 900px;
		margin: 0 auto;
		padding-bottom: 4rem;
	}

	/* HEADER & TABS */
	.results-header {
		text-align: center;
		margin-bottom: 2rem;
	}

	.header-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.header-actions {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.btn-save {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: linear-gradient(135deg, #10b981, #059669);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-save:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
	}

	.btn-save:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-login-to-save {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.btn-login-to-save:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
	}

	.btn-continue {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: linear-gradient(135deg, #f59e0b, #d97706);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-continue:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
	}

	.btn-view-saved {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.875rem;
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.btn-view-saved:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
	}

	.btn-reset {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: #f3f4f6;
		color: #4b5563;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-reset:hover {
		background: #e5e7eb;
	}

	.results-title {
		font-size: 1.75rem;
		font-weight: 800;
		color: #1f2937;
		margin: 0;
	}

	.tabs-container {
		display: flex;
		justify-content: center;
		padding-bottom: 1rem;
	}

	.tabs-nav {
		display: inline-flex;
		border-bottom: 1px solid #e5e7eb;
		gap: 2rem;
		padding: 0 1rem;
	}

	.tab-btn {
		background: transparent;
		border: none;
		color: #6b7280;
		padding: 0.75rem 0.5rem;
		font-weight: 600;
		font-size: 0.9375rem;
		cursor: pointer;
		transition: all 0.2s;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}

	.tab-btn:hover {
		color: #1f2937;
	}

	.tab-btn.active {
		color: #4f46e5;
		border-bottom-color: #4f46e5;
	}

	/* COMMON SECTION STYLES */
	.section-heading {
		font-size: 1.125rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* OVERVIEW TAB */
	.cluster-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 1.5rem;
	}

	/* FINAL ACTIONS */
	.final-actions {
		display: flex;
		justify-content: center;
		gap: 1rem;
		margin-top: 3rem;
		flex-wrap: wrap;
	}

	.save-button {
		background: linear-gradient(135deg, #10b981, #059669);
		color: white;
		border: none;
		padding: 0.875rem 2rem;
		border-radius: 8px;
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
	}

	.save-button:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 6px 16px rgba(16, 185, 129, 0.3);
	}

	.save-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.view-saved-button {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		padding: 0.875rem 2rem;
		border-radius: 8px;
		font-size: 0.9375rem;
		font-weight: 600;
		text-decoration: none;
		transition: all 0.2s ease;
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
	}

	.view-saved-button:hover {
		transform: translateY(-2px);
		box-shadow: 0 6px 16px rgba(99, 102, 241, 0.3);
	}

	.restart-button {
		background: white;
		color: #4b5563;
		border: 1px solid #d1d5db;
		padding: 0.75rem 2rem;
		border-radius: 8px;
		font-size: 0.9375rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}

	.restart-button:hover {
		background: #f9fafb;
		border-color: #9ca3af;
		color: #1f2937;
	}

	/* MODAL */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.modal-container {
		background: white;
		width: 100%;
		max-width: 450px;
		border-radius: 16px;
		padding: 2rem;
		position: relative;
		box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
	}

	.modal-close-btn {
		position: absolute;
		top: 1rem;
		right: 1rem;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: #f3f4f6;
		border: none;
		font-size: 1.25rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.modal-close-btn:hover {
		background: #e5e7eb;
	}

	.modal-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 0.5rem;
	}

	.modal-desc {
		color: #6b7280;
		margin-bottom: 1.5rem;
		font-size: 0.95rem;
	}

	.modal-error {
		background: #fee2e2;
		border: 1px solid #fca5a5;
		color: #991b1b;
		padding: 0.75rem 1rem;
		border-radius: 8px;
		margin-bottom: 1rem;
		font-size: 0.9rem;
	}

	.form-group {
		margin-bottom: 1.25rem;
	}

	.form-group label {
		display: block;
		font-weight: 600;
		color: #1f2937;
		margin-bottom: 0.5rem;
		font-size: 0.9rem;
	}

	.form-group input {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 1rem;
		font-family: inherit;
	}

	.form-group input:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
	}

	.modal-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: flex-end;
		margin-top: 1.5rem;
	}

	.btn-cancel {
		padding: 0.75rem 1.25rem;
		background: #f3f4f6;
		color: #4b5563;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-cancel:hover {
		background: #e5e7eb;
	}

	.btn-save-confirm {
		padding: 0.75rem 1.5rem;
		background: linear-gradient(135deg, #10b981, #059669);
		color: white;
		border: none;
		border-radius: 8px;
		font-weight: 600;
		cursor: pointer;
	}

	.btn-save-confirm:hover:not(:disabled) {
		box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
	}

	.btn-save-confirm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.fade-in-up {
		animation: fadeInUp 0.6s ease both;
	}

	.fade-in {
		animation: fadeIn 0.4s ease both;
	}

	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@media (max-width: 640px) {
		.results-title {
			font-size: 1.5rem;
		}
		.tab-btn {
			padding: 0.75rem 1rem;
			font-size: 0.875rem;
		}
		.cluster-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
