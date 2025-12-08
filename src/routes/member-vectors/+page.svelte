<script lang="ts">
	import type { PageData } from './$types';

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
	}

	interface RepresentativeBill {
		billId: number;
		title: string;
		passed: boolean;
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

	let { data }: { data: PageData } = $props();

	let availableClusters: ClusterInfo[] = $state(data.clusters || []);
	let selectedClusterId: number | null = $state(null);
	let selectedClusterLabel: number | null = $state(null);
	let clusterLabels: ClusterLabel[] = $state([]);
	let isLoadingLabels: boolean = $state(false);
	let isCalculating: boolean = $state(false);
	let nComponents: number = $state(3);

	let calculationResult: Record<string, ClusterVectorResult> | null = $state<Record<
		string,
		ClusterVectorResult
	> | null>(null);
	let currentClusterData: ClusterVectorResult | null = $state<ClusterVectorResult | null>(null);

	let searchTerm: string = $state('');
	let sortBy: 'name' | 'dim0' | 'dim1' | 'dim2' = $state('name');
	let selectedMember: MemberWithVector | null = $state(null);
	let comparisonMember: MemberWithVector | null = $state(null);
	let similarMembers: Array<{ member: MemberWithVector; similarity: number }> = $state([]);
	let showSimilar: boolean = $state(false);

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
		} catch (error) {
			console.error('Failed to load cluster labels:', error);
			alert('Failed to load cluster labels');
		} finally {
			isLoadingLabels = false;
		}
	}

	async function calculateVectors() {
		if (!selectedClusterId) {
			alert('Please select a cluster');
			return;
		}

		isCalculating = true;

		try {
			const body: Record<string, unknown> = {
				clusterId: selectedClusterId,
				nComponents
			};

			if (selectedClusterLabel !== null) {
				body.clusterLabel = selectedClusterLabel;
			}

			const response = await fetch('/api/cluster-vectors', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			const result = await response.json();

			if (!result.success) {
				alert('Error: ' + result.error);
				return;
			}

			calculationResult = result.clusters;

			if (selectedClusterLabel !== null && calculationResult) {
				currentClusterData = calculationResult[String(selectedClusterLabel)] || null;
			} else if (calculationResult) {
				const labels = Object.keys(calculationResult);
				if (labels.length > 0) {
					currentClusterData = calculationResult[labels[0]];
					selectedClusterLabel = parseInt(labels[0]);
				}
			}
		} catch (error) {
			console.error('Failed to calculate vectors:', error);
			alert('Failed to calculate vectors');
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
	<section class="hero">
		<div class="hero-badge">📈 ベクトル分析</div>
		<h1 class="hero-title">クラスター別メンバーベクトル分析</h1>
		<p class="hero-subtitle">法案クラスターごとに議員の投票パターンを潜在空間で分析</p>
	</section>

	<section class="content-section">
		<div class="section-header">
			<h2>1. クラスタリング結果を選択</h2>
		</div>

		{#if availableClusters.length === 0}
			<p class="empty-state">
				クラスタリング結果がありません。<a href="/bill-clustering"
					>先に法案クラスタリングを実行してください。</a
				>
			</p>
		{:else}
			<div class="cluster-list">
				{#each availableClusters as cluster}
					<button
						class="cluster-card"
						class:active={selectedClusterId === cluster.id}
						onclick={() => loadClusterLabels(cluster.id)}
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

	{#if selectedClusterId && clusterLabels.length > 0}
		<section class="content-section">
			<div class="section-header">
				<h2>2. クラスターラベルを選択（任意）</h2>
			</div>
			<p class="help-text">特定のクラスターを選択するか、全てを一括で計算できます。</p>

			<div class="label-list">
				<button
					class="label-card"
					class:active={selectedClusterLabel === null}
					onclick={() => (selectedClusterLabel = null)}
				>
					<span class="label-name">全て</span>
					<span class="label-count"
						>{clusterLabels.reduce((sum, l) => sum + l.billCount, 0)} 件の法案</span
					>
				</button>
				{#each clusterLabels as { label, billCount }}
					<button
						class="label-card"
						class:active={selectedClusterLabel === label}
						onclick={() => (selectedClusterLabel = label)}
					>
						<span class="label-name">クラスター {label}</span>
						<span class="label-count">{billCount} 件の法案</span>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	{#if selectedClusterId}
		<section class="content-section">
			<div class="section-header">
				<h2>3. ベクトルを計算</h2>
			</div>

			<div class="param-row">
				<label for="nComponents">潜在次元数:</label>
				<select id="nComponents" bind:value={nComponents} class="select">
					<option value={1}>1次元</option>
					<option value={2}>2次元</option>
					<option value={3}>3次元</option>
					<option value={4}>4次元</option>
					<option value={5}>5次元</option>
				</select>
			</div>

			<button
				class="btn-primary"
				onclick={calculateVectors}
				disabled={isCalculating || isLoadingLabels}
			>
				{#if isCalculating}
					計算中...
				{:else}
					潜在ベクトルを計算
				{/if}
			</button>
		</section>
	{/if}

	{#if calculationResult && currentClusterData}
		<section class="content-section results-section">
			<div class="section-header">
				<h2>4. 分析結果</h2>
			</div>

			{#if Object.keys(calculationResult).length > 1}
				<div class="result-cluster-switcher">
					{#each Object.keys(calculationResult).sort((a, b) => parseInt(a) - parseInt(b)) as label}
						<button
							class="switcher-btn"
							class:active={selectedClusterLabel === parseInt(label)}
							onclick={() => selectClusterLabelResult(parseInt(label))}
						>
							クラスター {label}
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
				<h3>次元別の代表法案</h3>
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
								<div class="bill-item" class:passed={bill.passed}>
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

	/* ===== HERO SECTION ===== */
	.hero {
		text-align: center;
		padding: 4rem 2rem 3rem;
		background: white;
		border-bottom: 1px solid #e5e7eb;
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
		font-size: clamp(2rem, 5vw, 2.75rem);
		font-weight: 800;
		color: #1a1a2e;
		margin: 0 0 0.75rem 0;
		letter-spacing: -0.02em;
	}

	.hero-subtitle {
		font-size: 1.1rem;
		color: #64748b;
		margin: 0;
	}

	/* ===== CONTENT SECTIONS ===== */
	.content-section {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
	}

	.section-header {
		margin-bottom: 1.25rem;
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

	.empty-state a {
		color: #6366f1;
	}

	.help-text {
		color: #64748b;
		font-size: 0.9rem;
		margin-bottom: 1rem;
	}

	/* ===== CLUSTER LIST ===== */
	.cluster-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.cluster-card {
		padding: 1rem 1.25rem;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		background: white;
		cursor: pointer;
		transition: all 0.2s;
		text-align: left;
	}

	.cluster-card:hover {
		border-color: #6366f1;
		background: #fafbff;
	}

	.cluster-card.active {
		border-color: #6366f1;
		background: #eef2ff;
	}

	.cluster-name {
		font-weight: 600;
		color: #1a1a2e;
		margin-bottom: 0.5rem;
	}

	.cluster-meta {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		margin-bottom: 0.25rem;
	}

	.cluster-params {
		font-size: 0.8rem;
		color: #64748b;
		font-family: monospace;
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

	/* ===== LABEL LIST ===== */
	.label-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.label-card {
		padding: 0.6rem 1rem;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		background: white;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.label-card:hover {
		border-color: #6366f1;
	}

	.label-card.active {
		border-color: #6366f1;
		background: #eef2ff;
	}

	.label-name {
		font-weight: 500;
		color: #1a1a2e;
		font-size: 0.9rem;
	}

	.label-count {
		font-size: 0.75rem;
		color: #64748b;
	}

	/* ===== FORM STYLES ===== */
	.param-row {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.param-row label {
		font-weight: 500;
		font-size: 0.9rem;
		color: #374151;
	}

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

	.btn-primary {
		padding: 0.7rem 1.5rem;
		background: #6366f1;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s, transform 0.2s;
	}

	.btn-primary:hover:not(:disabled) {
		background: #4f46e5;
		transform: translateY(-1px);
	}

	.btn-primary:disabled {
		background: #9ca3af;
		cursor: not-allowed;
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

	.representative-bills h3 {
		font-size: 1.1rem;
		font-weight: 600;
		color: #1a1a2e;
		margin-bottom: 1rem;
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
		border-left: 3px solid #e5e7eb;
	}

	.bill-item.passed {
		border-left-color: #22c55e;
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
		.hero {
			padding: 3rem 1.5rem 2rem;
		}

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
	}
</style>
