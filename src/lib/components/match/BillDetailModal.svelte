<script lang="ts">
	import type { EnrichedBillData } from '$lib/types/index.js';
	import {
		ThumbsUp,
		ThumbsDown,
		ClipboardList,
		CircleQuestionMark,
		FileText,
		Target,
		User,
		Calendar,
		Scale,
		Lightbulb,
		Vote,
		Mic,
		FileDown,
		TriangleAlert,
		Handshake,
		Undo2,
		X
	} from '@lucide/svelte';

	interface Props {
		billId: number;
		billTitle: string;
		billType: string;
		billSubmissionSession: number;
		billNumber: number;
		billResult: string | null;
		answerScore: number | null;
		hasDelegation: boolean;
		delegateUsername: string | null;
		onClose: () => void;
		onVote: (billId: number, score: number) => Promise<void>;
		onRetract: (billId: number) => Promise<void>;
		onDelegate: (billId: number) => void;
		onGoToDelegations?: () => void;
	}

	let {
		billId,
		billTitle,
		billType,
		billSubmissionSession,
		billNumber,
		billResult,
		answerScore = $bindable(),
		hasDelegation,
		delegateUsername,
		onClose,
		onVote,
		onRetract,
		onDelegate,
		onGoToDelegations
	}: Props = $props();

	let enrichmentData: EnrichedBillData | null = $state(null);
	let isLoading = $state(true);
	let loadError: string | null = $state(null);
	let actionLoading = $state(false);
	let actionError: string | null = $state(null);
	let retractConfirm = $state(false);

	function getSpeechTypeLabel(type: string | null): string {
		switch (type) {
			case 'pro':
				return '賛成意見';
			case 'con':
				return '反対意見';
			case 'explanation':
				return '政府説明';
			case 'question':
				return '質問';
			default:
				return '発言';
		}
	}

	function getSpeechTypeClass(type: string | null): string {
		switch (type) {
			case 'pro':
				return 'speech-pro';
			case 'con':
				return 'speech-con';
			case 'explanation':
				return 'speech-explanation';
			default:
				return 'speech-neutral';
		}
	}

	function truncateText(text: string, maxLength: number): string {
		if (text.length <= maxLength) return text;
		return text.slice(0, maxLength) + '...';
	}

	function getResultLabel(result: string | null): string {
		if (!result) return '審議中';
		return result;
	}

	function getAnswerLabel(score: number | null): string {
		if (score === 1) return '賛成';
		if (score === -1) return '反対';
		if (score === 0) return 'スキップ';
		return '未回答';
	}

	function getAnswerClass(score: number | null): string {
		if (score === 1) return 'answer-agree';
		if (score === -1) return 'answer-disagree';
		if (score === 0) return 'answer-skip';
		return 'answer-none';
	}

	$effect(() => {
		loadEnrichment();
	});

	async function loadEnrichment() {
		isLoading = true;
		loadError = null;
		try {
			const res = await fetch(`/api/bill-enrichment?billId=${billId}`);
			if (!res.ok) throw new Error('データの取得に失敗しました');
			enrichmentData = await res.json();
		} catch (e) {
			loadError = e instanceof Error ? e.message : '不明なエラー';
		} finally {
			isLoading = false;
		}
	}

	async function handleVote(score: number) {
		actionLoading = true;
		actionError = null;
		try {
			await onVote(billId, score);
			answerScore = score;
		} catch (e) {
			actionError = e instanceof Error ? e.message : '投票に失敗しました';
		} finally {
			actionLoading = false;
		}
	}

	async function handleRetract() {
		actionLoading = true;
		actionError = null;
		try {
			await onRetract(billId);
			answerScore = null;
			retractConfirm = false;
		} catch (e) {
			actionError = e instanceof Error ? e.message : '取り消しに失敗しました';
		} finally {
			actionLoading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_interactive_supports_focus -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="modal-backdrop"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
	role="dialog"
	aria-modal="true"
	aria-label="法案詳細"
>
	<div class="modal-content">
		<!-- Header -->
		<div class="modal-header">
			<div class="modal-header-left">
				<span class="bill-id">第{billSubmissionSession}回 {billType} 第{billNumber}号</span>
				<span
					class="result-badge"
					class:result-passed={billResult === '可決'}
					class:result-rejected={billResult === '否決'}
					class:result-withdrawn={billResult === '撤回'}
					class:result-expired={billResult === '未了'}
					class:result-pending={!billResult}
				>
					{getResultLabel(billResult)}
				</span>
			</div>
			<button class="modal-close-btn" onclick={onClose}><X size={16} /></button>
		</div>

		<!-- Title -->
		<h2 class="bill-title">{billTitle}</h2>

		<!-- Scrollable Body -->
		<div class="modal-body">
			{#if isLoading}
				<div class="loading-state">
					<div class="spinner"></div>
					<span>詳細を読み込み中...</span>
				</div>
			{:else if loadError}
				<div class="error-state">
					<p><TriangleAlert size={14} class="inline-icon" color="#f59e0b" /> {loadError}</p>
					<button class="retry-btn" onclick={loadEnrichment}>再読み込み</button>
				</div>
			{:else if enrichmentData}
				<!-- Short Summary -->
				{#if enrichmentData.summaryShort}
					<div class="section first-section">
						<p class="summary-short">{enrichmentData.summaryShort}</p>
					</div>
				{/if}

				<!-- Impact Tags -->
				{#if enrichmentData.impactTags && enrichmentData.impactTags.length > 0}
					<div class="impact-tags">
						{#each enrichmentData.impactTags as tag, i (i)}
							<span class="tag">{tag}</span>
						{/each}
					</div>
				{/if}

				<!-- Detailed Summary -->
				{#if enrichmentData.summaryDetailed}
					<div class="section">
						<h3><FileText size={16} class="inline-icon" /> 詳しい説明</h3>
						<p class="summary-detailed">{enrichmentData.summaryDetailed}</p>
					</div>
				{/if}

				<!-- Key Points -->
				{#if enrichmentData.keyPoints && enrichmentData.keyPoints.length > 0}
					<div class="section">
						<h3><Target size={16} class="inline-icon" /> ポイント</h3>
						<ul class="key-points">
							{#each enrichmentData.keyPoints as point, i (i)}
								<li class="key-point">
									<div class="point-row">
										<span class="point-label"><User size={14} class="inline-icon" /> 誰に:</span>
										<span class="point-value">{point.who}</span>
									</div>
									<div class="point-row">
										<span class="point-label"
											><ClipboardList size={14} class="inline-icon" /> 何が:</span
										>
										<span class="point-value">{point.what}</span>
									</div>
									<div class="point-row">
										<span class="point-label"><Calendar size={14} class="inline-icon" /> いつ:</span
										>
										<span class="point-value">{point.when}</span>
									</div>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<!-- Pros and Cons -->
				{#if enrichmentData.prosAndCons}
					<div class="section">
						<h3><Scale size={16} class="inline-icon" /> 賛成・反対の論点</h3>
						<div class="pros-cons-grid">
							<div class="pros-column">
								<h4><ThumbsUp size={14} class="inline-icon" color="#22c55e" /> 賛成派の主張</h4>
								<ul>
									{#each enrichmentData.prosAndCons.pros as pro, i (i)}
										<li>{pro}</li>
									{/each}
								</ul>
							</div>
							<div class="cons-column">
								<h4><ThumbsDown size={14} class="inline-icon" color="#ef4444" /> 反対派の主張</h4>
								<ul>
									{#each enrichmentData.prosAndCons.cons as con, i (i)}
										<li>{con}</li>
									{/each}
								</ul>
							</div>
						</div>
					</div>
				{/if}

				<!-- Example Scenario -->
				{#if enrichmentData.exampleScenario}
					<div class="section">
						<h3><Lightbulb size={16} class="inline-icon" color="#f59e0b" /> 具体例</h3>
						<p class="example-scenario">{enrichmentData.exampleScenario}</p>
					</div>
				{/if}

				<!-- Voting Results -->
				{#if enrichmentData.voteResults && enrichmentData.voteResults.length > 0}
					<div class="section">
						<h3><Vote size={16} class="inline-icon" /> 会派別投票結果</h3>
						<div class="vote-results">
							{#each enrichmentData.voteResults as vote (vote.groupName)}
								<span
									class="vote-badge"
									class:vote-approved={vote.approved}
									class:vote-rejected={!vote.approved}
								>
									{vote.groupName}: {vote.approved ? '賛成' : '反対'}
								</span>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Debate Records -->
				{#if enrichmentData.debates && enrichmentData.debates.length > 0}
					<div class="section">
						<h3>
							<Mic size={16} class="inline-icon" /> 国会での議論 ({enrichmentData.debateCount}件)
						</h3>
						<div class="debates">
							{#each enrichmentData.debates as debate (debate.id)}
								<div class="debate-record {getSpeechTypeClass(debate.speechType)}">
									<div class="debate-header">
										<span class="speaker-name">{debate.speakerName}</span>
										{#if debate.speakerPosition}
											<span class="speaker-position">({debate.speakerPosition})</span>
										{/if}
										<span class="speech-type">{getSpeechTypeLabel(debate.speechType)}</span>
									</div>
									<div class="debate-meta">
										<span class="meeting-info">{debate.house} {debate.meetingName}</span>
										{#if debate.meetingDate}
											<span class="meeting-date">{debate.meetingDate}</span>
										{/if}
									</div>
									<p class="speech-content">{truncateText(debate.speechContent, 300)}</p>
									{#if debate.speechUrl}
										<a
											href={debate.speechUrl}
											target="_blank"
											rel="noopener noreferrer"
											class="speech-link"
										>
											全文を見る →
										</a>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- PDF Link -->
				{#if enrichmentData.pdfUrl}
					<div class="section pdf-section">
						<a
							href={enrichmentData.pdfUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="pdf-link"
						>
							<FileDown size={14} class="inline-icon" /> 法案原文 (PDF) を見る
						</a>
					</div>
				{/if}

				<!-- No enrichment data at all -->
				{#if !enrichmentData.summaryShort && !enrichmentData.summaryDetailed && enrichmentData.keyPoints.length === 0 && !enrichmentData.prosAndCons && enrichmentData.debates.length === 0 && enrichmentData.voteResults.length === 0}
					<div class="no-enrichment">
						<p>この法案の詳細情報はまだ生成されていません</p>
					</div>
				{/if}
			{/if}
		</div>

		<!-- Sticky Action Bar -->
		<div class="action-bar">
			{#if actionError}
				<div class="action-error">{actionError}</div>
			{/if}

			{#if hasDelegation}
				<!-- Delegated state -->
				<div class="action-delegated">
					<span class="delegation-info"
						><Handshake size={14} class="inline-icon" /> {delegateUsername}に委任中</span
					>
					{#if onGoToDelegations}
						<button class="btn-go-delegations" onclick={onGoToDelegations}>
							委任タブで管理 →
						</button>
					{/if}
				</div>
			{:else if answerScore !== null}
				<!-- Already answered — show current answer + change/retract options -->
				<div class="action-answered">
					<div class="current-answer">
						<span class="current-answer-label">あなたの回答:</span>
						<span class="current-answer-value {getAnswerClass(answerScore)}">
							{#if answerScore === 1}<ThumbsUp
									size={16}
									class="inline-icon"
									color="#22c55e"
								/>{:else if answerScore === -1}<ThumbsDown
									size={16}
									class="inline-icon"
									color="#ef4444"
								/>{:else if answerScore === 0}<CircleQuestionMark
									size={16}
									class="inline-icon"
									color="#6b7280"
								/>{/if}
							{getAnswerLabel(answerScore)}
						</span>
					</div>
					<div class="action-buttons-row">
						<div class="change-vote-group">
							<span class="change-vote-label">変更:</span>
							{#if answerScore !== 1}
								<button
									class="vote-btn-sm vote-agree-sm"
									onclick={() => handleVote(1)}
									disabled={actionLoading}><ThumbsUp size={16} /></button
								>
							{/if}
							{#if answerScore !== 0}
								<button
									class="vote-btn-sm vote-skip-sm"
									onclick={() => handleVote(0)}
									disabled={actionLoading}><CircleQuestionMark size={16} /></button
								>
							{/if}
							{#if answerScore !== -1}
								<button
									class="vote-btn-sm vote-disagree-sm"
									onclick={() => handleVote(-1)}
									disabled={actionLoading}><ThumbsDown size={16} /></button
								>
							{/if}
						</div>
						<div class="secondary-actions">
							{#if retractConfirm}
								<span class="retract-confirm-text">取り消しますか？</span>
								<button class="btn-confirm-retract" onclick={handleRetract} disabled={actionLoading}
									>はい</button
								>
								<button
									class="btn-cancel-retract"
									onclick={() => (retractConfirm = false)}
									disabled={actionLoading}>いいえ</button
								>
							{:else}
								<button
									class="btn-retract"
									onclick={() => (retractConfirm = true)}
									disabled={actionLoading}><Undo2 size={14} class="inline-icon" /> 取り消す</button
								>
							{/if}
							<button
								class="btn-delegate"
								onclick={() => onDelegate(billId)}
								disabled={actionLoading}><Handshake size={14} class="inline-icon" /> 委任</button
							>
						</div>
					</div>
				</div>
			{:else}
				<!-- Not yet answered — show vote buttons prominently -->
				<div class="action-vote">
					<span class="vote-prompt">この法案について、あなたの意見は？</span>
					<div class="vote-buttons">
						<button
							class="vote-btn vote-agree"
							onclick={() => handleVote(1)}
							disabled={actionLoading}
						>
							<span class="vote-emoji"><ThumbsUp size={20} color="#22c55e" /></span>
							<span class="vote-label">賛成</span>
						</button>
						<button
							class="vote-btn vote-skip"
							onclick={() => handleVote(0)}
							disabled={actionLoading}
						>
							<span class="vote-emoji"><CircleQuestionMark size={20} color="#6b7280" /></span>
							<span class="vote-label">わからない</span>
						</button>
						<button
							class="vote-btn vote-disagree"
							onclick={() => handleVote(-1)}
							disabled={actionLoading}
						>
							<span class="vote-emoji"><ThumbsDown size={20} color="#ef4444" /></span>
							<span class="vote-label">反対</span>
						</button>
					</div>
					<button
						class="btn-delegate standalone-delegate"
						onclick={() => onDelegate(billId)}
						disabled={actionLoading}
					>
						<Handshake size={14} class="inline-icon" /> フレンドに委任する
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>

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

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.modal-content {
		background: white;
		border-radius: 16px;
		width: 100%;
		max-width: 680px;
		max-height: 85vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
		animation: slideUp 0.3s ease;
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

	/* ── Header ── */
	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		padding: 1.25rem 1.5rem 0;
		flex-shrink: 0;
	}

	.modal-header-left {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.bill-id {
		font-size: 0.8rem;
		color: #9ca3af;
		font-weight: 500;
	}

	.result-badge {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.15rem 0.6rem;
		border-radius: 100px;
	}

	.result-passed {
		background: #d1fae5;
		color: #065f46;
	}
	.result-rejected {
		background: #fee2e2;
		color: #991b1b;
	}
	.result-withdrawn {
		background: #f3f4f6;
		color: #6b7280;
	}
	.result-expired {
		background: #fef3c7;
		color: #92400e;
	}
	.result-pending {
		background: #eff6ff;
		color: #2563eb;
	}

	.modal-close-btn {
		background: #f3f4f6;
		border: none;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		font-size: 1rem;
		cursor: pointer;
		color: #6b7280;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: background 0.2s;
	}

	.modal-close-btn:hover {
		background: #e5e7eb;
	}

	.bill-title {
		font-size: 1.15rem;
		font-weight: 700;
		color: #1f2937;
		margin: 0;
		padding: 0.75rem 1.5rem 0;
		line-height: 1.5;
		flex-shrink: 0;
	}

	/* ── Scrollable Body ── */
	.modal-body {
		padding: 1rem 1.5rem;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
	}

	/* Loading & Error */
	.loading-state {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: #6b7280;
		padding: 2rem 0;
		justify-content: center;
	}

	.spinner {
		width: 20px;
		height: 20px;
		border: 2px solid #e5e7eb;
		border-top-color: #6366f1;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.error-state {
		text-align: center;
		padding: 2rem 0;
		color: #991b1b;
	}

	.retry-btn {
		margin-top: 0.75rem;
		padding: 0.5rem 1rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.retry-btn:hover {
		background: #4f46e5;
	}

	/* ── Content Sections ── */
	.section {
		margin-top: 1.25rem;
		padding-top: 1.25rem;
		border-top: 1px solid #f3f4f6;
	}

	.first-section {
		margin-top: 0;
		padding-top: 0;
		border-top: none;
	}

	.section h3 {
		font-size: 0.95rem;
		font-weight: 700;
		color: #374151;
		margin: 0 0 0.75rem 0;
	}

	.section h4 {
		font-size: 0.85rem;
		font-weight: 600;
		color: #4b5563;
		margin: 0 0 0.5rem 0;
	}

	.summary-short {
		font-size: 0.95rem;
		color: #4b5563;
		margin: 0;
		padding: 0.75rem;
		background: #f8fafc;
		border-radius: 8px;
		border-left: 4px solid #6366f1;
		line-height: 1.6;
	}

	.summary-detailed {
		font-size: 0.9rem;
		color: #4b5563;
		line-height: 1.7;
		margin: 0;
	}

	.impact-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.tag {
		font-size: 0.75rem;
		padding: 0.25rem 0.6rem;
		border-radius: 9999px;
		background: #eff6ff;
		color: #1d4ed8;
	}

	.key-points {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.key-point {
		background: #f9fafb;
		border-radius: 10px;
		padding: 0.75rem;
	}

	.point-row {
		display: flex;
		gap: 0.5rem;
		font-size: 0.875rem;
		margin-bottom: 0.25rem;
	}

	.point-row:last-child {
		margin-bottom: 0;
	}

	.point-label {
		font-weight: 600;
		color: #6b7280;
		white-space: nowrap;
	}

	.point-value {
		color: #374151;
	}

	.pros-cons-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	@media (max-width: 500px) {
		.pros-cons-grid {
			grid-template-columns: 1fr;
		}
	}

	.pros-column ul,
	.cons-column ul {
		list-style: disc;
		padding-left: 1.25rem;
		margin: 0;
		font-size: 0.875rem;
		line-height: 1.6;
		color: #4b5563;
	}

	.pros-column {
		background: #f0fdf4;
		border-radius: 10px;
		padding: 0.75rem;
	}

	.cons-column {
		background: #fef2f2;
		border-radius: 10px;
		padding: 0.75rem;
	}

	.example-scenario {
		font-size: 0.9rem;
		color: #4b5563;
		line-height: 1.7;
		margin: 0;
		background: #fffbeb;
		padding: 0.75rem;
		border-radius: 10px;
		border-left: 4px solid #f59e0b;
	}

	.vote-results {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.vote-badge {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.25rem 0.6rem;
		border-radius: 9999px;
	}

	.vote-approved {
		background: #d1fae5;
		color: #065f46;
	}
	.vote-rejected {
		background: #fee2e2;
		color: #991b1b;
	}

	.debates {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.debate-record {
		padding: 0.75rem;
		border-radius: 10px;
		border: 1px solid #f3f4f6;
	}

	.debate-record.speech-pro {
		border-left: 3px solid #22c55e;
	}
	.debate-record.speech-con {
		border-left: 3px solid #ef4444;
	}
	.debate-record.speech-explanation {
		border-left: 3px solid #3b82f6;
	}
	.debate-record.speech-neutral {
		border-left: 3px solid #9ca3af;
	}

	.debate-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 0.35rem;
	}

	.speaker-name {
		font-weight: 600;
		font-size: 0.875rem;
		color: #1f2937;
	}

	.speaker-position {
		font-size: 0.75rem;
		color: #6b7280;
	}

	.speech-type {
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.1rem 0.5rem;
		border-radius: 100px;
		background: #f3f4f6;
		color: #6b7280;
	}

	.debate-meta {
		display: flex;
		gap: 0.75rem;
		font-size: 0.75rem;
		color: #9ca3af;
		margin-bottom: 0.5rem;
	}

	.speech-content {
		font-size: 0.85rem;
		color: #4b5563;
		line-height: 1.6;
		margin: 0;
	}

	.speech-link {
		display: inline-block;
		margin-top: 0.35rem;
		font-size: 0.8rem;
		color: #6366f1;
		text-decoration: none;
	}

	.speech-link:hover {
		text-decoration: underline;
	}

	.pdf-section {
		text-align: center;
	}

	.pdf-link {
		display: inline-block;
		padding: 0.65rem 1.25rem;
		background: #f3f4f6;
		border-radius: 10px;
		color: #374151;
		text-decoration: none;
		font-size: 0.9rem;
		font-weight: 500;
		transition: background 0.2s;
	}

	.pdf-link:hover {
		background: #e5e7eb;
	}

	.no-enrichment {
		text-align: center;
		padding: 2rem 0;
		color: #9ca3af;
		font-style: italic;
	}

	/* ── Sticky Action Bar ── */
	.action-bar {
		flex-shrink: 0;
		border-top: 1px solid #e5e7eb;
		padding: 1rem 1.5rem;
		background: #fafbfc;
		border-radius: 0 0 16px 16px;
	}

	.action-error {
		font-size: 0.8rem;
		color: #dc2626;
		background: #fef2f2;
		padding: 0.4rem 0.75rem;
		border-radius: 8px;
		margin-bottom: 0.75rem;
		text-align: center;
	}

	/* ── Delegated State ── */
	.action-delegated {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.delegation-info {
		font-size: 0.9rem;
		color: #92400e;
		font-weight: 500;
	}

	.btn-go-delegations {
		padding: 0.35rem 0.75rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		background: white;
		font-size: 0.8rem;
		color: #6366f1;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn-go-delegations:hover {
		background: #eef2ff;
		border-color: #a5b4fc;
	}

	/* ── Already Answered ── */
	.action-answered {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.current-answer {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		justify-content: center;
	}

	.current-answer-label {
		font-size: 0.85rem;
		color: #6b7280;
	}

	.current-answer-value {
		font-size: 0.85rem;
		font-weight: 700;
		padding: 0.2rem 0.75rem;
		border-radius: 100px;
	}

	.current-answer-value.answer-agree {
		background: #dbeafe;
		color: #1e40af;
	}
	.current-answer-value.answer-disagree {
		background: #fce7f3;
		color: #9d174d;
	}
	.current-answer-value.answer-skip {
		background: #f3f4f6;
		color: #6b7280;
	}

	.action-buttons-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.change-vote-group {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.change-vote-label {
		font-size: 0.8rem;
		color: #9ca3af;
	}

	.vote-btn-sm {
		width: 36px;
		height: 36px;
		border-radius: 10px;
		border: 1px solid #e5e7eb;
		background: white;
		cursor: pointer;
		font-size: 1.1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
	}

	.vote-btn-sm:hover:not(:disabled) {
		transform: scale(1.1);
	}
	.vote-agree-sm:hover:not(:disabled) {
		background: #dbeafe;
		border-color: #93c5fd;
	}
	.vote-skip-sm:hover:not(:disabled) {
		background: #f3f4f6;
		border-color: #d1d5db;
	}
	.vote-disagree-sm:hover:not(:disabled) {
		background: #fce7f3;
		border-color: #f9a8d4;
	}
	.vote-btn-sm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.secondary-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.retract-confirm-text {
		font-size: 0.8rem;
		color: #6b7280;
	}

	.btn-confirm-retract {
		font-size: 0.8rem;
		padding: 0.3rem 0.6rem;
		border-radius: 6px;
		border: none;
		background: #ef4444;
		color: white;
		cursor: pointer;
	}

	.btn-confirm-retract:hover:not(:disabled) {
		background: #dc2626;
	}

	.btn-cancel-retract {
		font-size: 0.8rem;
		padding: 0.3rem 0.6rem;
		border-radius: 6px;
		border: 1px solid #d1d5db;
		background: white;
		color: #6b7280;
		cursor: pointer;
	}

	.btn-retract {
		font-size: 0.8rem;
		padding: 0.35rem 0.7rem;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		background: white;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn-retract:hover:not(:disabled) {
		background: #fef2f2;
		border-color: #fca5a5;
		color: #dc2626;
	}

	.btn-delegate {
		font-size: 0.8rem;
		padding: 0.35rem 0.7rem;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		background: white;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn-delegate:hover:not(:disabled) {
		background: #fffbeb;
		border-color: #fcd34d;
		color: #92400e;
	}
	.btn-retract:disabled,
	.btn-delegate:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* ── Not Answered (Full Vote) ── */
	.action-vote {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.vote-prompt {
		font-size: 0.9rem;
		color: #374151;
		font-weight: 600;
	}

	.vote-buttons {
		display: flex;
		gap: 0.75rem;
		width: 100%;
	}

	.vote-btn {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 0.75rem 0.5rem;
		border-radius: 12px;
		border: 2px solid #e5e7eb;
		background: white;
		cursor: pointer;
		transition: all 0.2s;
	}

	.vote-btn:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
	}
	.vote-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.vote-agree:hover:not(:disabled) {
		border-color: #93c5fd;
		background: #eff6ff;
	}
	.vote-skip:hover:not(:disabled) {
		border-color: #d1d5db;
		background: #f9fafb;
	}
	.vote-disagree:hover:not(:disabled) {
		border-color: #f9a8d4;
		background: #fdf2f8;
	}

	.vote-emoji {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.vote-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: #4b5563;
	}

	.standalone-delegate {
		font-size: 0.8rem;
		padding: 0.4rem 1rem;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		background: white;
		color: #6b7280;
		cursor: pointer;
		transition: all 0.15s;
	}

	.standalone-delegate:hover:not(:disabled) {
		background: #fffbeb;
		border-color: #fcd34d;
		color: #92400e;
	}
	.standalone-delegate:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
