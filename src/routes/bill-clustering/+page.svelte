<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// State for clustering parameters
	let algorithm = $state<'kmeans' | 'hdbscan'>('kmeans');
	let nClusters = $state(8);
	let minClusterSize = $state(5);
	let minSamples = $state(3);
	let clusteringName = $state('');
	let isGenerating = $state(false);

	// State for visualization
	let selectedClusterId = $state<number | null>(null);
	let clusterData = $state<any>(null);
	let billsByCluster = $state<any>(null);
	let isLoadingCluster = $state(false);
	let selectedBillId = $state<number | null>(null);
	let selectedBill = $state<any>(null);

	// 2D visualization data
	let visualizationData = $state<any[]>([]);
	let isLoadingViz = $state(false);

	// Cluster label names from LLM
	let labelNames = $state<Record<number, { name: string; description: string | null }>>({});

	async function generateClustering() {
		if (!clusteringName.trim()) {
			alert('Please enter a name for this clustering');
			return;
		}

		isGenerating = true;
		try {
			// Call Python script via API (we'll need to create this endpoint)
			const params =
				algorithm === 'kmeans'
					? { algorithm, name: clusteringName, n_clusters: nClusters }
					: {
							algorithm,
							name: clusteringName,
							min_cluster_size: minClusterSize,
							min_samples: minSamples
						};

			const response = await fetch('/api/generate-clustering', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(params)
			});

			if (response.ok) {
				const result = await response.json();
				alert(`Clustering generated successfully! Cluster ID: ${result.clusterId}`);
				// Reload page to show new cluster
				window.location.reload();
			} else {
				const error = await response.json();
				alert(`Failed to generate clustering: ${error.message}`);
			}
		} catch (error) {
			console.error('Failed to generate clustering:', error);
			alert('Failed to generate clustering. See console for details.');
		} finally {
			isGenerating = false;
		}
	}

	async function loadCluster(clusterId: number) {
		// Skip if already loading this cluster
		if (selectedClusterId === clusterId && isLoadingCluster) {
			console.log('Already loading cluster', clusterId);
			return;
		}

		// Skip if this cluster is already loaded
		if (selectedClusterId === clusterId && clusterData && billsByCluster) {
			console.log('Cluster', clusterId, 'already loaded');
			return;
		}

		selectedClusterId = clusterId;
		isLoadingCluster = true;

		const startTime = performance.now();
		console.log('Loading cluster', clusterId);

		try {
			const response = await fetch(`/api/bill-clusters?id=${clusterId}`);
			const result = await response.json();
			const fetchTime = performance.now() - startTime;
			console.log(`✓ Fetched cluster data in ${fetchTime.toFixed(0)}ms`);

			clusterData = result.cluster;
			billsByCluster = result.billsByCluster;
			labelNames = result.labelNames || {};

			// Load visualization data for this specific cluster
			await loadVisualizationDataForCluster(clusterId);

			const totalTime = performance.now() - startTime;
			console.log(`✓ Total cluster load time: ${totalTime.toFixed(0)}ms`);
		} catch (error) {
			console.error('Failed to load cluster:', error);
		} finally {
			isLoadingCluster = false;
		}
	}

	async function loadVisualizationDataForCluster(clusterId: number) {
		isLoadingViz = true;
		const startTime = performance.now();
		console.log('Loading visualization for cluster', clusterId);

		try {
			// Try to fetch from API which generates cluster-specific data
			const response = await fetch(`/api/bill-embeddings?clusterId=${clusterId}`);
			if (response.ok) {
				const data = await response.json();
				visualizationData = data;
				const elapsed = performance.now() - startTime;
				console.log(
					`✓ Loaded ${visualizationData.length} visualization points for cluster ${clusterId} in ${elapsed.toFixed(0)}ms`
				);
			} else {
				console.error('Failed to load visualization data:', response.statusText);
				// Fallback: try to load the static file
				const fallbackResponse = await fetch('/src/lib/data/bill_embeddings_2d.json');
				if (fallbackResponse.ok) {
					visualizationData = await fallbackResponse.json();
					console.log(`Loaded ${visualizationData.length} visualization points from fallback`);
				}
			}
		} catch (error) {
			console.error('Failed to load visualization data:', error);
			// Try fallback
			try {
				const fallbackResponse = await fetch('/src/lib/data/bill_embeddings_2d.json');
				if (fallbackResponse.ok) {
					visualizationData = await fallbackResponse.json();
					console.log(
						`Loaded ${visualizationData.length} visualization points from fallback after error`
					);
				}
			} catch (fallbackError) {
				console.error('Fallback also failed:', fallbackError);
			}
		} finally {
			isLoadingViz = false;
		}
	}

	function selectBill(bill: any) {
		selectedBillId = bill.billId;
		selectedBill = bill;
	}

	function selectBillFromViz(point: any) {
		selectedBillId = point.billId;

		// Try to find the full bill data from billsByCluster
		if (billsByCluster) {
			for (const bills of Object.values(billsByCluster)) {
				const foundBill = (bills as any[]).find((b: any) => b.billId === point.billId);
				if (foundBill) {
					selectedBill = foundBill;
					return;
				}
			}
		}

		// Fallback: Create a basic bill object from the visualization point
		selectedBill = {
			billId: point.billId,
			billType: point.type,
			submissionSession: point.session,
			billNumber: point.number,
			title: point.title,
			clusterLabel: point.cluster
		};
	}

	function getClusterColor(clusterLabel: number): string {
		const colors = [
			'#3b82f6',
			'#ef4444',
			'#10b981',
			'#f59e0b',
			'#8b5cf6',
			'#ec4899',
			'#14b8a6',
			'#f97316',
			'#6366f1',
			'#84cc16'
		];
		return colors[clusterLabel % colors.length];
	}
</script>

<div class="container">
	<h1>法案クラスタリング分析</h1>

	<!-- Clustering Generation Section -->
	<section class="generation-section">
		<h2>新しいクラスタリングを生成</h2>

		<div class="form-group">
			<label for="name">クラスタリング名</label>
			<input
				id="name"
				type="text"
				bind:value={clusteringName}
				placeholder="例: 政策トピック - 10クラスタ"
				class="input"
			/>
		</div>

		<div class="form-group">
			<label for="algorithm">アルゴリズム</label>
			<select id="algorithm" bind:value={algorithm} class="select">
				<option value="kmeans">K-Means (クラスタ数指定)</option>
				<option value="hdbscan">HDBSCAN (自動クラスタ数)</option>
			</select>
		</div>

		{#if algorithm === 'kmeans'}
			<div class="form-group">
				<label for="nClusters">クラスタ数</label>
				<input id="nClusters" type="number" bind:value={nClusters} min="2" max="20" class="input" />
			</div>
		{:else}
			<div class="form-group">
				<label for="minClusterSize">最小クラスタサイズ</label>
				<input
					id="minClusterSize"
					type="number"
					bind:value={minClusterSize}
					min="2"
					max="50"
					class="input"
				/>
			</div>
			<div class="form-group">
				<label for="minSamples">最小サンプル数</label>
				<input
					id="minSamples"
					type="number"
					bind:value={minSamples}
					min="1"
					max="20"
					class="input"
				/>
			</div>
		{/if}

		<button onclick={generateClustering} disabled={isGenerating} class="btn-primary">
			{isGenerating ? 'クラスタリング実行中...' : 'クラスタリング実行'}
		</button>
	</section>

	<!-- Clustering Results Section -->
	<section class="results-section">
		<h2>既存のクラスタリング結果</h2>

		{#if data.clusters.length === 0}
			<p class="empty-state">
				クラスタリング結果がありません。上記のフォームから新しいクラスタリングを生成してください。
			</p>
		{:else}
			<div class="cluster-list">
				{#each data.clusters as cluster}
					<button
						class="cluster-card"
						class:active={selectedClusterId === cluster.id}
						onclick={() => loadCluster(cluster.id)}
					>
						<div class="cluster-name">{cluster.name}</div>
						<div class="cluster-meta">
							<span class="badge">{cluster.algorithm.toUpperCase()}</span>
							<span class="text-sm">{new Date(cluster.createdAt).toLocaleDateString('ja-JP')}</span>
						</div>
						<div class="cluster-params">{cluster.parameters}</div>
					</button>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Visualization Section -->
	{#if selectedClusterId && clusterData}
		<section class="visualization-section">
			<h2>クラスタ詳細: {clusterData.name}</h2>

			{#if isLoadingCluster}
				<p>読み込み中...</p>
			{:else if billsByCluster}
				<!-- 2D Visualization Chart -->
				{#if isLoadingViz}
					<div class="visualization-chart">
						<h3>法案の2次元可視化 (PCA)</h3>
						<p>可視化データを読み込み中...</p>
					</div>
				{:else if visualizationData.length > 0}
					<div class="visualization-chart">
						<h3>法案の2次元可視化 (PCA)</h3>
						<p class="viz-description">
							768次元の埋め込みベクトルを主成分分析(PCA)で2次元に縮約して表示しています。
						</p>

						<div class="scatter-plot-container">
							<svg
								class="scatter-plot"
								viewBox="-120 -120 240 240"
								preserveAspectRatio="xMidYMid meet"
							>
								<!-- Grid lines -->
								<line x1="-100" y1="0" x2="100" y2="0" stroke="#e5e7eb" stroke-width="0.5" />
								<line x1="0" y1="-100" x2="0" y2="100" stroke="#e5e7eb" stroke-width="0.5" />

								<!-- Data points -->
								{#each visualizationData as point}
									{@const x =
										(point.x / Math.max(...visualizationData.map((p) => Math.abs(p.x)))) * 90}
									{@const y =
										-(point.y / Math.max(...visualizationData.map((p) => Math.abs(p.y)))) * 90}
									{@const color = getClusterColor(point.cluster)}

									<circle
										cx={x}
										cy={y}
										r="4"
										fill={color}
										stroke="white"
										stroke-width="1"
										class="data-point"
										class:selected={selectedBillId === point.billId}
										onclick={() => selectBillFromViz(point)}
										role="button"
										tabindex="0"
									>
										<title>{point.type}-{point.session}-{point.number}: {point.title}</title>
									</circle>

									<!-- Labels for selected point -->
									{#if selectedBillId === point.billId}
										<text
											{x}
											y={y - 8}
											text-anchor="middle"
											class="point-label"
											fill="#1f2937"
											font-size="4"
											font-weight="600"
										>
											{point.type}-{point.number}
										</text>
									{/if}
								{/each}
							</svg>

							<!-- Legend -->
							<div class="legend">
								<div class="legend-title">クラスタ:</div>
								{#each Array.from(new Set(visualizationData.map((p) => p.cluster))).sort() as cluster}
									{@const count = visualizationData.filter((p) => p.cluster === cluster).length}
									{@const labelName = labelNames[cluster]?.name}
									<div class="legend-item" title={labelNames[cluster]?.description || ''}>
										<div
											class="legend-color"
											style="background-color: {getClusterColor(cluster)}"
										></div>
										<span
											>{cluster === -1 ? 'ノイズ' : labelName || `クラスタ ${cluster}`} ({count})</span
										>
									</div>
								{/each}
							</div>
						</div>
					</div>
				{/if}

				<!-- Clusters Grid -->
				<div class="clusters-grid">
					{#each Object.entries(billsByCluster) as [label, bills]}
						{@const labelNum = Number(label)}
						{@const labelName = labelNames[labelNum]?.name}
						{@const labelDesc = labelNames[labelNum]?.description}
						<div class="cluster-group" style="border-left: 4px solid {getClusterColor(labelNum)}">
							<h3>
								{labelNum === -1 ? 'ノイズ (未分類)' : labelName || `クラスタ ${label}`}
								<span class="count">({bills.length} 法案)</span>
							</h3>
							{#if labelDesc}
								<p class="cluster-description">{labelDesc}</p>
							{/if}

							<div class="bills-list">
								{#each bills as bill}
									<button
										class="bill-item"
										class:selected={selectedBillId === bill.billId}
										onclick={() => selectBill(bill)}
									>
										<div class="bill-type">
											{bill.billType}-{bill.submissionSession}-{bill.billNumber}
										</div>
										<div class="bill-title">{bill.title || '(タイトルなし)'}</div>
										<div class="bill-status">
											{#if bill.passed}
												<span class="status-badge passed">可決</span>
											{:else if bill.deliberationCompleted}
												<span class="status-badge completed">審議終了</span>
											{:else}
												<span class="status-badge pending">審議中</span>
											{/if}
										</div>
									</button>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	<!-- Bill Detail Panel -->
	{#if selectedBill}
		<aside class="detail-panel">
			<div class="detail-header">
				<h3>法案詳細</h3>
				<button
					class="close-btn"
					onclick={() => {
						selectedBillId = null;
						selectedBill = null;
					}}>✕</button
				>
			</div>

			<div class="detail-content">
				<div class="detail-row">
					<span class="label">種別</span>
					<span class="value">{selectedBill.billType}</span>
				</div>
				<div class="detail-row">
					<span class="label">提出回次</span>
					<span class="value">{selectedBill.submissionSession}</span>
				</div>
				<div class="detail-row">
					<span class="label">番号</span>
					<span class="value">{selectedBill.billNumber}</span>
				</div>
				<div class="detail-row">
					<span class="label">件名</span>
					<span class="value">{selectedBill.title || 'N/A'}</span>
				</div>
				{#if selectedBill.description}
					<div class="detail-row">
						<span class="label">説明</span>
						<span class="value">{selectedBill.description}</span>
					</div>
				{/if}
				{#if selectedBill.committees && selectedBill.committees.length > 0}
					<div class="detail-row">
						<span class="label">委員会</span>
						<div class="committees">
							{#each selectedBill.committees as committee}
								<div class="committee-tag">
									{committee.chamber} - {committee.name}
								</div>
							{/each}
						</div>
					</div>
				{/if}
				{#if selectedBill.pdfUrl}
					<div class="detail-row">
						<span class="label">PDF</span>
						<span class="value">
							<a
								href={selectedBill.pdfUrl}
								target="_blank"
								rel="noopener noreferrer"
								class="pdf-link"
							>
								法案PDFを開く ↗
							</a>
						</span>
					</div>
				{/if}
				<div class="detail-row">
					<span class="label">クラスタ距離</span>
					<span class="value"
						>{selectedBill.distance ? Number(selectedBill.distance).toFixed(4) : 'N/A'}</span
					>
				</div>
			</div>
		</aside>
	{/if}
</div>

<style>
	.container {
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem;
	}

	h1 {
		font-size: 2.5rem;
		margin-bottom: 2rem;
		color: #1f2937;
	}

	h2 {
		font-size: 1.75rem;
		margin-bottom: 1.5rem;
		color: #374151;
	}

	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1.5rem;
		margin-bottom: 3rem;
	}

	.stat-card {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		padding: 1.5rem;
		border-radius: 12px;
		color: white;
		text-align: center;
	}

	.stat-value {
		font-size: 3rem;
		font-weight: bold;
		margin-bottom: 0.5rem;
	}

	.stat-label {
		font-size: 1rem;
		opacity: 0.9;
	}

	.generation-section,
	.results-section,
	.visualization-section,
	.visualization-chart {
		background: white;
		padding: 2rem;
		border-radius: 12px;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
		margin-bottom: 2rem;
	}

	.viz-description {
		color: #6b7280;
		margin-bottom: 1.5rem;
		font-size: 0.875rem;
	}

	.scatter-plot-container {
		display: flex;
		gap: 2rem;
		align-items: center;
	}

	.scatter-plot {
		flex: 1;
		max-width: 600px;
		height: 600px;
		border: 2px solid #e5e7eb;
		border-radius: 8px;
		background: #f9fafb;
	}

	.data-point {
		cursor: pointer;
		transition: all 0.2s;
	}

	.data-point:hover {
		r: 6;
		filter: brightness(1.2);
	}

	.data-point.selected {
		r: 6;
		stroke: #1f2937;
		stroke-width: 2;
	}

	.point-label {
		pointer-events: none;
		user-select: none;
	}

	.legend {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1rem;
		background: #f9fafb;
		border-radius: 8px;
		min-width: 200px;
	}

	.legend-title {
		font-weight: 600;
		color: #1f2937;
		margin-bottom: 0.5rem;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: #374151;
	}

	.legend-color {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 2px solid white;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
	}

	.legend-note {
		font-size: 0.875rem;
		color: #9ca3af;
		font-style: italic;
	}

	.form-group {
		margin-bottom: 1.5rem;
	}

	label {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: 600;
		color: #374151;
	}

	.input,
	.select {
		width: 100%;
		padding: 0.75rem;
		border: 2px solid #e5e7eb;
		border-radius: 8px;
		font-size: 1rem;
		transition: border-color 0.2s;
	}

	.input:focus,
	.select:focus {
		outline: none;
		border-color: #667eea;
	}

	.btn-primary {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		padding: 1rem 2rem;
		border: none;
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.2s;
	}

	.btn-primary:hover:not(:disabled) {
		transform: translateY(-2px);
	}

	.btn-primary:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.cluster-list {
		display: grid;
		gap: 1rem;
	}

	.cluster-card {
		background: #f9fafb;
		padding: 1.5rem;
		border: 2px solid #e5e7eb;
		border-radius: 8px;
		text-align: left;
		cursor: pointer;
		transition: all 0.2s;
	}

	.cluster-card:hover {
		border-color: #667eea;
		background: #f3f4f6;
	}

	.cluster-card.active {
		border-color: #667eea;
		background: #eef2ff;
	}

	.cluster-name {
		font-size: 1.25rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
		color: #1f2937;
	}

	.cluster-meta {
		display: flex;
		gap: 1rem;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.badge {
		background: #667eea;
		color: white;
		padding: 0.25rem 0.75rem;
		border-radius: 9999px;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.text-sm {
		font-size: 0.875rem;
		color: #6b7280;
	}

	.cluster-params {
		font-size: 0.875rem;
		color: #6b7280;
		font-family: monospace;
	}

	.empty-state {
		text-align: center;
		color: #6b7280;
		padding: 3rem;
	}

	.clusters-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 2rem;
	}

	.cluster-group {
		background: #f9fafb;
		padding: 1.5rem;
		border-radius: 8px;
	}

	.cluster-group h3 {
		font-size: 1.25rem;
		margin-bottom: 0.5rem;
		color: #1f2937;
	}

	.cluster-description {
		font-size: 0.875rem;
		color: #4b5563;
		margin-bottom: 1rem;
		line-height: 1.5;
	}

	.count {
		font-size: 0.875rem;
		color: #6b7280;
		font-weight: normal;
	}

	.bills-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.bill-item {
		background: white;
		padding: 1rem;
		border: 2px solid #e5e7eb;
		border-radius: 6px;
		text-align: left;
		cursor: pointer;
		transition: all 0.2s;
	}

	.bill-item:hover {
		border-color: #667eea;
	}

	.bill-item.selected {
		border-color: #667eea;
		background: #eef2ff;
	}

	.bill-type {
		font-size: 0.875rem;
		color: #6b7280;
		margin-bottom: 0.25rem;
	}

	.bill-title {
		font-weight: 600;
		margin-bottom: 0.5rem;
		color: #1f2937;
	}

	.bill-status {
		display: flex;
		gap: 0.5rem;
	}

	.status-badge {
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.status-badge.passed {
		background: #d1fae5;
		color: #065f46;
	}

	.status-badge.completed {
		background: #dbeafe;
		color: #1e40af;
	}

	.status-badge.pending {
		background: #fef3c7;
		color: #92400e;
	}

	.detail-panel {
		position: fixed;
		right: 0;
		top: 0;
		bottom: 0;
		width: 400px;
		background: white;
		box-shadow: -4px 0 6px rgba(0, 0, 0, 0.1);
		padding: 2rem;
		overflow-y: auto;
		z-index: 1000;
	}

	.detail-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 2rem;
	}

	.detail-header h3 {
		font-size: 1.5rem;
		margin: 0;
	}

	.close-btn {
		background: none;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		color: #6b7280;
		transition: color 0.2s;
	}

	.close-btn:hover {
		color: #1f2937;
	}

	.detail-content {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.detail-row {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.detail-row .label {
		font-weight: 600;
		color: #6b7280;
		font-size: 0.875rem;
		text-transform: uppercase;
	}

	.detail-row .value {
		color: #1f2937;
	}

	.committees {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.committee-tag {
		background: #eef2ff;
		padding: 0.5rem;
		border-radius: 4px;
		font-size: 0.875rem;
		color: #3730a3;
	}

	.pdf-link {
		color: #3b82f6;
		text-decoration: none;
		font-weight: 500;
		transition: color 0.2s;
	}

	.pdf-link:hover {
		color: #2563eb;
		text-decoration: underline;
	}
</style>
