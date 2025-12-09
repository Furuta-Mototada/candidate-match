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
	let showExplanationModal: boolean = $state(false);

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
	async function saveImportanceAndContinue() {
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
			await startClusterSessionWithSavedVector(clusterLabelsToProcess[currentClusterIndex]);
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
			<div class="progress-section animate-in">
				<div class="progress-header">
					<div class="progress-info">
						<span class="progress-cluster-name">
							{currentClusterDisplayName || `クラスター${currentClusterIndex + 1}`}
						</span>
						<span class="progress-count">
							分野 {currentClusterIndex + 1}/{clusterLabelsToProcess.length}
						</span>
					</div>

					{#if phase === 'questioning'}
						<div class="progress-stats">
							<span class="stat-item">
								<span class="stat-label">回答数:</span>
								<span class="stat-value">{answeredCount}/{currentClusterBillCount}</span>
							</span>
							<span class="stat-divider">|</span>
							<span class="stat-item">
								<span class="stat-label">信頼度:</span>
								<span class="stat-value">{confidence.toFixed(0)}%</span>
							</span>
						</div>
					{/if}
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
		{:else if phase === 'rating'}
			<!-- Cluster Review Phase (Rating + Results) -->
			<ClusterReviewPhase
				{currentClusterDisplayName}
				{currentClusterMatches}
				bind:pendingImportance
				{currentClusterIndex}
				totalClusters={clusterLabelsToProcess.length}
				{isLoading}
				{memberVectorsForViz}
				{explainedVariance}
				bind:xDimension
				bind:yDimension
				{userVector}
				{userVectorHistory}
				onSetImportance={(importance) => (pendingImportance = importance)}
				onSaveAndContinue={saveImportanceAndContinue}
			/>
		{:else if phase === 'global-results'}
			<!-- Global Results Phase -->
			<GlobalResultsPhase {clusterResults} {globalScores} onReset={reset} />
		{/if}
	</main>

	<!-- Floating Help Button -->
	<button
		class="floating-help-btn"
		onclick={() => (showExplanationModal = true)}
		aria-label="マッチングの仕組みを見る"
	>
		<span class="help-icon">?</span>
		<span class="help-text">仕組み</span>
	</button>

	<!-- Explanation Modal -->
	{#if showExplanationModal}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="modal-overlay" onclick={() => (showExplanationModal = false)}>
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="modal-container" onclick={(e) => e.stopPropagation()} role="document">
				<button class="modal-close-btn" onclick={() => (showExplanationModal = false)}>×</button>

				<div class="explanation-content-modal">
					<div class="explanation-intro">
						<h3>🎯 どうやってマッチングしているの？</h3>
						<p>
							このマッチングシステムは、<strong>適応型質問選択</strong>と<strong>ベイズ推定</strong>
							を組み合わせた手法で、あなたの政治的立場を効率的に推定します。
						</p>
					</div>

					<div class="explanation-diagram">
						<div class="diagram-step">
							<div class="step-number">1</div>
							<div class="step-content">
								<div class="step-title">分野（クラスター）選択</div>
								<div class="step-visual cluster-visual">
									<div class="cluster-box">経済政策</div>
									<div class="cluster-box">外交・安全保障</div>
									<div class="cluster-box">社会保障</div>
									<div class="cluster-box">環境・エネルギー</div>
								</div>
								<div class="step-desc">複数の政策分野ごとに質問に回答</div>
							</div>
						</div>

						<div class="diagram-arrow-down">↓</div>

						<div class="diagram-step">
							<div class="step-number">2</div>
							<div class="step-content">
								<div class="step-title">適応型質問選択</div>
								<div class="step-visual question-visual">
									<div class="question-item">
										<div class="q-label">質問1</div>
										<div class="q-desc">不確実性が最も高い次元を特定</div>
									</div>
									<div class="question-item">
										<div class="q-label">質問2</div>
										<div class="q-desc">前の回答に基づいて次の質問を選択</div>
									</div>
									<div class="question-item">
										<div class="q-label">質問3</div>
										<div class="q-desc">確信度が閾値を超えるまで繰り返す</div>
									</div>
								</div>
								<div class="step-desc">最も情報価値の高い法案を優先的に質問</div>
							</div>
						</div>

						<div class="diagram-arrow-down">↓</div>

						<div class="diagram-step">
							<div class="step-number">3</div>
							<div class="step-content">
								<div class="step-title">立場の推定</div>
								<div class="step-visual vector-visual">
									<div class="vector-space">
										<div class="vector-point user">あなた</div>
										<div class="vector-point member-1">議員A</div>
										<div class="vector-point member-2">議員B</div>
										<div class="vector-point member-3">議員C</div>
									</div>
								</div>
								<div class="step-desc">回答から多次元空間での立ち位置を計算</div>
							</div>
						</div>

						<div class="diagram-arrow-down">↓</div>

						<div class="diagram-step">
							<div class="step-number">4</div>
							<div class="step-content">
								<div class="step-title">分野別重要度設定</div>
								<div class="step-visual importance-visual">
									<div class="importance-bar">
										<span>経済政策</span>
										<div class="bar-fill" style="width: 80%">★★★★★</div>
									</div>
									<div class="importance-bar">
										<span>外交</span>
										<div class="bar-fill" style="width: 60%">★★★</div>
									</div>
									<div class="importance-bar">
										<span>社会保障</span>
										<div class="bar-fill" style="width: 40%">★★</div>
									</div>
								</div>
								<div class="step-desc">各分野の重要度を5段階で評価</div>
							</div>
						</div>

						<div class="diagram-arrow-down">↓</div>

						<div class="diagram-step">
							<div class="step-number">5</div>
							<div class="step-content">
								<div class="step-title">総合マッチ度算出</div>
								<div class="step-visual result-visual">
									<div class="result-card top">
										<span class="rank">1位</span>
										<span class="name">山田太郎</span>
										<span class="score">92.5%</span>
									</div>
									<div class="result-card">
										<span class="rank">2位</span>
										<span class="name">佐藤花子</span>
										<span class="score">87.3%</span>
									</div>
								</div>
								<div class="step-desc">分野別マッチ度 × 重要度の加重平均で算出</div>
							</div>
						</div>
					</div>

					<div class="explanation-details">
						<div class="detail-card">
							<h4>🧠 適応型質問選択とは？</h4>
							<p>
								あなたの立場を最も効率的に推定するため、<strong>不確実性が高い次元</strong
								>に関連する法案を優先的に質問します。
							</p>
							<ul>
								<li>
									<strong>不確実性の計算</strong>：各次元での確信度を測定し、最も不確実な次元を特定
								</li>
								<li>
									<strong>情報価値の最大化</strong
									>：その次元に関連する法案（因子負荷量が高い法案）を選択
								</li>
								<li>
									<strong>早期終了</strong>：すべての次元で十分な確信度が得られたら質問を終了
								</li>
							</ul>
							<p class="detail-note">
								💡 これにより、ランダムな質問よりも少ない回答数で正確な推定が可能になります。
							</p>
						</div>

						<div class="detail-card">
							<h4>📐 コサイン類似度によるマッチング</h4>
							<p>
								推定されたあなたのベクトルと各議員のベクトルの<strong>コサイン類似度</strong
								>を計算してマッチ度を算出します。
							</p>
							<ul>
								<li>
									<span class="value-positive">1.0（100%）</span>：完全に一致
								</li>
								<li><strong>0.0</strong>：無関係</li>
								<li><span class="value-negative">-1.0</span>：完全に対立</li>
							</ul>
							<p class="detail-note">
								💡
								ベクトルの「方向」が似ているかを見るため、投票パターンの傾向が一致するかを測れます。
							</p>
						</div>

						<div class="detail-card">
							<h4>⚖️ 分野別重要度の反映</h4>
							<p>
								各分野でのマッチ度を、あなたが設定した<strong>重要度</strong
								>で重み付けして総合スコアを計算します。
							</p>
							<div class="formula-box">
								<code> 総合スコア = Σ (分野iのマッチ度 × 重要度i) / Σ 重要度i </code>
							</div>
							<p class="detail-note">
								💡 あなたが重視する分野でのマッチ度が、総合スコアに大きく影響します。
							</p>
						</div>

						<div class="detail-card">
							<h4>🔍 なぜ分野別に質問するの？</h4>
							<p>政治的立場は一つの軸では表現できないため、複数の分野に分けて評価します。</p>
							<ul>
								<li>
									<strong>多面的な評価</strong
									>：経済、外交、社会保障など、分野ごとに異なる立場を持つことができる
								</li>
								<li>
									<strong>クラスタリング</strong
									>：似た性質の法案をグループ化することで、効率的に質問できる
								</li>
								<li>
									<strong>柔軟な重み付け</strong>：あなたが重視する分野を反映した結果が得られる
								</li>
							</ul>
						</div>

						<div class="detail-card">
							<h4>🎨 2D可視化について</h4>
							<p>質問中に表示される散布図は、多次元空間を2次元に圧縮して表示しています。</p>
							<ul>
								<li>
									<strong>あなたの位置</strong>：回答するごとに更新され、軌跡が表示されます
								</li>
								<li>
									<strong>議員の位置</strong>：実際の投票記録から計算されたベクトルを2D投影
								</li>
								<li>
									<strong>距離</strong>：近い位置にいる議員ほど、あなたと投票パターンが似ています
								</li>
							</ul>
							<p class="detail-note">
								💡 2次元表示は簡略化されたものです。実際のマッチング計算は全次元を使用しています。
							</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}
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

	/* ===== PROGRESS SECTION ===== */
	.progress-section {
		margin-bottom: 2rem;
		max-width: 800px;
		margin-left: auto;
		margin-right: auto;
	}

	.progress-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.progress-info {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	.progress-cluster-name {
		font-size: 1.125rem;
		font-weight: 700;
		color: #1f2937;
	}

	.progress-count {
		font-size: 0.875rem;
		color: #6b7280;
		font-weight: 500;
	}

	.progress-stats {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.875rem;
	}

	.stat-item {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.stat-label {
		color: #6b7280;
	}

	.stat-value {
		font-weight: 600;
		color: #4b5563;
		font-variant-numeric: tabular-nums;
	}

	.stat-divider {
		color: #e5e7eb;
	}

	.progress-bar-container {
		height: 6px;
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

	/* ===== FLOATING HELP BUTTON ===== */
	.floating-help-btn {
		position: fixed;
		bottom: 2rem;
		right: 2rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem;
		background: #6366f1;
		color: white;
		border-radius: 100px;
		border: none;
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
		cursor: pointer;
		z-index: 100;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		font-weight: 600;
	}

	.floating-help-btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 6px 16px rgba(99, 102, 241, 0.5);
		background: #4f46e5;
	}

	.help-icon {
		font-size: 1.25rem;
		font-weight: 700;
	}

	/* ===== MODAL ===== */
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		animation: fadeIn 0.2s ease-out;
	}

	.modal-container {
		background: white;
		width: 100%;
		max-width: 900px;
		max-height: 90vh;
		border-radius: 16px;
		box-shadow:
			0 20px 25px -5px rgba(0, 0, 0, 0.1),
			0 10px 10px -5px rgba(0, 0, 0, 0.04);
		position: relative;
		overflow-y: auto;
		animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.modal-close-btn {
		position: absolute;
		top: 1rem;
		right: 1rem;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: #f3f4f6;
		border: none;
		color: #4b5563;
		font-size: 1.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.2s;
		z-index: 10;
	}

	.modal-close-btn:hover {
		background: #e5e7eb;
		color: #1f2937;
	}

	.explanation-content-modal {
		padding: 2rem;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes scaleIn {
		from {
			transform: scale(0.95);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}

	.explanation-intro {
		margin-bottom: 3rem;
	}

	.explanation-intro h3 {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 1rem;
	}

	.explanation-intro p {
		font-size: 1.05rem;
		color: #4b5563;
		line-height: 1.7;
	}

	.explanation-diagram {
		margin: 3rem 0;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.diagram-step {
		display: flex;
		gap: 1.5rem;
		align-items: flex-start;
	}

	.step-number {
		flex-shrink: 0;
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border-radius: 50%;
		font-weight: 700;
		font-size: 1.25rem;
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
	}

	.step-content {
		flex: 1;
	}

	.step-title {
		font-size: 1.125rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 1rem;
	}

	.step-visual {
		margin: 1rem 0;
		padding: 1.5rem;
		background: #f9fafb;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
	}

	.step-desc {
		font-size: 0.95rem;
		color: #6b7280;
		margin-top: 0.75rem;
		font-style: italic;
	}

	.diagram-arrow-down {
		text-align: center;
		font-size: 2rem;
		color: #6366f1;
		margin: 0.5rem 0;
	}

	/* Cluster Visual */
	.cluster-visual {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.75rem;
	}

	.cluster-box {
		padding: 0.75rem 1rem;
		background: linear-gradient(135deg, #ddd6fe, #e9d5ff);
		border-radius: 8px;
		text-align: center;
		font-weight: 600;
		font-size: 0.9rem;
		color: #5b21b6;
		border: 1px solid #c4b5fd;
	}

	/* Question Visual */
	.question-visual {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.question-item {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1rem;
		background: white;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
	}

	.q-label {
		flex-shrink: 0;
		padding: 0.25rem 0.75rem;
		background: #6366f1;
		color: white;
		border-radius: 6px;
		font-weight: 600;
		font-size: 0.875rem;
	}

	.q-desc {
		font-size: 0.9rem;
		color: #4b5563;
	}

	/* Vector Visual */
	.vector-visual {
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.vector-space {
		position: relative;
		width: 100%;
		height: 200px;
		background: linear-gradient(135deg, #ede9fe 0%, #fae8ff 100%);
		border-radius: 8px;
		border: 2px solid #c4b5fd;
	}

	.vector-point {
		position: absolute;
		padding: 0.5rem 1rem;
		background: white;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.875rem;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		border: 2px solid #e5e7eb;
	}

	.vector-point.user {
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		background: linear-gradient(135deg, #fef3c7, #fde68a);
		border-color: #f59e0b;
		color: #92400e;
	}

	.vector-point.member-1 {
		top: 20%;
		left: 25%;
	}

	.vector-point.member-2 {
		top: 65%;
		left: 70%;
	}

	.vector-point.member-3 {
		top: 30%;
		right: 20%;
	}

	/* Importance Visual */
	.importance-visual {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.importance-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.importance-bar > span:first-child {
		flex-shrink: 0;
		width: 120px;
		font-weight: 600;
		font-size: 0.9rem;
		color: #1f2937;
	}

	.bar-fill {
		flex: 1;
		height: 32px;
		background: linear-gradient(90deg, #fbbf24, #f59e0b);
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-weight: 600;
		font-size: 0.9rem;
		box-shadow: 0 2px 6px rgba(245, 158, 11, 0.3);
		transition: width 0.3s ease;
	}

	/* Result Visual */
	.result-visual {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.result-card {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 1rem 1.25rem;
		background: white;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
	}

	.result-card.top {
		background: linear-gradient(135deg, #fef3c7, #fde68a);
		border-color: #fbbf24;
	}

	.result-card .rank {
		flex-shrink: 0;
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #6366f1;
		color: white;
		border-radius: 50%;
		font-weight: 700;
		font-size: 0.875rem;
	}

	.result-card.top .rank {
		background: linear-gradient(135deg, #f59e0b, #d97706);
	}

	.result-card .name {
		flex: 1;
		font-weight: 600;
		font-size: 1rem;
		color: #1f2937;
	}

	.result-card .score {
		flex-shrink: 0;
		font-size: 1.25rem;
		font-weight: 700;
		color: #6366f1;
	}

	.result-card.top .score {
		color: #d97706;
	}

	/* Explanation Details */
	.explanation-details {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1.5rem;
		margin-top: 3rem;
	}

	.detail-card {
		padding: 1.5rem;
		background: white;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
	}

	.detail-card h4 {
		font-size: 1.125rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 1rem;
	}

	.detail-card p {
		font-size: 0.95rem;
		color: #4b5563;
		line-height: 1.6;
		margin-bottom: 1rem;
	}

	.detail-card ul {
		list-style: none;
		padding: 0;
		margin: 1rem 0;
	}

	.detail-card ul li {
		padding: 0.5rem 0;
		padding-left: 1.5rem;
		position: relative;
		font-size: 0.95rem;
		color: #4b5563;
		line-height: 1.6;
	}

	.detail-card ul li::before {
		content: '•';
		position: absolute;
		left: 0.5rem;
		color: #6366f1;
		font-weight: 700;
	}

	.detail-note {
		margin-top: 1rem;
		padding: 1rem;
		background: linear-gradient(135deg, #fef3c7, #fef9e7);
		border-left: 4px solid #f59e0b;
		border-radius: 6px;
		font-size: 0.9rem;
		color: #92400e;
		line-height: 1.6;
	}

	.value-positive {
		color: #059669;
		font-weight: 700;
	}

	.value-negative {
		color: #dc2626;
		font-weight: 700;
	}

	.formula-box {
		margin: 1rem 0;
		padding: 1rem;
		background: #1f2937;
		border-radius: 8px;
		overflow-x: auto;
	}

	.formula-box code {
		color: #10b981;
		font-family: 'Monaco', 'Courier New', monospace;
		font-size: 0.9rem;
		white-space: nowrap;
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
