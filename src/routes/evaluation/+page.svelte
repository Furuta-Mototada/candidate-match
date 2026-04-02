<script lang="ts">
	import { onMount } from 'svelte';
	import { PageHero } from '$lib/components/index.js';
	import { FlaskConical, Play, BookOpen, Target, Lightbulb, BarChart3 } from '@lucide/svelte';
	import type { PageData } from './$types.js';

	let { data }: { data: PageData } = $props();

	// Types
	interface SavedVector {
		id: number;
		clusterId: number;
		clusterLabel: number;
		name: string;
		dimensions: number;
		memberCount: number;
		billCount: number;
		isDefault: boolean;
		createdAt: string;
	}

	interface AggregatedMetrics {
		strategy: string;
		avgCosineError: number[];
		avgVectorMSE: number[];
		avgUncertaintySum: number[];
		avgTrueRank: number[];
		top5Rate: number[];
		avgQuestionsToConverge: number | null;
	}

	interface PerMemberResult {
		strategy: string;
		memberId: number;
		memberName: string;
		finalCosineError: number | null;
		finalRank: number | null;
		steps: {
			questionNumber: number;
			billId: number;
			cosineError: number;
			vectorMSE: number;
			uncertaintySum: number;
			top1Correct: boolean;
			top5Correct: boolean;
			trueRank: number;
		}[];
	}

	interface EvalResult {
		aggregated: AggregatedMetrics[];
		memberCount: number;
		billCount: number;
		dimensions: number;
		clusterLabel: number;
		sampleMemberIds: number[];
		perMember: PerMemberResult[];
	}

	// State
	let savedVectors: SavedVector[] = $state((data.savedVectors || []) as SavedVector[]);
	let selectedVectorId: number | null = $state(null);
	let maxQuestions = $state(20);
	let sampleSize = $state(10);
	let convergeThreshold = $state(0.2);
	let isRunning = $state(false);
	let error: string | null = $state(null);
	let result: EvalResult | null = $state(null);
	let activeChart: 'cosine' | 'rank' | 'top5' | 'uncertainty' = $state('cosine');
	let selectedMember: number | null = $state(null);

	// Strategy display config
	const strategyConfig: Record<string, { label: string; color: string; description: string }> = {
		cat: {
			label: 'CAT（適応型）',
			color: '#4f46e5',
			description: '不確実性 × 議論度スコアで次の質問を選択 — 本アプリの実装アルゴリズム'
		},
		random: {
			label: 'ランダム',
			color: '#ef4444',
			description: '未回答の法案からランダムに選択'
		},
		controversial: {
			label: '最大分散',
			color: '#f59e0b',
			description: '議員間の投票分散が最大の法案を選択'
		}
	};

	// Auto-select default vector
	onMount(() => {
		const defaultVec = savedVectors.find((v) => v.isDefault);
		if (defaultVec) {
			selectedVectorId = defaultVec.id;
		} else if (savedVectors.length > 0) {
			selectedVectorId = savedVectors[0].id;
		}
	});

	async function runEvaluation() {
		if (!selectedVectorId) return;

		isRunning = true;
		error = null;
		result = null;

		try {
			const response = await fetch('/api/evaluation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					savedVectorId: selectedVectorId,
					maxQuestions,
					sampleSize,
					convergeThreshold
				})
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error || 'Evaluation failed');
			}

			const data = await response.json();
			result = data.result;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unknown error';
		} finally {
			isRunning = false;
		}
	}

	// Chart helpers
	function getChartData(
		metric: 'cosine' | 'rank' | 'top5' | 'uncertainty'
	): { strategy: string; values: number[] }[] {
		if (!result) return [];
		return result.aggregated.map((a) => ({
			strategy: a.strategy,
			values:
				metric === 'cosine'
					? a.avgCosineError
					: metric === 'rank'
						? a.avgTrueRank
						: metric === 'top5'
							? a.top5Rate
							: a.avgUncertaintySum
		}));
	}

	function getYLabel(metric: 'cosine' | 'rank' | 'top5' | 'uncertainty'): string {
		switch (metric) {
			case 'cosine':
				return 'コサイン誤差 (1 − cos θ)';
			case 'rank':
				return '真のランク順位';
			case 'top5':
				return 'Top-5 的中率';
			case 'uncertainty':
				return '不確実性合計';
		}
	}

	function getYDomain(metric: 'cosine' | 'rank' | 'top5' | 'uncertainty'): [number, number] {
		if (!result) return [0, 1];
		const data = getChartData(metric);
		const allVals = data.flatMap((d) => d.values);
		if (allVals.length === 0) return [0, 1];
		if (metric === 'top5') return [0, 1];
		const max = Math.max(...allVals);
		return [0, Math.ceil(max * 10) / 10 || 1];
	}

	// SVG chart dimensions
	const chartWidth = 700;
	const chartHeight = 370;
	const padding = { top: 20, right: 30, bottom: 60, left: 60 };
	const plotWidth = chartWidth - padding.left - padding.right;
	const plotHeight = chartHeight - padding.top - padding.bottom;

	function xScale(q: number, maxQ: number): number {
		return padding.left + ((q - 1) / Math.max(maxQ - 1, 1)) * plotWidth;
	}

	function yScale(val: number, domain: [number, number]): number {
		const [min, max] = domain;
		const ratio = max === min ? 0 : (val - min) / (max - min);
		return padding.top + plotHeight - ratio * plotHeight;
	}

	function buildPath(values: number[], maxQ: number, domain: [number, number]): string {
		if (values.length === 0) return '';
		return values
			.map((v, i) => {
				const x = xScale(i + 1, maxQ);
				const y = yScale(v, domain);
				return `${i === 0 ? 'M' : 'L'}${x},${y}`;
			})
			.join(' ');
	}

	// Per-member detail data
	function getMemberResults(): PerMemberResult[] {
		if (!result || selectedMember === null) return [];
		return result.perMember.filter((r) => r.memberId === selectedMember);
	}

	// Derived chart data
	let chartData = $derived(getChartData(activeChart));
	let chartDomain = $derived(getYDomain(activeChart));

	$effect(() => {
		if (result && result.sampleMemberIds.length > 0 && selectedMember === null) {
			selectedMember = result.sampleMemberIds[0];
		}
	});
</script>

<PageHero
	title="アルゴリズム評価"
	description="適応型質問選択アルゴリズムの精度を、3つのベースライン戦略と比較・評価します"
>
	{#snippet badge()}<FlaskConical size={16} class="inline-icon" /> アルゴリズム評価{/snippet}
</PageHero>

<div class="page">
	<!-- Explanation Section (Collapsible) -->
	<section class="explanation-section">
		<details class="explanation-details-wrapper">
			<summary class="explanation-summary">
				<span class="summary-icon"><BookOpen size={16} /></span>
				<span>この評価について</span>
				<span class="expand-icon">▼</span>
			</summary>

			<div class="explanation-content">
				<div class="explanation-intro">
					<h3><Target size={16} class="inline-icon" /> 何を評価しているの？</h3>
					<p>
						マッチング機能で使用している<strong>適応型質問選択（CAT）</strong
						>アルゴリズムの性能を評価します。
						実際の国会議員の投票データを「正解」として、各戦略がどれだけ早く正確な政治的立場を推定できるかを計測します。
					</p>
				</div>

				<div class="explanation-diagram">
					<div class="diagram-container">
						<div class="diagram-before">
							<div class="diagram-title">シミュレーション方法</div>
							<div class="diagram-visual">
								<div class="step-visual">
									<div class="step-item">👤 議員の投票履歴</div>
									<div class="step-arrow">↓</div>
									<div class="step-item highlight">「ユーザー」として回答をシミュレート</div>
									<div class="step-arrow">↓</div>
									<div class="step-item">各戦略で質問を選択</div>
								</div>
							</div>
							<div class="diagram-desc">実際の議員データで精度を検証</div>
						</div>

						<div class="diagram-arrow">→</div>

						<div class="diagram-after">
							<div class="diagram-title">比較結果</div>
							<div class="diagram-visual">
								<div class="step-visual">
									<div class="strategy-compare">
										<div class="compare-item cat-item">
											<span class="compare-dot" style="background: #4f46e5"></span>
											CAT — 早い収束
										</div>
										<div class="compare-item">
											<span class="compare-dot" style="background: #ef4444"></span>
											ランダム — 遅い
										</div>
										<div class="compare-item">
											<span class="compare-dot" style="background: #f59e0b"></span>
											最大分散 — 中程度
										</div>
									</div>
								</div>
							</div>
							<div class="diagram-desc">戦略間の収束速度と精度を比較</div>
						</div>
					</div>
				</div>

				<div class="explanation-details">
					<div class="detail-card">
						<h4><FlaskConical size={16} class="inline-icon" /> 3つの戦略</h4>
						<div class="strategy-list">
							{#each Object.entries(strategyConfig) as [stratKey, config] (stratKey)}
								<div class="strategy-item">
									<span class="strategy-dot" style="background:{config.color}"></span>
									<div>
										<strong>{config.label}</strong>
										<p>{config.description}</p>
									</div>
								</div>
							{/each}
						</div>
					</div>

					<div class="detail-card">
						<h4><BarChart3 size={16} class="inline-icon" /> 評価指標</h4>
						<ul>
							<li>
								<strong>コサイン誤差</strong> — 推定ベクトルと真のベクトルの距離。0に近いほど正確
							</li>
							<li>
								<strong>真のランク順位</strong> — シミュレート対象の議員が類似度ランキングの何位に出るか。1位が理想
							</li>
							<li><strong>Top-5 的中率</strong> — 上位5件に正解議員が含まれる割合。高いほど良い</li>
							<li>
								<strong>不確実性合計</strong> — 全潜在次元の不確実性の合計。低いほど推定が安定
							</li>
						</ul>
					</div>

					<div class="detail-card">
						<h4><Lightbulb size={16} class="inline-icon" /> 期待される結果</h4>
						<p>
							CATアルゴリズムは、不確実性が高い次元に関連する法案を優先的に選択するため、
							他の戦略より<strong>少ない質問数</strong>で正確な推定に収束することが期待されます。
						</p>
						<p class="detail-note">
							<Lightbulb size={14} class="inline-icon" color="#f59e0b" /> サンプル数やベクトルデータによって結果が変わる場合があります。
						</p>
					</div>
				</div>
			</div>
		</details>
	</section>

	<!-- Configuration -->
	<section class="config-section">
		<div class="section-header">
			<h2>評価設定</h2>
		</div>

		<div class="form-group">
			<label for="vector-select">ベクトルデータ</label>
			<select id="vector-select" class="select" bind:value={selectedVectorId}>
				<option value={null}>保存済みベクトルを選択...</option>
				{#each savedVectors as vec (vec.id)}
					<option value={vec.id}>
						{vec.name} — ラベル {vec.clusterLabel}（{vec.memberCount}人, {vec.billCount}法案, {vec.dimensions}次元）
						{vec.isDefault ? ' ★' : ''}
					</option>
				{/each}
			</select>
		</div>

		<div class="form-row">
			<div class="form-group">
				<label for="max-q">最大質問数</label>
				<input id="max-q" class="input" type="number" bind:value={maxQuestions} min={5} max={50} />
			</div>
			<div class="form-group">
				<label for="sample-size">サンプル議員数</label>
				<input
					id="sample-size"
					class="input"
					type="number"
					bind:value={sampleSize}
					min={3}
					max={50}
				/>
			</div>
			<div class="form-group">
				<label for="threshold">収束閾値</label>
				<input
					id="threshold"
					class="input"
					type="number"
					bind:value={convergeThreshold}
					min={0.05}
					max={1}
					step={0.05}
				/>
			</div>
		</div>

		<button class="btn-primary" onclick={runEvaluation} disabled={isRunning || !selectedVectorId}>
			{#if isRunning}
				<span class="btn-spinner"></span>
				評価を実行中...
			{:else}
				<Play size={18} class="inline-icon" />
				評価を実行
			{/if}
		</button>

		{#if error}
			<p class="error-msg">{error}</p>
		{/if}
	</section>

	<!-- Results -->
	{#if result}
		<section class="results-section">
			<!-- Summary Cards -->
			<div class="summary-row">
				{#each result.aggregated as agg (agg.strategy)}
					{@const config = strategyConfig[agg.strategy]}
					<div class="summary-card" style="border-top: 3px solid {config?.color || '#999'}">
						<h3>{config?.label || agg.strategy}</h3>
						<div class="summary-stats">
							<div class="stat">
								<span class="stat-value">
									{agg.avgQuestionsToConverge !== null
										? agg.avgQuestionsToConverge.toFixed(1)
										: '—'}
								</span>
								<span class="stat-label">平均収束質問数</span>
							</div>
							<div class="stat">
								<span class="stat-value">
									{agg.avgCosineError.length > 0
										? agg.avgCosineError[agg.avgCosineError.length - 1].toFixed(3)
										: '—'}
								</span>
								<span class="stat-label">最終コサイン誤差</span>
							</div>
							<div class="stat">
								<span class="stat-value">
									{agg.top5Rate.length > 0
										? (agg.top5Rate[agg.top5Rate.length - 1] * 100).toFixed(0) + '%'
										: '—'}
								</span>
								<span class="stat-label">最終Top-5率</span>
							</div>
							<div class="stat">
								<span class="stat-value">
									{agg.avgTrueRank.length > 0
										? agg.avgTrueRank[agg.avgTrueRank.length - 1].toFixed(1)
										: '—'}
								</span>
								<span class="stat-label">最終平均ランク</span>
							</div>
						</div>
					</div>
				{/each}
			</div>

			<!-- Chart Tabs -->
			<div class="chart-section">
				<div class="chart-tabs">
					<button
						class="chart-tab"
						class:active={activeChart === 'cosine'}
						onclick={() => (activeChart = 'cosine')}
					>
						コサイン誤差
					</button>
					<button
						class="chart-tab"
						class:active={activeChart === 'rank'}
						onclick={() => (activeChart = 'rank')}
					>
						真のランク
					</button>
					<button
						class="chart-tab"
						class:active={activeChart === 'top5'}
						onclick={() => (activeChart = 'top5')}
					>
						Top-5 的中率
					</button>
					<button
						class="chart-tab"
						class:active={activeChart === 'uncertainty'}
						onclick={() => (activeChart = 'uncertainty')}
					>
						不確実性
					</button>
				</div>

				<div class="chart-container">
					<svg viewBox="0 0 {chartWidth} {chartHeight}" class="eval-chart">
						<!-- Grid lines -->
						{#each Array.from({ length: 5 }, (_, idx) => idx) as i (i)}
							{@const y = padding.top + (plotHeight / 4) * i}
							<line
								x1={padding.left}
								y1={y}
								x2={padding.left + plotWidth}
								y2={y}
								stroke="#e5e7eb"
								stroke-width="1"
							/>
							<text x={padding.left - 8} y={y + 4} text-anchor="end" font-size="11" fill="#6b7280">
								{(chartDomain[1] - ((chartDomain[1] - chartDomain[0]) / 4) * i).toFixed(
									activeChart === 'top5' ? 1 : activeChart === 'rank' ? 0 : 2
								)}
							</text>
						{/each}

						<!-- X-axis labels -->
						{#each Array.from({ length: Math.min(maxQuestions, 10) }, (_, idx) => idx) as i (i)}
							{@const q = Math.ceil(((i + 1) / 10) * maxQuestions)}
							<text
								x={xScale(q, maxQuestions)}
								y={padding.top + plotHeight + 20}
								text-anchor="middle"
								font-size="11"
								fill="#6b7280"
							>
								{q}
							</text>
						{/each}

						<!-- Axis labels -->
						<text
							x={padding.left + plotWidth / 2}
							y={padding.top + plotHeight + 45}
							text-anchor="middle"
							font-size="12"
							fill="#374151"
						>
							回答済み質問数
						</text>
						<text
							x={14}
							y={padding.top + plotHeight / 2}
							text-anchor="middle"
							font-size="12"
							fill="#374151"
							transform="rotate(-90, 14, {padding.top + plotHeight / 2})"
						>
							{getYLabel(activeChart)}
						</text>

						<!-- Data lines -->
						{#each chartData as series (series.strategy)}
							{@const config = strategyConfig[series.strategy]}
							<path
								d={buildPath(series.values, maxQuestions, chartDomain)}
								fill="none"
								stroke={config?.color || '#999'}
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
							<!-- Data points -->
							{#each series.values as val, i (i)}
								<circle
									cx={xScale(i + 1, maxQuestions)}
									cy={yScale(val, chartDomain)}
									r="3"
									fill={config?.color || '#999'}
									opacity="0.7"
								/>
							{/each}
						{/each}
					</svg>

					<!-- Legend -->
					<div class="chart-legend">
						{#each Object.entries(strategyConfig) as [stratKey, config] (stratKey)}
							<span class="legend-item">
								<span class="legend-line" style="background:{config.color}"></span>
								{config.label}
							</span>
						{/each}
					</div>
				</div>
			</div>

			<!-- Per-Member Results -->
			<div class="per-member-section">
				<h2>議員別結果</h2>
				<p class="section-desc">
					サンプル議員を選択して、各戦略のステップごとの精度推移を確認できます。
				</p>

				<div class="member-selector">
					{#each result.sampleMemberIds as memberId (memberId)}
						{@const memberResult = result.perMember.find((r) => r.memberId === memberId)}
						<button
							class="member-btn"
							class:active={selectedMember === memberId}
							onclick={() => (selectedMember = memberId)}
						>
							{memberResult?.memberName || `議員 ${memberId}`}
						</button>
					{/each}
				</div>

				{#if selectedMember !== null}
					{@const memberResults = getMemberResults()}
					<div class="member-detail-grid">
						{#each memberResults as mr (mr.strategy)}
							{@const config = strategyConfig[mr.strategy]}
							<div
								class="member-detail-card"
								style="border-left: 3px solid {config?.color || '#999'}"
							>
								<h4>{config?.label || mr.strategy}</h4>
								<div class="detail-stats">
									<span>
										最終誤差: <strong>
											{mr.finalCosineError !== null ? mr.finalCosineError.toFixed(4) : '—'}
										</strong>
									</span>
									<span>
										最終ランク: <strong>{mr.finalRank ?? '—'}</strong>
									</span>
								</div>
								{#if mr.steps.length > 0}
									<table class="step-table">
										<thead>
											<tr>
												<th>Q#</th>
												<th>コサイン誤差</th>
												<th>ランク</th>
												<th>Top-5</th>
											</tr>
										</thead>
										<tbody>
											{#each mr.steps as step (step.questionNumber)}
												<tr>
													<td>{step.questionNumber}</td>
													<td>{step.cosineError.toFixed(4)}</td>
													<td class:rank-good={step.trueRank <= 5}>{step.trueRank}</td>
													<td>{step.top5Correct ? '✓' : '✗'}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Convergence Comparison Table -->
			<div class="comparison-section">
				<h2>収束比較</h2>
				<div class="table-wrapper">
					<table class="comparison-table">
						<thead>
							<tr>
								<th>戦略</th>
								<th>平均収束質問数</th>
								<th>最終コサイン誤差</th>
								<th>最終平均ランク</th>
								<th>最終Top-5率</th>
								<th>Q5時点の誤差</th>
								<th>Q5時点のランク</th>
							</tr>
						</thead>
						<tbody>
							{#each result.aggregated as agg (agg.strategy)}
								{@const config = strategyConfig[agg.strategy]}
								<tr>
									<td>
										<span class="strategy-dot-sm" style="background:{config?.color}"></span>
										{config?.label || agg.strategy}
									</td>
									<td>
										{agg.avgQuestionsToConverge !== null
											? agg.avgQuestionsToConverge.toFixed(1)
											: '未収束'}
									</td>
									<td>
										{agg.avgCosineError.length > 0
											? agg.avgCosineError[agg.avgCosineError.length - 1].toFixed(4)
											: '—'}
									</td>
									<td>
										{agg.avgTrueRank.length > 0
											? agg.avgTrueRank[agg.avgTrueRank.length - 1].toFixed(1)
											: '—'}
									</td>
									<td>
										{agg.top5Rate.length > 0
											? (agg.top5Rate[agg.top5Rate.length - 1] * 100).toFixed(0) + '%'
											: '—'}
									</td>
									<td>{agg.avgCosineError.length >= 5 ? agg.avgCosineError[4].toFixed(4) : '—'}</td>
									<td>{agg.avgTrueRank.length >= 5 ? agg.avgTrueRank[4].toFixed(1) : '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		</section>
	{/if}
</div>

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

	.explanation-details-wrapper {
		background: white;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
		overflow: hidden;
	}

	.explanation-summary {
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

	.explanation-summary:hover {
		background: #f3f4f6;
	}

	.explanation-summary::-webkit-details-marker {
		display: none;
	}

	.summary-icon {
		display: flex;
		align-items: center;
	}

	.expand-icon {
		margin-left: auto;
		font-size: 0.75rem;
		color: #9ca3af;
		transition: transform 0.3s;
	}

	.explanation-details-wrapper[open] .expand-icon {
		transform: rotate(180deg);
	}

	.explanation-content {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		padding: 1.5rem;
		border-top: 1px solid #e5e7eb;
	}

	.explanation-intro {
		background: #f9fafb;
		padding: 1.25rem;
		border-radius: 10px;
	}

	.explanation-intro h3 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.75rem 0;
		font-size: 1rem;
		color: #1a1a2e;
	}

	.explanation-intro p {
		margin: 0;
		color: #64748b;
		line-height: 1.6;
	}

	.explanation-diagram {
		background: #f9fafb;
		padding: 1.5rem;
		border-radius: 10px;
		overflow-x: auto;
	}

	.diagram-container {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
		flex-wrap: wrap;
	}

	.diagram-before,
	.diagram-after {
		flex: 1;
		min-width: 200px;
		max-width: 350px;
	}

	.diagram-title {
		font-weight: 700;
		font-size: 0.9rem;
		color: #1a1a2e;
		margin-bottom: 0.75rem;
		text-align: center;
	}

	.diagram-visual {
		background: white;
		border-radius: 8px;
		padding: 1rem;
		border: 1px solid #e5e7eb;
		min-height: 100px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.step-visual {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.85rem;
		color: #374151;
	}

	.step-item {
		padding: 0.4rem 0.85rem;
		background: #f3f4f6;
		border-radius: 6px;
		text-align: center;
	}

	.step-item.highlight {
		background: #eef2ff;
		color: #4f46e5;
		font-weight: 600;
	}

	.step-arrow {
		color: #9ca3af;
		font-size: 1rem;
	}

	.diagram-arrow {
		font-size: 1.5rem;
		color: #9ca3af;
		font-weight: 700;
	}

	.diagram-desc {
		text-align: center;
		font-size: 0.8rem;
		color: #64748b;
		margin-top: 0.5rem;
	}

	.strategy-compare {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
	}

	.compare-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
		color: #374151;
		padding: 0.35rem 0.75rem;
		background: #f3f4f6;
		border-radius: 6px;
	}

	.compare-item.cat-item {
		background: #eef2ff;
		color: #4f46e5;
		font-weight: 600;
	}

	.compare-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.explanation-details {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1rem;
	}

	.detail-card {
		background: #f9fafb;
		padding: 1.25rem;
		border-radius: 10px;
	}

	.detail-card h4 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.75rem 0;
		font-size: 1rem;
		color: #1a1a2e;
	}

	.detail-card p {
		margin: 0 0 0.75rem 0;
		color: #64748b;
		font-size: 0.9rem;
		line-height: 1.6;
	}

	.detail-card ul {
		margin: 0;
		padding-left: 1.25rem;
		color: #64748b;
		font-size: 0.9rem;
		line-height: 1.8;
	}

	.detail-card li {
		margin-bottom: 0.25rem;
	}

	.detail-note {
		background: #fef9c3;
		padding: 0.75rem;
		border-radius: 8px;
		font-size: 0.85rem !important;
		margin-top: 0.75rem !important;
		margin-bottom: 0 !important;
		border-left: 3px solid #eab308;
	}

	.strategy-list {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	.strategy-item {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.6rem 0.75rem;
		background: white;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
	}

	.strategy-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
		margin-top: 5px;
	}

	.strategy-item strong {
		font-size: 0.9rem;
		color: #1f2937;
	}

	.strategy-item p {
		font-size: 0.8rem;
		color: #6b7280;
		margin: 0.2rem 0 0;
	}

	/* ===== CONFIG SECTION ===== */
	.config-section {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	.section-header {
		margin-bottom: 1.5rem;
	}

	.section-header h2 {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1a1a2e;
		margin: 0;
	}

	.form-group {
		margin-bottom: 1.25rem;
	}

	.form-group label {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: 600;
		color: #374151;
		font-size: 0.9rem;
	}

	.input,
	.select {
		width: 100%;
		padding: 0.7rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 0.95rem;
		transition: border-color 0.2s;
		background: white;
	}

	.input:focus,
	.select:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
	}

	.form-row {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
	}

	@media (max-width: 768px) {
		.form-row {
			grid-template-columns: 1fr;
		}
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: #6366f1;
		color: white;
		padding: 0.7rem 1.5rem;
		border: none;
		border-radius: 8px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 0.2s,
			transform 0.2s;
	}

	.btn-primary:hover:not(:disabled) {
		background: #4f46e5;
		transform: translateY(-1px);
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.btn-spinner {
		display: inline-block;
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.error-msg {
		color: #dc2626;
		font-size: 0.9rem;
		margin: 0.75rem 0 0;
	}

	/* ===== RESULTS SECTION ===== */
	.results-section {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 2rem 4rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* Summary Cards */
	.summary-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 1rem;
	}

	.summary-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		padding: 1.25rem;
	}

	.summary-card h3 {
		font-size: 1rem;
		font-weight: 700;
		color: #1f2937;
		margin: 0 0 0.75rem;
	}

	.summary-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}

	.stat {
		display: flex;
		flex-direction: column;
	}

	.stat-value {
		font-size: 1.25rem;
		font-weight: 800;
		color: #111827;
	}

	.stat-label {
		font-size: 0.75rem;
		color: #6b7280;
	}

	/* Chart */
	.chart-section {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		overflow: hidden;
	}

	.chart-tabs {
		display: flex;
		border-bottom: 1px solid #e5e7eb;
		overflow-x: auto;
	}

	.chart-tab {
		padding: 0.75rem 1.25rem;
		border: none;
		background: none;
		font-size: 0.9rem;
		font-weight: 600;
		color: #6b7280;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.chart-tab:hover {
		color: #374151;
	}

	.chart-tab.active {
		color: #4f46e5;
		border-bottom-color: #4f46e5;
	}

	.chart-container {
		padding: 1.5rem;
	}

	.eval-chart {
		width: 100%;
		height: auto;
	}

	.chart-legend {
		display: flex;
		justify-content: center;
		gap: 1.5rem;
		margin-top: 0.75rem;
		flex-wrap: wrap;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: #374151;
	}

	.legend-line {
		width: 20px;
		height: 3px;
		border-radius: 2px;
	}

	/* Per-member */
	.per-member-section {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1.5rem 2rem;
	}

	.per-member-section h2 {
		font-size: 1.2rem;
		font-weight: 700;
		color: #1f2937;
		margin: 0 0 0.25rem;
	}

	.section-desc {
		font-size: 0.9rem;
		color: #6b7280;
		margin: 0 0 1rem;
	}

	.member-selector {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
	}

	.member-btn {
		padding: 0.4rem 0.85rem;
		border: 1px solid #d1d5db;
		border-radius: 20px;
		background: white;
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.member-btn:hover {
		background: #f3f4f6;
	}

	.member-btn.active {
		background: #4f46e5;
		color: white;
		border-color: #4f46e5;
	}

	.member-detail-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1rem;
	}

	.member-detail-card {
		background: #f9fafb;
		border-radius: 8px;
		padding: 1rem;
		overflow-x: auto;
	}

	.member-detail-card h4 {
		font-size: 0.95rem;
		font-weight: 700;
		margin: 0 0 0.5rem;
		color: #1f2937;
	}

	.detail-stats {
		display: flex;
		gap: 1.25rem;
		font-size: 0.85rem;
		color: #4b5563;
		margin-bottom: 0.75rem;
	}

	.step-table {
		width: 100%;
		font-size: 0.8rem;
		border-collapse: collapse;
	}

	.step-table th {
		text-align: left;
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid #e5e7eb;
		color: #6b7280;
		font-weight: 600;
	}

	.step-table td {
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid #f3f4f6;
		color: #374151;
	}

	.rank-good {
		color: #059669;
		font-weight: 700;
	}

	/* Comparison Table */
	.comparison-section {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1.5rem 2rem;
	}

	.comparison-section h2 {
		font-size: 1.2rem;
		font-weight: 700;
		color: #1f2937;
		margin: 0 0 1rem;
	}

	.table-wrapper {
		overflow-x: auto;
	}

	.comparison-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	.comparison-table th {
		text-align: left;
		padding: 0.6rem 0.75rem;
		border-bottom: 2px solid #e5e7eb;
		color: #374151;
		font-weight: 700;
		white-space: nowrap;
	}

	.comparison-table td {
		padding: 0.6rem 0.75rem;
		border-bottom: 1px solid #f3f4f6;
		color: #1f2937;
	}

	.strategy-dot-sm {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin-right: 0.4rem;
	}

	/* ===== RESPONSIVE ===== */
	@media (max-width: 600px) {
		.diagram-container {
			flex-direction: column;
		}

		.diagram-arrow {
			transform: rotate(90deg);
		}

		.explanation-section {
			padding: 1rem 1rem 0;
		}

		.config-section,
		.results-section {
			padding: 1rem;
		}
	}
</style>
