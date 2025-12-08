<script lang="ts">
	import type { PageData } from './$types';

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
		key: string; // "name|clusterId" for grouping
		name: string;
		clusterId: number;
		nComponents: number;
		dimensions: number;
		clusterCount: number;
		totalMembers: number;
		totalBills: number;
		vectors: SavedVectorInfo[]; // All cluster labels in this group
		createdAt: string;
	}

	interface NextQuestion {
		billId: number;
		title: string;
		description: string | null;
		passed: boolean;
		reason: string;
		dimensionTarget: number;
	}

	interface MemberMatch {
		memberId: number;
		name: string;
		group: string | null;
		similarity: number;
		rank: number;
		latentVector?: number[];
	}

	interface ClusterResult {
		clusterLabel: number;
		matches: MemberMatch[];
		answeredCount: number;
		importance: number; // 1-5 stars
		userVector: number[];
	}

	interface GlobalMemberScore {
		memberId: number;
		name: string;
		group: string | null;
		globalScore: number;
		clusterScores: Record<number, number>; // clusterLabel -> similarity
	}

	type MatchingPhase = 'setup' | 'questioning' | 'rating' | 'cluster-results' | 'global-results';

	let { data }: { data: PageData } = $props();

	// State
	let savedVectors: SavedVectorInfo[] = $state(data.savedVectors || []);
	let selectedSavedVectorKey: string | null = $state(null);

	let phase: MatchingPhase = $state('setup');
	let isLoading: boolean = $state(false);
	let error: string | null = $state(null);

	// Multi-cluster state
	let clusterLabelsToProcess: number[] = $state([]);
	let currentClusterIndex: number = $state(0);
	let clusterResults: ClusterResult[] = $state([]);
	let globalScores: GlobalMemberScore[] = $state([]);

	// Current cluster session
	let sessionId: string | null = $state(null);
	let currentQuestion: NextQuestion | null = $state(null);
	let answeredCount: number = $state(0);
	let topMatches: MemberMatch[] = $state([]);
	let uncertainty: number[] = $state([]);
	let userVector: number[] = $state([]);
	let currentClusterMatches: MemberMatch[] = $state([]);

	// Rating state
	let pendingImportance: number = $state(3);

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
	let progress = $derived.by(() => {
		if (clusterLabelsToProcess.length === 0) return 0;
		return (currentClusterIndex / clusterLabelsToProcess.length) * 100;
	});
	let confidence = $derived.by(() => {
		if (uncertainty.length === 0) return 0;
		const avgUncertainty = uncertainty.reduce((a, b) => a + b, 0) / uncertainty.length;
		return Math.max(0, Math.min(100, (1 - avgUncertainty) * 100));
	});

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
			topMatches = [];
			uncertainty = result.uncertainty || [];
			userVector = result.userVector || [];
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
			matches: currentClusterMatches,
			answeredCount: answeredCount,
			importance: pendingImportance,
			userVector: [...userVector]
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
		error = null;
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
</script>

<svelte:head>
	<title>議員マッチング | Candidate Match</title>
</svelte:head>

<main class="container mx-auto max-w-4xl px-4 py-8">
	<h1 class="mb-2 text-3xl font-bold text-gray-800">🗳️ あなたに合う議員を見つけよう</h1>
	<p class="mb-8 text-gray-600">
		各分野（クラスター）ごとに法案への賛否を答え、分野ごとの重要度を設定することで総合マッチ度を算出します。
	</p>

	{#if error}
		<div class="mb-6 rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
			<span class="font-bold">エラー:</span>
			{error}
		</div>
	{/if}

	<!-- Progress bar for multi-cluster -->
	{#if phase !== 'setup' && phase !== 'global-results'}
		<div class="mb-6 rounded-lg bg-white p-4 shadow">
			<div class="mb-2 flex items-center justify-between">
				<span class="text-sm text-gray-600">
					クラスター {currentClusterIndex + 1} / {clusterLabelsToProcess.length}
				</span>
				<span class="text-sm text-gray-600">
					完了: {clusterResults.length} クラスター
				</span>
			</div>
			<div class="h-2 w-full rounded-full bg-gray-200">
				<div
					class="h-2 rounded-full bg-purple-600 transition-all duration-300"
					style="width: {progress}%"
				></div>
			</div>
		</div>
	{/if}

	{#if phase === 'setup'}
		<!-- Setup Phase -->
		<div class="rounded-lg bg-white p-6 shadow-lg">
			<h2 class="mb-4 text-xl font-semibold">マッチング設定</h2>

			<div class="space-y-6">
				<!-- Saved Vectors Section -->
				{#if groupedSavedVectors.length > 0}
					<div>
						<label for="savedVector" class="mb-2 block text-sm font-medium text-gray-700">
							💾 保存済みベクトル設定を選択
						</label>
						<p class="mb-3 text-sm text-gray-500">
							メンバーベクトルページで計算・保存された設定を使用してマッチングを行います。
						</p>
						<select
							id="savedVector"
							class="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-green-500 focus:ring-2 focus:ring-green-500"
							bind:value={selectedSavedVectorKey}
							disabled={isLoading}
						>
							<option value={null}>-- 保存済み設定を選択 --</option>
							{#each groupedSavedVectors as group (group.key)}
								<option value={group.key}>
									{group.name} ({group.clusterCount}クラスター, {group.dimensions}D, {group.totalMembers}議員,
									{group.totalBills}法案)
								</option>
							{/each}
						</select>

						{#if selectedGroupedVector}
							<div class="mt-4 rounded-lg bg-gray-50 p-4">
								<h3 class="mb-2 text-sm font-medium text-gray-700">
									選択中: {selectedGroupedVector.name}
								</h3>
								<div class="flex flex-wrap gap-2">
									{#each selectedGroupedVector.vectors.sort((a, b) => a.clusterLabel - b.clusterLabel) as v (v.id)}
										<span
											class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800"
										>
											クラスター{v.clusterLabel} ({v.billCount}法案)
										</span>
									{/each}
								</div>
							</div>

							<button
								onclick={startWithSavedVector}
								disabled={isLoading}
								class="mt-4 w-full rounded-lg bg-green-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-400"
							>
								{#if isLoading}
									<span class="mr-2 inline-block animate-spin">⏳</span>
									準備中...
								{:else}
									🚀 マッチング開始（{selectedGroupedVector.clusterCount}クラスター）
								{/if}
							</button>
						{/if}
					</div>
				{:else}
					<!-- No saved vectors available -->
					<div class="rounded-lg bg-yellow-50 p-6 text-center">
						<div class="mb-3 text-4xl">📊</div>
						<h3 class="mb-2 text-lg font-medium text-yellow-800">保存済みベクトルがありません</h3>
						<p class="mb-4 text-sm text-yellow-700">
							マッチングを行うには、まずメンバーベクトルページでベクトル分析を実行し、結果を保存してください。
						</p>
						<a
							href="/member-vectors"
							class="inline-block rounded-lg bg-yellow-600 px-6 py-2 font-semibold text-white transition-colors hover:bg-yellow-700"
						>
							メンバーベクトルページへ →
						</a>
					</div>
				{/if}
			</div>
		</div>

		<!-- How it works -->
		<div class="mt-8 rounded-lg bg-gray-50 p-6">
			<h3 class="mb-3 text-lg font-semibold">📖 マッチングの仕組み</h3>
			<ul class="space-y-2 text-gray-700">
				<li><span class="font-medium">1.</span> 各クラスター（分野）ごとに法案への賛否を回答</li>
				<li><span class="font-medium">2.</span> 各クラスターの重要度を★1〜★5で評価</li>
				<li><span class="font-medium">3.</span> 分野ごとのマッチング結果と総合マッチ度を表示</li>
				<li><span class="font-medium">4.</span> 総合スコア = Σ(重要度 × 類似度) で算出</li>
			</ul>
		</div>
	{:else if phase === 'questioning'}
		<!-- Questioning Phase -->
		<div class="space-y-6">
			<div class="rounded-lg bg-purple-50 p-4">
				<h2 class="text-lg font-semibold text-purple-800">
					📂 クラスター {currentClusterLabel}
				</h2>
				<p class="text-sm text-purple-600">
					回答済み: {answeredCount}問 | 信頼度: {confidence.toFixed(0)}%
				</p>
			</div>

			{#if currentQuestion}
				<!-- Question Card -->
				<div class="rounded-lg bg-white p-6 shadow-lg">
					<div class="mb-4 flex items-start justify-between">
						<span
							class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
							class:bg-green-100={currentQuestion.passed}
							class:text-green-800={currentQuestion.passed}
							class:bg-yellow-100={!currentQuestion.passed}
							class:text-yellow-800={!currentQuestion.passed}
						>
							{currentQuestion.passed ? '成立' : '審議中/廃案'}
						</span>
					</div>

					<h2 class="mb-4 text-xl font-semibold text-gray-800">
						{currentQuestion.title}
					</h2>

					{#if currentQuestion.description}
						<p class="mb-6 text-sm leading-relaxed text-gray-600">
							{currentQuestion.description}
						</p>
					{/if}

					<!-- Vote Buttons -->
					<div class="grid grid-cols-3 gap-4">
						<button
							onclick={() => submitAnswer(1)}
							disabled={isLoading}
							class="flex flex-col items-center rounded-lg bg-green-500 px-6 py-4 font-semibold text-white transition-colors hover:bg-green-600 disabled:opacity-50"
						>
							<span class="mb-1 text-2xl">👍</span>
							<span>賛成</span>
						</button>
						<button
							onclick={() => submitAnswer(0)}
							disabled={isLoading}
							class="flex flex-col items-center rounded-lg bg-gray-400 px-6 py-4 font-semibold text-white transition-colors hover:bg-gray-500 disabled:opacity-50"
						>
							<span class="mb-1 text-2xl">🤔</span>
							<span>わからない</span>
						</button>
						<button
							onclick={() => submitAnswer(-1)}
							disabled={isLoading}
							class="flex flex-col items-center rounded-lg bg-red-500 px-6 py-4 font-semibold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
						>
							<span class="mb-1 text-2xl">👎</span>
							<span>反対</span>
						</button>
					</div>

					<!-- Skip / Actions -->
					<div class="mt-4 flex items-center justify-between">
						<button
							onclick={skipQuestion}
							disabled={isLoading}
							class="text-sm text-gray-500 hover:text-gray-700"
						>
							スキップ →
						</button>
						<button
							onclick={finishCurrentCluster}
							disabled={isLoading || answeredCount < 2}
							class="text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-400"
						>
							{answeredCount >= 2
								? 'このクラスターを終了'
								: `あと${2 - answeredCount}問回答してください`}
						</button>
					</div>
				</div>
			{:else}
				<div class="rounded-lg bg-white p-6 text-center shadow-lg">
					<p class="text-gray-600">このクラスターの質問が完了しました</p>
				</div>
			{/if}

			<!-- Top Matches Preview -->
			{#if topMatches.length > 0 && answeredCount >= 2}
				<div class="rounded-lg bg-white p-4 shadow">
					<h3 class="mb-3 text-sm font-medium text-gray-700">暫定マッチング</h3>
					<div class="space-y-2">
						{#each topMatches.slice(0, 3) as match (match.memberId)}
							<div class="flex items-center justify-between text-sm">
								<span class="font-medium">{match.name}</span>
								<span class={getSimilarityColor(match.similarity)}>
									{formatSimilarity(match.similarity)}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<button onclick={reset} class="text-sm text-gray-500 underline hover:text-gray-700">
				最初からやり直す
			</button>
		</div>
	{:else if phase === 'rating'}
		<!-- Importance Rating Phase -->
		<div class="space-y-6">
			<div class="rounded-lg bg-white p-6 shadow-lg">
				<h2 class="mb-4 text-xl font-semibold text-gray-800">
					📊 クラスター {currentClusterLabel} の重要度を設定
				</h2>
				<p class="mb-6 text-gray-600">この分野の法案はあなたにとってどれくらい重要ですか？</p>

				<!-- Star Rating -->
				<div class="mb-6 flex justify-center gap-2">
					{#each [1, 2, 3, 4, 5] as star (star)}
						<button
							onclick={() => (pendingImportance = star)}
							class="text-4xl transition-transform hover:scale-110"
							class:text-yellow-400={star <= pendingImportance}
							class:text-gray-300={star > pendingImportance}
						>
							★
						</button>
					{/each}
				</div>

				<p class="mb-6 text-center text-lg font-medium text-gray-700">
					{#if pendingImportance === 1}
						あまり重要ではない
					{:else if pendingImportance === 2}
						少し重要
					{:else if pendingImportance === 3}
						普通に重要
					{:else if pendingImportance === 4}
						かなり重要
					{:else}
						最も重要
					{/if}
				</p>

				<!-- Top matches preview -->
				<div class="mb-6 rounded-lg bg-gray-50 p-4">
					<h3 class="mb-2 text-sm font-medium text-gray-700">このクラスターでのトップ3</h3>
					{#each currentClusterMatches.slice(0, 3) as match, idx (match.memberId)}
						<div class="flex items-center justify-between py-1">
							<span class="text-sm">
								{idx + 1}. {match.name}
								{#if match.group}
									<span class="text-gray-500">({match.group})</span>
								{/if}
							</span>
							<span class="text-sm {getSimilarityColor(match.similarity)}">
								{formatSimilarity(match.similarity)}
							</span>
						</div>
					{/each}
				</div>

				<button
					onclick={saveImportanceAndContinue}
					class="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700"
				>
					{#if currentClusterIndex < clusterLabelsToProcess.length - 1}
						次のクラスターへ進む →
					{:else}
						総合結果を見る 🎉
					{/if}
				</button>
			</div>
		</div>
	{:else if phase === 'cluster-results'}
		<!-- Cluster Results Phase (between clusters) -->
		<div class="space-y-6">
			<div class="rounded-lg bg-white p-6 shadow-lg">
				<h2 class="mb-4 text-xl font-semibold text-gray-800">
					✅ クラスター {clusterResults[clusterResults.length - 1]?.clusterLabel} 完了
				</h2>

				<div class="mb-6 rounded-lg bg-gray-50 p-4">
					<div class="mb-2 flex items-center justify-between">
						<span class="text-gray-600">回答数</span>
						<span class="font-medium"
							>{clusterResults[clusterResults.length - 1]?.answeredCount}問</span
						>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-gray-600">重要度</span>
						<span class="font-medium text-yellow-500">
							{getStars(clusterResults[clusterResults.length - 1]?.importance || 0)}
						</span>
					</div>
				</div>

				<p class="mb-4 text-gray-600">
					次はクラスター {clusterLabelsToProcess[currentClusterIndex]} を分析します。
				</p>

				<button
					onclick={continueToNextCluster}
					disabled={isLoading}
					class="w-full rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-gray-400"
				>
					{#if isLoading}
						<span class="mr-2 inline-block animate-spin">⏳</span>
						読み込み中...
					{:else}
						クラスター {clusterLabelsToProcess[currentClusterIndex]} を開始 →
					{/if}
				</button>
			</div>

			<!-- Progress summary -->
			<div class="rounded-lg bg-white p-4 shadow">
				<h3 class="mb-3 text-sm font-medium text-gray-700">完了したクラスター</h3>
				<div class="space-y-2">
					{#each clusterResults as result (result.clusterLabel)}
						<div class="flex items-center justify-between text-sm">
							<span>クラスター {result.clusterLabel}</span>
							<span class="text-yellow-500">{getStars(result.importance)}</span>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{:else if phase === 'global-results'}
		<!-- Global Results Phase -->
		<div class="space-y-6">
			<div class="rounded-lg bg-white p-6 shadow-lg">
				<h2 class="mb-2 text-2xl font-bold text-gray-800">🎉 総合マッチング結果</h2>
				<p class="mb-4 text-gray-600">
					{clusterResults.length}つのクラスターの結果を重要度で加重平均しました。
				</p>

				<!-- Cluster importance summary -->
				<div class="mb-6 grid grid-cols-2 gap-2 md:grid-cols-4">
					{#each clusterResults as result (result.clusterLabel)}
						<div class="rounded bg-gray-50 p-2 text-center">
							<div class="text-xs text-gray-500">クラスター {result.clusterLabel}</div>
							<div class="text-sm text-yellow-500">{getStars(result.importance)}</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Global Top 10 -->
			<div class="rounded-lg bg-white p-6 shadow-lg">
				<h3 class="mb-4 text-xl font-semibold">🏆 総合マッチTOP10</h3>

				<div class="space-y-3">
					{#each globalScores.slice(0, 10) as member, idx (member.memberId)}
						<div
							class="rounded-lg p-4 transition-colors"
							class:bg-yellow-50={idx === 0}
							class:bg-gray-50={idx > 0}
						>
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-4">
									<div
										class="flex h-8 w-8 items-center justify-center rounded-full font-bold"
										class:bg-yellow-400={idx === 0}
										class:text-white={idx === 0}
										class:bg-gray-300={idx > 0}
										class:text-gray-700={idx > 0}
									>
										{idx + 1}
									</div>
									<div>
										<div class="font-semibold text-gray-800">{member.name}</div>
										{#if member.group}
											<div class="text-sm text-gray-500">{member.group}</div>
										{/if}
									</div>
								</div>
								<div class="text-right">
									<div class="text-lg font-bold {getSimilarityColor(member.globalScore)}">
										{formatSimilarity(member.globalScore)}
									</div>
									<div class="text-xs text-gray-500">総合スコア</div>
								</div>
							</div>

							<!-- Cluster breakdown -->
							<div class="mt-2 flex flex-wrap gap-1">
								{#each clusterResults as result (result.clusterLabel)}
									{@const score = member.clusterScores[result.clusterLabel] || 0}
									<span
										class="rounded px-1.5 py-0.5 text-xs"
										class:bg-green-100={score >= 0.6}
										class:text-green-800={score >= 0.6}
										class:bg-yellow-100={score >= 0.3 && score < 0.6}
										class:text-yellow-800={score >= 0.3 && score < 0.6}
										class:bg-red-100={score < 0.3}
										class:text-red-800={score < 0.3}
									>
										C{result.clusterLabel}: {(score * 100).toFixed(0)}%
									</span>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Per-cluster results -->
			<details class="rounded-lg bg-white p-4 shadow">
				<summary class="cursor-pointer text-sm font-medium text-gray-700">
					クラスター別の詳細結果
				</summary>
				<div class="mt-4 space-y-4">
					{#each clusterResults as result (result.clusterLabel)}
						<div class="border-t pt-4">
							<h4 class="mb-2 font-medium text-gray-800">
								クラスター {result.clusterLabel}
								<span class="ml-2 text-yellow-500">{getStars(result.importance)}</span>
							</h4>
							<div class="space-y-1">
								{#each result.matches.slice(0, 5) as match, idx (match.memberId)}
									<div class="flex justify-between text-sm">
										<span>{idx + 1}. {match.name}</span>
										<span class={getSimilarityColor(match.similarity)}>
											{formatSimilarity(match.similarity)}
										</span>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</details>

			<!-- All members table -->
			{#if globalScores.length > 10}
				<details class="rounded-lg bg-white p-4 shadow">
					<summary class="cursor-pointer text-sm font-medium text-gray-700">
						全議員の総合スコア ({globalScores.length}名)
					</summary>
					<div class="mt-4 max-h-96 overflow-y-auto">
						<table class="w-full text-sm">
							<thead class="sticky top-0 bg-gray-50">
								<tr>
									<th class="p-2 text-left">順位</th>
									<th class="p-2 text-left">氏名</th>
									<th class="p-2 text-left">所属</th>
									<th class="p-2 text-right">総合スコア</th>
								</tr>
							</thead>
							<tbody>
								{#each globalScores as member, idx (member.memberId)}
									<tr class="border-t hover:bg-gray-50">
										<td class="p-2">{idx + 1}</td>
										<td class="p-2 font-medium">{member.name}</td>
										<td class="p-2 text-gray-600">{member.group || '-'}</td>
										<td class="p-2 text-right {getSimilarityColor(member.globalScore)}">
											{formatSimilarity(member.globalScore)}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</details>
			{/if}

			<!-- Actions -->
			<div class="flex gap-4">
				<button
					onclick={reset}
					class="flex-1 rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700"
				>
					🔄 もう一度やり直す
				</button>
			</div>
		</div>
	{/if}
</main>

<style>
	:global(body) {
		background-color: #f7fafc;
	}
</style>
