<script lang="ts">
	import { onMount } from 'svelte';

	let stats = $state({
		totalBills: 0,
		totalMembers: 0,
		totalVotes: 0,
		sessionsAnalyzed: 0
	});

	let isLoading = $state(true);

	onMount(async () => {
		try {
			const response = await fetch('/api/stats');
			if (response.ok) {
				stats = await response.json();
			}
		} catch (err) {
			console.error('Error loading stats:', err);
		} finally {
			isLoading = false;
		}
	});
</script>

<svelte:head>
	<title>Candidate Match - あなたに合う議員を見つけよう</title>
</svelte:head>

<div class="page">
	<!-- Hero Section -->
	<section class="hero">
		<div class="hero-badge">🇯🇵 日本国会分析プラットフォーム</div>
		<h1 class="hero-title">
			あなたの政治的価値観に<br />
			<span class="gradient-text">最も近い議員</span>を見つけよう
		</h1>
		<p class="hero-subtitle">
			法案への賛否を答えるだけで、AI が国会議員とのマッチ度を算出。
			分野別の重要度設定で、あなただけの総合スコアを表示します。
		</p>
		<div class="hero-buttons">
			<a href="/match" class="btn-primary">
				マッチングを始める
				<span class="btn-arrow">→</span>
			</a>
			<a href="#features" class="btn-secondary">機能を見る</a>
		</div>

		<!-- Trust indicators -->
		<div class="trust-section">
			<p class="trust-label">分析データ</p>
			<div class="trust-stats">
				<div class="trust-item">
					<span class="trust-number">{isLoading ? '...' : stats.totalBills.toLocaleString()}</span>
					<span class="trust-text">法案</span>
				</div>
				<div class="trust-divider"></div>
				<div class="trust-item">
					<span class="trust-number">{isLoading ? '...' : stats.totalMembers.toLocaleString()}</span
					>
					<span class="trust-text">議員</span>
				</div>
				<div class="trust-divider"></div>
				<div class="trust-item">
					<span class="trust-number">{isLoading ? '...' : stats.totalVotes.toLocaleString()}</span>
					<span class="trust-text">投票記録</span>
				</div>
			</div>
		</div>
	</section>

	<!-- How It Works Section -->
	<section class="how-it-works">
		<h2 class="section-title">使い方はかんたん</h2>
		<div class="steps">
			<div class="step">
				<div class="step-number">1</div>
				<div class="step-content">
					<h3>法案に賛否を回答</h3>
					<p>表示される法案に対して「賛成」「反対」「わからない」を選ぶだけ</p>
				</div>
			</div>
			<div class="step-arrow">→</div>
			<div class="step">
				<div class="step-number">2</div>
				<div class="step-content">
					<h3>分野の重要度を設定</h3>
					<p>各政策分野があなたにとってどれくらい重要か★1〜5で評価</p>
				</div>
			</div>
			<div class="step-arrow">→</div>
			<div class="step">
				<div class="step-number">3</div>
				<div class="step-content">
					<h3>マッチ結果を確認</h3>
					<p>総合スコアと分野別スコアであなたに近い議員がわかる</p>
				</div>
			</div>
		</div>
	</section>

	<!-- Primary CTA Card -->
	<section class="cta-section">
		<div class="cta-card">
			<div class="cta-content">
				<span class="cta-badge">🗳️ メイン機能</span>
				<h2 class="cta-title">議員マッチング</h2>
				<p class="cta-description">
					あなたの回答パターンと国会議員の投票パターンをAIが比較分析。
					複数の政策分野にわたって、総合的なマッチ度を算出します。
				</p>
				<ul class="cta-features">
					<li>✓ 適応型質問選択で効率的に分析</li>
					<li>✓ 8つの政策分野を個別に評価</li>
					<li>✓ 重要度ウェイトで総合スコア算出</li>
					<li>✓ 全議員のランキングを表示</li>
				</ul>
				<a href="/match" class="cta-button">
					今すぐ試す
					<span>→</span>
				</a>
			</div>
			<div class="cta-visual">
				<div class="visual-card">
					<div class="visual-header">🏆 マッチ結果</div>
					<div class="visual-item top">
						<span class="rank">1</span>
						<span class="name">山田 太郎</span>
						<span class="score">92%</span>
					</div>
					<div class="visual-item">
						<span class="rank">2</span>
						<span class="name">鈴木 花子</span>
						<span class="score">87%</span>
					</div>
					<div class="visual-item">
						<span class="rank">3</span>
						<span class="name">佐藤 一郎</span>
						<span class="score">84%</span>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- Features Section -->
	<section id="features" class="features">
		<h2 class="section-title">その他の分析機能</h2>
		<p class="section-subtitle">詳細なデータ分析で政治をもっと身近に</p>

		<div class="features-grid">
			<a href="/legislation-scores" class="feature-card">
				<div class="feature-icon">🎯</div>
				<h3>議案別スコア分析</h3>
				<p>各議案に対する議員の賛成・反対パターンを分析し、政治的立場を数値化</p>
				<span class="feature-link">詳しく見る →</span>
			</a>

			<a href="/bill-clustering" class="feature-card">
				<div class="feature-icon">🔬</div>
				<h3>法案クラスタリング</h3>
				<p>機械学習で法案をベクトル化し、類似する法案をグループ化して可視化</p>
				<span class="feature-link">詳しく見る →</span>
			</a>

			<a href="/member-vectors" class="feature-card">
				<div class="feature-icon">🧭</div>
				<h3>議員ベクトル分析</h3>
				<p>投票履歴から議員の政治的方向性をベクトル化し、類似性を分析</p>
				<span class="feature-link">詳しく見る →</span>
			</a>
		</div>
	</section>

	<!-- Footer CTA -->
	<section class="footer-cta">
		<h2>あなたに合う議員を見つけよう</h2>
		<p>数分の質問回答で、あなたの政治的価値観に最も近い国会議員がわかります</p>
		<a href="/match" class="btn-primary large">
			マッチングを始める
			<span class="btn-arrow">→</span>
		</a>
	</section>

	<!-- Footer -->
	<footer class="footer">
		<p>Candidate Match © 2025 - データ駆動型政治分析プラットフォーム</p>
	</footer>
</div>

<style>
	.page {
		min-height: 100vh;
		background: #fafbfc;
	}

	/* Hero Section */
	.hero {
		text-align: center;
		padding: 6rem 2rem 4rem;
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
		margin-bottom: 2rem;
	}

	.hero-title {
		font-size: clamp(2.5rem, 6vw, 4rem);
		font-weight: 800;
		line-height: 1.15;
		color: #1a1a2e;
		margin-bottom: 1.5rem;
		letter-spacing: -0.02em;
	}

	.gradient-text {
		background: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.hero-subtitle {
		font-size: 1.25rem;
		color: #64748b;
		line-height: 1.7;
		max-width: 600px;
		margin: 0 auto 2.5rem;
	}

	.hero-buttons {
		display: flex;
		gap: 1rem;
		justify-content: center;
		flex-wrap: wrap;
		margin-bottom: 4rem;
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
		color: white;
		padding: 1rem 2rem;
		border-radius: 12px;
		font-size: 1.1rem;
		font-weight: 600;
		text-decoration: none;
		box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
		transition: all 0.2s ease;
	}

	.btn-primary:hover {
		transform: translateY(-2px);
		box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5);
	}

	.btn-primary.large {
		padding: 1.25rem 2.5rem;
		font-size: 1.2rem;
	}

	.btn-arrow {
		transition: transform 0.2s ease;
	}

	.btn-primary:hover .btn-arrow {
		transform: translateX(4px);
	}

	.btn-secondary {
		display: inline-flex;
		align-items: center;
		background: white;
		color: #374151;
		padding: 1rem 2rem;
		border-radius: 12px;
		font-size: 1.1rem;
		font-weight: 600;
		text-decoration: none;
		border: 2px solid #e5e7eb;
		transition: all 0.2s ease;
	}

	.btn-secondary:hover {
		border-color: #6366f1;
		color: #6366f1;
	}

	/* Trust Section */
	.trust-section {
		padding-top: 2rem;
		border-top: 1px solid #e5e7eb;
	}

	.trust-label {
		font-size: 0.85rem;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		margin-bottom: 1rem;
	}

	.trust-stats {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 2rem;
		flex-wrap: wrap;
	}

	.trust-item {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.trust-number {
		font-size: 1.75rem;
		font-weight: 800;
		color: #1a1a2e;
	}

	.trust-text {
		font-size: 1rem;
		color: #64748b;
	}

	.trust-divider {
		width: 1px;
		height: 30px;
		background: #e5e7eb;
	}

	/* How It Works */
	.how-it-works {
		background: white;
		padding: 5rem 2rem;
		border-top: 1px solid #e5e7eb;
		border-bottom: 1px solid #e5e7eb;
	}

	.section-title {
		text-align: center;
		font-size: 2.25rem;
		font-weight: 800;
		color: #1a1a2e;
		margin-bottom: 1rem;
	}

	.section-subtitle {
		text-align: center;
		font-size: 1.1rem;
		color: #64748b;
		margin-bottom: 3rem;
	}

	.steps {
		display: flex;
		justify-content: center;
		align-items: flex-start;
		gap: 1.5rem;
		max-width: 1000px;
		margin: 3rem auto 0;
		flex-wrap: wrap;
	}

	.step {
		flex: 1;
		min-width: 200px;
		max-width: 280px;
		text-align: center;
	}

	.step-number {
		width: 48px;
		height: 48px;
		background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
		color: white;
		font-size: 1.25rem;
		font-weight: 700;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 1.25rem;
	}

	.step-content h3 {
		font-size: 1.1rem;
		font-weight: 700;
		color: #1a1a2e;
		margin-bottom: 0.5rem;
	}

	.step-content p {
		font-size: 0.95rem;
		color: #64748b;
		line-height: 1.6;
	}

	.step-arrow {
		color: #d1d5db;
		font-size: 1.5rem;
		padding-top: 0.75rem;
	}

	/* CTA Section */
	.cta-section {
		padding: 5rem 2rem;
		max-width: 1100px;
		margin: 0 auto;
	}

	.cta-card {
		background: linear-gradient(135deg, #6366f1 0%, #4f46e5 50%, #7c3aed 100%);
		border-radius: 24px;
		padding: 3rem;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 3rem;
		align-items: center;
		box-shadow: 0 20px 60px rgba(99, 102, 241, 0.3);
	}

	.cta-badge {
		display: inline-block;
		background: rgba(255, 255, 255, 0.2);
		color: white;
		padding: 0.4rem 1rem;
		border-radius: 100px;
		font-size: 0.85rem;
		font-weight: 600;
		margin-bottom: 1rem;
	}

	.cta-title {
		font-size: 2.5rem;
		font-weight: 800;
		color: white;
		margin-bottom: 1rem;
	}

	.cta-description {
		font-size: 1.1rem;
		color: rgba(255, 255, 255, 0.9);
		line-height: 1.7;
		margin-bottom: 1.5rem;
	}

	.cta-features {
		list-style: none;
		padding: 0;
		margin: 0 0 2rem 0;
	}

	.cta-features li {
		color: rgba(255, 255, 255, 0.9);
		font-size: 1rem;
		padding: 0.4rem 0;
	}

	.cta-button {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: white;
		color: #4f46e5;
		padding: 1rem 2rem;
		border-radius: 12px;
		font-size: 1.1rem;
		font-weight: 700;
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.cta-button:hover {
		transform: translateY(-2px);
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
	}

	.cta-visual {
		display: flex;
		justify-content: center;
	}

	.visual-card {
		background: white;
		border-radius: 16px;
		padding: 1.5rem;
		width: 280px;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
	}

	.visual-header {
		font-size: 1rem;
		font-weight: 700;
		color: #1a1a2e;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid #e5e7eb;
	}

	.visual-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid #f3f4f6;
	}

	.visual-item:last-child {
		border-bottom: none;
	}

	.visual-item.top {
		background: linear-gradient(135deg, #fef3c7, #fde68a);
		margin: -0.5rem;
		padding: 1rem;
		border-radius: 8px;
		margin-bottom: 0.5rem;
	}

	.visual-item .rank {
		width: 24px;
		height: 24px;
		background: #6366f1;
		color: white;
		font-size: 0.8rem;
		font-weight: 700;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.visual-item.top .rank {
		background: #f59e0b;
	}

	.visual-item .name {
		flex: 1;
		font-weight: 600;
		color: #374151;
	}

	.visual-item .score {
		font-weight: 700;
		color: #10b981;
	}

	/* Features Section */
	.features {
		padding: 5rem 2rem;
		max-width: 1100px;
		margin: 0 auto;
	}

	.features-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1.5rem;
		margin-top: 3rem;
	}

	.feature-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 16px;
		padding: 2rem;
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.feature-card:hover {
		border-color: #6366f1;
		box-shadow: 0 10px 30px rgba(99, 102, 241, 0.1);
		transform: translateY(-4px);
	}

	.feature-icon {
		font-size: 2.5rem;
		margin-bottom: 1rem;
	}

	.feature-card h3 {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1a1a2e;
		margin-bottom: 0.75rem;
	}

	.feature-card p {
		font-size: 0.95rem;
		color: #64748b;
		line-height: 1.6;
		margin-bottom: 1rem;
	}

	.feature-link {
		color: #6366f1;
		font-weight: 600;
		font-size: 0.95rem;
	}

	/* Footer CTA */
	.footer-cta {
		background: #1a1a2e;
		padding: 5rem 2rem;
		text-align: center;
	}

	.footer-cta h2 {
		font-size: 2.25rem;
		font-weight: 800;
		color: white;
		margin-bottom: 1rem;
	}

	.footer-cta p {
		font-size: 1.1rem;
		color: rgba(255, 255, 255, 0.7);
		margin-bottom: 2rem;
	}

	/* Footer */
	.footer {
		background: #0f0f1a;
		padding: 2rem;
		text-align: center;
	}

	.footer p {
		color: rgba(255, 255, 255, 0.5);
		font-size: 0.9rem;
	}

	/* Responsive */
	@media (max-width: 768px) {
		.hero {
			padding: 4rem 1.5rem 3rem;
		}

		.cta-card {
			grid-template-columns: 1fr;
			padding: 2rem;
		}

		.cta-visual {
			order: -1;
		}

		.step-arrow {
			display: none;
		}

		.steps {
			flex-direction: column;
			align-items: center;
		}

		.trust-divider {
			display: none;
		}

		.trust-stats {
			gap: 1.5rem;
		}
	}
</style>
