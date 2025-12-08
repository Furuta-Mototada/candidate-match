<script lang="ts">
	import { onMount } from 'svelte';

	let stats = $state({
		totalBills: 0,
		totalMembers: 0,
		totalVotes: 0,
		sessionsAnalyzed: 0
	});

	let isLoading = $state(true);
	let mounted = $state(false);
	let statsLoaded = $state(false);

	// Animated counter effect
	function animateValue(
		start: number,
		end: number,
		duration: number,
		callback: (val: number) => void
	) {
		const startTime = performance.now();
		const update = (currentTime: number) => {
			const elapsed = currentTime - startTime;
			const progress = Math.min(elapsed / duration, 1);
			const easeOutQuart = 1 - Math.pow(1 - progress, 4);
			callback(Math.floor(start + (end - start) * easeOutQuart));
			if (progress < 1) {
				requestAnimationFrame(update);
			}
		};
		requestAnimationFrame(update);
	}

	let displayStats = $state({
		totalBills: 0,
		totalMembers: 0,
		totalVotes: 0
	});

	onMount(async () => {
		// Trigger mount animations
		setTimeout(() => {
			mounted = true;
		}, 100);

		try {
			const response = await fetch('/api/stats');
			if (response.ok) {
				const data = await response.json();
				stats = data;
				statsLoaded = true;

				// Animate the counters
				setTimeout(() => {
					animateValue(0, data.totalBills, 1500, (val) => (displayStats.totalBills = val));
					animateValue(0, data.totalMembers, 1500, (val) => (displayStats.totalMembers = val));
					animateValue(0, data.totalVotes, 2000, (val) => (displayStats.totalVotes = val));
				}, 300);
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

<div class="page" class:mounted>
	<!-- Hero Section -->
	<section class="hero">
		<div class="hero-badge animate-in" style="--delay: 0">🇯🇵 日本国会分析プラットフォーム</div>
		<h1 class="hero-title animate-in" style="--delay: 1">
			あなたの政治的価値観に<br />
			<span class="gradient-text">最も近い議員</span>を見つけよう
		</h1>
		<p class="hero-subtitle animate-in" style="--delay: 2">
			法案への賛否を答えるだけで、AI が国会議員とのマッチ度を算出。
			分野別の重要度設定で、あなただけの総合スコアを表示します。
		</p>
		<div class="hero-buttons animate-in" style="--delay: 3">
			<a href="/match" class="btn-primary pulse-glow">
				マッチングを始める
				<span class="btn-arrow">→</span>
			</a>
			<a href="#features" class="btn-secondary">機能を見る</a>
		</div>

		<!-- Trust indicators -->
		<div class="trust-section animate-in" style="--delay: 4">
			<p class="trust-label">分析データ</p>
			<div class="trust-stats">
				<div class="trust-item">
					{#if isLoading}
						<span class="trust-number loading-shimmer">000</span>
					{:else}
						<span class="trust-number count-up">{displayStats.totalBills.toLocaleString()}</span>
					{/if}
					<span class="trust-text">法案</span>
				</div>
				<div class="trust-divider"></div>
				<div class="trust-item">
					{#if isLoading}
						<span class="trust-number loading-shimmer">000</span>
					{:else}
						<span class="trust-number count-up">{displayStats.totalMembers.toLocaleString()}</span>
					{/if}
					<span class="trust-text">議員</span>
				</div>
				<div class="trust-divider"></div>
				<div class="trust-item">
					{#if isLoading}
						<span class="trust-number loading-shimmer">00,000</span>
					{:else}
						<span class="trust-number count-up">{displayStats.totalVotes.toLocaleString()}</span>
					{/if}
					<span class="trust-text">投票記録</span>
				</div>
			</div>
		</div>
	</section>

	<!-- How It Works Section -->
	<section class="how-it-works">
		<h2 class="section-title animate-in" style="--delay: 0">使い方はかんたん</h2>
		<div class="steps">
			<div class="step animate-in" style="--delay: 1">
				<div class="step-number">1</div>
				<div class="step-content">
					<h3>法案に賛否を回答</h3>
					<p>表示される法案に対して「賛成」「反対」「わからない」を選ぶだけ</p>
				</div>
			</div>
			<div class="step-arrow animate-in" style="--delay: 2">→</div>
			<div class="step animate-in" style="--delay: 2">
				<div class="step-number">2</div>
				<div class="step-content">
					<h3>分野の重要度を設定</h3>
					<p>各政策分野があなたにとってどれくらい重要か★1〜5で評価</p>
				</div>
			</div>
			<div class="step-arrow animate-in" style="--delay: 3">→</div>
			<div class="step animate-in" style="--delay: 3">
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
		<div class="cta-card floating">
			<div class="cta-content">
				<span class="cta-badge sparkle">🗳️ メイン機能</span>
				<h2 class="cta-title">議員マッチング</h2>
				<p class="cta-description">
					あなたの回答パターンと国会議員の投票パターンをAIが比較分析。
					複数の政策分野にわたって、総合的なマッチ度を算出します。
				</p>
				<ul class="cta-features">
					<li class="feature-item" style="--item-delay: 0">✓ 適応型質問選択で効率的に分析</li>
					<li class="feature-item" style="--item-delay: 1">✓ 政策分野を個別に評価</li>
					<li class="feature-item" style="--item-delay: 2">✓ 重要度ウェイトで総合スコア算出</li>
					<li class="feature-item" style="--item-delay: 3">✓ 全議員のランキングを表示</li>
				</ul>
				<a href="/match" class="cta-button ripple">
					今すぐ試す
					<span>→</span>
				</a>
			</div>
			<div class="cta-visual">
				<div class="visual-card">
					<div class="visual-header">🏆 マッチ結果</div>
					<div class="visual-item top slide-in" style="--slide-delay: 0">
						<span class="rank pulse">1</span>
						<span class="name">山田 太郎</span>
						<span class="score">92%</span>
					</div>
					<div class="visual-item slide-in" style="--slide-delay: 1">
						<span class="rank">2</span>
						<span class="name">鈴木 花子</span>
						<span class="score">87%</span>
					</div>
					<div class="visual-item slide-in" style="--slide-delay: 2">
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
			<a href="/legislation-scores" class="feature-card hover-lift" style="--card-delay: 0">
				<div class="feature-icon bounce-in">🎯</div>
				<h3>議案別スコア分析</h3>
				<p>各議案に対する議員の賛成・反対パターンを分析し、政治的立場を数値化</p>
				<span class="feature-link">詳しく見る →</span>
			</a>

			<a href="/bill-clustering" class="feature-card hover-lift" style="--card-delay: 1">
				<div class="feature-icon bounce-in">🔬</div>
				<h3>法案クラスタリング</h3>
				<p>機械学習で法案をベクトル化し、類似する法案をグループ化して可視化</p>
				<span class="feature-link">詳しく見る →</span>
			</a>

			<a href="/member-vectors" class="feature-card hover-lift" style="--card-delay: 2">
				<div class="feature-icon bounce-in">🧭</div>
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

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes slideInRight {
		from {
			opacity: 0;
			transform: translateX(-20px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	@keyframes float {
		0%,
		100% {
			transform: translateY(0px);
		}
		50% {
			transform: translateY(-10px);
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

	@keyframes pulseGlow {
		0%,
		100% {
			box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
		}
		50% {
			box-shadow: 0 4px 30px rgba(99, 102, 241, 0.7);
		}
	}

	@keyframes shimmer {
		0% {
			background-position: -200% 0;
		}
		100% {
			background-position: 200% 0;
		}
	}

	@keyframes bounceIn {
		0% {
			transform: scale(0);
			opacity: 0;
		}
		50% {
			transform: scale(1.2);
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}

	@keyframes sparkle {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.6;
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

	@keyframes countUp {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* ===== BASE STYLES ===== */
	.page {
		min-height: 100vh;
		background: #fafbfc;
		overflow-x: hidden;
	}

	/* Animate-in class for staggered entrance */
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
		background-size: 200% 200%;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		animation: gradientShift 4s ease infinite;
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

	/* ===== BUTTONS ===== */
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
		transition: all 0.3s ease;
		position: relative;
		overflow: hidden;
	}

	.btn-primary::before {
		content: '';
		position: absolute;
		top: 0;
		left: -100%;
		width: 100%;
		height: 100%;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
		transition: left 0.5s ease;
	}

	.btn-primary:hover::before {
		left: 100%;
	}

	.btn-primary:hover {
		transform: translateY(-3px);
		box-shadow: 0 8px 25px rgba(99, 102, 241, 0.5);
	}

	.btn-primary.pulse-glow {
		animation: pulseGlow 2s ease-in-out infinite;
	}

	.btn-primary.large {
		padding: 1.25rem 2.5rem;
		font-size: 1.2rem;
	}

	.btn-arrow {
		transition: transform 0.3s ease;
	}

	.btn-primary:hover .btn-arrow {
		transform: translateX(6px);
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
		transition: all 0.3s ease;
	}

	.btn-secondary:hover {
		border-color: #6366f1;
		color: #6366f1;
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.15);
	}

	/* ===== TRUST SECTION ===== */
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
		min-width: 60px;
		text-align: right;
	}

	.trust-number.loading-shimmer {
		background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
		background-size: 200% 100%;
		animation: shimmer 1.5s infinite;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.trust-number.count-up {
		animation: countUp 0.5s ease forwards;
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

	/* ===== HOW IT WORKS ===== */
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
		transition: transform 0.3s ease;
	}

	.step:hover {
		transform: translateY(-5px);
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
		transition:
			transform 0.3s ease,
			box-shadow 0.3s ease;
	}

	.step:hover .step-number {
		transform: scale(1.1);
		box-shadow: 0 8px 20px rgba(99, 102, 241, 0.4);
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
		transition: transform 0.3s ease;
	}

	.steps:hover .step-arrow {
		animation: pulse 1s ease infinite;
	}

	/* ===== CTA SECTION ===== */
	.cta-section {
		padding: 5rem 2rem;
		max-width: 1100px;
		margin: 0 auto;
	}

	.cta-card {
		background: linear-gradient(135deg, #6366f1 0%, #4f46e5 50%, #7c3aed 100%);
		background-size: 200% 200%;
		border-radius: 24px;
		padding: 3rem;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 3rem;
		align-items: center;
		box-shadow: 0 20px 60px rgba(99, 102, 241, 0.3);
		transition:
			transform 0.3s ease,
			box-shadow 0.3s ease;
	}

	.cta-card.floating {
		animation: float 6s ease-in-out infinite;
	}

	.cta-card:hover {
		box-shadow: 0 30px 80px rgba(99, 102, 241, 0.4);
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
		backdrop-filter: blur(10px);
	}

	.cta-badge.sparkle {
		animation: sparkle 2s ease-in-out infinite;
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
		opacity: 0;
		animation: slideInRight 0.5s ease forwards;
		animation-delay: calc(var(--item-delay, 0) * 0.15s + 0.5s);
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
		transition: all 0.3s ease;
		position: relative;
		overflow: hidden;
	}

	.cta-button::after {
		content: '';
		position: absolute;
		width: 100%;
		height: 100%;
		top: 0;
		left: -100%;
		background: linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.1), transparent);
		transition: left 0.5s ease;
	}

	.cta-button:hover::after {
		left: 100%;
	}

	.cta-button:hover {
		transform: translateY(-3px) scale(1.02);
		box-shadow: 0 15px 35px rgba(0, 0, 0, 0.2);
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
		transform: rotate(2deg);
		transition: transform 0.3s ease;
	}

	.cta-card:hover .visual-card {
		transform: rotate(0deg) scale(1.02);
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
		transition:
			transform 0.2s ease,
			background 0.2s ease;
	}

	.visual-item.slide-in {
		opacity: 0;
		animation: slideInRight 0.5s ease forwards;
		animation-delay: calc(var(--slide-delay, 0) * 0.2s + 0.3s);
	}

	.visual-item:hover {
		transform: translateX(5px);
		background: #f9fafb;
		border-radius: 8px;
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
		transition: transform 0.2s ease;
	}

	.visual-item .rank.pulse {
		animation: pulse 2s ease-in-out infinite;
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

	/* ===== FEATURES SECTION ===== */
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
		transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
		position: relative;
		overflow: hidden;
	}

	.feature-card::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 3px;
		background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899);
		transform: scaleX(0);
		transform-origin: left;
		transition: transform 0.3s ease;
	}

	.feature-card:hover::before {
		transform: scaleX(1);
	}

	.feature-card.hover-lift:hover {
		border-color: #6366f1;
		box-shadow: 0 20px 40px rgba(99, 102, 241, 0.15);
		transform: translateY(-8px);
	}

	.feature-icon {
		font-size: 2.5rem;
		margin-bottom: 1rem;
		display: inline-block;
		transition: transform 0.3s ease;
	}

	.feature-icon.bounce-in {
		animation: bounceIn 0.6s ease forwards;
		animation-delay: calc(var(--card-delay, 0) * 0.2s);
	}

	.feature-card:hover .feature-icon {
		transform: scale(1.2) rotate(10deg);
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
		transition: letter-spacing 0.2s ease;
	}

	.feature-card:hover .feature-link {
		letter-spacing: 0.5px;
	}

	/* ===== FOOTER CTA ===== */
	.footer-cta {
		background: #1a1a2e;
		padding: 5rem 2rem;
		text-align: center;
		position: relative;
		overflow: hidden;
	}

	.footer-cta::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.1) 0%, transparent 70%);
		pointer-events: none;
	}

	.footer-cta h2 {
		font-size: 2.25rem;
		font-weight: 800;
		color: white;
		margin-bottom: 1rem;
		position: relative;
	}

	.footer-cta p {
		font-size: 1.1rem;
		color: rgba(255, 255, 255, 0.7);
		margin-bottom: 2rem;
		position: relative;
	}

	/* ===== FOOTER ===== */
	.footer {
		background: #0f0f1a;
		padding: 2rem;
		text-align: center;
	}

	.footer p {
		color: rgba(255, 255, 255, 0.5);
		font-size: 0.9rem;
	}

	/* ===== RESPONSIVE ===== */
	@media (max-width: 768px) {
		.hero {
			padding: 4rem 1.5rem 3rem;
		}

		.cta-card {
			grid-template-columns: 1fr;
			padding: 2rem;
		}

		.cta-card.floating {
			animation: none;
		}

		.cta-visual {
			order: -1;
		}

		.visual-card {
			transform: none;
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
