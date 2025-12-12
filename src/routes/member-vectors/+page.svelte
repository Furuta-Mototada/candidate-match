<script lang="ts">
	import type { PageData } from './$types.js';
	import { PageHero, ClusterCard, LoadingSpinner, EmptyState } from '$lib/components/index.js';

	interface ClusterInfo {
		id: number;
		name: string;
		algorithm: string;
		parameters: string;
		createdAt: string;
	}

	interface ClusterLabel {
		label: number;
		billCount: number;
		name: string | null;
		description: string | null;
	}

	interface RepresentativeBill {
		billId: number;
		title: string;
		result: '可決' | '否決' | '撤回' | '未了' | null;
		loading: number;
		absLoading: number;
	}

	interface ClusterVectorResult {
		memberVectors: Record<string, number[]>;
		memberNames: Record<string, string>;
		billLoadings: number[][];
		representativeBills: RepresentativeBill[][];
		explainedVariance: number[];
		dimensions: number;
		memberCount: number;
		billCount: number;
		billIds: number[];
	}

	interface MemberWithVector {
		memberId: number;
		memberName: string;
		latentVector: number[];
	}

	interface SavedVectorInfo {
		id: number;
		clusterId: number;
		clusterLabel: number;
		nComponents: number;
		name: string;
		dimensions: number;
		memberCount: number;
		billCount: number;
		createdAt: string;
	}

	interface GroupedSavedVector {
		key: string;
		name: string;
		clusterId: number;
		clusterName: string;
		nComponents: number;
		dimensions: number;
		clusterCount: number;
		totalBills: number;
		vectors: SavedVectorInfo[];
		createdAt: string;
	}

	let { data }: { data: PageData } = $props();

	let availableClusters: ClusterInfo[] = $state(data.clusters || []);
	let selectedClusterId: number | null = $state(null);
	let selectedClusterLabel: number | null = $state(null);
	let clusterLabels: ClusterLabel[] = $state([]);
	let isLoadingLabels: boolean = $state(false);
	let isCalculating: boolean = $state(false);
	let nComponents: number = $state(3);
	let vectorizationName: string = $state(''); // Name for saving (entered before calculation)

	let calculationResult: Record<string, ClusterVectorResult> | null = $state<Record<
		string,
		ClusterVectorResult
	> | null>(null);
	let currentClusterData: ClusterVectorResult | null = $state<ClusterVectorResult | null>(null);

	// Saved vectors state
	let savedVectors: SavedVectorInfo[] = $state([]);
	let isLoadingSaved: boolean = $state(false);
	let selectedSavedVectorKey: string | null = $state(null);
	let loadedVectorizationName: string | null = $state(null);

	// Group saved vectors by name + clusterId
	let groupedSavedVectors = $derived.by(() => {
		const groups = new Map<string, GroupedSavedVector>();
		for (const sv of savedVectors) {
			const key = `${sv.name}|${sv.clusterId}`;
			if (!groups.has(key)) {
				const cluster = availableClusters.find((c) => c.id === sv.clusterId);
				groups.set(key, {
					key,
					name: sv.name,
					clusterId: sv.clusterId,
					clusterName: cluster?.name || 'Unknown',
					nComponents: sv.nComponents,
					dimensions: sv.dimensions,
					clusterCount: 0,
					totalBills: 0,
					vectors: [],
					createdAt: sv.createdAt
				});
			}
			const group = groups.get(key)!;
			group.vectors.push(sv);
			group.clusterCount++;
			group.totalBills += sv.billCount;
		}
		return Array.from(groups.values()).sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		);
	});

	let searchTerm: string = $state('');
	let sortBy: 'name' | 'dim0' | 'dim1' | 'dim2' = $state('name');
	let selectedMember: MemberWithVector | null = $state(null);
	let comparisonMember: MemberWithVector | null = $state(null);
	let similarMembers: Array<{ member: MemberWithVector; similarity: number }> = $state([]);
	let showSimilar: boolean = $state(false);

	// Visualization state
	let xDimension: number = $state(0);
	let yDimension: number = $state(1);
	let canvasElement: HTMLCanvasElement | null = $state(null);
	let hoveredMember: MemberWithVector | null = $state(null);
	let tooltipPosition: { x: number; y: number } = $state({ x: 0, y: 0 });
	let canvasWidth: number = $state(800);
	let canvasHeight: number = $state(600);
	let vizSelectedMember: MemberWithVector | null = $state(null);
	let vizSimilarMembers: Array<{ member: MemberWithVector; similarity: number }> = $state([]);

	let members = $derived(
		currentClusterData
			? Object.entries(currentClusterData.memberVectors).map(([id, vector]) => ({
					memberId: parseInt(id),
					memberName: currentClusterData!.memberNames[id] || 'Member ' + id,
					latentVector: vector as number[]
				}))
			: []
	);

	let filteredMembers = $derived(
		members.filter((m) => m.memberName.toLowerCase().includes(searchTerm.toLowerCase()))
	);

	let sortedMembers = $derived(
		[...filteredMembers].sort((a, b) => {
			switch (sortBy) {
				case 'name':
					return a.memberName.localeCompare(b.memberName);
				case 'dim0':
					return (b.latentVector[0] || 0) - (a.latentVector[0] || 0);
				case 'dim1':
					return (b.latentVector[1] || 0) - (a.latentVector[1] || 0);
				case 'dim2':
					return (b.latentVector[2] || 0) - (a.latentVector[2] || 0);
				default:
					return 0;
			}
		})
	);

	// Visualization derived values
	let availableDimensions = $derived(
		currentClusterData ? Array.from({ length: currentClusterData.dimensions }, (_, i) => i) : []
	);

	let visualizationBounds = $derived(() => {
		if (!members.length) return { minX: -1, maxX: 1, minY: -1, maxY: 1 };

		let minX = Infinity,
			maxX = -Infinity;
		let minY = Infinity,
			maxY = -Infinity;

		for (const m of members) {
			const x = m.latentVector[xDimension] ?? 0;
			const y = m.latentVector[yDimension] ?? 0;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}

		// Add padding
		const padX = (maxX - minX) * 0.1 || 0.1;
		const padY = (maxY - minY) * 0.1 || 0.1;

		return {
			minX: minX - padX,
			maxX: maxX + padX,
			minY: minY - padY,
			maxY: maxY + padY
		};
	});

	function drawVisualization() {
		if (!canvasElement || !members.length) return;

		const ctx = canvasElement.getContext('2d');
		if (!ctx) return;

		// Handle high-DPI displays
		const dpr = window.devicePixelRatio || 1;
		const displayWidth = canvasWidth;
		const displayHeight = canvasHeight;

		// Set actual canvas size in memory (scaled for DPI)
		canvasElement.width = displayWidth * dpr;
		canvasElement.height = displayHeight * dpr;

		// Scale context to match DPI
		ctx.scale(dpr, dpr);

		// Set CSS size to display size
		canvasElement.style.width = displayWidth + 'px';
		canvasElement.style.height = displayHeight + 'px';

		const bounds = visualizationBounds();
		const padding = 60;
		const plotWidth = displayWidth - padding * 2;
		const plotHeight = displayHeight - padding * 2;

		// Clear canvas
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, displayWidth, displayHeight);

		// Draw grid
		ctx.strokeStyle = '#e5e7eb';
		ctx.lineWidth = 1;

		// Vertical grid lines
		for (let i = 0; i <= 5; i++) {
			const x = padding + (plotWidth / 5) * i;
			ctx.beginPath();
			ctx.moveTo(x, padding);
			ctx.lineTo(x, displayHeight - padding);
			ctx.stroke();
		}

		// Horizontal grid lines
		for (let i = 0; i <= 5; i++) {
			const y = padding + (plotHeight / 5) * i;
			ctx.beginPath();
			ctx.moveTo(padding, y);
			ctx.lineTo(displayWidth - padding, y);
			ctx.stroke();
		}

		// Draw axes
		ctx.strokeStyle = '#9ca3af';
		ctx.lineWidth = 2;

		// X axis
		ctx.beginPath();
		ctx.moveTo(padding, displayHeight - padding);
		ctx.lineTo(displayWidth - padding, displayHeight - padding);
		ctx.stroke();

		// Y axis
		ctx.beginPath();
		ctx.moveTo(padding, padding);
		ctx.lineTo(padding, displayHeight - padding);
		ctx.stroke();

		// Axis labels
		ctx.fillStyle = '#374151';
		ctx.font = '14px sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText(
			`次元 ${xDimension + 1} (${formatPercent(currentClusterData?.explainedVariance[xDimension] || 0)})`,
			displayWidth / 2,
			displayHeight - 15
		);

		ctx.save();
		ctx.translate(20, displayHeight / 2);
		ctx.rotate(-Math.PI / 2);
		ctx.fillText(
			`次元 ${yDimension + 1} (${formatPercent(currentClusterData?.explainedVariance[yDimension] || 0)})`,
			0,
			0
		);
		ctx.restore();

		// Scale tick labels
		ctx.font = '10px sans-serif';
		ctx.fillStyle = '#6b7280';

		// X axis ticks
		for (let i = 0; i <= 5; i++) {
			const val = bounds.minX + ((bounds.maxX - bounds.minX) / 5) * i;
			const x = padding + (plotWidth / 5) * i;
			ctx.textAlign = 'center';
			ctx.fillText(val.toFixed(2), x, displayHeight - padding + 15);
		}

		// Y axis ticks
		for (let i = 0; i <= 5; i++) {
			const val = bounds.maxY - ((bounds.maxY - bounds.minY) / 5) * i;
			const y = padding + (plotHeight / 5) * i;
			ctx.textAlign = 'right';
			ctx.fillText(val.toFixed(2), padding - 8, y + 4);
		}

		// Helper function to convert data to canvas coordinates
		const toCanvasX = (val: number) =>
			padding + ((val - bounds.minX) / (bounds.maxX - bounds.minX)) * plotWidth;
		const toCanvasY = (val: number) =>
			displayHeight - padding - ((val - bounds.minY) / (bounds.maxY - bounds.minY)) * plotHeight;

		// Draw zero lines if in range
		ctx.strokeStyle = '#d1d5db';
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 4]);

		if (bounds.minX < 0 && bounds.maxX > 0) {
			const zeroX = toCanvasX(0);
			ctx.beginPath();
			ctx.moveTo(zeroX, padding);
			ctx.lineTo(zeroX, displayHeight - padding);
			ctx.stroke();
		}

		if (bounds.minY < 0 && bounds.maxY > 0) {
			const zeroY = toCanvasY(0);
			ctx.beginPath();
			ctx.moveTo(padding, zeroY);
			ctx.lineTo(displayWidth - padding, zeroY);
			ctx.stroke();
		}

		ctx.setLineDash([]);

		// Draw members - first pass: draw non-highlighted members
		for (const member of members) {
			const x = toCanvasX(member.latentVector[xDimension] ?? 0);
			const y = toCanvasY(member.latentVector[yDimension] ?? 0);

			const isSelected = vizSelectedMember?.memberId === member.memberId;
			const isHovered = hoveredMember?.memberId === member.memberId;
			const isSimilar = vizSimilarMembers.some((s) => s.member.memberId === member.memberId);

			// Skip highlighted members for now (draw them on top later)
			if (isSelected || isHovered || isSimilar) continue;

			// Draw regular point
			ctx.beginPath();
			ctx.arc(x, y, 6, 0, Math.PI * 2);
			ctx.fillStyle = '#6366f1';
			ctx.fill();
			ctx.strokeStyle = '#4f46e5';
			ctx.lineWidth = 2;
			ctx.stroke();
		}

		// Second pass: draw similar members
		for (const { member } of vizSimilarMembers) {
			if (vizSelectedMember?.memberId === member.memberId) continue;

			const x = toCanvasX(member.latentVector[xDimension] ?? 0);
			const y = toCanvasY(member.latentVector[yDimension] ?? 0);

			ctx.beginPath();
			ctx.arc(x, y, 7, 0, Math.PI * 2);
			ctx.fillStyle = '#f59e0b';
			ctx.fill();
			ctx.strokeStyle = '#d97706';
			ctx.lineWidth = 2;
			ctx.stroke();
		}

		// Third pass: draw hovered member
		if (hoveredMember && vizSelectedMember?.memberId !== hoveredMember.memberId) {
			const x = toCanvasX(hoveredMember.latentVector[xDimension] ?? 0);
			const y = toCanvasY(hoveredMember.latentVector[yDimension] ?? 0);

			ctx.beginPath();
			ctx.arc(x, y, 8, 0, Math.PI * 2);
			ctx.fillStyle = '#ec4899';
			ctx.fill();
			ctx.strokeStyle = '#db2777';
			ctx.lineWidth = 2;
			ctx.stroke();

			ctx.fillStyle = '#1f2937';
			ctx.font = 'bold 12px sans-serif';
			ctx.textAlign = 'left';
			ctx.fillText(hoveredMember.memberName, x + 12, y + 4);
		}

		// Fourth pass: draw selected member (always on top)
		if (vizSelectedMember) {
			const x = toCanvasX(vizSelectedMember.latentVector[xDimension] ?? 0);
			const y = toCanvasY(vizSelectedMember.latentVector[yDimension] ?? 0);

			ctx.beginPath();
			ctx.arc(x, y, 10, 0, Math.PI * 2);
			ctx.fillStyle = '#22c55e';
			ctx.fill();
			ctx.strokeStyle = '#16a34a';
			ctx.lineWidth = 2;
			ctx.stroke();

			ctx.fillStyle = '#1f2937';
			ctx.font = 'bold 12px sans-serif';
			ctx.textAlign = 'left';
			ctx.fillText(vizSelectedMember.memberName, x + 14, y + 4);
		}
	}

	function handleCanvasMouseMove(event: MouseEvent) {
		if (!canvasElement || !members.length) return;

		const rect = canvasElement.getBoundingClientRect();
		const mouseX = event.clientX - rect.left;
		const mouseY = event.clientY - rect.top;

		const bounds = visualizationBounds();
		const padding = 60;
		const plotWidth = canvasWidth - padding * 2;
		const plotHeight = canvasHeight - padding * 2;

		const toCanvasX = (val: number) =>
			padding + ((val - bounds.minX) / (bounds.maxX - bounds.minX)) * plotWidth;
		const toCanvasY = (val: number) =>
			canvasHeight - padding - ((val - bounds.minY) / (bounds.maxY - bounds.minY)) * plotHeight;

		let found: MemberWithVector | null = null;
		let minDist = Infinity;

		for (const member of members) {
			const x = toCanvasX(member.latentVector[xDimension] ?? 0);
			const y = toCanvasY(member.latentVector[yDimension] ?? 0);
			const dist = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);

			if (dist < 15 && dist < minDist) {
				minDist = dist;
				found = member;
			}
		}

		if (found !== hoveredMember) {
			hoveredMember = found;
			tooltipPosition = { x: event.clientX, y: event.clientY };
			drawVisualization();
		}
	}

	function handleCanvasClick(event: MouseEvent) {
		if (hoveredMember) {
			// Select for visualization panel (not modal)
			vizSelectedMember = hoveredMember;
			// Calculate similar members for visualization
			const selected = hoveredMember;
			vizSimilarMembers = members
				.filter((m) => m.memberId !== selected.memberId)
				.map((member) => ({
					member,
					similarity: cosineSimilarity(selected.latentVector, member.latentVector)
				}))
				.sort((a, b) => b.similarity - a.similarity)
				.slice(0, 10);
			drawVisualization();
		}
	}

	function clearVizSelection() {
		vizSelectedMember = null;
		vizSimilarMembers = [];
		drawVisualization();
	}

	function handleCanvasMouseLeave() {
		if (hoveredMember) {
			hoveredMember = null;
			drawVisualization();
		}
	}

	// Redraw when relevant state changes
	$effect(() => {
		if (canvasElement && members.length > 0) {
			// Access reactive dependencies
			xDimension;
			yDimension;
			vizSelectedMember;
			vizSimilarMembers;
			drawVisualization();
		}
	});

	// Load saved vectors on mount
	$effect(() => {
		loadSavedVectors();
	});

	// Update default name when nComponents changes
	$effect(() => {
		if (selectedClusterId && clusterLabels.length > 0 && !loadedVectorizationName) {
			const cluster = availableClusters.find((c) => c.id === selectedClusterId);
			const today = new Date().toLocaleDateString('ja-JP', {
				year: 'numeric',
				month: '2-digit',
				day: '2-digit'
			});
			vectorizationName = `${cluster?.name || 'クラスター'} ${nComponents}D - ${today}`;
		}
	});

	async function loadSavedVectors() {
		isLoadingSaved = true;
		try {
			const response = await fetch('/api/cluster-vectors?saved=true&all=true');
			const result = await response.json();
			if (result.savedResults) {
				savedVectors = result.savedResults;
			}
		} catch (error) {
			console.error('Failed to load saved vectors:', error);
		} finally {
			isLoadingSaved = false;
		}
	}

	async function loadSavedVectorization(group: GroupedSavedVector) {
		isLoadingSaved = true;
		selectedSavedVectorKey = group.key;
		loadedVectorizationName = group.name;

		try {
			// Load full data for each cluster label in the group
			const loadedClusters: Record<string, ClusterVectorResult> = {};

			for (const sv of group.vectors) {
				const response = await fetch(`/api/cluster-vectors/${sv.id}`);
				const result = await response.json();

				if (result.success && result.data) {
					loadedClusters[String(sv.clusterLabel)] = {
						memberVectors: JSON.parse(result.data.memberVectors),
						memberNames: JSON.parse(result.data.memberNames),
						billLoadings: JSON.parse(result.data.billLoadings),
						representativeBills: result.data.representativeBills
							? JSON.parse(result.data.representativeBills)
							: [],
						explainedVariance: JSON.parse(result.data.explainedVariance),
						dimensions: result.data.dimensions,
						memberCount: result.data.memberCount,
						billCount: result.data.billCount,
						billIds: JSON.parse(result.data.billIds)
					};
				}
			}

			if (Object.keys(loadedClusters).length > 0) {
				calculationResult = loadedClusters;
				selectedClusterId = group.clusterId;
				nComponents = group.nComponents;

				// Load cluster labels for this cluster
				const labelsResponse = await fetch('/api/cluster-vectors?clusterId=' + group.clusterId);
				const labelsResult = await labelsResponse.json();
				if (labelsResult.clusterLabels) {
					clusterLabels = labelsResult.clusterLabels;
				}

				// Set first cluster as current
				const labels = Object.keys(loadedClusters);
				if (labels.length > 0) {
					currentClusterData = loadedClusters[labels[0]];
					selectedClusterLabel = parseInt(labels[0]);
				}
			}
		} catch (error) {
			console.error('Failed to load saved vectorization:', error);
			alert('保存済みベクトルの読み込みに失敗しました');
		} finally {
			isLoadingSaved = false;
		}
	}

	function clearLoadedVectorization() {
		calculationResult = null;
		currentClusterData = null;
		selectedClusterLabel = null;
		selectedSavedVectorKey = null;
		loadedVectorizationName = null;
		selectedClusterId = null;
		clusterLabels = [];
	}

	async function loadClusterLabels(clusterId: number) {
		selectedClusterId = clusterId;
		isLoadingLabels = true;
		clusterLabels = [];
		calculationResult = null;
		currentClusterData = null;
		selectedClusterLabel = null;

		try {
			const response = await fetch('/api/cluster-vectors?clusterId=' + clusterId);
			const result = await response.json();

			if (result.error) {
				alert('Error: ' + result.error);
				return;
			}

			clusterLabels = result.clusterLabels;

			// Auto-generate a default saving name
			const cluster = availableClusters.find((c) => c.id === clusterId);
			const today = new Date().toLocaleDateString('ja-JP', {
				year: 'numeric',
				month: '2-digit',
				day: '2-digit'
			});
			vectorizationName = `${cluster?.name || 'クラスター'} ${nComponents}D - ${today}`;
		} catch (error) {
			console.error('Failed to load cluster labels:', error);
			alert('Failed to load cluster labels');
		} finally {
			isLoadingLabels = false;
		}
	}

	async function calculateAndSaveVectors() {
		if (!selectedClusterId) {
			alert('クラスタリング設定を選択してください');
			return;
		}

		if (!vectorizationName.trim()) {
			alert('保存名を入力してください');
			return;
		}

		isCalculating = true;

		try {
			// Calculate vectors for ALL cluster labels (no specific label)
			const response = await fetch('/api/cluster-vectors', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					clusterId: selectedClusterId,
					nComponents,
					saveImmediately: true,
					saveName: vectorizationName.trim()
				})
			});

			const result = await response.json();

			if (!result.success) {
				alert('Error: ' + result.error);
				return;
			}

			calculationResult = result.clusters;

			// Set the first cluster as currently viewed
			if (calculationResult) {
				const labels = Object.keys(calculationResult);
				if (labels.length > 0) {
					currentClusterData = calculationResult[labels[0]];
					selectedClusterLabel = parseInt(labels[0]);
				}
			}

			alert(
				`ベクトル計算が完了し、保存されました！\n保存された数: ${result.savedCount || Object.keys(result.clusters || {}).length} クラスター`
			);
		} catch (error) {
			console.error('Failed to calculate vectors:', error);
			alert('ベクトル計算に失敗しました');
		} finally {
			isCalculating = false;
		}
	}

	function selectClusterLabelResult(label: number) {
		selectedClusterLabel = label;
		if (calculationResult) {
			currentClusterData = calculationResult[String(label)] || null;
		}
		selectedMember = null;
		comparisonMember = null;
		showSimilar = false;
		similarMembers = [];
	}

	function cosineSimilarity(vec1: number[], vec2: number[]): number {
		if (vec1.length !== vec2.length || vec1.length === 0) return 0;

		let dotProduct = 0;
		let mag1 = 0;
		let mag2 = 0;

		for (let i = 0; i < vec1.length; i++) {
			dotProduct += vec1[i] * vec2[i];
			mag1 += vec1[i] * vec1[i];
			mag2 += vec2[i] * vec2[i];
		}

		mag1 = Math.sqrt(mag1);
		mag2 = Math.sqrt(mag2);

		if (mag1 === 0 || mag2 === 0) return 0;

		return dotProduct / (mag1 * mag2);
	}

	function selectMember(member: MemberWithVector) {
		selectedMember = member;
		showSimilar = false;
		comparisonMember = null;
		similarMembers = [];
	}

	function findSimilarMembers() {
		if (!selectedMember) return;

		const selected = selectedMember;
		const similarities = members
			.filter((m) => m.memberId !== selected.memberId)
			.map((member) => ({
				member,
				similarity: cosineSimilarity(selected.latentVector, member.latentVector)
			}))
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, 20);

		similarMembers = similarities;
		showSimilar = true;
	}

	function selectComparison(member: MemberWithVector) {
		comparisonMember = member;
	}

	function closeModal() {
		selectedMember = null;
		comparisonMember = null;
		showSimilar = false;
		similarMembers = [];
	}

	function formatPercent(value: number): string {
		return (value * 100).toFixed(1) + '%';
	}

	function formatLatent(value: number): string {
		return value.toFixed(3);
	}

	function getClusterLabelName(label: number): string {
		const clusterInfo = clusterLabels.find((c) => c.label === label);
		return clusterInfo?.name || 'クラスター ' + label;
	}

	function getDimensionLabel(dimIndex: number): string {
		if (!currentClusterData?.representativeBills?.[dimIndex]) {
			return '次元 ' + (dimIndex + 1);
		}
		const topBill = currentClusterData.representativeBills[dimIndex][0];
		if (topBill?.title) {
			const title =
				topBill.title.length > 30 ? topBill.title.substring(0, 30) + '...' : topBill.title;
			return 'D' + (dimIndex + 1) + ': ' + title;
		}
		return '次元 ' + (dimIndex + 1);
	}
</script>

<div class="page">
	<!-- Hero Section -->
	<PageHero
		badge="📈 ベクトル分析"
		title="クラスター別メンバーベクトル分析"
		description="法案クラスターごとに議員の投票パターンを潜在空間で分析"
	/>

	<!-- Explanation Section (Collapsible) -->
	<section class="explanation-section">
		<details class="explanation-details-wrapper">
			<summary class="explanation-summary">
				<span class="summary-icon">📖</span>
				<span>この分析について</span>
				<span class="expand-icon">▼</span>
			</summary>

			<div class="explanation-content">
				<div class="explanation-intro">
					<h3>🎯 何をしているの？</h3>
					<p>
						この分析では、<strong>主成分分析（PCA）</strong
						>という手法を使って、各議員の投票パターンを
						<strong>少数の「次元」</strong>で表現しています。
					</p>
				</div>

				<div class="explanation-diagram">
					<div class="diagram-container">
						<div class="diagram-before">
							<div class="diagram-title">変換前</div>
							<div class="diagram-visual">
								<div class="bill-grid">
									<div class="bill-row header">
										<span></span>
										<span>法案1</span>
										<span>法案2</span>
										<span>...</span>
										<span>法案N</span>
									</div>
									<div class="bill-row">
										<span class="member-label">議員A</span>
										<span class="vote yes">賛成</span>
										<span class="vote no">反対</span>
										<span class="vote">...</span>
										<span class="vote yes">賛成</span>
									</div>
									<div class="bill-row">
										<span class="member-label">議員B</span>
										<span class="vote no">反対</span>
										<span class="vote yes">賛成</span>
										<span class="vote">...</span>
										<span class="vote no">反対</span>
									</div>
								</div>
							</div>
							<div class="diagram-desc">数百の法案への投票記録</div>
						</div>

						<div class="diagram-arrow">→</div>

						<div class="diagram-after">
							<div class="diagram-title">変換後（ベクトル）</div>
							<div class="diagram-visual">
								<div class="vector-display">
									<div class="vector-row">
										<span class="member-label">議員A</span>
										<span class="vector">[0.82, -0.35, ...]</span>
									</div>
									<div class="vector-row">
										<span class="member-label">議員B</span>
										<span class="vector">[-0.91, 0.28, ...]</span>
									</div>
								</div>
							</div>
							<div class="diagram-desc">潜在次元数分の数値で表現</div>
						</div>
					</div>
				</div>

				<div class="explanation-details">
					<div class="detail-card">
						<h4>📐 「次元」とは？</h4>
						<p>
							各次元は、投票パターンの中で最も<strong>重要な違い</strong>を表します。
						</p>
						<ul>
							<li><strong>次元1</strong>：投票の違いを最もよく説明する軸（例：与党 vs 野党）</li>
							<li><strong>次元2</strong>：次元1では説明できない2番目の違い</li>
							<li><strong>次元3以降</strong>：さらに細かい違いのパターン</li>
						</ul>
						<p class="detail-note">
							💡 「説明分散」の値が高いほど、その次元が投票パターンの違いをよく説明しています。
						</p>
					</div>

					<div class="detail-card">
						<h4>🔢 ベクトルの値の意味</h4>
						<p>各議員のベクトル値は、その次元での「立ち位置」を示します。</p>
						<ul>
							<li><span class="value-positive">+の値</span>：その次元の「正」方向に位置</li>
							<li><span class="value-negative">−の値</span>：その次元の「負」方向に位置</li>
							<li><strong>0に近い</strong>：その次元ではどちらでもない</li>
						</ul>
						<p class="detail-note">
							💡 ベクトルが似ている議員は、投票パターンが似ていることを意味します。
						</p>
					</div>

					<div class="detail-card">
						<h4>📊 2D可視化の見方</h4>
						<p>下の散布図では、議員を2つの次元で平面上に配置しています。</p>
						<ul>
							<li><strong>近い点</strong>：投票パターンが似ている議員</li>
							<li><strong>遠い点</strong>：投票パターンが異なる議員</li>
							<li><strong>グループ</strong>：同じ政治的立場を持つ議員のまとまり</li>
						</ul>
					</div>

					<div class="detail-card">
						<h4>📋 代表法案とは？</h4>
						<p>
							各次元で<strong>「因子負荷量」</strong>が高い法案です。
							この法案への投票が、その次元での立ち位置を最も決定づけます。
						</p>
						<ul>
							<li><strong>正の負荷量</strong>：賛成すると+方向に</li>
							<li><strong>負の負荷量</strong>：賛成すると−方向に</li>
						</ul>
					</div>
				</div>
			</div>
		</details>
	</section>

	<!-- New Vectorization Section -->
	<section class="content-section">
		<div class="section-header">
			<h2>新規ベクトル分析</h2>
		</div>

		<div class="form-grid">
			<div class="form-group">
				<label for="clusterSelect">クラスタリング設定</label>
				<select
					id="clusterSelect"
					class="select"
					bind:value={selectedClusterId}
					onchange={() => selectedClusterId && loadClusterLabels(selectedClusterId)}
				>
					<option value={null}>-- 選択してください --</option>
					{#each availableClusters as cluster}
						<option value={cluster.id}>{cluster.name}</option>
					{/each}
				</select>
			</div>

			<div class="form-group">
				<label for="nComponents">潜在次元数</label>
				<select id="nComponents" bind:value={nComponents} class="select">
					<option value={1}>1次元</option>
					<option value={2}>2次元</option>
					<option value={3}>3次元</option>
					<option value={4}>4次元</option>
					<option value={5}>5次元</option>
				</select>
			</div>

			<div class="form-group full-width">
				<label for="vectorizationName">保存名</label>
				<input
					type="text"
					id="vectorizationName"
					bind:value={vectorizationName}
					placeholder="例: 2024年分析 (3次元)"
					class="input-text"
				/>
			</div>
		</div>

		{#if isLoadingLabels}
			<p class="loading-state">クラスター情報を読み込み中...</p>
		{:else if selectedClusterId && clusterLabels.length > 0}
			<div class="cluster-preview-box">
				<div class="preview-header">
					<span class="preview-title">計算対象クラスター（{clusterLabels.length}件）</span>
					<a href="/bill-clustering?id={selectedClusterId}" class="preview-link" target="_blank">
						クラスタリング結果を見る →
					</a>
				</div>
				<div class="preview-tags">
					{#each clusterLabels as { label, billCount, name }}
						<span class="preview-tag">
							{name || 'クラスター ' + label}
							<span class="tag-count">({billCount}法案)</span>
						</span>
					{/each}
				</div>
			</div>
		{/if}

		<button
			class="btn-primary"
			onclick={calculateAndSaveVectors}
			disabled={isCalculating || !selectedClusterId || !vectorizationName.trim() || isLoadingLabels}
		>
			{#if isCalculating}
				計算中...
			{:else}
				ベクトル分析を実行
			{/if}
		</button>
	</section>

	<!-- Saved Vectorizations Section -->
	<section class="content-section">
		<div class="section-header">
			<h2>保存済みベクトル分析</h2>
		</div>

		{#if isLoadingSaved}
			<p class="loading-state">読み込み中...</p>
		{:else if groupedSavedVectors.length === 0}
			<p class="empty-state">
				保存済みのベクトル分析がありません。上記のフォームから新しい分析を実行してください。
			</p>
		{:else}
			<div class="saved-list">
				{#each groupedSavedVectors as group (group.key)}
					<button
						class="saved-card"
						class:active={selectedSavedVectorKey === group.key}
						onclick={() => loadSavedVectorization(group)}
					>
						<div class="saved-name">{group.name}</div>
						<div class="saved-meta">
							<span class="badge">{group.clusterName}</span>
							<span class="text-sm">{group.dimensions}次元</span>
							<span class="text-sm">{group.clusterCount}クラスター</span>
						</div>
						<div class="saved-stats">
							{group.totalBills}法案 • {new Date(group.createdAt).toLocaleDateString('ja-JP')}
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</section>

	{#if calculationResult && currentClusterData}
		<section class="content-section results-section">
			<div class="section-header">
				<h2>分析結果: {loadedVectorizationName || vectorizationName}</h2>
				{#if loadedVectorizationName}
					<button class="btn-secondary" onclick={clearLoadedVectorization}>✕ クリア</button>
				{/if}
			</div>

			{#if Object.keys(calculationResult).length > 1}
				<div class="result-cluster-switcher">
					{#each Object.keys(calculationResult).sort((a, b) => parseInt(a) - parseInt(b)) as label}
						<button
							class="switcher-btn"
							class:active={selectedClusterLabel === parseInt(label)}
							onclick={() => selectClusterLabelResult(parseInt(label))}
						>
							{getClusterLabelName(parseInt(label))}
						</button>
					{/each}
				</div>
			{/if}

			<div class="stats-summary">
				<div class="stat-card">
					<span class="stat-label">議員数</span>
					<span class="stat-value">{currentClusterData.memberCount}</span>
				</div>
				<div class="stat-card">
					<span class="stat-label">法案数</span>
					<span class="stat-value">{currentClusterData.billCount}</span>
				</div>
				<div class="stat-card">
					<span class="stat-label">次元数</span>
					<span class="stat-value">{currentClusterData.dimensions}</span>
				</div>
				<div class="stat-card">
					<span class="stat-label">説明分散</span>
					<span class="stat-value">
						{formatPercent(currentClusterData.explainedVariance.reduce((sum, v) => sum + v, 0))}
					</span>
				</div>
			</div>

			<div class="representative-bills">
				<div class="representative-bills-header">
					<h3>次元別の代表法案</h3>
					<div class="bills-legend">
						<span class="legend-item"><span class="legend-dot passed"></span> 可決</span>
						<span class="legend-item"><span class="legend-dot rejected"></span> 否決</span>
						<span class="legend-item"><span class="legend-dot withdrawn"></span> 撤回</span>
						<span class="legend-item"><span class="legend-dot expired"></span> 未了</span>
						<span class="legend-item"><span class="legend-dot pending"></span> 審議中</span>
					</div>
				</div>
				{#each currentClusterData.representativeBills as bills, dimIndex}
					<div class="dimension-section">
						<h4>
							次元 {dimIndex + 1}
							<span class="variance-badge">
								分散: {formatPercent(currentClusterData.explainedVariance[dimIndex] || 0)}
							</span>
						</h4>
						<div class="bills-list">
							{#each bills as bill}
								<div
									class="bill-item"
									class:passed={bill.result === '可決'}
									class:rejected={bill.result === '否決'}
									class:withdrawn={bill.result === '撤回'}
									class:expired={bill.result === '未了'}
									class:pending={bill.result === null}
								>
									<span class="bill-title">{bill.title || '法案 ' + bill.billId}</span>
									<span class="bill-loading" title="因子負荷量">
										{formatLatent(bill.loading)}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>

			<!-- Visualization Section -->
			<div class="visualization-section">
				<div class="visualization-header">
					<h3>📊 2D可視化</h3>
				</div>

				{#if availableDimensions.length >= 2}
					<div class="viz-controls">
						<div class="dim-selector">
							<label for="xDim">X軸:</label>
							<select id="xDim" bind:value={xDimension} class="dim-select">
								{#each availableDimensions as dim}
									<option value={dim}>次元 {dim + 1}</option>
								{/each}
							</select>
						</div>
						<div class="dim-selector">
							<label for="yDim">Y軸:</label>
							<select id="yDim" bind:value={yDimension} class="dim-select">
								{#each availableDimensions as dim}
									<option value={dim}>次元 {dim + 1}</option>
								{/each}
							</select>
						</div>
						<div class="viz-legend">
							<span class="legend-item"><span class="dot selected"></span> 選択中</span>
							<span class="legend-item"><span class="dot similar"></span> 類似議員</span>
							<span class="legend-item"><span class="dot default"></span> その他</span>
						</div>
					</div>

					<div class="viz-main-container">
						<div class="canvas-container">
							<canvas
								bind:this={canvasElement}
								width={canvasWidth}
								height={canvasHeight}
								onmousemove={handleCanvasMouseMove}
								onclick={handleCanvasClick}
								onmouseleave={handleCanvasMouseLeave}
							></canvas>

							{#if hoveredMember && !vizSelectedMember}
								<div
									class="canvas-tooltip"
									style="left: {tooltipPosition.x + 15}px; top: {tooltipPosition.y - 10}px;"
								>
									<strong>{hoveredMember.memberName}</strong>
									<div class="tooltip-coords">
										D{xDimension + 1}: {formatLatent(
											hoveredMember.latentVector[xDimension] ?? 0
										)}<br />
										D{yDimension + 1}: {formatLatent(hoveredMember.latentVector[yDimension] ?? 0)}
									</div>
								</div>
							{/if}
						</div>

						{#if vizSelectedMember}
							<div class="viz-detail-panel">
								<div class="viz-panel-header">
									<h4>{vizSelectedMember.memberName}</h4>
									<button class="viz-panel-close" onclick={clearVizSelection}>✕</button>
								</div>

								<div class="viz-panel-section">
									<h5>潜在ベクトル</h5>
									<div class="viz-latent-list">
										{#each vizSelectedMember.latentVector as val, i}
											<div class="viz-latent-row">
												<span class="viz-latent-label">次元 {i + 1}</span>
												<span
													class="viz-latent-value"
													class:positive={val > 0}
													class:negative={val < 0}
												>
													{formatLatent(val)}
												</span>
											</div>
										{/each}
									</div>
								</div>

								{#if vizSimilarMembers.length > 0}
									<div class="viz-panel-section">
										<h5>類似議員 Top 10</h5>
										<div class="viz-similar-list">
											{#each vizSimilarMembers as { member, similarity }}
												<button
													class="viz-similar-item"
													onclick={() => {
														vizSelectedMember = member;
														vizSimilarMembers = members
															.filter((m) => m.memberId !== member.memberId)
															.map((m) => ({
																member: m,
																similarity: cosineSimilarity(member.latentVector, m.latentVector)
															}))
															.sort((a, b) => b.similarity - a.similarity)
															.slice(0, 10);
														drawVisualization();
													}}
												>
													<span class="viz-similar-name">{member.memberName}</span>
													<span class="viz-similar-score">{formatPercent(similarity)}</span>
												</button>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						{/if}
					</div>

					<p class="viz-hint">
						💡 ポイントをクリックして議員を選択すると、詳細と類似議員が右側に表示されます。
					</p>
				{:else}
					<p class="viz-warning">
						⚠️
						2D可視化には2次元以上の潜在ベクトルが必要です。次元数を2以上に設定して再計算してください。
					</p>
				{/if}
			</div>

			<div class="member-section">
				<h3>議員の潜在位置</h3>

				<div class="controls">
					<div class="search-box">
						<input
							type="text"
							placeholder="議員を検索..."
							bind:value={searchTerm}
							class="search-input"
						/>
					</div>

					<div class="sort-controls">
						<label for="sortBy">並べ替え:</label>
						<select id="sortBy" bind:value={sortBy} class="sort-select">
							<option value="name">名前順</option>
							<option value="dim0">次元1</option>
							<option value="dim1">次元2</option>
							<option value="dim2">次元3</option>
						</select>
					</div>

					<div class="stats">
						<span>表示: {filteredMembers.length} / {members.length}</span>
					</div>
				</div>

				<div class="members-grid">
					{#each sortedMembers as member (member.memberId)}
						<button class="member-card" onclick={() => selectMember(member)}>
							<h4>{member.memberName}</h4>
							<div class="latent-values">
								{#each member.latentVector as val, i}
									<div class="latent-item">
										<span class="latent-label">D{i + 1}</span>
										<span class="latent-value" class:positive={val > 0} class:negative={val < 0}>
											{formatLatent(val)}
										</span>
									</div>
								{/each}
							</div>
						</button>
					{/each}
				</div>
			</div>
		</section>
	{/if}

	{#if selectedMember}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions a11y_interactive_supports_focus -->
		<div class="modal-overlay" role="dialog" tabindex="-1" onclick={closeModal}>
			<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions a11y_no_static_element_interactions -->
			<div class="modal" role="none" onclick={(e) => e.stopPropagation()}>
				<div class="modal-header">
					<h2>{selectedMember.memberName}</h2>
					<button class="close-button" onclick={closeModal}>x</button>
				</div>

				<div class="modal-content">
					<section class="section">
						<h3>潜在ベクトル</h3>
						<div class="latent-detail">
							{#each selectedMember.latentVector as val, i}
								<div class="latent-detail-item">
									<div class="latent-header">
										<span class="latent-dim-label">{getDimensionLabel(i)}</span>
										<span
											class="latent-dim-value"
											class:positive={val > 0}
											class:negative={val < 0}
										>
											{formatLatent(val)}
										</span>
									</div>
								</div>
							{/each}
						</div>
					</section>

					<section class="section">
						<button class="button-primary" onclick={findSimilarMembers}>類似議員を検索</button>

						{#if showSimilar}
							<div class="similar-members">
								<h4>類似度上位20名</h4>
								<div class="similar-list">
									{#each similarMembers as { member, similarity }}
										<button
											class="similar-item"
											onclick={() => selectComparison(member)}
											class:selected={comparisonMember?.memberId === member.memberId}
										>
											<span class="similar-name">{member.memberName}</span>
											<span class="similar-score">{formatPercent(similarity)}</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}
					</section>

					{#if comparisonMember}
						<section class="section comparison-section">
							<h3>比較: {selectedMember.memberName} vs {comparisonMember.memberName}</h3>
							<div class="comparison-grid">
								<div class="comparison-header">次元</div>
								<div class="comparison-header">{selectedMember.memberName}</div>
								<div class="comparison-header">{comparisonMember.memberName}</div>

								{#each selectedMember.latentVector as val, i}
									<div class="comparison-label">D{i + 1}</div>
									<div class="comparison-value" class:positive={val > 0} class:negative={val < 0}>
										{formatLatent(val)}
									</div>
									<div
										class="comparison-value"
										class:positive={comparisonMember.latentVector[i] > 0}
										class:negative={comparisonMember.latentVector[i] < 0}
									>
										{formatLatent(comparisonMember.latentVector[i])}
									</div>
								{/each}

								<div class="comparison-label">類似度</div>
								<div class="comparison-value similarity-value" style="grid-column: 2 / 4">
									{formatPercent(
										cosineSimilarity(selectedMember.latentVector, comparisonMember.latentVector)
									)}
								</div>
							</div>
						</section>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* ===== BASE STYLES ===== */
	.page {
		min-height: 100vh;
		background: #fafbfc;
	}

	/* ===== CONTENT SECTIONS ===== */
	.content-section {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	.section-header {
		margin-bottom: 1.25rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 1rem;
	}

	.section-header h2 {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1a1a2e;
		margin: 0;
	}

	.empty-state {
		color: #64748b;
		font-style: italic;
		text-align: center;
		padding: 2rem;
		background: white;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
	}

	/* ===== FORM GRID ===== */
	.form-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.form-group.full-width {
		grid-column: 1 / -1;
	}

	.form-group label {
		font-weight: 500;
		font-size: 0.9rem;
		color: #374151;
	}

	.cluster-preview-box {
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		padding: 1rem;
		margin-bottom: 1rem;
	}

	.preview-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.preview-title {
		font-weight: 600;
		color: #374151;
		font-size: 0.9rem;
	}

	.preview-link {
		font-size: 0.8rem;
		color: #3b82f6;
		text-decoration: none;
		transition: color 0.2s;
	}

	.preview-link:hover {
		color: #1d4ed8;
		text-decoration: underline;
	}

	.preview-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.preview-tag {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.35rem 0.75rem;
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 20px;
		font-size: 0.8rem;
		color: #374151;
	}

	.tag-count {
		font-size: 0.7rem;
		color: #64748b;
	}

	/* ===== SAVED VECTORS SECTION ===== */
	.saved-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.saved-card {
		padding: 1rem 1.25rem;
		border: 1px solid #d1fae5;
		border-radius: 10px;
		background: white;
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
		min-width: 200px;
	}

	.saved-card:hover {
		border-color: #10b981;
		background: #f0fdf4;
	}

	.saved-card.active {
		border-color: #10b981;
		background: #ecfdf5;
	}

	.saved-name {
		font-weight: 600;
		color: #065f46;
		margin-bottom: 0.5rem;
	}

	.saved-meta {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.25rem;
		flex-wrap: wrap;
	}

	.saved-stats {
		font-size: 0.8rem;
		color: #6b7280;
	}

	.loading-state {
		color: #6b7280;
		padding: 2rem;
		text-align: center;
	}

	.btn-secondary {
		background: #f3f4f6;
		color: #374151;
		border: 1px solid #d1d5db;
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.85rem;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-secondary:hover {
		background: #e5e7eb;
		border-color: #9ca3af;
	}

	.badge {
		display: inline-block;
		padding: 0.2rem 0.5rem;
		background: #6366f1;
		color: white;
		font-size: 0.7rem;
		border-radius: 100px;
		font-weight: 600;
	}

	.text-sm {
		font-size: 0.8rem;
		color: #64748b;
	}

	/* ===== FORM STYLES ===== */

	.select {
		padding: 0.5rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 0.95rem;
		background: white;
		cursor: pointer;
	}

	.select:focus {
		outline: none;
		border-color: #6366f1;
	}

	.input-text {
		flex: 1;
		padding: 0.5rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 0.95rem;
		min-width: 200px;
	}

	.input-text:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
	}

	.btn-primary {
		padding: 0.7rem 1.5rem;
		background: #6366f1;
		color: white;
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
		background: #9ca3af;
		cursor: not-allowed;
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
		font-size: 1.2rem;
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

	/* Diagram */
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
		font-size: 0.85rem;
		font-weight: 600;
		color: #64748b;
		text-align: center;
		margin-bottom: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.diagram-visual {
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		padding: 1rem;
		min-height: 100px;
	}

	.diagram-desc {
		font-size: 0.8rem;
		color: #64748b;
		text-align: center;
		margin-top: 0.5rem;
	}

	.diagram-arrow {
		font-size: 2rem;
		color: #0369a1;
		font-weight: bold;
		flex-shrink: 0;
	}

	/* Bill grid in diagram */
	.bill-grid {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.75rem;
	}

	.bill-row {
		display: grid;
		grid-template-columns: 50px repeat(4, 1fr);
		gap: 0.25rem;
		align-items: center;
	}

	.bill-row.header {
		font-weight: 500;
		color: #64748b;
		font-size: 0.7rem;
	}

	.bill-row .member-label {
		font-weight: 500;
		color: #374151;
	}

	.bill-row .vote {
		padding: 0.2rem 0.35rem;
		border-radius: 4px;
		text-align: center;
		font-size: 0.65rem;
		background: #f1f5f9;
		color: #64748b;
	}

	.bill-row .vote.yes {
		background: #dcfce7;
		color: #15803d;
	}

	.bill-row .vote.no {
		background: #fee2e2;
		color: #dc2626;
	}

	/* Vector display in diagram */
	.vector-display {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.vector-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.vector-row .member-label {
		font-weight: 500;
		color: #374151;
		min-width: 50px;
		font-size: 0.8rem;
	}

	.vector-row .vector {
		font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
		background: #6366f1;
		color: white;
		padding: 0.35rem 0.75rem;
		border-radius: 6px;
		font-size: 0.8rem;
	}

	/* Detail cards */
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

	.value-positive {
		color: #22c55e;
		font-weight: 600;
	}

	.value-negative {
		color: #ef4444;
		font-weight: 600;
	}

	/* Mobile responsive */
	@media (max-width: 600px) {
		.diagram-container {
			flex-direction: column;
		}

		.diagram-arrow {
			transform: rotate(90deg);
		}

		.diagram-before,
		.diagram-after {
			max-width: 100%;
		}
	}

	/* ===== RESULTS SECTION ===== */
	.result-cluster-switcher {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.switcher-btn {
		padding: 0.5rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		background: white;
		cursor: pointer;
		transition: all 0.2s;
		font-size: 0.9rem;
	}

	.switcher-btn:hover {
		border-color: #6366f1;
	}

	.switcher-btn.active {
		border-color: #6366f1;
		background: #6366f1;
		color: white;
	}

	.stats-summary {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 1rem;
		margin-bottom: 2rem;
	}

	.stat-card {
		padding: 1rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.stat-label {
		font-size: 0.8rem;
		color: #64748b;
		margin-bottom: 0.35rem;
	}

	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		color: #6366f1;
	}

	/* ===== REPRESENTATIVE BILLS ===== */
	.representative-bills {
		margin-bottom: 2rem;
	}

	.representative-bills-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.representative-bills h3 {
		font-size: 1.1rem;
		font-weight: 600;
		color: #1a1a2e;
		margin: 0;
	}

	.bills-legend {
		display: flex;
		gap: 1rem;
		font-size: 0.8rem;
		color: #64748b;
	}

	.bills-legend .legend-item {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.bills-legend .legend-dot {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		background: #fef3c7;
		border: 1px solid #f59e0b;
	}

	.bills-legend .legend-dot.passed {
		background: #dcfce7;
		border-color: #22c55e;
	}

	.bills-legend .legend-dot.rejected {
		background: #fee2e2;
		border-color: #ef4444;
	}

	.bills-legend .legend-dot.withdrawn {
		background: #e5e7eb;
		border-color: #6b7280;
	}

	.bills-legend .legend-dot.expired {
		background: #dbeafe;
		border-color: #3b82f6;
	}

	.bills-legend .legend-dot.pending {
		background: #fef3c7;
		border-color: #f59e0b;
	}

	.dimension-section {
		margin-bottom: 1rem;
		padding: 1rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
	}

	.dimension-section h4 {
		margin: 0 0 0.75rem 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.95rem;
		color: #1a1a2e;
	}

	.variance-badge {
		font-size: 0.75rem;
		font-weight: normal;
		color: #64748b;
		background: #f3f4f6;
		padding: 0.2rem 0.5rem;
		border-radius: 100px;
	}

	.bills-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.bill-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem 0.75rem;
		background: #f9fafb;
		border-radius: 6px;
		border-left: 3px solid #f59e0b;
	}

	.bill-item.passed {
		border-left-color: #22c55e;
	}

	.bill-item.rejected {
		border-left-color: #ef4444;
	}

	.bill-item.withdrawn {
		border-left-color: #6b7280;
	}

	.bill-item.expired {
		border-left-color: #3b82f6;
	}

	.bill-item.pending {
		border-left-color: #f59e0b;
	}

	.bill-title {
		font-size: 0.85rem;
		color: #1a1a2e;
	}

	.bill-loading {
		font-family: monospace;
		font-size: 0.8rem;
		color: #6366f1;
		font-weight: 600;
	}

	/* ===== VISUALIZATION SECTION ===== */
	.visualization-section {
		margin-bottom: 2rem;
		padding: 1.5rem;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
	}

	.visualization-header {
		margin-bottom: 1rem;
	}

	.visualization-header h3 {
		font-size: 1.1rem;
		font-weight: 600;
		color: #1a1a2e;
		margin: 0;
	}

	.viz-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
		align-items: center;
		margin-bottom: 1rem;
		padding: 1rem;
		background: #f9fafb;
		border-radius: 8px;
	}

	.dim-selector {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.dim-selector label {
		font-size: 0.9rem;
		font-weight: 500;
		color: #374151;
	}

	.dim-select {
		padding: 0.4rem 0.8rem;
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		font-size: 0.9rem;
		background: white;
		cursor: pointer;
	}

	.dim-select:focus {
		outline: none;
		border-color: #6366f1;
	}

	.viz-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		margin-left: auto;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: #64748b;
	}

	.legend-item .dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
	}

	.legend-item .dot.selected {
		background: #22c55e;
	}

	.legend-item .dot.similar {
		background: #f59e0b;
	}

	.legend-item .dot.default {
		background: #6366f1;
	}

	.viz-main-container {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
	}

	.canvas-container {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		justify-content: center;
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		overflow: hidden;
	}

	.canvas-container canvas {
		cursor: crosshair;
		max-width: 100%;
		height: auto;
	}

	.canvas-tooltip {
		position: fixed;
		background: rgba(0, 0, 0, 0.85);
		color: white;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		font-size: 0.85rem;
		pointer-events: none;
		z-index: 1000;
		max-width: 200px;
	}

	.canvas-tooltip strong {
		display: block;
		margin-bottom: 0.25rem;
	}

	.tooltip-coords {
		font-size: 0.75rem;
		opacity: 0.9;
		font-family: monospace;
	}

	/* Visualization Detail Panel */
	.viz-detail-panel {
		width: 280px;
		flex-shrink: 0;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		overflow: hidden;
	}

	.viz-panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		background: #6366f1;
		color: white;
	}

	.viz-panel-header h4 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
	}

	.viz-panel-close {
		background: none;
		border: none;
		color: white;
		font-size: 1.1rem;
		cursor: pointer;
		opacity: 0.8;
		padding: 0;
		line-height: 1;
	}

	.viz-panel-close:hover {
		opacity: 1;
	}

	.viz-panel-section {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.viz-panel-section:last-child {
		border-bottom: none;
	}

	.viz-panel-section h5 {
		margin: 0 0 0.5rem 0;
		font-size: 0.8rem;
		font-weight: 600;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.viz-latent-list {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.viz-latent-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.3rem 0.5rem;
		background: white;
		border-radius: 4px;
	}

	.viz-latent-label {
		font-size: 0.8rem;
		color: #64748b;
	}

	.viz-latent-value {
		font-family: monospace;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.viz-latent-value.positive {
		color: #16a34a;
	}

	.viz-latent-value.negative {
		color: #dc2626;
	}

	.viz-similar-list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 300px;
		overflow-y: auto;
	}

	.viz-similar-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.4rem 0.6rem;
		background: white;
		border: 1px solid transparent;
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s;
		text-align: left;
	}

	.viz-similar-item:hover {
		border-color: #6366f1;
		background: #f5f3ff;
	}

	.viz-similar-name {
		font-size: 0.85rem;
		color: #1a1a2e;
	}

	.viz-similar-score {
		font-size: 0.8rem;
		font-weight: 600;
		color: #6366f1;
	}

	.viz-hint {
		margin-top: 0.75rem;
		font-size: 0.85rem;
		color: #64748b;
		text-align: center;
	}

	.viz-warning {
		padding: 1rem;
		background: #fef3c7;
		border: 1px solid #fcd34d;
		border-radius: 8px;
		color: #92400e;
		text-align: center;
	}

	/* ===== MEMBER SECTION ===== */
	.member-section h3 {
		font-size: 1.1rem;
		font-weight: 600;
		color: #1a1a2e;
		margin-bottom: 1rem;
	}

	.controls {
		display: flex;
		gap: 1.5rem;
		align-items: center;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.search-box {
		flex: 1;
		min-width: 200px;
	}

	.search-input {
		width: 100%;
		padding: 0.6rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 0.95rem;
		background: white;
	}

	.search-input:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
	}

	.sort-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.sort-controls label {
		font-size: 0.9rem;
		color: #64748b;
	}

	.sort-select {
		padding: 0.5rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		font-size: 0.9rem;
		background: white;
		cursor: pointer;
	}

	.stats {
		font-size: 0.85rem;
		color: #64748b;
	}

	/* ===== MEMBERS GRID ===== */
	.members-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.75rem;
	}

	.member-card {
		padding: 0.85rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: white;
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
	}

	.member-card:hover {
		border-color: #6366f1;
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.1);
	}

	.member-card h4 {
		margin: 0 0 0.5rem 0;
		font-size: 0.9rem;
		color: #1a1a2e;
	}

	.latent-values {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.latent-item {
		display: flex;
		align-items: center;
		gap: 0.2rem;
	}

	.latent-label {
		font-size: 0.7rem;
		color: #64748b;
	}

	.latent-value {
		font-family: monospace;
		font-size: 0.8rem;
		padding: 0.1rem 0.25rem;
		border-radius: 3px;
		background: #f3f4f6;
	}

	.latent-value.positive {
		color: #16a34a;
		background: #f0fdf4;
	}

	.latent-value.negative {
		color: #dc2626;
		background: #fef2f2;
	}

	/* ===== MODAL ===== */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		z-index: 1000;
		overflow-y: auto;
	}

	.modal {
		background: white;
		border-radius: 16px;
		max-width: 800px;
		width: 100%;
		max-height: 90vh;
		overflow-y: auto;
		box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
	}

	.modal-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1.5rem 2rem;
		border-bottom: 1px solid #e5e7eb;
		position: sticky;
		top: 0;
		background: white;
		z-index: 10;
	}

	.modal-header h2 {
		margin: 0;
		font-size: 1.5rem;
		color: #1a1a2e;
	}

	.close-button {
		background: #f3f4f6;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		color: #6b7280;
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		transition: all 0.2s;
	}

	.close-button:hover {
		background: #e5e7eb;
		color: #1a1a2e;
	}

	.modal-content {
		padding: 2rem;
	}

	.modal-content .section {
		margin-bottom: 1.5rem;
		padding: 0;
		background: none;
		box-shadow: none;
	}

	.modal-content .section h3 {
		font-size: 1rem;
		font-weight: 600;
		color: #1a1a2e;
		margin: 0 0 1rem 0;
	}

	.latent-detail {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.latent-detail-item {
		padding: 0.85rem 1rem;
		background: #f9fafb;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
	}

	.latent-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.latent-dim-label {
		font-weight: 500;
		color: #1a1a2e;
		font-size: 0.9rem;
	}

	.latent-dim-value {
		font-family: monospace;
		font-size: 1.1rem;
		font-weight: bold;
	}

	.latent-dim-value.positive {
		color: #16a34a;
	}

	.latent-dim-value.negative {
		color: #dc2626;
	}

	.button-primary {
		padding: 0.6rem 1.25rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s;
	}

	.button-primary:hover {
		background: #4f46e5;
	}

	/* ===== SIMILAR MEMBERS ===== */
	.similar-members {
		margin-top: 1.5rem;
	}

	.similar-members h4 {
		margin: 0 0 1rem 0;
		color: #1a1a2e;
		font-size: 1rem;
	}

	.similar-list {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		max-height: 300px;
		overflow-y: auto;
	}

	.similar-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.6rem 0.85rem;
		background: #f9fafb;
		border: 1px solid transparent;
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s;
	}

	.similar-item:hover {
		background: #f3f4f6;
		border-color: #6366f1;
	}

	.similar-item.selected {
		background: #eef2ff;
		border-color: #6366f1;
	}

	.similar-name {
		font-weight: 500;
		color: #1a1a2e;
		font-size: 0.9rem;
	}

	.similar-score {
		font-weight: bold;
		color: #6366f1;
		font-size: 0.9rem;
	}

	/* ===== COMPARISON ===== */
	.comparison-section {
		background: #f9fafb;
		padding: 1.25rem;
		border-radius: 10px;
		border: 1px solid #e5e7eb;
	}

	.comparison-section h3 {
		margin-bottom: 1rem !important;
	}

	.comparison-grid {
		display: grid;
		grid-template-columns: 80px 1fr 1fr;
		gap: 0.4rem;
		align-items: center;
	}

	.comparison-header {
		font-weight: 600;
		padding: 0.5rem;
		background: white;
		border-radius: 6px;
		text-align: center;
		font-size: 0.85rem;
		color: #1a1a2e;
	}

	.comparison-label {
		font-weight: 500;
		color: #64748b;
		padding: 0.4rem;
		font-size: 0.85rem;
	}

	.comparison-value {
		padding: 0.4rem;
		background: white;
		border-radius: 6px;
		text-align: center;
		font-family: monospace;
		font-size: 0.9rem;
	}

	.comparison-value.positive {
		color: #16a34a;
	}

	.comparison-value.negative {
		color: #dc2626;
	}

	.similarity-value {
		font-size: 1.1rem;
		font-weight: bold;
		color: #6366f1;
	}

	/* ===== RESPONSIVE ===== */
	@media (max-width: 768px) {
		.content-section {
			padding: 1.5rem 1rem;
		}

		.controls {
			flex-direction: column;
			align-items: stretch;
		}

		.search-box {
			min-width: unset;
		}

		.members-grid {
			grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		}

		.modal {
			margin: 1rem;
		}

		.comparison-grid {
			grid-template-columns: 60px 1fr 1fr;
		}

		.viz-main-container {
			flex-direction: column;
		}

		.viz-detail-panel {
			width: 100%;
		}

		.viz-controls {
			flex-direction: column;
			align-items: flex-start;
		}

		.viz-legend {
			margin-left: 0;
			margin-top: 0.5rem;
		}
	}
</style>
