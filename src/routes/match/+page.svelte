<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types.js';
	import {
		SetupPhase,
		QuestioningPhase,
		ClusterReviewPhase,
		GlobalResultsPhase
	} from '$lib/components/index.js';
	import type {
		SavedVectorInfo,
		GroupedSavedVector,
		Bill,
		MemberMatch,
		ClusterResult,
		GlobalMemberScore,
		MatchingPhase,
		MemberVectorForViz
	} from '$lib/types/index.js';

	interface NextQuestion {
		billId: number;
		title: string;
		description: string | null;
		passed: boolean;
		reason: string;
		dimensionTarget: number;
	}

	let { data }: { data: PageData } = $props();

	// State
	let savedVectors: SavedVectorInfo[] = $state((data.savedVectors || []) as SavedVectorInfo[]);
	let selectedSavedVectorKey: string | null = $state(null);

	let phase: MatchingPhase = $state('setup');
	let isLoading: boolean = $state(false);
	let error: string | null = $state(null);
	let mounted: boolean = $state(false);

	// Multi-cluster state
	let clusterLabelsToProcess: number[] = $state([]);
	let clusterLabelNameMap: Record<number, string> = $state({}); // clusterLabel -> name
	let currentClusterIndex: number = $state(0);
	let clusterResults: ClusterResult[] = $state([]);
	let globalScores: GlobalMemberScore[] = $state([]);

	// Current cluster session
	let sessionId: string | null = $state(null);
	let currentQuestion: NextQuestion | null = $state(null);
	let answeredCount: number = $state(0);
	let currentClusterBillCount: number = $state(0); // Total bills in current cluster
	let topMatches: MemberMatch[] = $state([]);
	let uncertainty: number[] = $state([]);
	let userVector: number[] = $state([]);
	let currentClusterMatches: MemberMatch[] = $state([]);

	// Rating state
	let pendingImportance: number = $state(3);

	// 2D Visualization state
	interface MemberVectorForViz {
		memberId: number;
		name: string;
		group: string | null;
		latentVector: number[];
	}
	let memberVectorsForViz: MemberVectorForViz[] = $state([]);
	let explainedVariance: number[] = $state([]);
	let xDimension: number = $state(0);
	let yDimension: number = $state(1);
	let userVectorHistory: number[][] = $state([]); // Track user position over time
	let showVisualization: boolean = $state(true);

	// Group saved vectors by name + clusterId
	let groupedSavedVectors = $derived.by(() => {
		const groups = new Map<string, GroupedSavedVector>();
		for (const sv of savedVectors) {
			const key = `${sv.name}|${sv.clusterId}`;
			if (!groups.has(key)) {
				groups.set(key, {
					key,
					name: sv.name,
					clusterId: sv.clusterId,
					nComponents: sv.nComponents,
					dimensions: sv.dimensions,
					clusterCount: 0,
					totalMembers: sv.memberCount,
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

	// Get selected grouped vector
	let selectedGroupedVector = $derived(
		groupedSavedVectors.find((g) => g.key === selectedSavedVectorKey) || null
	);

	// Derived
	let currentClusterLabel = $derived(clusterLabelsToProcess[currentClusterIndex] ?? null);
	let currentClusterDisplayName = $derived(
		currentClusterLabel !== null
			? clusterLabelNameMap[currentClusterLabel] || `クラスター${currentClusterLabel}`
			: null
	);
	let progress = $derived.by(() => {
		if (clusterLabelsToProcess.length === 0) return 0;
		return (currentClusterIndex / clusterLabelsToProcess.length) * 100;
	});
	let confidence = $derived.by(() => {
		if (uncertainty.length === 0) return 0;
		const avgUncertainty = uncertainty.reduce((a, b) => a + b, 0) / uncertainty.length;
		return Math.max(0, Math.min(100, (1 - avgUncertainty) * 100));
	});

	// Highlighted members for visualization (top matches)
	let highlightedMembersForViz = $derived(
		topMatches.map((m) => ({ memberId: m.memberId, similarity: m.similarity }))
	);

	/**
	 * Get display name for a cluster label
	 */
	function getClusterDisplayName(clusterLabel: number): string {
		return clusterLabelNameMap[clusterLabel] || `クラスター${clusterLabel}`;
	}

	/**
	 * Start matching with a saved vector configuration (all clusters)
	 */
	async function startWithSavedVector() {
		if (!selectedGroupedVector) {
			error = '保存済みベクトルを選択してください';
			return;
		}

		isLoading = true;
		error = null;
		clusterResults = [];
		globalScores = [];

		// Get all cluster labels from the grouped vector, sorted
		const labels = selectedGroupedVector.vectors.map((v) => v.clusterLabel).sort((a, b) => a - b);

		if (labels.length === 0) {
			error = 'クラスターが見つかりません';
			isLoading = false;
			return;
		}

		// Build cluster label name map
		const nameMap: Record<number, string> = {};
		for (const v of selectedGroupedVector.vectors) {
			if (v.clusterLabelName) {
				nameMap[v.clusterLabel] = v.clusterLabelName;
			}
		}
		clusterLabelNameMap = nameMap;

		clusterLabelsToProcess = labels;
		currentClusterIndex = 0;

		// Start with the first cluster using its saved vector
		await startClusterSessionWithSavedVector(labels[0]);
	}

	/**
	 * Start session for a specific cluster using saved vector
	 */
	async function startClusterSessionWithSavedVector(clusterLabel: number) {
		if (!selectedGroupedVector) return;

		isLoading = true;
		error = null;

		try {
			const savedVector = selectedGroupedVector.vectors.find(
				(v) => v.clusterLabel === clusterLabel
			);

			if (!savedVector) {
				throw new Error(`クラスター ${clusterLabel} の保存済みベクトルが見つかりません`);
			}

			const response = await fetch('/api/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'start',
					savedVectorId: savedVector.id
				})
			});

			const result = await response.json();

			if (!response.ok || !result.success) {
				throw new Error(result.error || 'セッションの開始に失敗しました');
			}

			sessionId = result.sessionId;
			currentQuestion = result.nextQuestion;
			answeredCount = 0;
			currentClusterBillCount = savedVector.billCount; // Set the bill count for current cluster
			topMatches = [];
			uncertainty = result.uncertainty || [];
			userVector = result.userVector || [];

			// Store member vectors for 2D visualization
			memberVectorsForViz = result.memberVectors || [];
			explainedVariance = result.explainedVariance || [];
			userVectorHistory = []; // Reset history for new cluster

			phase = 'questioning';
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Submit answer for current question
	 */
	async function submitAnswer(score: number) {
		if (!sessionId || !currentQuestion) return;

		isLoading = true;
		error = null;

		try {
			const response = await fetch('/api/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'answer',
					sessionId: sessionId,
					billId: currentQuestion.billId,
					score: score
				})
			});

			const result = await response.json();

			if (!response.ok || !result.success) {
				throw new Error(result.error || '回答の送信に失敗しました');
			}

			answeredCount = result.answeredBills;
			currentQuestion = result.nextQuestion;
			uncertainty = result.uncertainty || [];

			// Track user position history for visualization
			if (userVector.length > 0 && userVector.some((v) => v !== 0)) {
				userVectorHistory = [...userVectorHistory, [...userVector]];
			}
			userVector = result.userVector || [];
			topMatches = result.topMatches || [];

			if (result.isComplete || !result.nextQuestion) {
				await finishCurrentCluster();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Skip current question
	 */
	async function skipQuestion() {
		if (!sessionId || !currentQuestion) return;

		isLoading = true;
		error = null;

		try {
			const response = await fetch('/api/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'skip',
					sessionId: sessionId,
					billId: currentQuestion.billId
				})
			});

			const result = await response.json();

			if (!response.ok || !result.success) {
				throw new Error(result.error || 'スキップに失敗しました');
			}

			currentQuestion = result.nextQuestion;
			uncertainty = result.uncertainty || [];
			userVector = result.userVector || [];
			topMatches = result.topMatches || [];

			if (result.isComplete || !result.nextQuestion) {
				await finishCurrentCluster();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Finish current cluster early and get results
	 */
	async function finishCurrentCluster() {
		if (!sessionId) return;

		isLoading = true;
		error = null;

		try {
			const response = await fetch('/api/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'results',
					sessionId: sessionId
				})
			});

			const result = await response.json();

			if (!response.ok || !result.success) {
				throw new Error(result.error || '結果の取得に失敗しました');
			}

			currentClusterMatches = result.matches || [];
			userVector = result.userVector || [];
			pendingImportance = 3;
			phase = 'rating';
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Save importance rating and move to next cluster or results
	 */
	function saveImportanceAndContinue() {
		// Save current cluster result
		const newResult: ClusterResult = {
			clusterLabel: currentClusterLabel!,
			clusterLabelName: clusterLabelNameMap[currentClusterLabel!] || null,
			matches: currentClusterMatches,
			answeredCount: answeredCount,
			importance: pendingImportance,
			userVector: [...userVector],
			// Save visualization state
			memberVectorsForViz: [...memberVectorsForViz],
			explainedVariance: [...explainedVariance],
			userVectorHistory: userVectorHistory.map((v) => [...v]),
			xDimension,
			yDimension
		};
		clusterResults = [...clusterResults, newResult];

		// Move to next cluster or show results
		if (currentClusterIndex < clusterLabelsToProcess.length - 1) {
			currentClusterIndex++;
			phase = 'cluster-results';
		} else {
			calculateGlobalScores();
			phase = 'global-results';
		}
	}

	/**
	 * Continue to next cluster
	 */
	async function continueToNextCluster() {
		const nextLabel = clusterLabelsToProcess[currentClusterIndex];
		await startClusterSessionWithSavedVector(nextLabel);
	}

	/**
	 * Calculate global weighted scores
	 */
	function calculateGlobalScores() {
		// Collect all member IDs
		const allMemberIds = new Set<number>();
		for (const result of clusterResults) {
			for (const match of result.matches) {
				allMemberIds.add(match.memberId);
			}
		}

		// Calculate total weight
		const totalWeight = clusterResults.reduce((sum, r) => sum + r.importance, 0);

		// Calculate weighted scores for each member
		const memberScores: GlobalMemberScore[] = [];

		for (const memberId of allMemberIds) {
			let weightedSum = 0;
			const clusterScores: Record<number, number> = {};
			let memberName = '';
			let memberGroup: string | null = null;

			for (const result of clusterResults) {
				const match = result.matches.find((m) => m.memberId === memberId);
				if (match) {
					const similarity = match.similarity;
					clusterScores[result.clusterLabel] = similarity;
					weightedSum += (result.importance / totalWeight) * similarity;
					memberName = match.name;
					memberGroup = match.group;
				} else {
					clusterScores[result.clusterLabel] = 0;
				}
			}

			if (memberName) {
				memberScores.push({
					memberId,
					name: memberName,
					group: memberGroup,
					globalScore: weightedSum,
					clusterScores
				});
			}
		}

		// Sort by global score
		globalScores = memberScores.sort((a, b) => b.globalScore - a.globalScore);
	}

	/**
	 * Reset and start over
	 */
	function reset() {
		phase = 'setup';
		sessionId = null;
		currentQuestion = null;
		answeredCount = 0;
		topMatches = [];
		uncertainty = [];
		userVector = [];
		clusterResults = [];
		globalScores = [];
		currentClusterIndex = 0;
		clusterLabelsToProcess = [];
		clusterLabelNameMap = {};
		error = null;
		// Reset visualization state
		memberVectorsForViz = [];
		explainedVariance = [];
		userVectorHistory = [];
		xDimension = 0;
		yDimension = 1;
	}

	/**
	 * Format similarity as percentage
	 */
	function formatSimilarity(sim: number): string {
		return (sim * 100).toFixed(1) + '%';
	}

	/**
	 * Get color for similarity score
	 */
	function getSimilarityColor(sim: number): string {
		if (sim >= 0.8) return 'text-green-600';
		if (sim >= 0.6) return 'text-blue-600';
		if (sim >= 0.4) return 'text-yellow-600';
		return 'text-red-600';
	}

	/**
	 * Get star rating display
	 */
	function getStars(count: number): string {
		return '★'.repeat(count) + '☆'.repeat(5 - count);
	}

	// Trigger animations on mount
	onMount(() => {
		setTimeout(() => {
			mounted = true;
		}, 100);
	});
</script>

<svelte:head>
	<title>議員マッチング | Candidate Match</title>
</svelte:head>

<div class="page" class:mounted>
	<!-- Hero Section (shown only in setup) -->
	{#if phase === 'setup'}
		<section class="hero">
			<div class="hero-badge animate-in" style="--delay: 0">🗳️ AI議員マッチング</div>
			<h1 class="hero-title animate-in" style="--delay: 1">
				<span class="gradient-text">マッチング診断</span>を<br />
				開始しましょう
			</h1>
			<p class="hero-subtitle animate-in" style="--delay: 2">
				保存済みのベクトル設定を選択し、各分野（クラスター）ごとに法案への賛否を答えることで、あなたの政治的立場と議員との総合マッチ度を算出します。
			</p>
		</section>
	{:else}
		<!-- Compact Header for other phases -->
		<header class="compact-header">
			<div class="container">
				<h1 class="compact-title">🗳️ 議員マッチング</h1>
			</div>
		</header>
	{/if}

	<main class="main-container">
		{#if error}
			<div class="error-alert animate-in">
				<div class="error-icon">⚠️</div>
				<div>
					<span class="error-title">エラー</span>
					<p class="error-message">{error}</p>
				</div>
			</div>
		{/if}

		<!-- Progress bar for multi-cluster -->
		{#if phase !== 'setup' && phase !== 'global-results'}
			<div class="progress-card animate-in">
				<div class="progress-header">
					<span class="progress-cluster-name">
						{currentClusterDisplayName || `クラスター${currentClusterIndex + 1}`}
					</span>
					<span class="progress-count">
						分野 {currentClusterIndex + 1}/{clusterLabelsToProcess.length}
					</span>
				</div>
				<div class="progress-bar-container">
					<div class="progress-bar" style="width: {progress}%"></div>
				</div>

				<!-- Cluster chips -->
				<div class="cluster-chips">
					{#each clusterLabelsToProcess as label, idx (label)}
						{@const displayName = getClusterDisplayName(label)}
						<span
							class="cluster-chip"
							class:completed={idx < currentClusterIndex}
							class:active={idx === currentClusterIndex}
							class:pending={idx > currentClusterIndex}
						>
							{#if idx < currentClusterIndex}
								<span class="chip-icon">✓</span>
							{:else if idx === currentClusterIndex}
								<span class="chip-icon">▶</span>
							{/if}
							{displayName}
						</span>
					{/each}
				</div>
			</div>
		{/if}

		{#if phase === 'setup'}
			<SetupPhase
				{groupedSavedVectors}
				bind:selectedSavedVectorKey
				{selectedGroupedVector}
				{isLoading}
				onStart={startWithSavedVector}
			/>
		{:else if phase === 'questioning'}
			<QuestioningPhase
				{currentClusterDisplayName}
				{answeredCount}
				{currentClusterBillCount}
				{confidence}
				{currentQuestion}
				{isLoading}
				{topMatches}
				{memberVectorsForViz}
				bind:showVisualization
				{explainedVariance}
				bind:xDimension
				bind:yDimension
				{userVector}
				{userVectorHistory}
				{highlightedMembersForViz}
				onSubmitAnswer={submitAnswer}
				onSkipQuestion={skipQuestion}
				onFinishCluster={finishCurrentCluster}
				onToggleVisualization={(show) => (showVisualization = show)}
			/>
		{:else if phase === 'rating' || phase === 'cluster-results'}
			<!-- Cluster Review Phase (Rating + Results between clusters) -->
			<ClusterReviewPhase
				showRating={phase === 'rating'}
				{currentClusterDisplayName}
				{currentClusterMatches}
				bind:pendingImportance
				{currentClusterIndex}
				totalClusters={clusterLabelsToProcess.length}
				showResults={phase === 'cluster-results'}
				lastCompletedResult={clusterResults[clusterResults.length - 1] || null}
				nextClusterName={getClusterDisplayName(clusterLabelsToProcess[currentClusterIndex])}
				allCompletedResults={clusterResults}
				{isLoading}
				onSetImportance={(importance) => (pendingImportance = importance)}
				onSaveAndContinue={saveImportanceAndContinue}
				onContinueToNext={continueToNextCluster}
			/>
		{:else if phase === 'global-results'}
			<!-- Global Results Phase -->
			<GlobalResultsPhase {clusterResults} {globalScores} onReset={reset} />
		{/if}
	</main>
</div>

<style>
	/* ===== KEYFRAME ANIMATIONS ===== */
	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(30px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.05);
		}
	}

	@keyframes gradientShift {
		0% {
			background-position: 0% 50%;
		}
		50% {
			background-position: 100% 50%;
		}
		100% {
			background-position: 0% 50%;
		}
	}

	@keyframes shimmer {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(100%);
		}
	}

	/* ===== BASE STYLES ===== */
	:global(body) {
		background-color: #fafbfc;
	}

	.page {
		min-height: 100vh;
		background: #fafbfc;
	}

	.animate-in {
		opacity: 0;
		transform: translateY(30px);
	}

	.page.mounted .animate-in {
		animation: fadeInUp 0.8s ease forwards;
		animation-delay: calc(var(--delay, 0) * 0.15s);
	}

	/* ===== HERO SECTION ===== */
	.hero {
		text-align: center;
		padding: 4rem 2rem 3rem;
		max-width: 900px;
		margin: 0 auto;
	}

	.hero-badge {
		display: inline-block;
		background: linear-gradient(135deg, #eef2ff, #e0e7ff);
		color: #4f46e5;
		padding: 0.5rem 1.25rem;
		border-radius: 100px;
		font-size: 0.9rem;
		font-weight: 600;
		margin-bottom: 1.5rem;
	}

	.hero-title {
		font-size: clamp(2rem, 5vw, 3.5rem);
		font-weight: 800;
		line-height: 1.15;
		color: #1a1a2e;
		margin-bottom: 1.5rem;
		letter-spacing: -0.02em;
	}

	.gradient-text {
		background: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%);
		background-size: 200% 200%;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		animation: gradientShift 4s ease infinite;
	}

	.hero-subtitle {
		font-size: 1.1rem;
		color: #64748b;
		line-height: 1.7;
		max-width: 600px;
		margin: 0 auto 2rem;
	}

	/* ===== COMPACT HEADER ===== */
	.compact-header {
		background: white;
		border-bottom: 1px solid #e5e7eb;
		padding: 1rem 0;
		position: sticky;
		top: 0;
		z-index: 50;
		backdrop-filter: blur(10px);
		background: rgba(255, 255, 255, 0.95);
	}

	.compact-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1a1a2e;
	}

	.container {
		max-width: 1024px;
		margin: 0 auto;
		padding: 0 1rem;
	}

	/* ===== MAIN LAYOUT ===== */
	.main-container {
		max-width: 64rem;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	/* ===== ERROR ALERT ===== */
	.error-alert {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		background: linear-gradient(135deg, #fee2e2, #fecaca);
		border: 1px solid #fca5a5;
		border-radius: 12px;
		padding: 1rem 1.5rem;
		margin-bottom: 1.5rem;
		box-shadow: 0 4px 12px rgba(239, 68, 68, 0.1);
	}

	.error-icon {
		font-size: 1.5rem;
		line-height: 1;
	}

	.error-title {
		display: block;
		font-weight: 700;
		color: #991b1b;
		margin-bottom: 0.25rem;
	}

	.error-message {
		color: #7f1d1d;
		font-size: 0.95rem;
		line-height: 1.5;
	}

	/* ===== PROGRESS CARD ===== */
	.progress-card {
		background: white;
		border-radius: 16px;
		padding: 1.5rem;
		margin-bottom: 2rem;
		box-shadow:
			0 4px 6px rgba(0, 0, 0, 0.05),
			0 10px 20px rgba(0, 0, 0, 0.05);
		border: 1px solid #e5e7eb;
	}

	.progress-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}

	.progress-cluster-name {
		font-size: 1rem;
		font-weight: 700;
		color: #6366f1;
	}

	.progress-count {
		font-size: 0.9rem;
		color: #64748b;
		font-weight: 600;
	}

	.progress-bar-container {
		height: 8px;
		background: #e5e7eb;
		border-radius: 100px;
		overflow: hidden;
		margin-bottom: 1rem;
		position: relative;
	}

	.progress-bar {
		height: 100%;
		background: linear-gradient(90deg, #6366f1 0%, #a855f7 100%);
		border-radius: 100px;
		transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
		overflow: hidden;
	}

	.progress-bar::after {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;
		right: 0;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
		animation: shimmer 2s infinite;
	}

	/* ===== CLUSTER CHIPS ===== */
	.cluster-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.cluster-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem 0.75rem;
		border-radius: 100px;
		font-size: 0.85rem;
		font-weight: 600;
		transition: all 0.3s ease;
	}

	.cluster-chip.completed {
		background: linear-gradient(135deg, #d1fae5, #a7f3d0);
		color: #065f46;
	}

	.cluster-chip.active {
		background: linear-gradient(135deg, #ddd6fe, #c4b5fd);
		color: #5b21b6;
		animation: pulse 2s ease-in-out infinite;
	}

	.cluster-chip.pending {
		background: #f3f4f6;
		color: #6b7280;
	}

	.chip-icon {
		font-size: 0.75rem;
	}

	/* ===== RESPONSIVE ===== */
	@media (max-width: 768px) {
		.hero {
			padding: 3rem 1.5rem 2rem;
		}

		.hero-title {
			font-size: 2rem;
		}

		.cluster-chips {
			justify-content: center;
		}
	}

	/* Reduce animations for users who prefer reduced motion */
	@media (prefers-reduced-motion: reduce) {
		*,
		*::before,
		*::after {
			animation-duration: 0.01ms !important;
			animation-iteration-count: 1 !important;
			transition-duration: 0.01ms !important;
		}
	}
</style>
