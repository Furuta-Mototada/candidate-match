<script lang="ts">
	import type { EnrichedBillData } from '$lib/types/index.js';
	import {
		ThumbsUp,
		ThumbsDown,
		ClipboardList,
		FileText,
		Target,
		User,
		Calendar,
		Scale,
		Lightbulb,
		Vote,
		Mic,
		FileDown,
		X,
		Maximize,
		Minimize,
		Book
	} from '@lucide/svelte';

	interface Props {
		enrichmentData: EnrichedBillData | null;
		isLoading: boolean;
		detailLevel: number;
		isFullscreen: boolean;
		onClose: () => void;
		onDetailLevelChange: (level: number) => void;
		onToggleFullscreen: () => void;
	}

	let {
		enrichmentData,
		isLoading,
		detailLevel,
		isFullscreen = false,
		onClose,
		onDetailLevelChange,
		onToggleFullscreen
	}: Props = $props();

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
</script>

<div class="detail-panel slide-in" class:fullscreen={isFullscreen}>
	<div class="detail-panel-header">
		<h3 class="detail-panel-title">法案の詳細</h3>
		<div class="header-actions">
			{#if detailLevel === 2}
				<button class="header-btn" onclick={() => onDetailLevelChange(3)}>
					<Book size={14} class="inline-icon" /> もっと詳しく
				</button>
			{/if}
			<button class="header-btn" onclick={onToggleFullscreen}>
				{#if isFullscreen}
					<Minimize size={14} class="inline-icon" /> 縮小
				{:else}
					<Maximize size={14} class="inline-icon" /> 拡大
				{/if}
			</button>
			<button class="close-btn" onclick={onClose}>
				<X size={16} /> 閉じる
			</button>
		</div>
	</div>

	<div class="detail-panel-content">
		{#if isLoading}
			<div class="loading-state">
				<span class="spinner"></span>
				<span>詳細を読み込み中...</span>
			</div>
		{:else if enrichmentData}
			<!-- Level 2: Key Points and Pros/Cons -->
			{#if enrichmentData.summaryDetailed}
				<div class="section">
					<h3><FileText size={16} class="inline-icon" /> 詳しい説明</h3>
					<p class="summary-detailed">{enrichmentData.summaryDetailed}</p>
				</div>
			{/if}

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
									<span class="point-label"><Calendar size={14} class="inline-icon" /> いつ:</span>
									<span class="point-value">{point.when}</span>
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if enrichmentData.prosAndCons}
				<div class="section pros-cons">
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

			{#if enrichmentData.exampleScenario}
				<div class="section">
					<h3><Lightbulb size={16} class="inline-icon" color="#f59e0b" /> 具体例</h3>
					<p class="example-scenario">{enrichmentData.exampleScenario}</p>
				</div>
			{/if}

			<!-- Level 3: Debates and Voting Records -->
			{#if detailLevel >= 3}
				{#if enrichmentData.voteResults && enrichmentData.voteResults.length > 0}
					<div class="section">
						<h3><Vote size={16} class="inline-icon" /> 会派別投票結果</h3>
						<div class="vote-results">
							{#each enrichmentData.voteResults as vote (vote.groupName)}
								<span
									class="vote-badge"
									class:approved={vote.approved}
									class:rejected={!vote.approved}
								>
									{vote.groupName}: {vote.approved ? '賛成' : '反対'}
								</span>
							{/each}
						</div>
					</div>
				{/if}

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

				{#if enrichmentData.pdfUrl}
					<div class="section">
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
			{/if}
		{:else}
			<div class="no-enrichment">
				<p>詳細情報はまだ生成されていません</p>
			</div>
		{/if}
	</div>
</div>

<style>
	.detail-panel {
		background: white;
		border-radius: 16px;
		box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		max-height: 80vh;
		transition: all 0.3s ease;
	}

	.detail-panel.fullscreen {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		max-height: 100vh;
		border-radius: 0;
		z-index: 1000;
		box-shadow: none;
		animation: none;
	}

	.slide-in {
		animation: slideIn 0.35s ease-out;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateX(30px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	.detail-panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem 1.5rem;
		border-bottom: 1px solid #e5e7eb;
		flex-shrink: 0;
	}

	.detail-panel-title {
		font-size: 1rem;
		font-weight: 600;
		color: #1f2937;
		margin: 0;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.header-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		background: #f3f4f6;
		border: none;
		cursor: pointer;
		font-size: 0.8rem;
		color: #4b5563;
		transition: all 0.2s;
	}

	.header-btn:hover {
		background: #e5e7eb;
	}

	.close-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		background: #f3f4f6;
		border: none;
		cursor: pointer;
		font-size: 0.8rem;
		color: #4b5563;
		transition: all 0.2s;
	}

	.close-btn:hover {
		background: #e5e7eb;
	}

	.detail-panel-content {
		padding: 1.5rem;
		overflow-y: auto;
		flex: 1;
	}

	/* Loading */
	.loading-state {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #6b7280;
		padding: 1rem 0;
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid #e5e7eb;
		border-top-color: #3b82f6;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Sections */
	.section {
		margin-bottom: 1.25rem;
	}

	.section h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		color: #374151;
		margin: 0 0 0.75rem 0;
	}

	.summary-detailed {
		font-size: 0.9375rem;
		color: #4b5563;
		line-height: 1.6;
		margin: 0;
	}

	.key-points {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.key-point {
		background: #f9fafb;
		border-radius: 8px;
		padding: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.point-row {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.point-row:last-child {
		margin-bottom: 0;
	}

	.point-label {
		font-size: 0.8125rem;
		color: #6b7280;
		flex-shrink: 0;
	}

	.point-value {
		font-size: 0.875rem;
		color: #1f2937;
	}

	.pros-cons-grid {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.pros-column,
	.cons-column {
		padding: 0.75rem;
		border-radius: 8px;
	}

	.pros-column {
		background: #f0fdf4;
	}

	.cons-column {
		background: #fef2f2;
	}

	.pros-column h4,
	.cons-column h4 {
		font-size: 0.875rem;
		font-weight: 600;
		margin: 0 0 0.5rem 0;
	}

	.pros-column h4 {
		color: #166534;
	}

	.cons-column h4 {
		color: #991b1b;
	}

	.pros-column ul,
	.cons-column ul {
		margin: 0;
		padding-left: 1.25rem;
	}

	.pros-column li,
	.cons-column li {
		font-size: 0.8125rem;
		margin-bottom: 0.375rem;
		line-height: 1.4;
	}

	.pros-column li {
		color: #166534;
	}

	.cons-column li {
		color: #991b1b;
	}

	.example-scenario {
		font-size: 0.9375rem;
		color: #4b5563;
		line-height: 1.6;
		margin: 0;
		padding: 0.75rem;
		background: #fffbeb;
		border-radius: 8px;
		border-left: 4px solid #f59e0b;
	}

	.vote-results {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.vote-badge {
		font-size: 0.75rem;
		padding: 0.375rem 0.75rem;
		border-radius: 9999px;
		font-weight: 500;
	}

	.vote-badge.approved {
		background: #dcfce7;
		color: #166534;
	}

	.vote-badge.rejected {
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
		border-radius: 8px;
		border-left: 4px solid #e5e7eb;
	}

	.debate-record.speech-pro {
		background: #f0fdf4;
		border-left-color: #22c55e;
	}

	.debate-record.speech-con {
		background: #fef2f2;
		border-left-color: #ef4444;
	}

	.debate-record.speech-explanation {
		background: #eff6ff;
		border-left-color: #3b82f6;
	}

	.debate-record.speech-neutral {
		background: #f9fafb;
		border-left-color: #9ca3af;
	}

	.debate-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.375rem;
	}

	.speaker-name {
		font-weight: 600;
		color: #1f2937;
	}

	.speaker-position {
		font-size: 0.8125rem;
		color: #6b7280;
	}

	.speech-type {
		font-size: 0.75rem;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		background: white;
		color: #4b5563;
	}

	.debate-meta {
		font-size: 0.75rem;
		color: #9ca3af;
		margin-bottom: 0.5rem;
	}

	.meeting-date {
		margin-left: 0.5rem;
	}

	.speech-content {
		font-size: 0.8125rem;
		color: #4b5563;
		line-height: 1.5;
		margin: 0;
	}

	.speech-link {
		display: inline-block;
		font-size: 0.75rem;
		color: #3b82f6;
		margin-top: 0.5rem;
		text-decoration: none;
	}

	.speech-link:hover {
		text-decoration: underline;
	}

	.pdf-link {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: #f3f4f6;
		border-radius: 8px;
		color: #374151;
		text-decoration: none;
		font-size: 0.875rem;
		transition: all 0.2s;
	}

	.pdf-link:hover {
		background: #e5e7eb;
	}

	.no-enrichment {
		text-align: center;
		padding: 1rem;
		color: #9ca3af;
	}
</style>
