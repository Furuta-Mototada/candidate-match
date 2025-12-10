<script lang="ts">
	import type { EnrichedBillData } from '$lib/types/index.js';

	interface Props {
		billId: number;
		title: string;
		description: string | null;
		passed: boolean;
		enrichmentData: EnrichedBillData | null;
		isLoading: boolean;
		onLoadEnrichment: () => void;
	}

	let { billId, title, description, passed, enrichmentData, isLoading, onLoadEnrichment }: Props =
		$props();

	// Detail level: 1 = basic, 2 = expanded, 3 = full
	let detailLevel = $state(1);

	function toggleDetailLevel() {
		if (detailLevel < 3) {
			detailLevel++;
			// Load enrichment data if not already loaded
			if (!enrichmentData && !isLoading) {
				onLoadEnrichment();
			}
		} else {
			detailLevel = 1;
		}
	}

	function getSpeechTypeLabel(type: string | null): string {
		switch (type) {
			case 'pro':
				return '👍 賛成意見';
			case 'con':
				return '👎 反対意見';
			case 'explanation':
				return '📋 政府説明';
			case 'question':
				return '❓ 質問';
			default:
				return '💬 発言';
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

<div class="enriched-bill-card">
	<!-- Header with status -->
	<div class="card-header">
		<span class="bill-status" class:passed class:not-passed={!passed}>
			{passed ? '✓ 成立' : '⏳ 審議中/廃案'}
		</span>
		<button class="detail-toggle" onclick={toggleDetailLevel} disabled={isLoading}>
			{#if detailLevel === 1}
				📖 詳しく見る
			{:else if detailLevel === 2}
				📚 もっと詳しく
			{:else}
				📕 閉じる
			{/if}
		</button>
	</div>

	<!-- Title -->
	<h2 class="bill-title">{title}</h2>

	<!-- Level 1: Basic Info -->
	<div class="level-1">
		{#if enrichmentData?.summaryShort}
			<p class="summary-short">{enrichmentData.summaryShort}</p>
		{:else if description}
			<p class="description">{description}</p>
		{:else}
			<p class="no-description">説明がありません</p>
		{/if}

		<!-- Impact Tags (always show if available) -->
		{#if enrichmentData?.impactTags && enrichmentData.impactTags.length > 0}
			<div class="impact-tags">
				{#each enrichmentData.impactTags as tag, i (i)}
					<span class="tag">{tag}</span>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Level 2: Key Points and Pros/Cons -->
	{#if detailLevel >= 2}
		<div class="level-2 fade-in">
			{#if isLoading}
				<div class="loading-state">
					<span class="spinner"></span>
					<span>詳細を読み込み中...</span>
				</div>
			{:else if enrichmentData}
				<!-- Detailed Summary -->
				{#if enrichmentData.summaryDetailed}
					<div class="section">
						<h3>📝 詳しい説明</h3>
						<p class="summary-detailed">{enrichmentData.summaryDetailed}</p>
					</div>
				{/if}

				<!-- Key Points -->
				{#if enrichmentData.keyPoints && enrichmentData.keyPoints.length > 0}
					<div class="section">
						<h3>🎯 ポイント</h3>
						<ul class="key-points">
							{#each enrichmentData.keyPoints as point, i (i)}
								<li class="key-point">
									<div class="point-row">
										<span class="point-label">👤 誰に:</span>
										<span class="point-value">{point.who}</span>
									</div>
									<div class="point-row">
										<span class="point-label">📋 何が:</span>
										<span class="point-value">{point.what}</span>
									</div>
									<div class="point-row">
										<span class="point-label">📅 いつ:</span>
										<span class="point-value">{point.when}</span>
									</div>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<!-- Pros and Cons -->
				{#if enrichmentData.prosAndCons}
					<div class="section pros-cons">
						<h3>⚖️ 賛成・反対の論点</h3>
						<div class="pros-cons-grid">
							<div class="pros-column">
								<h4>👍 賛成派の主張</h4>
								<ul>
									{#each enrichmentData.prosAndCons.pros as pro, i (i)}
										<li>{pro}</li>
									{/each}
								</ul>
							</div>
							<div class="cons-column">
								<h4>👎 反対派の主張</h4>
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
						<h3>💡 具体例</h3>
						<p class="example-scenario">{enrichmentData.exampleScenario}</p>
					</div>
				{/if}
			{:else}
				<div class="no-enrichment">
					<p>詳細情報はまだ生成されていません</p>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Level 3: Debates and Voting Records -->
	{#if detailLevel >= 3}
		<div class="level-3 fade-in">
			{#if enrichmentData}
				<!-- Voting Results -->
				{#if enrichmentData.voteResults && enrichmentData.voteResults.length > 0}
					<div class="section">
						<h3>🗳️ 会派別投票結果</h3>
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

				<!-- Debate Records -->
				{#if enrichmentData.debates && enrichmentData.debates.length > 0}
					<div class="section">
						<h3>🎤 国会での議論 ({enrichmentData.debateCount}件)</h3>
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
					<div class="section">
						<a
							href={enrichmentData.pdfUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="pdf-link"
						>
							📄 法案原文 (PDF) を見る
						</a>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.enriched-bill-card {
		background: white;
		border-radius: 16px;
		padding: 1.5rem;
		box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
		max-width: 100%;
	}

	.card-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.bill-status {
		font-size: 0.875rem;
		padding: 0.25rem 0.75rem;
		border-radius: 9999px;
		font-weight: 500;
	}

	.bill-status.passed {
		background: #dcfce7;
		color: #166534;
	}

	.bill-status.not-passed {
		background: #fef3c7;
		color: #92400e;
	}

	.detail-toggle {
		font-size: 0.875rem;
		padding: 0.375rem 0.75rem;
		border-radius: 8px;
		background: #f3f4f6;
		border: none;
		cursor: pointer;
		transition: all 0.2s;
	}

	.detail-toggle:hover:not(:disabled) {
		background: #e5e7eb;
	}

	.detail-toggle:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.bill-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1f2937;
		margin: 0 0 1rem 0;
		line-height: 1.4;
	}

	.summary-short {
		font-size: 1rem;
		color: #4b5563;
		margin: 0 0 0.75rem 0;
		padding: 0.75rem;
		background: #f8fafc;
		border-radius: 8px;
		border-left: 4px solid #3b82f6;
	}

	.description {
		font-size: 0.9375rem;
		color: #6b7280;
		margin: 0 0 0.75rem 0;
	}

	.no-description {
		font-size: 0.875rem;
		color: #9ca3af;
		font-style: italic;
	}

	.impact-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}

	.tag {
		font-size: 0.75rem;
		padding: 0.25rem 0.5rem;
		border-radius: 9999px;
		background: #eff6ff;
		color: #1d4ed8;
	}

	.level-2,
	.level-3 {
		margin-top: 1.25rem;
		padding-top: 1.25rem;
		border-top: 1px solid #e5e7eb;
	}

	.fade-in {
		animation: fadeIn 0.3s ease-out;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

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
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}

	@media (max-width: 640px) {
		.pros-cons-grid {
			grid-template-columns: 1fr;
		}
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
