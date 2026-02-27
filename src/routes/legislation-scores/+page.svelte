<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types.js';
	import { PageHero, LoadingSpinner, EmptyState } from '$lib/components/index.js';

	interface MemberLegislationScore {
		memberId: number;
		memberName: string;
		score: number;
		breakdown: string[];
	}

	interface LegislationScore {
		billId: number;
		billTitle: string;
		billType: string;
		billNumber: number;
		session: number;
		submissionDate: string | null;
		memberScores: MemberLegislationScore[];
		totalPositive: number;
		totalNegative: number;
		averageScore: number;
	}

	let { data }: { data: PageData } = $props();

	let legislationScores: LegislationScore[] = $state([]);
	let loadingScores: boolean = $state(true);
	let selectedBill: LegislationScore | null = $state(null);
	let searchTerm: string = $state('');
	let memberSearchTerm: string = $state('');
	let calculating: boolean = $state(false);
	let calculationMessage: string = $state('');
	let calculationProgress: number = $state(0);
	let showConfirmDialog: boolean = $state(false);
	let sortBy: 'billId' | 'positive' | 'negative' | 'average' = $state('billId');

	// Filter bills based on search
	let filteredBills = $derived(
		legislationScores.filter((bill) =>
			bill.billTitle.toLowerCase().includes(searchTerm.toLowerCase())
		)
	);

	// Filter member scores based on search
	let filteredMemberScores: MemberLegislationScore[] = $derived.by(() => {
		if (!selectedBill) return [];
		return selectedBill.memberScores.filter((member: MemberLegislationScore) =>
			member.memberName.toLowerCase().includes(memberSearchTerm.toLowerCase())
		);
	});

	// Sort bills
	let sortedBills = $derived(
		[...filteredBills].sort((a, b) => {
			switch (sortBy) {
				case 'positive':
					return b.totalPositive - a.totalPositive;
				case 'negative':
					return b.totalNegative - a.totalNegative;
				case 'average':
					return b.averageScore - a.averageScore;
				default:
					return a.billId - b.billId;
			}
		})
	);

	function requestCalculation() {
		showConfirmDialog = true;
	}

	function cancelCalculation() {
		showConfirmDialog = false;
	}

	async function runCalculation() {
		showConfirmDialog = false;
		calculating = true;
		calculationProgress = 0;
		calculationMessage = 'スコア計算を開始しています...';

		try {
			const response = await fetch('/api/calculate', {
				method: 'POST'
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const reader = response.body?.getReader();
			const decoder = new TextDecoder();

			if (!reader) {
				throw new Error('Response body is null');
			}

			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();

				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n\n');
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						try {
							const data = JSON.parse(line.substring(6));

							if (data.done) {
								if (data.success) {
									calculationMessage = '計算が完了しました！ページを再読み込みしてください。';
									calculationProgress = 100;
									// Reload after 2 seconds
									setTimeout(() => {
										window.location.reload();
									}, 2000);
								} else {
									calculationMessage = `エラー: ${data.error}`;
									calculationProgress = 0;
									calculating = false;
								}
							} else if (data.progress !== undefined) {
								calculationProgress = data.progress;
								if (data.message) {
									calculationMessage = data.message;
								}
							}
						} catch (error) {
							console.error('Error parsing SSE data:', error);
						}
					}
				}
			}
		} catch (error) {
			calculationMessage = `エラー: ${error}`;
			calculationProgress = 0;
			calculating = false;
		}
	}

	function selectBill(bill: LegislationScore) {
		selectedBill = bill;
		memberSearchTerm = '';
	}

	function closeModal() {
		selectedBill = null;
		memberSearchTerm = '';
		// Destroy chart if it exists
		if (chartInstance) {
			chartInstance.destroy();
			chartInstance = null;
		}
	}

	let chartInstance: any = null;
	let chartCanvas: HTMLCanvasElement | undefined = $state(undefined);

	// Create histogram when selected bill changes
	$effect(() => {
		if (selectedBill && chartCanvas && typeof window !== 'undefined' && (window as any).Chart) {
			// Destroy existing chart
			if (chartInstance) {
				chartInstance.destroy();
			}

			const ctx = chartCanvas.getContext('2d');
			if (!ctx) return;

			// Create histogram bins for score distribution
			const scores = selectedBill.memberScores.map((m) => m.score);
			const minScore = Math.min(...scores);
			const maxScore = Math.max(...scores);

			// Create bins - use fixed ranges for better readability
			const binSize = 1;
			const bins: { label: string; count: number; minVal: number; maxVal: number }[] = [];

			for (let i = minScore; i <= maxScore; i += binSize) {
				bins.push({
					label: i.toString(),
					count: 0,
					minVal: i,
					maxVal: i + binSize
				});
			}

			// Count scores in each bin
			scores.forEach((score) => {
				const bin = bins.find((b) => score >= b.minVal && score < b.maxVal);
				if (bin) {
					bin.count++;
				} else if (score === maxScore) {
					// Handle edge case where score equals maxScore
					const lastBin = bins[bins.length - 1];
					if (lastBin) lastBin.count++;
				}
			});

			// Create chart
			chartInstance = new (window as any).Chart(ctx, {
				type: 'bar',
				data: {
					labels: bins.map((b) => b.label),
					datasets: [
						{
							label: '議員数',
							data: bins.map((b) => b.count),
							backgroundColor: bins.map((b) => {
								if (b.minVal > 0) return 'rgba(76, 175, 80, 0.7)';
								if (b.minVal < 0) return 'rgba(244, 67, 54, 0.7)';
								return 'rgba(158, 158, 158, 0.7)';
							}),
							borderColor: bins.map((b) => {
								if (b.minVal > 0) return 'rgb(76, 175, 80)';
								if (b.minVal < 0) return 'rgb(244, 67, 54)';
								return 'rgb(158, 158, 158)';
							}),
							borderWidth: 1
						}
					]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					scales: {
						x: {
							title: {
								display: true,
								text: 'スコア',
								font: {
									size: 14,
									weight: 'bold'
								}
							}
						},
						y: {
							beginAtZero: true,
							title: {
								display: true,
								text: '議員数',
								font: {
									size: 14,
									weight: 'bold'
								}
							},
							ticks: {
								stepSize: 1
							}
						}
					},
					plugins: {
						legend: {
							display: false
						},
						tooltip: {
							callbacks: {
								label: function (context: any) {
									return `議員数: ${context.parsed.y}名`;
								}
							}
						}
					}
				}
			});
		}
	});

	// Chart setup
	onMount(async () => {
		// Fetch legislation scores from static JSON
		try {
			const response = await fetch('/data/legislation_scores.json');
			if (response.ok) {
				legislationScores = await response.json();
			} else {
				console.error('Failed to fetch legislation scores:', response.status);
			}
		} catch (error) {
			console.error('Error fetching legislation scores:', error);
		} finally {
			loadingScores = false;
		}

		if (typeof window !== 'undefined') {
			// Load Chart.js dynamically
			const script = document.createElement('script');
			script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
			script.onload = () => {
				// Chart.js is loaded, the $effect will handle chart creation
			};
			document.head.appendChild(script);
		}
	});
</script>

<div class="page">
	<!-- Hero Section -->
	<PageHero
		badge="🎯 議案分析"
		title="議案別スコア分析"
		description="各議案に対する全議員のスコアを分析・可視化します"
	/>

	<!-- Scoring Explanation Section -->
	<section class="explanation-section">
		<details class="scoring-explanation">
			<summary class="scoring-summary">
				<span class="summary-icon">📊</span>
				<span>スコア計算方法について</span>
				<span class="expand-icon">▼</span>
			</summary>
			<div class="scoring-content">
				<p class="scoring-intro">
					各議員のスコアは、議案への関与度に基づいて計算されます。議案提出と採決の両面から評価します。
				</p>

				<div class="scoring-categories">
					<!-- Bill Submission -->
					<div class="scoring-category">
						<h4>
							<span class="category-icon">📝</span>
							議案提出
						</h4>
						<div class="score-items">
							<div class="score-item positive-bg">
								<div class="score-label">議案提出者</div>
								<div class="score-value">+10</div>
								<div class="score-desc">議案を代表して提出した議員（複数名の場合あり）</div>
							</div>
							<div class="score-item positive-bg">
								<div class="score-label">賛成者</div>
								<div class="score-value">+5</div>
								<div class="score-desc">議案提出に賛同した議員</div>
							</div>
							<div class="score-item positive-bg">
								<div class="score-label">所属会派メンバー</div>
								<div class="score-value">+2</div>
								<div class="score-desc">
									提出時点で提出者と同じ会派に所属（提出者・賛成者を除く）
								</div>
							</div>
						</div>
						<div class="score-notes">
							<p class="score-note">
								※ 閣法（内閣提出法案）の場合、議案提出者は当時の内閣総理大臣となります
							</p>
						</div>
					</div>

					<!-- Bill Voting -->
					<div class="scoring-category">
						<h4>
							<span class="category-icon">🗳️</span>
							議案採決
						</h4>
						<div class="score-items">
							<div class="score-item-group">
								<h5>衆議院（起立投票）</h5>
								<div class="score-row">
									<div class="score-item positive-bg small">
										<div class="score-label">賛成</div>
										<div class="score-value">+2</div>
									</div>
									<div class="score-item negative-bg small">
										<div class="score-label">反対</div>
										<div class="score-value">-2</div>
									</div>
								</div>
								<p class="score-note">賛成/反対した会派に所属する議員全員に適用</p>
							</div>
							<div class="score-item-group">
								<h5>参議院（押しボタン式投票）</h5>
								<div class="score-row">
									<div class="score-item positive-bg small">
										<div class="score-label">賛成</div>
										<div class="score-value">+5</div>
									</div>
									<div class="score-item negative-bg small">
										<div class="score-label">反対</div>
										<div class="score-value">-5</div>
									</div>
								</div>
								<p class="score-note">議員個人の投票記録に基づく</p>
							</div>
						</div>
						<div class="score-notes">
							<p class="score-note warning">※ その他の投票方式（記名投票等）は現在未実装です</p>
						</div>
					</div>
				</div>

				<div class="scoring-example">
					<h4>例：ある議案に対するスコア計算</h4>
					<div class="example-breakdown">
						<div class="example-row">
							<span class="example-action">議案提出者として提出</span>
							<span class="example-score positive">+10</span>
						</div>
						<div class="example-row">
							<span class="example-action">衆議院で会派が賛成</span>
							<span class="example-score positive">+2</span>
						</div>
						<div class="example-row total">
							<span class="example-action">合計スコア</span>
							<span class="example-score">+12</span>
						</div>
					</div>
				</div>
			</div>
		</details>
	</section>

	<!-- Controls Section -->
	<section class="controls-section">
		<div class="controls-bar">
			<div class="search-wrapper">
				<span class="search-icon">🔍</span>
				<input
					type="text"
					bind:value={searchTerm}
					placeholder="議案名で検索..."
					class="search-input"
				/>
			</div>

			<div class="stats-inline">
				<span class="stat-item">総議案数: <strong>{legislationScores.length}</strong></span>
				<span class="stat-divider">|</span>
				<span class="stat-item">表示中: <strong>{filteredBills.length}</strong></span>
			</div>

			<div class="control-group">
				<label for="sortBy">並び替え:</label>
				<select id="sortBy" bind:value={sortBy} class="sort-select">
					<option value="billId">議案ID</option>
					<option value="positive">賛成議員数</option>
					<option value="negative">反対議員数</option>
					<option value="average">平均スコア</option>
				</select>
			</div>

			<button onclick={requestCalculation} disabled={calculating} class="calculate-btn">
				{calculating ? '計算中...' : '🔧 再計算'}
			</button>
		</div>

		{#if calculationMessage}
			<div class="message">
				{calculationMessage}
				{#if calculating && calculationProgress > 0}
					<div class="progress-bar">
						<div class="progress-fill" style="width: {calculationProgress}%"></div>
					</div>
					<div class="progress-text">{Math.round(calculationProgress)}%</div>
				{/if}
			</div>
		{/if}
	</section>

	<!-- Bills Table Section -->
	<section class="bills-section">
		{#if loadingScores}
			<div class="loading-container">
				<LoadingSpinner />
				<p>議案データを読み込み中...</p>
			</div>
		{:else if sortedBills.length === 0}
			<div class="no-results">
				<span class="no-results-icon">📭</span>
				<p>検索条件に一致する議案が見つかりませんでした。</p>
			</div>
		{:else}
			<div class="bills-table-wrapper">
				<table class="bills-table">
					<thead>
						<tr>
							<th class="col-type">種別</th>
							<th class="col-title">議案名</th>
							<th class="col-session">国会</th>
							<th class="col-positive">賛成</th>
							<th class="col-negative">反対</th>
							<th class="col-average">平均</th>
							<th class="col-date">提出日</th>
						</tr>
					</thead>
					<tbody>
						{#each sortedBills as bill}
							<tr class="bill-row" onclick={() => selectBill(bill)}>
								<td class="col-type">
									<span class="bill-type-badge">{bill.billType}{bill.billNumber}</span>
								</td>
								<td class="col-title">{bill.billTitle}</td>
								<td class="col-session">第{bill.session}回</td>
								<td class="col-positive">
									<span class="score-positive">+{bill.totalPositive}</span>
								</td>
								<td class="col-negative">
									<span class="score-negative">-{bill.totalNegative}</span>
								</td>
								<td class="col-average">
									<span
										class="score-avg"
										class:positive={bill.averageScore > 0}
										class:negative={bill.averageScore < 0}
									>
										{bill.averageScore > 0 ? '+' : ''}{bill.averageScore.toFixed(1)}
									</span>
								</td>
								<td class="col-date">{bill.submissionDate || '-'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>

<!-- Confirmation Dialog -->
{#if showConfirmDialog}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={cancelCalculation}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="confirm-dialog" onclick={(e) => e.stopPropagation()}>
			<h3>スコア再計算の確認</h3>
			<p>全議案のスコアを再計算します。この処理には時間がかかる場合があります。</p>
			<p class="warning">よろしいですか？</p>
			<div class="dialog-buttons">
				<button class="btn-cancel" onclick={cancelCalculation}>キャンセル</button>
				<button class="btn-confirm" onclick={runCalculation}>実行する</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal for bill details -->
{#if selectedBill}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-overlay" onclick={closeModal}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-content" onclick={(e) => e.stopPropagation()}>
			<button class="close-btn" onclick={closeModal}>✕</button>

			<div class="modal-header">
				<h2>{selectedBill.billTitle}</h2>
				<div class="modal-meta">
					<span class="badge">{selectedBill.billType} {selectedBill.billNumber}号</span>
					<span class="badge">第{selectedBill.session}回</span>
					{#if selectedBill.submissionDate}
						<span class="badge">{selectedBill.submissionDate}</span>
					{/if}
				</div>
			</div>

			<div class="modal-stats">
				<div class="modal-stat positive">
					<div class="stat-label">賛成議員</div>
					<div class="stat-value">{selectedBill.totalPositive}</div>
				</div>
				<div class="modal-stat negative">
					<div class="stat-label">反対議員</div>
					<div class="stat-value">{selectedBill.totalNegative}</div>
				</div>
				<div class="modal-stat average">
					<div class="stat-label">平均スコア</div>
					<div class="stat-value">{selectedBill.averageScore.toFixed(2)}</div>
				</div>
				<div class="modal-stat">
					<div class="stat-label">総議員数</div>
					<div class="stat-value">{selectedBill.memberScores.length}</div>
				</div>
			</div>

			<!-- Chart Visualization -->
			<div class="chart-section">
				<h3>スコア分布</h3>
				<div class="chart-container">
					<canvas bind:this={chartCanvas} id="memberScoresChart"></canvas>
				</div>
			</div>

			<div class="member-scores">
				<div class="member-scores-header">
					<h3>議員別スコア（全{selectedBill.memberScores.length}名）</h3>
					<input
						type="text"
						bind:value={memberSearchTerm}
						placeholder="議員名で検索..."
						class="member-search-input"
					/>
				</div>
				{#if memberSearchTerm && filteredMemberScores.length !== selectedBill.memberScores.length}
					<p class="search-result-count">{filteredMemberScores.length}名が見つかりました</p>
				{/if}
				<div class="scores-table">
					<table>
						<thead>
							<tr>
								<th>順位</th>
								<th>議員名</th>
								<th>スコア</th>
								<th>詳細</th>
							</tr>
						</thead>
						<tbody>
							{#each filteredMemberScores as member, index}
								<tr>
									<td>{index + 1}</td>
									<td>{member.memberName}</td>
									<td class={member.score > 0 ? 'positive' : member.score < 0 ? 'negative' : ''}>
										{member.score > 0 ? '+' : ''}{member.score}
									</td>
									<td>
										<details>
											<summary>詳細を見る</summary>
											<ul class="breakdown">
												{#each member.breakdown as item}
													<li>{item}</li>
												{/each}
											</ul>
										</details>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	/* ===== BASE STYLES ===== */
	.page {
		min-height: 100vh;
		background: #fafbfc;
	}

	/* ===== EXPLANATION SECTION ===== */
	.explanation-section {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem 2rem 0;
	}

	.scoring-explanation {
		background: white;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
		overflow: hidden;
	}

	.scoring-summary {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.5rem;
		cursor: pointer;
		font-size: 1rem;
		font-weight: 600;
		color: #374151;
		background: #f9fafb;
		border: none;
		list-style: none;
		transition: background 0.2s;
	}

	.scoring-summary:hover {
		background: #f3f4f6;
	}

	.scoring-summary::-webkit-details-marker {
		display: none;
	}

	.summary-icon {
		font-size: 1.2rem;
	}

	.expand-icon {
		margin-left: auto;
		font-size: 0.75rem;
		color: #9ca3af;
		transition: transform 0.3s;
	}

	.scoring-explanation[open] .expand-icon {
		transform: rotate(180deg);
	}

	.scoring-content {
		padding: 1.5rem;
		border-top: 1px solid #e5e7eb;
	}

	.scoring-intro {
		color: #64748b;
		line-height: 1.6;
		margin-bottom: 1.5rem;
	}

	.scoring-categories {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1.5rem;
		margin-bottom: 1.5rem;
	}

	.scoring-category {
		background: #f9fafb;
		border-radius: 10px;
		padding: 1.25rem;
	}

	.scoring-category h4 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 1rem 0;
		font-size: 1rem;
		color: #1a1a2e;
	}

	.category-icon {
		font-size: 1.1rem;
	}

	.score-items {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.score-item {
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-rows: auto auto;
		gap: 0.2rem 1rem;
		padding: 0.6rem 0.85rem;
		border-radius: 6px;
		background: white;
	}

	.score-item.small {
		padding: 0.4rem 0.6rem;
		grid-template-rows: auto;
	}

	.score-item.positive-bg {
		border-left: 3px solid #22c55e;
	}

	.score-item.negative-bg {
		border-left: 3px solid #ef4444;
	}

	.score-label {
		font-weight: 600;
		font-size: 0.9rem;
		color: #374151;
	}

	.score-value {
		font-weight: 700;
		font-size: 1rem;
		grid-row: span 2;
		display: flex;
		align-items: center;
	}

	.score-item.small .score-value {
		grid-row: span 1;
		font-size: 0.95rem;
	}

	.score-item.positive-bg .score-value {
		color: #16a34a;
	}

	.score-item.negative-bg .score-value {
		color: #dc2626;
	}

	.score-desc {
		font-size: 0.8rem;
		color: #6b7280;
	}

	.score-item-group {
		background: white;
		padding: 0.6rem 0.85rem;
		border-radius: 6px;
	}

	.score-item-group h5 {
		margin: 0 0 0.4rem 0;
		font-size: 0.85rem;
		color: #4b5563;
	}

	.score-row {
		display: flex;
		gap: 0.5rem;
	}

	.score-row .score-item {
		flex: 1;
	}

	.score-note {
		margin: 0.4rem 0 0 0;
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.score-notes {
		margin-top: 0.75rem;
		padding-top: 0.6rem;
		border-top: 1px dashed #e5e7eb;
	}

	.score-notes .score-note {
		margin: 0.2rem 0;
	}

	.score-note.warning {
		color: #ea580c;
	}

	.scoring-example {
		background: linear-gradient(135deg, #f0f4ff 0%, #faf5ff 100%);
		border-radius: 10px;
		padding: 1rem;
		border: 1px solid #e0e7ff;
	}

	.scoring-example h4 {
		margin: 0 0 0.75rem 0;
		color: #6366f1;
		font-size: 0.9rem;
	}

	.example-breakdown {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.example-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.4rem 0.6rem;
		background: white;
		border-radius: 4px;
		font-size: 0.85rem;
	}

	.example-row.total {
		background: #6366f1;
		color: white;
		font-weight: 600;
	}

	.example-score {
		font-weight: 600;
	}

	.example-score.positive {
		color: #16a34a;
	}

	.example-row.total .example-score {
		color: white;
	}

	/* ===== CONTROLS SECTION ===== */
	.controls-section {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.5rem 2rem;
	}

	.controls-bar {
		display: flex;
		gap: 1rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.search-wrapper {
		display: flex;
		align-items: center;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 0 1rem;
		flex: 1;
		min-width: 250px;
		max-width: 400px;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}

	.search-wrapper:focus-within {
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
	}

	.search-icon {
		font-size: 1rem;
		margin-right: 0.5rem;
	}

	.search-input {
		flex: 1;
		padding: 0.7rem 0;
		border: none;
		font-size: 0.95rem;
		background: transparent;
		color: inherit;
	}

	.search-input:focus {
		outline: none;
		box-shadow: none;
	}

	.search-input::placeholder {
		color: #9ca3af;
	}

	.stats-inline {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		color: #64748b;
	}

	.stats-inline strong {
		color: #374151;
	}

	.stat-divider {
		color: #d1d5db;
	}

	.control-group {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.control-group label {
		font-size: 0.9rem;
		color: #64748b;
	}

	.sort-select {
		padding: 0.6rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 0.9rem;
		cursor: pointer;
		background: white;
		transition: border-color 0.2s;
	}

	.sort-select:focus {
		outline: none;
		border-color: #6366f1;
	}

	.calculate-btn {
		padding: 0.6rem 1.25rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.2s,
			transform 0.2s;
		margin-left: auto;
	}

	.calculate-btn:hover:not(:disabled) {
		background: #4f46e5;
		transform: translateY(-1px);
	}

	.calculate-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.message {
		margin-top: 1rem;
		padding: 1rem;
		background: #eff6ff;
		border-left: 3px solid #3b82f6;
		border-radius: 6px;
		font-size: 0.9rem;
		color: #1e40af;
	}

	.progress-bar {
		margin-top: 0.75rem;
		height: 6px;
		background: #dbeafe;
		border-radius: 3px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #6366f1, #a855f7);
		transition: width 0.3s ease;
	}

	.progress-text {
		text-align: center;
		font-size: 0.85rem;
		margin-top: 0.5rem;
		font-weight: 600;
		color: #6366f1;
	}

	/* ===== BILLS TABLE SECTION ===== */
	.bills-section {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 2rem 3rem;
	}

	.bills-table-wrapper {
		background: white;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
		overflow: hidden;
	}

	.bills-table {
		width: 100%;
		border-collapse: collapse;
	}

	.bills-table thead {
		background: #f9fafb;
		border-bottom: 1px solid #e5e7eb;
	}

	.bills-table th {
		padding: 0.85rem 1rem;
		text-align: left;
		font-size: 0.8rem;
		font-weight: 600;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.bills-table td {
		padding: 0.85rem 1rem;
		border-bottom: 1px solid #f3f4f6;
		font-size: 0.9rem;
		color: #374151;
	}

	.bill-row {
		cursor: pointer;
		transition: background 0.15s;
	}

	.bill-row:hover {
		background: #f9fafb;
	}

	.bill-row:last-child td {
		border-bottom: none;
	}

	.col-type {
		width: 80px;
		text-align: center;
		white-space: nowrap;
	}

	.col-title {
		min-width: 300px;
	}

	.col-session {
		width: 80px;
		text-align: center;
		white-space: nowrap;
		color: #9ca3af;
	}

	.col-positive,
	.col-negative,
	.col-average {
		width: 70px;
		text-align: center;
	}

	.col-date {
		width: 100px;
		text-align: center;
		white-space: nowrap;
		color: #9ca3af;
		font-size: 0.85rem;
	}

	.bill-type-badge {
		display: inline-block;
		padding: 0.25rem 0.5rem;
		background: #eef2ff;
		color: #4f46e5;
		border-radius: 4px;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.score-positive {
		color: #16a34a;
		font-weight: 600;
	}

	.score-negative {
		color: #dc2626;
		font-weight: 600;
	}

	.score-avg {
		font-weight: 600;
		color: #64748b;
	}

	.score-avg.positive {
		color: #16a34a;
	}

	.score-avg.negative {
		color: #dc2626;
	}

	.no-results {
		text-align: center;
		padding: 4rem 2rem;
		background: white;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
	}

	.no-results-icon {
		font-size: 3rem;
		display: block;
		margin-bottom: 1rem;
	}

	.no-results p {
		color: #64748b;
		font-size: 1rem;
	}

	/* ===== MODAL STYLES ===== */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}

	.confirm-dialog {
		background: white;
		border-radius: 16px;
		padding: 2rem;
		max-width: 450px;
		box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
	}

	.confirm-dialog h3 {
		margin: 0 0 1rem 0;
		color: #1a1a2e;
		font-size: 1.25rem;
	}

	.confirm-dialog p {
		color: #64748b;
		line-height: 1.6;
		margin-bottom: 0.5rem;
		font-size: 0.95rem;
	}

	.confirm-dialog .warning {
		font-weight: 600;
		color: #f59e0b;
		margin-top: 0.75rem;
	}

	.dialog-buttons {
		display: flex;
		gap: 0.75rem;
		margin-top: 1.5rem;
		justify-content: flex-end;
	}

	.btn-cancel,
	.btn-confirm {
		padding: 0.6rem 1.25rem;
		border: none;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.2s,
			transform 0.2s;
	}

	.btn-cancel {
		background: #f3f4f6;
		color: #4b5563;
	}

	.btn-cancel:hover {
		background: #e5e7eb;
	}

	.btn-confirm {
		background: #6366f1;
		color: white;
	}

	.btn-confirm:hover {
		background: #4f46e5;
	}

	.modal-content {
		background: white;
		border-radius: 16px;
		width: 95vw;
		max-width: 1000px;
		max-height: 90vh;
		overflow-y: auto;
		padding: 2rem;
		position: relative;
	}

	.close-btn {
		position: absolute;
		top: 1rem;
		right: 1rem;
		background: #f3f4f6;
		border: none;
		font-size: 1.25rem;
		cursor: pointer;
		color: #6b7280;
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		transition: background 0.2s;
	}

	.close-btn:hover {
		background: #e5e7eb;
	}

	.modal-header h2 {
		margin: 0 0 1rem 0;
		color: #1a1a2e;
		font-size: 1.5rem;
		padding-right: 3rem;
	}

	.modal-meta {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 1.5rem;
	}

	.badge {
		display: inline-block;
		padding: 0.35rem 0.75rem;
		background: #eef2ff;
		color: #4f46e5;
		border-radius: 100px;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.modal-stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.modal-stat {
		background: #f9fafb;
		padding: 1.25rem;
		border-radius: 10px;
		text-align: center;
	}

	.modal-stat.positive {
		background: #f0fdf4;
	}

	.modal-stat.positive .stat-value {
		color: #16a34a;
	}

	.modal-stat.negative {
		background: #fef2f2;
	}

	.modal-stat.negative .stat-value {
		color: #dc2626;
	}

	.modal-stat.average {
		background: #fffbeb;
	}

	.modal-stat.average .stat-value {
		color: #d97706;
	}

	.modal-stat .stat-label {
		font-size: 0.8rem;
		color: #6b7280;
		margin-bottom: 0.4rem;
	}

	.modal-stat .stat-value {
		font-size: 1.75rem;
		font-weight: 700;
		color: #374151;
	}

	.chart-section {
		margin-bottom: 2rem;
	}

	.chart-section h3 {
		margin: 0 0 1rem 0;
		font-size: 1.1rem;
		color: #1a1a2e;
	}

	.chart-container {
		background: #f9fafb;
		padding: 1.25rem;
		border-radius: 10px;
		height: 280px;
	}

	.chart-container canvas {
		min-height: 100%;
	}

	.member-scores-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.member-scores-header h3 {
		margin: 0;
		font-size: 1.1rem;
		color: #1a1a2e;
	}

	.member-search-input {
		padding: 0.5rem 0.85rem;
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		font-size: 0.9rem;
		min-width: 180px;
		transition: border-color 0.2s;
	}

	.member-search-input:focus {
		outline: none;
		border-color: #6366f1;
	}

	.search-result-count {
		font-size: 0.85rem;
		color: #6b7280;
		margin-bottom: 0.5rem;
	}

	.scores-table {
		overflow-x: auto;
	}

	.scores-table table {
		width: 100%;
		border-collapse: collapse;
	}

	.scores-table thead {
		background: #f9fafb;
	}

	.scores-table th {
		padding: 0.75rem 1rem;
		text-align: left;
		font-size: 0.8rem;
		font-weight: 600;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.scores-table td {
		padding: 0.65rem 1rem;
		border-bottom: 1px solid #f3f4f6;
		font-size: 0.9rem;
	}

	.scores-table tbody tr:hover {
		background: #f9fafb;
	}

	.scores-table td.positive {
		color: #16a34a;
		font-weight: 600;
	}

	.scores-table td.negative {
		color: #dc2626;
		font-weight: 600;
	}

	.scores-table details {
		cursor: pointer;
	}

	.scores-table summary {
		color: #6366f1;
		font-size: 0.85rem;
	}

	.breakdown {
		margin-top: 0.5rem;
		padding-left: 1.25rem;
		font-size: 0.8rem;
		color: #6b7280;
	}

	.breakdown li {
		margin-bottom: 0.2rem;
	}

	/* ===== RESPONSIVE ===== */
	@media (max-width: 900px) {
		.bills-table-wrapper {
			overflow-x: auto;
		}

		.col-title {
			min-width: 200px;
		}
	}

	@media (max-width: 768px) {
		.explanation-section,
		.controls-section,
		.bills-section {
			padding-left: 1rem;
			padding-right: 1rem;
		}

		.controls-bar {
			flex-direction: column;
			align-items: stretch;
		}

		.stats-inline {
			justify-content: center;
		}

		.search-wrapper {
			max-width: none;
		}

		.calculate-btn {
			margin-left: 0;
		}

		.modal-stats {
			grid-template-columns: repeat(2, 1fr);
		}

		.modal-content {
			padding: 1.5rem;
		}

		.scoring-categories {
			grid-template-columns: 1fr;
		}

		.score-row {
			flex-direction: column;
		}

		.member-scores-header {
			flex-direction: column;
			align-items: stretch;
		}

		.member-search-input {
			width: 100%;
			min-width: unset;
		}
	}
</style>
