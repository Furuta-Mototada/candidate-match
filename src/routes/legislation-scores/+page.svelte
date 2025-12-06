<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

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

	let legislationScores: LegislationScore[] = $state(data.legislationScores || []);
	let selectedBill: LegislationScore | null = $state(null);
	let searchTerm: string = $state('');
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
	}

	function closeModal() {
		selectedBill = null;
		// Destroy chart if it exists
		if (chartInstance) {
			chartInstance.destroy();
			chartInstance = null;
		}
	}

	let chartInstance: any = null;
	let chartCanvas: HTMLCanvasElement | undefined = $state(undefined);

	// Create chart when selected bill changes
	$effect(() => {
		if (selectedBill && chartCanvas && typeof window !== 'undefined' && (window as any).Chart) {
			// Destroy existing chart
			if (chartInstance) {
				chartInstance.destroy();
			}

			const ctx = chartCanvas.getContext('2d');
			if (!ctx) return;

			// Prepare data - show all members sorted by score
			const sortedMembers = [...selectedBill.memberScores].sort((a, b) => b.score - a.score);

			// Create chart
			chartInstance = new (window as any).Chart(ctx, {
				type: 'bar',
				data: {
					labels: sortedMembers.map((m) => m.memberName),
					datasets: [
						{
							label: 'Score',
							data: sortedMembers.map((m) => m.score),
							backgroundColor: sortedMembers.map((m) => {
								if (m.score > 0) return 'rgba(76, 175, 80, 0.7)';
								if (m.score < 0) return 'rgba(244, 67, 54, 0.7)';
								return 'rgba(158, 158, 158, 0.7)';
							}),
							borderColor: sortedMembers.map((m) => {
								if (m.score > 0) return 'rgb(76, 175, 80)';
								if (m.score < 0) return 'rgb(244, 67, 54)';
								return 'rgb(158, 158, 158)';
							}),
							borderWidth: 2
						}
					]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					indexAxis: 'y',
					scales: {
						x: {
							beginAtZero: true,
							title: {
								display: true,
								text: 'Score',
								font: {
									size: 14,
									weight: 'bold'
								}
							}
						},
						y: {
							ticks: {
								font: {
									size: 10
								}
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
									return `Score: ${context.parsed.x}`;
								},
								afterLabel: function (context: any) {
									const member = sortedMembers[context.dataIndex];
									return member.breakdown.join('\n');
								}
							}
						}
					}
				}
			});
		}
	});

	// Chart setup
	onMount(() => {
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

<div class="container">
	<div class="header">
		<h1>議案別スコア分析</h1>
		<p class="subtitle">各議案に対する全議員のスコアを表示します</p>
	</div>

	<div class="controls">
		<div class="control-group">
			<input
				type="text"
				bind:value={searchTerm}
				placeholder="議案名で検索..."
				class="search-input"
			/>
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
			{calculating ? '計算中...' : 'スコアを再計算'}
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

	<div class="stats">
		<div class="stat-card">
			<div class="stat-label">総議案数</div>
			<div class="stat-value">{legislationScores.length}</div>
		</div>
		<div class="stat-card">
			<div class="stat-label">表示中</div>
			<div class="stat-value">{filteredBills.length}</div>
		</div>
	</div>

	<div class="bills-grid">
		{#each sortedBills as bill}
			<button class="bill-card" onclick={() => selectBill(bill)}>
				<div class="bill-header">
					<div class="bill-type">{bill.billType} {bill.billNumber}号</div>
					<div class="bill-session">第{bill.session}回</div>
				</div>
				<h3 class="bill-title">{bill.billTitle}</h3>
				<div class="bill-stats">
					<div class="stat-item positive">
						<span class="stat-icon">✓</span>
						<span>{bill.totalPositive}</span>
					</div>
					<div class="stat-item negative">
						<span class="stat-icon">✗</span>
						<span>{bill.totalNegative}</span>
					</div>
					<div class="stat-item average">
						<span>平均: {bill.averageScore.toFixed(2)}</span>
					</div>
				</div>
				{#if bill.submissionDate}
					<div class="bill-date">提出日: {bill.submissionDate}</div>
				{/if}
			</button>
		{/each}
	</div>

	{#if sortedBills.length === 0}
		<div class="no-results">検索条件に一致する議案が見つかりませんでした。</div>
	{/if}
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
				<h3>スコア分布グラフ</h3>
				<div class="chart-container">
					<canvas bind:this={chartCanvas} id="memberScoresChart"></canvas>
				</div>
			</div>

			<div class="member-scores">
				<h3>議員別スコア（全{selectedBill.memberScores.length}名）</h3>
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
							{#each selectedBill.memberScores as member, index}
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
	.container {
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem;
	}

	.header {
		text-align: center;
		margin-bottom: 2rem;
	}

	h1 {
		font-size: 2.5rem;
		color: #333;
		margin-bottom: 0.5rem;
	}

	.subtitle {
		color: #666;
		font-size: 1.1rem;
	}

	.controls {
		display: flex;
		gap: 1rem;
		margin-bottom: 2rem;
		flex-wrap: wrap;
		align-items: center;
		background: white;
		padding: 1.5rem;
		border-radius: 10px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.control-group {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.search-input {
		padding: 0.75rem 1rem;
		border: 2px solid #e0e0e0;
		border-radius: 8px;
		font-size: 1rem;
		min-width: 300px;
		transition: border-color 0.3s;
	}

	.search-input:focus {
		outline: none;
		border-color: #667eea;
	}

	.sort-select {
		padding: 0.75rem 1rem;
		border: 2px solid #e0e0e0;
		border-radius: 8px;
		font-size: 1rem;
		cursor: pointer;
		background: white;
	}

	.calculate-btn {
		padding: 0.75rem 1.5rem;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			transform 0.2s,
			box-shadow 0.2s;
		margin-left: auto;
	}

	.calculate-btn:hover:not(:disabled) {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
	}

	.calculate-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.message {
		padding: 1rem;
		background: #e7f3ff;
		border-left: 4px solid #2196f3;
		border-radius: 4px;
		margin-bottom: 1rem;
	}

	.progress-bar {
		margin-top: 0.75rem;
		height: 8px;
		background: #e0e0e0;
		border-radius: 4px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
		transition: width 0.3s ease;
	}

	.progress-text {
		text-align: center;
		font-size: 0.9rem;
		margin-top: 0.5rem;
		font-weight: 600;
		color: #667eea;
	}

	.confirm-dialog {
		background: white;
		border-radius: 15px;
		padding: 2rem;
		max-width: 500px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
	}

	.confirm-dialog h3 {
		margin: 0 0 1rem 0;
		color: #333;
		font-size: 1.5rem;
	}

	.confirm-dialog p {
		color: #666;
		line-height: 1.6;
		margin-bottom: 0.75rem;
	}

	.confirm-dialog .warning {
		font-weight: 600;
		color: #ff9800;
		margin-top: 1rem;
	}

	.dialog-buttons {
		display: flex;
		gap: 1rem;
		margin-top: 1.5rem;
		justify-content: flex-end;
	}

	.btn-cancel,
	.btn-confirm {
		padding: 0.75rem 1.5rem;
		border: none;
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			transform 0.2s,
			box-shadow 0.2s;
	}

	.btn-cancel {
		background: #e0e0e0;
		color: #666;
	}

	.btn-cancel:hover {
		background: #d0d0d0;
		transform: translateY(-2px);
	}

	.btn-confirm {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
	}

	.btn-confirm:hover {
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.stat-card {
		background: white;
		padding: 1.5rem;
		border-radius: 10px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		text-align: center;
	}

	.stat-label {
		font-size: 0.9rem;
		color: #666;
		margin-bottom: 0.5rem;
	}

	.stat-value {
		font-size: 2rem;
		font-weight: bold;
		color: #667eea;
	}

	.bills-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
		gap: 1.5rem;
	}

	.bill-card {
		background: white;
		padding: 1.5rem;
		border-radius: 10px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		cursor: pointer;
		transition:
			transform 0.2s,
			box-shadow 0.2s;
		text-align: left;
		border: none;
		width: 100%;
	}

	.bill-card:hover {
		transform: translateY(-4px);
		box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
	}

	.bill-header {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.75rem;
		font-size: 0.9rem;
	}

	.bill-type {
		color: #667eea;
		font-weight: 600;
	}

	.bill-session {
		color: #666;
	}

	.bill-title {
		font-size: 1.1rem;
		margin-bottom: 1rem;
		color: #333;
		line-height: 1.4;
	}

	.bill-stats {
		display: flex;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}

	.stat-item {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.9rem;
	}

	.stat-item.positive {
		color: #4caf50;
	}

	.stat-item.negative {
		color: #f44336;
	}

	.stat-item.average {
		color: #666;
	}

	.stat-icon {
		font-weight: bold;
	}

	.bill-date {
		font-size: 0.85rem;
		color: #999;
		margin-top: 0.5rem;
	}

	.no-results {
		text-align: center;
		padding: 3rem;
		color: #666;
		font-size: 1.1rem;
	}

	/* Modal styles */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 2rem;
	}

	.modal-content {
		background: white;
		border-radius: 15px;
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
		background: none;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		color: #666;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		transition: background 0.2s;
	}

	.close-btn:hover {
		background: #f0f0f0;
	}

	.modal-header h2 {
		margin-bottom: 1rem;
		color: #333;
	}

	.modal-meta {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 1.5rem;
	}

	.badge {
		display: inline-block;
		padding: 0.4rem 0.8rem;
		background: #e7f3ff;
		color: #2196f3;
		border-radius: 20px;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.modal-stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.modal-stat {
		background: #f8f9fa;
		padding: 1.5rem;
		border-radius: 10px;
		text-align: center;
	}

	.modal-stat.positive {
		background: #e8f5e9;
		color: #2e7d32;
	}

	.modal-stat.negative {
		background: #ffebee;
		color: #c62828;
	}

	.modal-stat.average {
		background: #fff3e0;
		color: #e65100;
	}

	.modal-stat .stat-label {
		font-size: 0.9rem;
		margin-bottom: 0.5rem;
		opacity: 0.8;
	}

	.modal-stat .stat-value {
		font-size: 2rem;
		font-weight: bold;
	}

	.chart-section {
		margin-bottom: 2rem;
	}

	.chart-section h3 {
		margin-bottom: 1rem;
		color: #333;
	}

	.chart-container {
		background: white;
		padding: 1.5rem;
		border-radius: 10px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		height: 600px;
		overflow-y: auto;
	}

	.chart-container canvas {
		max-height: none !important;
	}

	.member-scores h3 {
		margin-bottom: 1rem;
		color: #333;
	}
	.modal-stat {
		background: #f8f9fa;
		padding: 1.5rem;
		border-radius: 10px;
		text-align: center;
	}

	.modal-stat.positive {
		background: #e8f5e9;
		color: #2e7d32;
	}

	.modal-stat.negative {
		background: #ffebee;
		color: #c62828;
	}

	.modal-stat.average {
		background: #fff3e0;
		color: #e65100;
	}

	.modal-stat .stat-label {
		font-size: 0.9rem;
		margin-bottom: 0.5rem;
		opacity: 0.8;
	}

	.modal-stat .stat-value {
		font-size: 2rem;
		font-weight: bold;
	}

	.member-scores h3 {
		margin-bottom: 1rem;
		color: #333;
	}

	.scores-table {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	thead {
		background: #f8f9fa;
	}

	th {
		padding: 1rem;
		text-align: left;
		font-weight: 600;
		color: #666;
	}

	td {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #e0e0e0;
	}

	tbody tr:hover {
		background: #f8f9fa;
	}

	td.positive {
		color: #4caf50;
		font-weight: 600;
	}

	td.negative {
		color: #f44336;
		font-weight: 600;
	}

	details {
		cursor: pointer;
	}

	summary {
		color: #667eea;
		font-size: 0.9rem;
	}

	.breakdown {
		margin-top: 0.5rem;
		padding-left: 1.5rem;
		font-size: 0.85rem;
		color: #666;
	}

	.breakdown li {
		margin-bottom: 0.25rem;
	}

	@media (max-width: 768px) {
		.container {
			padding: 1rem;
		}

		h1 {
			font-size: 1.8rem;
		}

		.controls {
			flex-direction: column;
		}

		.search-input {
			min-width: 100%;
		}

		.calculate-btn {
			width: 100%;
			margin-left: 0;
		}

		.bills-grid {
			grid-template-columns: 1fr;
		}

		.modal-stats {
			grid-template-columns: 1fr;
		}

		.chart-container {
			height: 400px;
		}

		.modal-content {
			padding: 1rem;
		}
	}
</style>
