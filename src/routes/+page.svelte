<script lang="ts">
	import { onMount } from 'svelte';

	let stats = $state({
		totalBills: 0,
		totalMembers: 0,
		totalVotes: 0,
		sessionsAnalyzed: 0
	});

	let isLoading = $state(true);
	let error = $state<string | null>(null);

	onMount(async () => {
		try {
			const response = await fetch('/api/stats');
			if (!response.ok) {
				throw new Error('Failed to fetch statistics');
			}
			const data = await response.json();
			stats = data;
		} catch (err) {
			console.error('Error loading stats:', err);
			error = err instanceof Error ? err.message : 'Failed to load statistics';
		} finally {
			isLoading = false;
		}
	});
</script>

<div class="landing-page">
	<!-- Hero Section -->
	<section class="hero">
		<div class="hero-content">
			<h1 class="hero-title">日本国会議案分析プラットフォーム</h1>
			<p class="hero-subtitle">AI技術を活用した国会議案・投票記録の包括的分析システム</p>
			<div class="hero-description">
				<p>
					参議院・衆議院の議案データを収集し、機械学習とベクトル分析により、
					議員の投票パターン、議案の類似性、政治的傾向を可視化します。
				</p>
			</div>
		</div>
	</section>

	<!-- Stats Section -->
	<section class="stats-section">
		{#if error}
			<div class="error-message">
				<p>⚠️ {error}</p>
			</div>
		{/if}
		<div class="stats-grid">
			<div class="stat-card">
				<div class="stat-icon">📊</div>
				<div class="stat-number">{isLoading ? '...' : stats.totalBills.toLocaleString()}</div>
				<div class="stat-label">分析済み議案</div>
			</div>
			<div class="stat-card">
				<div class="stat-icon">👥</div>
				<div class="stat-number">{isLoading ? '...' : stats.totalMembers.toLocaleString()}</div>
				<div class="stat-label">国会議員</div>
			</div>
			<div class="stat-card">
				<div class="stat-icon">🗳️</div>
				<div class="stat-number">{isLoading ? '...' : stats.totalVotes.toLocaleString()}</div>
				<div class="stat-label">投票記録</div>
			</div>
			<div class="stat-card">
				<div class="stat-icon">📅</div>
				<div class="stat-number">{isLoading ? '...' : stats.sessionsAnalyzed}</div>
				<div class="stat-label">国会会期</div>
			</div>
		</div>
	</section>

	<!-- Features Section -->
	<section class="features-section">
		<h2 class="section-title">分析機能</h2>

		<div class="features-grid">
			<a href="/legislation-scores" class="feature-card purple-gradient">
				<div class="feature-icon">🎯</div>
				<h3 class="feature-title">議案別スコア分析</h3>
				<p class="feature-description">
					各議案に対する議員の賛成・反対パターンを分析し、
					議員の政治的立場を数値化して可視化します。
				</p>
				<div class="feature-tags">
					<span class="tag">投票分析</span>
					<span class="tag">スコアリング</span>
					<span class="tag">議員評価</span>
				</div>
				<div class="feature-arrow">→</div>
			</a>

			<a href="/bill-clustering" class="feature-card pink-gradient">
				<div class="feature-icon">🔬</div>
				<h3 class="feature-title">法案クラスタリング分析</h3>
				<p class="feature-description">
					機械学習により法案の内容を埋め込みベクトル化し、
					類似する法案をグループ化して傾向を発見します。
				</p>
				<div class="feature-tags">
					<span class="tag">機械学習</span>
					<span class="tag">埋め込み</span>
					<span class="tag">可視化</span>
				</div>
				<div class="feature-arrow">→</div>
			</a>

			<a href="/member-vectors" class="feature-card blue-gradient">
				<div class="feature-icon">🧭</div>
				<h3 class="feature-title">議員ベクトル分析</h3>
				<p class="feature-description">
					投票履歴から議員の政治的方向性をベクトル化し、 議員間の類似性や政治的距離を分析します。
				</p>
				<div class="feature-tags">
					<span class="tag">ベクトル分析</span>
					<span class="tag">類似度</span>
					<span class="tag">政治マップ</span>
				</div>
				<div class="feature-arrow">→</div>
			</a>
		</div>
	</section>

	<!-- Footer -->
	<footer class="footer">
		<p>日本国会議案分析プラットフォーム - データ駆動型政治分析</p>
	</footer>
</div>

<style>
	.landing-page {
		min-height: 100vh;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
		padding: 2rem;
	}

	/* Hero Section */
	.hero {
		text-align: center;
		padding: 4rem 2rem;
		margin-bottom: 3rem;
	}

	.hero-content {
		max-width: 900px;
		margin: 0 auto;
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(10px);
		padding: 3rem;
		border-radius: 24px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
	}

	.hero-title {
		font-size: clamp(2rem, 5vw, 3.5rem);
		font-weight: 800;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		margin-bottom: 1rem;
		line-height: 1.2;
	}

	.hero-subtitle {
		font-size: clamp(1.1rem, 2.5vw, 1.5rem);
		color: #555;
		font-weight: 600;
		margin-bottom: 1.5rem;
	}

	.hero-description {
		font-size: 1.1rem;
		color: #666;
		line-height: 1.8;
		max-width: 700px;
		margin: 0 auto;
	}

	/* Stats Section */
	.stats-section {
		max-width: 1200px;
		margin: 0 auto 4rem;
	}

	.error-message {
		background: rgba(255, 100, 100, 0.9);
		color: white;
		padding: 1rem;
		border-radius: 8px;
		text-align: center;
		margin-bottom: 2rem;
		font-weight: 600;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 1.5rem;
	}

	.stat-card {
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(10px);
		padding: 2rem;
		border-radius: 16px;
		text-align: center;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
		transition:
			transform 0.3s ease,
			box-shadow 0.3s ease;
	}

	.stat-card:hover {
		transform: translateY(-5px);
		box-shadow: 0 15px 40px rgba(0, 0, 0, 0.3);
	}

	.stat-icon {
		font-size: 3rem;
		margin-bottom: 0.5rem;
	}

	.stat-number {
		font-size: 2.5rem;
		font-weight: 800;
		color: #667eea;
		margin-bottom: 0.5rem;
	}

	.stat-label {
		font-size: 1rem;
		color: #666;
		font-weight: 600;
	}

	/* Features Section */
	.features-section {
		max-width: 1200px;
		margin: 0 auto 4rem;
	}

	.section-title {
		text-align: center;
		font-size: 2.5rem;
		font-weight: 800;
		color: white;
		margin-bottom: 3rem;
		text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
	}

	.features-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
		gap: 2rem;
	}

	.feature-card {
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(10px);
		padding: 2.5rem;
		border-radius: 20px;
		text-decoration: none;
		color: inherit;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
		transition: all 0.3s ease;
		position: relative;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	.feature-card::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 6px;
		opacity: 0.8;
	}

	.feature-card.purple-gradient::before {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
	}

	.feature-card.pink-gradient::before {
		background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
	}

	.feature-card.blue-gradient::before {
		background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
	}

	.feature-card:hover {
		transform: translateY(-8px);
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
	}

	.feature-icon {
		font-size: 3.5rem;
		margin-bottom: 1rem;
	}

	.feature-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #333;
		margin-bottom: 1rem;
	}

	.feature-description {
		font-size: 1rem;
		color: #666;
		line-height: 1.7;
		margin-bottom: 1.5rem;
		flex-grow: 1;
	}

	.feature-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.tag {
		background: linear-gradient(135deg, #667eea15, #764ba215);
		color: #667eea;
		padding: 0.4rem 0.8rem;
		border-radius: 20px;
		font-size: 0.85rem;
		font-weight: 600;
	}

	.feature-arrow {
		font-size: 1.5rem;
		color: #667eea;
		font-weight: 700;
		text-align: right;
	}

	/* Footer */
	.footer {
		text-align: center;
		padding: 2rem;
		color: white;
		font-size: 0.95rem;
		text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
	}

	/* Responsive Design */
	@media (max-width: 768px) {
		.landing-page {
			padding: 1rem;
		}

		.hero {
			padding: 2rem 1rem;
		}

		.hero-content {
			padding: 2rem 1.5rem;
		}

		.stats-grid,
		.features-grid {
			grid-template-columns: 1fr;
		}

		.section-title {
			font-size: 2rem;
		}
	}
</style>
