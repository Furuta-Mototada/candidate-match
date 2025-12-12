<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types.js';
	import { PageHero, ClusterCard, LoadingSpinner, EmptyState } from '$lib/components/index.js';

	interface CommitteeInfo {
		name: string | null;
		chamber: string | null;
		session: number | null;
	}

	interface BillWithDetails {
		billId: number;
		clusterLabel: number;
		distance: string | null;
		billType: string;
		submissionSession: number;
		billNumber: number;
		title: string | null;
		description: string | null;
		result: string | null; // '可決' | '否決' | '撤回' | '未了' | null
		pdfUrl?: string;
		committees: CommitteeInfo[];
	}

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
	let clusterData = $state<Record<string, unknown> | null>(null);
	let billsByCluster = $state<Record<string, BillWithDetails[]> | null>(null);
	let isLoadingCluster = $state(false);
	let selectedBillId = $state<number | null>(null);
	let selectedBill = $state<BillWithDetails | null>(null);

	// Bill enrichment data
	interface EnrichmentData {
		summaryShort: string | null;
		summaryDetailed: string | null;
		keyPoints: Array<{ who: string; what: string; when: string }>;
		impactTags: string[];
		prosAndCons: { pros: string[]; cons: string[] } | null;
		exampleScenario: string | null;
		enrichmentStatus: string;
	}
	let enrichmentData = $state<EnrichmentData | null>(null);
	let isLoadingEnrichment = $state(false);

	// 2D visualization data
	let visualizationData = $state<
		Array<{
			billId: number;
			type: string;
			session: number;
			number: number;
			title: string;
			x: number;
			y: number;
			cluster: number;
		}>
	>([]);
	let isLoadingViz = $state(false);

	// Zoom and pan state for visualization
	let zoomLevel = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	const MIN_ZOOM = 0.5;
	const MAX_ZOOM = 5;
	const ZOOM_STEP = 0.5;

	function zoomIn() {
		zoomLevel = Math.min(MAX_ZOOM, zoomLevel + ZOOM_STEP);
	}

	function zoomOut() {
		zoomLevel = Math.max(MIN_ZOOM, zoomLevel - ZOOM_STEP);
	}

	function resetZoom() {
		zoomLevel = 1;
		panX = 0;
		panY = 0;
	}

	// Compute viewBox based on zoom and pan
	let viewBox = $derived.by(() => {
		const baseSize = 240;
		const size = baseSize / zoomLevel;
		const x = -size / 2 + panX;
		const y = -size / 2 + panY;
		return `${x} ${y} ${size} ${size}`;
	});

	// Pre-compute normalized visualization data to avoid O(n²) in template
	let normalizedVizData = $derived.by(() => {
		if (visualizationData.length === 0) return [];

		const maxX = Math.max(...visualizationData.map((p) => Math.abs(p.x))) || 1;
		const maxY = Math.max(...visualizationData.map((p) => Math.abs(p.y))) || 1;

		return visualizationData.map((point) => ({
			...point,
			nx: (point.x / maxX) * 90,
			ny: -(point.y / maxY) * 90
		}));
	});

	// Pre-compute unique clusters for legend
	let uniqueClusters = $derived.by(() => {
		const clusters = Array.from(new Set(visualizationData.map((p) => p.cluster))).sort(
			(a, b) => a - b
		);
		return clusters.map((cluster) => ({
			cluster,
			count: visualizationData.filter((p) => p.cluster === cluster).length
		}));
	});

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

	async function loadEnrichmentData(billId: number) {
		isLoadingEnrichment = true;
		enrichmentData = null;
		try {
			const response = await fetch(`/api/bill-enrichment?billId=${billId}`);
			if (response.ok) {
				const data = await response.json();
				enrichmentData = {
					summaryShort: data.summaryShort,
					summaryDetailed: data.summaryDetailed,
					keyPoints: data.keyPoints || [],
					impactTags: data.impactTags || [],
					prosAndCons: data.prosAndCons,
					exampleScenario: data.exampleScenario,
					enrichmentStatus: data.enrichmentStatus
				};
			}
		} catch (error) {
			console.error('Failed to load enrichment data:', error);
		} finally {
			isLoadingEnrichment = false;
		}
	}

	function selectBill(bill: BillWithDetails) {
		selectedBillId = bill.billId;
		selectedBill = bill;
		loadEnrichmentData(bill.billId);
	}

	interface VisualizationPoint {
		billId: number;
		type: string;
		session: number;
		number: number;
		title: string;
		x: number;
		y: number;
		cluster: number;
	}

	function selectBillFromViz(point: VisualizationPoint) {
		selectedBillId = point.billId;

		// Try to find the full bill data from billsByCluster
		if (billsByCluster) {
			for (const bills of Object.values(billsByCluster)) {
				const foundBill = bills.find((b) => b.billId === point.billId);
				if (foundBill) {
					selectedBill = foundBill;
					loadEnrichmentData(point.billId);
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
			clusterLabel: point.cluster,
			distance: null,
			description: null,
			result: null,
			committees: []
		};
		loadEnrichmentData(point.billId);
	}

	// Group committees by session for display
	function groupCommitteesBySession(committees: CommitteeInfo[]): Map<number, CommitteeInfo[]> {
		const grouped = new Map<number, CommitteeInfo[]>();
		for (const c of committees) {
			const session = c.session ?? 0;
			if (!grouped.has(session)) {
				grouped.set(session, []);
			}
			grouped.get(session)!.push(c);
		}
		// Sort by session descending (most recent first)
		return new Map([...grouped.entries()].sort((a, b) => b[0] - a[0]));
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

<div class="page">
	<!-- Hero Section -->
	<PageHero
		badge="📊 クラスタリング"
		title="法案クラスタリング分析"
		description="法案を類似性に基づいてグループ化し、政策トピックを可視化します"
	/>

	<!-- Clustering Generation Section -->
	<section class="generation-section">
		<div class="section-header">
			<h2>新しいクラスタリングを生成</h2>
		</div>

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
		<div class="section-header">
			<h2>既存のクラスタリング結果</h2>
		</div>

		{#if data.clusters.length === 0}
			<EmptyState
				message="クラスタリング結果がありません。上記のフォームから新しいクラスタリングを生成してください。"
				icon="📊"
			/>
		{:else}
			<div class="cluster-list">
				{#each data.clusters as cluster}
					<ClusterCard
						name={cluster.name}
						algorithm={cluster.algorithm}
						createdAt={cluster.createdAt}
						parameters={cluster.parameters}
						active={selectedClusterId === cluster.id}
						onclick={() => loadCluster(cluster.id)}
					/>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Visualization Section -->
	{#if selectedClusterId && clusterData}
		<section class="visualization-section">
			<div class="section-header">
				<h2>クラスタ詳細: {clusterData.name}</h2>
			</div>

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

						<!-- Zoom Controls -->
						<div class="zoom-controls">
							<button
								class="zoom-btn"
								onclick={zoomOut}
								disabled={zoomLevel <= MIN_ZOOM}
								title="ズームアウト"
							>
								−
							</button>
							<span class="zoom-level">{Math.round(zoomLevel * 100)}%</span>
							<button
								class="zoom-btn"
								onclick={zoomIn}
								disabled={zoomLevel >= MAX_ZOOM}
								title="ズームイン"
							>
								+
							</button>
							<button class="zoom-btn reset" onclick={resetZoom} title="リセット"> ⟲ </button>
						</div>

						<div class="scatter-plot-container">
							<svg class="scatter-plot" {viewBox} preserveAspectRatio="xMidYMid meet">
								<!-- Grid lines -->
								<line
									x1="-100"
									y1="0"
									x2="100"
									y2="0"
									stroke="#e5e7eb"
									stroke-width={0.5 / zoomLevel}
								/>
								<line
									x1="0"
									y1="-100"
									x2="0"
									y2="100"
									stroke="#e5e7eb"
									stroke-width={0.5 / zoomLevel}
								/>

								<!-- Data points (using pre-normalized coordinates) -->
								{#each normalizedVizData as point}
									{@const color = getClusterColor(point.cluster)}

									<circle
										cx={point.nx}
										cy={point.ny}
										r={4 / zoomLevel}
										fill={color}
										stroke="white"
										stroke-width={1 / zoomLevel}
										class="data-point"
										class:selected={selectedBillId === point.billId}
										onclick={() => selectBillFromViz(point)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') selectBillFromViz(point);
										}}
										role="button"
										tabindex="0"
									>
										<title>{point.type}-{point.session}-{point.number}: {point.title}</title>
									</circle>

									<!-- Labels for selected point -->
									{#if selectedBillId === point.billId}
										<text
											x={point.nx}
											y={point.ny - 8 / zoomLevel}
											text-anchor="middle"
											class="point-label"
											fill="#1f2937"
											font-size={4 / zoomLevel}
											font-weight="600"
										>
											{point.type}-{point.number}
										</text>
									{/if}
								{/each}
							</svg>

							<!-- Legend (using pre-computed unique clusters) -->
							<div class="legend">
								<div class="legend-title">クラスタ:</div>
								{#each uniqueClusters as { cluster, count }}
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
											{#if bill.result === '可決'}
												<span class="status-badge passed">可決</span>
											{:else if bill.result === '否決'}
												<span class="status-badge rejected">否決</span>
											{:else if bill.result === '撤回'}
												<span class="status-badge withdrawn">撤回</span>
											{:else if bill.result === '未了'}
												<span class="status-badge expired">未了</span>
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
					<div class="detail-row full-width">
						<span class="label">委員会</span>
						<div class="committees-grouped">
							{#each [...groupCommitteesBySession(selectedBill.committees)] as [session, sessionCommittees]}
								<div class="session-group">
									<div class="session-label">第{session}回国会</div>
									<div class="committees">
										{#each sessionCommittees as committee}
											<div class="committee-tag">
												{committee.chamber} - {committee.name}
											</div>
										{/each}
									</div>
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

				<!-- Enrichment Data Section -->
				<div class="enrichment-section">
					<h4 class="enrichment-title">📚 詳細情報</h4>

					{#if isLoadingEnrichment}
						<p class="loading-text">読み込み中...</p>
					{:else if enrichmentData}
						{#if enrichmentData.enrichmentStatus === 'pending'}
							<p class="enrichment-pending">この法案の詳細情報はまだ生成されていません。</p>
						{:else}
							{#if enrichmentData.summaryShort}
								<div class="enrichment-row">
									<span class="enrichment-label">概要</span>
									<p class="enrichment-value">{enrichmentData.summaryShort}</p>
								</div>
							{/if}

							{#if enrichmentData.summaryDetailed}
								<div class="enrichment-row">
									<span class="enrichment-label">詳細説明</span>
									<p class="enrichment-value detailed">{enrichmentData.summaryDetailed}</p>
								</div>
							{/if}

							{#if enrichmentData.impactTags && enrichmentData.impactTags.length > 0}
								<div class="enrichment-row">
									<span class="enrichment-label">影響タグ</span>
									<div class="impact-tags">
										{#each enrichmentData.impactTags as tag}
											<span class="impact-tag">{tag}</span>
										{/each}
									</div>
								</div>
							{/if}

							{#if enrichmentData.keyPoints && enrichmentData.keyPoints.length > 0}
								<div class="enrichment-row">
									<span class="enrichment-label">主要ポイント</span>
									<div class="key-points">
										{#each enrichmentData.keyPoints as point}
											<div class="key-point">
												<span class="key-point-who">{point.who}</span>
												<span class="key-point-what">{point.what}</span>
												{#if point.when}
													<span class="key-point-when">{point.when}</span>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/if}

							{#if enrichmentData.prosAndCons}
								<div class="enrichment-row">
									<span class="enrichment-label">賛否両論</span>
									<div class="pros-cons">
										{#if enrichmentData.prosAndCons.pros && enrichmentData.prosAndCons.pros.length > 0}
											<div class="pros">
												<span class="pros-cons-label">👍 賛成意見</span>
												<ul>
													{#each enrichmentData.prosAndCons.pros as pro}
														<li>{pro}</li>
													{/each}
												</ul>
											</div>
										{/if}
										{#if enrichmentData.prosAndCons.cons && enrichmentData.prosAndCons.cons.length > 0}
											<div class="cons">
												<span class="pros-cons-label">👎 反対意見</span>
												<ul>
													{#each enrichmentData.prosAndCons.cons as con}
														<li>{con}</li>
													{/each}
												</ul>
											</div>
										{/if}
									</div>
								</div>
							{/if}

							{#if enrichmentData.exampleScenario}
								<div class="enrichment-row">
									<span class="enrichment-label">具体例</span>
									<p class="enrichment-value example">{enrichmentData.exampleScenario}</p>
								</div>
							{/if}
						{/if}
					{:else}
						<p class="enrichment-pending">詳細情報を取得できませんでした。</p>
					{/if}
				</div>
			</div>
		</aside>
	{/if}
</div>

<style>
	/* ===== BASE STYLES ===== */
	.page {
		min-height: 100vh;
		background: #fafbfc;
	}

	/* ===== SECTION STYLES ===== */
	.generation-section,
	.results-section,
	.visualization-section {
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

	.visualization-chart {
		background: white;
		padding: 1.5rem;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
		margin-bottom: 2rem;
	}

	.visualization-chart h3 {
		font-size: 1.1rem;
		font-weight: 600;
		color: #1a1a2e;
		margin: 0 0 0.5rem 0;
	}

	.viz-description {
		color: #64748b;
		margin-bottom: 1.5rem;
		font-size: 0.875rem;
	}

	/* ===== FORM STYLES ===== */
	.form-group {
		margin-bottom: 1.25rem;
	}

	label {
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

	.btn-primary {
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

	/* ===== CLUSTER LIST ===== */
	.cluster-list {
		display: grid;
		gap: 0.75rem;
	}

	/* ===== SCATTER PLOT ===== */
	.scatter-plot-container {
		display: flex;
		gap: 2rem;
		align-items: center;
	}

	.scatter-plot {
		flex: 1;
		max-width: 600px;
		height: 500px;
		border: 1px solid #e5e7eb;
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
		gap: 0.5rem;
		padding: 1rem;
		background: #f9fafb;
		border-radius: 8px;
		min-width: 180px;
		border: 1px solid #e5e7eb;
	}

	.legend-title {
		font-weight: 600;
		color: #1a1a2e;
		margin-bottom: 0.25rem;
		font-size: 0.9rem;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
		color: #374151;
	}

	.legend-color {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid white;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
	}

	/* ===== CLUSTERS GRID ===== */
	.clusters-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 1.5rem;
	}

	.cluster-group {
		background: white;
		padding: 1.25rem;
		border-radius: 10px;
		border: 1px solid #e5e7eb;
	}

	.cluster-group h3 {
		font-size: 1rem;
		margin-bottom: 0.5rem;
		color: #1a1a2e;
	}

	.cluster-description {
		font-size: 0.85rem;
		color: #64748b;
		margin-bottom: 1rem;
		line-height: 1.5;
	}

	.count {
		font-size: 0.85rem;
		color: #64748b;
		font-weight: normal;
	}

	.bills-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.bill-item {
		background: #f9fafb;
		padding: 0.75rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		text-align: left;
		cursor: pointer;
		transition: all 0.2s;
	}

	.bill-item:hover {
		border-color: #6366f1;
		background: #fafbff;
	}

	.bill-item.selected {
		border-color: #6366f1;
		background: #eef2ff;
	}

	.bill-type {
		font-size: 0.8rem;
		color: #64748b;
		margin-bottom: 0.25rem;
	}

	.bill-title {
		font-weight: 600;
		margin-bottom: 0.5rem;
		color: #1a1a2e;
		font-size: 0.9rem;
	}

	.bill-status {
		display: flex;
		gap: 0.5rem;
	}

	.status-badge {
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		font-size: 0.7rem;
		font-weight: 600;
	}

	.status-badge.passed {
		background: #dcfce7;
		color: #166534;
	}

	.status-badge.rejected {
		background: #fee2e2;
		color: #991b1b;
	}

	.status-badge.withdrawn {
		background: #e5e7eb;
		color: #374151;
	}

	.status-badge.expired {
		background: #fef3c7;
		color: #92400e;
	}

	.status-badge.pending {
		background: #dbeafe;
		color: #1e40af;
	}

	/* ===== ZOOM CONTROLS ===== */
	.zoom-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.zoom-btn {
		width: 32px;
		height: 32px;
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		background: white;
		cursor: pointer;
		font-size: 1.2rem;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.2s;
	}

	.zoom-btn:hover:not(:disabled) {
		background: #f3f4f6;
		border-color: #d1d5db;
	}

	.zoom-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.zoom-btn.reset {
		font-size: 1rem;
	}

	.zoom-level {
		min-width: 50px;
		text-align: center;
		font-size: 0.875rem;
		color: #6b7280;
	}

	/* ===== DETAIL PANEL ===== */
	.detail-panel {
		position: fixed;
		right: 0;
		top: 0;
		bottom: 0;
		width: 400px;
		background: white;
		box-shadow: -4px 0 20px rgba(0, 0, 0, 0.1);
		padding: 2rem;
		overflow-y: auto;
		z-index: 1000;
	}

	.detail-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.detail-header h3 {
		font-size: 1.25rem;
		margin: 0;
		color: #1a1a2e;
	}

	.close-btn {
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
		color: #1a1a2e;
	}

	.detail-content {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
	}

	.detail-row {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.detail-row .label {
		font-weight: 600;
		color: #64748b;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.025em;
	}

	.detail-row .value {
		color: #1a1a2e;
		font-size: 0.95rem;
	}

	.detail-row.full-width {
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.committees-grouped {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
	}

	.session-group {
		background: #f8fafc;
		border-radius: 8px;
		padding: 0.75rem;
	}

	.session-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #64748b;
		margin-bottom: 0.5rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.committees {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.committee-tag {
		background: #eef2ff;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		font-size: 0.85rem;
		color: #4f46e5;
	}

	.pdf-link {
		color: #6366f1;
		text-decoration: none;
		font-weight: 500;
		transition: color 0.2s;
	}

	.pdf-link:hover {
		color: #4f46e5;
		text-decoration: underline;
	}

	/* ===== ENRICHMENT SECTION ===== */
	.enrichment-section {
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid #e5e7eb;
	}

	.enrichment-title {
		font-size: 1rem;
		font-weight: 600;
		color: #1f2937;
		margin: 0 0 1rem 0;
	}

	.loading-text {
		color: #6b7280;
		font-size: 0.875rem;
	}

	.enrichment-pending {
		color: #9ca3af;
		font-size: 0.875rem;
		font-style: italic;
	}

	.enrichment-row {
		margin-bottom: 1rem;
	}

	.enrichment-label {
		display: block;
		font-size: 0.75rem;
		font-weight: 600;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 0.25rem;
	}

	.enrichment-value {
		color: #374151;
		font-size: 0.875rem;
		line-height: 1.5;
		margin: 0;
	}

	.enrichment-value.detailed {
		background: #f9fafb;
		padding: 0.75rem;
		border-radius: 8px;
		border-left: 3px solid #6366f1;
	}

	.enrichment-value.example {
		background: #fffbeb;
		padding: 0.75rem;
		border-radius: 8px;
		border-left: 3px solid #f59e0b;
	}

	.impact-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.impact-tag {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		padding: 0.25rem 0.75rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 500;
	}

	.key-points {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.key-point {
		background: #f3f4f6;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		font-size: 0.8rem;
	}

	.key-point-who {
		font-weight: 600;
		color: #4f46e5;
	}

	.key-point-what {
		display: block;
		color: #374151;
		margin-top: 0.25rem;
	}

	.key-point-when {
		display: block;
		color: #9ca3af;
		font-size: 0.75rem;
		margin-top: 0.25rem;
	}

	.pros-cons {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.pros-cons-label {
		font-weight: 600;
		font-size: 0.8rem;
		display: block;
		margin-bottom: 0.25rem;
	}

	.pros {
		background: #ecfdf5;
		padding: 0.75rem;
		border-radius: 8px;
	}

	.cons {
		background: #fef2f2;
		padding: 0.75rem;
		border-radius: 8px;
	}

	.pros ul,
	.cons ul {
		margin: 0;
		padding-left: 1.25rem;
		font-size: 0.8rem;
	}

	.pros li {
		color: #166534;
	}

	.cons li {
		color: #991b1b;
	}

	/* ===== RESPONSIVE ===== */
	@media (max-width: 900px) {
		.scatter-plot-container {
			flex-direction: column;
		}

		.scatter-plot {
			max-width: 100%;
			height: 400px;
		}

		.legend {
			width: 100%;
			flex-direction: row;
			flex-wrap: wrap;
		}

		.detail-panel {
			width: 100%;
		}
	}

	@media (max-width: 768px) {
		.generation-section,
		.results-section,
		.visualization-section {
			padding: 1.5rem 1rem;
		}

		.clusters-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
