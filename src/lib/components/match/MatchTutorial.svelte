<script lang="ts">
	import {
		ThumbsUp,
		ThumbsDown,
		CircleQuestionMark,
		ChevronRight,
		ChevronLeft,
		Star,
		Rocket,
		X,
		Target,
		Brain,
		Lightbulb,
		Ruler,
		Scale,
		Search,
		Palette,
		BookOpen,
		Cog
	} from '@lucide/svelte';
	import { createHoldGesture } from '$lib/utils/hold-gesture.svelte.js';

	interface Props {
		show: boolean;
		isLoading: boolean;
		clusterNames?: string[];
		/** Which tab to open on: 'tutorial' or 'explanation' */
		initialTab?: 'tutorial' | 'explanation';
		onDismiss: () => void;
	}

	let { show, isLoading, clusterNames = [], initialTab = 'tutorial', onDismiss }: Props = $props();

	let activeTab = $state<'tutorial' | 'explanation'>('tutorial');
	let currentStep = $state(0);
	const TOTAL_STEPS = 4;

	// Demo state for interactive elements
	const demoHold = createHoldGesture<number>({
		onComplete: (vote) => {
			demoVoted = vote;
		}
	});
	let demoVoted = $state<number | null>(null);
	let demoImportance = $state(3);

	function nextStep() {
		if (currentStep < TOTAL_STEPS - 1) {
			currentStep++;
			resetDemoState();
		}
	}

	function prevStep() {
		if (currentStep > 0) {
			currentStep--;
			resetDemoState();
		}
	}

	function resetDemoState() {
		demoHold.cancel();
		demoVoted = null;
	}

	function handleDismiss() {
		resetDemoState();
		currentStep = 0;
		onDismiss();
	}

	// Reset when re-opened
	$effect(() => {
		if (show) {
			activeTab = initialTab;
			currentStep = 0;
			resetDemoState();
		}
	});
</script>

{#if show}
	<div class="tutorial-overlay" role="dialog" aria-modal="true" aria-label="マッチングガイド">
		<div class="tutorial-backdrop" onclick={handleDismiss} role="presentation"></div>
		<div class="tutorial-card" class:wide={activeTab === 'explanation'}>
			<!-- Close button -->
			<button class="tutorial-close" onclick={handleDismiss} aria-label="閉じる">
				<X size={18} />
			</button>

			<!-- Tab switcher -->
			<div class="tab-switcher">
				<button
					class="tab-btn"
					class:active={activeTab === 'tutorial'}
					onclick={() => {
						activeTab = 'tutorial';
						resetDemoState();
					}}
				>
					<BookOpen size={15} />
					使い方
				</button>
				<button
					class="tab-btn"
					class:active={activeTab === 'explanation'}
					onclick={() => {
						activeTab = 'explanation';
					}}
				>
					<Cog size={15} />
					仕組み
				</button>
			</div>

			{#if activeTab === 'tutorial'}
				<!-- ===== TUTORIAL TAB ===== -->

				<!-- Step indicator dots -->
				<div class="step-dots">
					{#each Array.from({ length: TOTAL_STEPS }, (_, i) => i) as i (i)}
						<button
							class="step-dot"
							class:active={i === currentStep}
							class:completed={i < currentStep}
							onclick={() => {
								currentStep = i;
								resetDemoState();
							}}
							aria-label="ステップ {i + 1}"
						></button>
					{/each}
				</div>

				<!-- Step content -->
				<div class="step-content">
					{#if currentStep === 0}
						<!-- Step 1: Overview -->
						<div class="step-body fade-in">
							<div class="step-icon-wrapper">
								<Rocket size={32} color="#6366f1" />
							</div>
							<h2 class="step-title">マッチングの流れ</h2>
							<p class="step-desc">法案への回答を通じて、あなたの考えに近い政治家を見つけます。</p>
							<div class="flow-diagram">
								<div class="flow-step">
									<div class="flow-number">1</div>
									<div class="flow-label">法案に回答</div>
									<div class="flow-sublabel">賛成・反対を選ぶ</div>
								</div>
								<div class="flow-arrow"><ChevronRight size={16} /></div>
								<div class="flow-step">
									<div class="flow-number">2</div>
									<div class="flow-label">カテゴリごとに</div>
									<div class="flow-sublabel">テーマ別に回答</div>
								</div>
								<div class="flow-arrow"><ChevronRight size={16} /></div>
								<div class="flow-step">
									<div class="flow-number">3</div>
									<div class="flow-label">重要度を設定</div>
									<div class="flow-sublabel">重みをつける</div>
								</div>
								<div class="flow-arrow"><ChevronRight size={16} /></div>
								<div class="flow-step highlight">
									<div class="flow-number">4</div>
									<div class="flow-label">結果を見る</div>
									<div class="flow-sublabel">マッチ度ランキング</div>
								</div>
							</div>
							{#if clusterNames.length > 0}
								<div class="category-preview">
									<span class="category-preview-label">今回のテーマ:</span>
									<div class="category-tags">
										{#each clusterNames as name (name)}
											<span class="category-tag">{name}</span>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{:else if currentStep === 1}
						<!-- Step 2: Voting buttons -->
						<div class="step-body fade-in">
							<h2 class="step-title">法案への回答方法</h2>
							<p class="step-desc">
								各法案について、ボタンを<strong>長押し</strong>して回答します。試してみてください！
							</p>

							<!-- Mock bill card -->
							<div class="demo-bill-card">
								<div class="demo-bill-badge">サンプル法案</div>
								<div class="demo-bill-title">消費税率を10%から8%に引き下げる法案</div>
								<div class="demo-bill-desc">
									消費税の軽減により家計負担を軽減することを目的とした法案です。
								</div>
							</div>

							<!-- Demo vote buttons -->
							<div class="demo-vote-buttons">
								<button
									onpointerdown={() => demoHold.start(1)}
									onpointerup={demoHold.cancel}
									onpointerleave={demoHold.cancel}
									class="demo-vote-btn demo-vote-agree"
									class:holding={demoHold.holdingId === 1}
									class:voted={demoVoted === 1}
								>
									<span
										class="demo-vote-fill demo-fill-agree"
										style="transform: scaleY({demoHold.holdingId === 1 ? demoHold.progress : 0})"
									></span>
									<span class="demo-vote-emoji"
										><ThumbsUp
											size={24}
											color={demoHold.holdingId === 1 || demoVoted === 1 ? '#166534' : '#22c55e'}
										/></span
									>
									<span class="demo-vote-label">賛成</span>
								</button>
								<button
									onpointerdown={() => demoHold.start(0)}
									onpointerup={demoHold.cancel}
									onpointerleave={demoHold.cancel}
									class="demo-vote-btn demo-vote-neutral"
									class:holding={demoHold.holdingId === 0}
									class:voted={demoVoted === 0}
								>
									<span
										class="demo-vote-fill demo-fill-neutral"
										style="transform: scaleY({demoHold.holdingId === 0 ? demoHold.progress : 0})"
									></span>
									<span class="demo-vote-emoji"
										><CircleQuestionMark
											size={24}
											color={demoHold.holdingId === 0 || demoVoted === 0 ? '#1e40af' : '#3b82f6'}
										/></span
									>
									<span class="demo-vote-label">わからない</span>
								</button>
								<button
									onpointerdown={() => demoHold.start(-1)}
									onpointerup={demoHold.cancel}
									onpointerleave={demoHold.cancel}
									class="demo-vote-btn demo-vote-disagree"
									class:holding={demoHold.holdingId === -1}
									class:voted={demoVoted === -1}
								>
									<span
										class="demo-vote-fill demo-fill-disagree"
										style="transform: scaleY({demoHold.holdingId === -1 ? demoHold.progress : 0})"
									></span>
									<span class="demo-vote-emoji"
										><ThumbsDown
											size={24}
											color={demoHold.holdingId === -1 || demoVoted === -1 ? '#991b1b' : '#ef4444'}
										/></span
									>
									<span class="demo-vote-label">反対</span>
								</button>
							</div>
							{#if demoVoted !== null}
								<div class="demo-voted-feedback">
									{#if demoVoted === 1}
										<span class="demo-feedback demo-feedback-agree">✓ 賛成しました！</span>
									{:else if demoVoted === 0}
										<span class="demo-feedback demo-feedback-neutral">✓ スキップしました</span>
									{:else}
										<span class="demo-feedback demo-feedback-disagree">✓ 反対しました！</span>
									{/if}
									<span class="demo-feedback-hint">この調子で本番も回答してください</span>
								</div>
							{:else}
								<p class="demo-hint">↑ 試しにどれかを長押ししてみてください</p>
							{/if}
						</div>
					{:else if currentStep === 2}
						<!-- Step 3: Category navigation -->
						<div class="step-body fade-in">
							<h2 class="step-title">カテゴリを切り替える</h2>
							<p class="step-desc">
								法案はテーマ別に分かれています。いくつか回答したら、右の矢印で次のカテゴリへ進めます。
							</p>

							<!-- Demo category chips -->
							<div class="demo-chips-row">
								<div class="demo-chip demo-chip-completed">
									<span class="demo-chip-check">✓</span>
									経済政策
								</div>
								<div class="demo-chip demo-chip-active">社会保障</div>
								<div class="demo-chip demo-chip-pending">外交・安全保障</div>
							</div>

							<!-- Demo progress bar -->
							<div class="demo-progress-row">
								<div class="demo-progress-bar-container">
									<div class="demo-progress-bar" style="width: 60%"></div>
								</div>
								<span class="demo-progress-label">6/10</span>
							</div>

							<!-- Demo navigation arrows -->
							<div class="demo-nav-illustration">
								<div class="demo-nav-side">
									<div class="demo-nav-circle demo-nav-left-circle">
										<ChevronLeft size={20} />
									</div>
									<span class="demo-nav-text">前のカテゴリ</span>
								</div>
								<div class="demo-nav-center">
									<div class="demo-card-mini">
										<div class="demo-card-mini-title">法案カード</div>
										<div class="demo-card-mini-buttons">
											<span class="mini-btn mini-agree">👍</span>
											<span class="mini-btn mini-neutral">❓</span>
											<span class="mini-btn mini-disagree">👎</span>
										</div>
									</div>
								</div>
								<div class="demo-nav-side">
									<div class="demo-nav-circle demo-nav-right-circle pulse-hint">
										<ChevronRight size={20} />
									</div>
									<span class="demo-nav-text">次のカテゴリ</span>
								</div>
							</div>
							<p class="demo-note">
								※ 2問以上回答すると右矢印が有効になります。全問回答しなくても進めます。
							</p>
						</div>
					{:else if currentStep === 3}
						<!-- Step 4: Importance rating -->
						<div class="step-body fade-in">
							<h2 class="step-title">重要度の設定</h2>
							<p class="step-desc">
								各カテゴリの重要度を★で設定できます。重要なテーマほど、最終結果に大きく反映されます。
							</p>

							<!-- Demo importance rating -->
							<div class="demo-importance-list">
								<div class="demo-importance-item">
									<span class="demo-importance-name">経済政策</span>
									<div class="demo-stars">
										{#each [1, 2, 3, 4, 5] as star (star)}
											<button
												class="demo-star-btn"
												class:selected={star <= demoImportance}
												onclick={() => (demoImportance = star)}
											>
												<Star
													size={18}
													fill={star <= demoImportance ? '#fbbf24' : 'none'}
													color={star <= demoImportance ? '#fbbf24' : '#d1d5db'}
												/>
											</button>
										{/each}
									</div>
								</div>
								<div class="demo-importance-item">
									<span class="demo-importance-name">社会保障</span>
									<div class="demo-stars">
										{#each [1, 2, 3, 4, 5] as star (star)}
											<Star
												size={18}
												fill={star <= 4 ? '#fbbf24' : 'none'}
												color={star <= 4 ? '#fbbf24' : '#d1d5db'}
											/>
										{/each}
									</div>
								</div>
								<div class="demo-importance-item">
									<span class="demo-importance-name">外交・安全保障</span>
									<div class="demo-stars">
										{#each [1, 2, 3, 4, 5] as star (star)}
											<Star
												size={18}
												fill={star <= 2 ? '#fbbf24' : 'none'}
												color={star <= 2 ? '#fbbf24' : '#d1d5db'}
											/>
										{/each}
									</div>
								</div>
							</div>
							<p class="demo-hint">↑ ★をクリックして重要度を試してみてください</p>

							<div class="ready-message">
								<Rocket size={18} color="#6366f1" />
								<span>準備はできましたか？マッチングを始めましょう！</span>
							</div>
						</div>
					{/if}
				</div>

				<!-- Navigation footer -->
				<div class="tutorial-footer">
					<div class="footer-left">
						{#if currentStep > 0}
							<button class="tutorial-nav-btn tutorial-prev" onclick={prevStep}>
								<ChevronLeft size={16} /> 戻る
							</button>
						{:else}
							<div></div>
						{/if}
					</div>

					<div class="footer-center">
						<span class="step-counter">{currentStep + 1} / {TOTAL_STEPS}</span>
					</div>

					<div class="footer-right">
						{#if currentStep < TOTAL_STEPS - 1}
							<button class="tutorial-nav-btn tutorial-next" onclick={nextStep}>
								次へ <ChevronRight size={16} />
							</button>
						{:else}
							<button class="tutorial-nav-btn tutorial-start" onclick={handleDismiss}>
								{#if isLoading}
									<span class="loading-dot-anim"></span>
									準備中...
								{:else}
									閉じる
								{/if}
							</button>
						{/if}
					</div>
				</div>
			{:else}
				<!-- ===== EXPLANATION TAB ===== -->
				<div class="explanation-content fade-in">
					<div class="explanation-intro">
						<h3><Target size={16} class="inline-icon" /> どうやってマッチングしているの？</h3>
						<p>
							このマッチングシステムは、<strong>適応型質問選択</strong>と<strong>ベイズ推定</strong>
							を組み合わせた手法で、あなたの政治的立場を効率的に推定します。
						</p>
					</div>

					<div class="explanation-diagram">
						<div class="diagram-step">
							<div class="diagram-step-number">1</div>
							<div class="diagram-step-content">
								<div class="diagram-step-title">分野（クラスター）選択</div>
								<div class="diagram-step-visual cluster-visual">
									<div class="cluster-box">経済政策</div>
									<div class="cluster-box">外交・安全保障</div>
									<div class="cluster-box">社会保障</div>
									<div class="cluster-box">環境・エネルギー</div>
								</div>
								<div class="diagram-step-desc">複数の政策分野ごとに質問に回答</div>
							</div>
						</div>

						<div class="diagram-arrow-down">↓</div>

						<div class="diagram-step">
							<div class="diagram-step-number">2</div>
							<div class="diagram-step-content">
								<div class="diagram-step-title">適応型質問選択</div>
								<div class="diagram-step-visual question-visual">
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
								<div class="diagram-step-desc">最も情報価値の高い法案を優先的に質問</div>
							</div>
						</div>

						<div class="diagram-arrow-down">↓</div>

						<div class="diagram-step">
							<div class="diagram-step-number">3</div>
							<div class="diagram-step-content">
								<div class="diagram-step-title">立場の推定</div>
								<div class="diagram-step-visual vector-visual">
									<div class="vector-space">
										<div class="vector-point user">あなた</div>
										<div class="vector-point member-1">議員A</div>
										<div class="vector-point member-2">議員B</div>
										<div class="vector-point member-3">議員C</div>
									</div>
								</div>
								<div class="diagram-step-desc">回答から多次元空間での立ち位置を計算</div>
							</div>
						</div>

						<div class="diagram-arrow-down">↓</div>

						<div class="diagram-step">
							<div class="diagram-step-number">4</div>
							<div class="diagram-step-content">
								<div class="diagram-step-title">分野別重要度設定</div>
								<div class="diagram-step-visual importance-visual">
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
								<div class="diagram-step-desc">各分野の重要度を5段階で評価</div>
							</div>
						</div>

						<div class="diagram-arrow-down">↓</div>

						<div class="diagram-step">
							<div class="diagram-step-number">5</div>
							<div class="diagram-step-content">
								<div class="diagram-step-title">総合マッチ度算出</div>
								<div class="diagram-step-visual result-visual">
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
								<div class="diagram-step-desc">分野別マッチ度 × 重要度の加重平均で算出</div>
							</div>
						</div>
					</div>

					<div class="explanation-details">
						<div class="detail-card">
							<h4><Brain size={16} class="inline-icon" /> 適応型質問選択とは？</h4>
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
								<Lightbulb size={14} class="inline-icon" color="#f59e0b" /> これにより、ランダムな質問よりも少ない回答数で正確な推定が可能になります。
							</p>
						</div>

						<div class="detail-card">
							<h4><Ruler size={16} class="inline-icon" /> コサイン類似度によるマッチング</h4>
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
								<Lightbulb size={14} class="inline-icon" color="#f59e0b" />
								ベクトルの「方向」が似ているかを見るため、投票パターンの傾向が一致するかを測れます。
							</p>
						</div>

						<div class="detail-card">
							<h4><Scale size={16} class="inline-icon" /> 分野別重要度の反映</h4>
							<p>
								各分野でのマッチ度を、あなたが設定した<strong>重要度</strong
								>で重み付けして総合スコアを計算します。
							</p>
							<div class="formula-box">
								<code> 総合スコア = Σ (分野iのマッチ度 × 重要度i) / Σ 重要度i </code>
							</div>
							<p class="detail-note">
								<Lightbulb size={14} class="inline-icon" color="#f59e0b" /> あなたが重視する分野でのマッチ度が、総合スコアに大きく影響します。
							</p>
						</div>

						<div class="detail-card">
							<h4><Search size={16} class="inline-icon" /> なぜ分野別に質問するの？</h4>
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
							<h4><Palette size={16} class="inline-icon" /> 2D可視化について</h4>
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
								<Lightbulb size={14} class="inline-icon" color="#f59e0b" /> 2次元表示は簡略化されたものです。実際のマッチング計算は全次元を使用しています。
							</p>
						</div>
					</div>
				</div>
			{/if}

			<!-- Loading indicator -->
			{#if isLoading}
				<div class="loading-bar">
					<div class="loading-bar-fill"></div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* ===== OVERLAY ===== */
	.tutorial-overlay {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.tutorial-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
	}

	.tutorial-card {
		position: relative;
		width: 100%;
		max-width: 560px;
		max-height: 85vh;
		overflow-y: auto;
		background: white;
		border-radius: 20px;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.2);
		padding: 2rem;
		animation: tutorialSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
	}

	@keyframes tutorialSlideIn {
		from {
			opacity: 0;
			transform: translateY(30px) scale(0.96);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	/* ===== CLOSE BUTTON ===== */
	.tutorial-close {
		position: absolute;
		top: 1rem;
		right: 1rem;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: none;
		background: #f3f4f6;
		color: #6b7280;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s;
		z-index: 2;
	}

	.tutorial-close:hover {
		background: #e5e7eb;
		color: #374151;
	}

	/* ===== TAB SWITCHER ===== */
	.tab-switcher {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.25rem;
		border-bottom: 2px solid #f3f4f6;
		padding-bottom: 0.75rem;
	}

	.tab-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 1rem;
		border-radius: 10px 10px 0 0;
		border: none;
		background: transparent;
		font-size: 0.85rem;
		font-weight: 600;
		color: #9ca3af;
		cursor: pointer;
		transition: all 0.2s;
		border-bottom: 2px solid transparent;
		margin-bottom: -2px;
	}

	.tab-btn:hover {
		color: #6b7280;
		background: #f9fafb;
	}

	.tab-btn.active {
		color: #6366f1;
		border-bottom-color: #6366f1;
		background: #eef2ff;
	}

	/* Wide card for explanation tab */
	.tutorial-card.wide {
		max-width: 720px;
	}

	/* ===== STEP DOTS ===== */
	.step-dots {
		display: flex;
		justify-content: center;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}

	.step-dot {
		width: 8px;
		height: 8px;
		border-radius: 100px;
		border: none;
		background: #e5e7eb;
		cursor: pointer;
		padding: 0;
		transition: all 0.3s;
	}

	.step-dot.active {
		width: 24px;
		background: #6366f1;
	}

	.step-dot.completed {
		background: #a5b4fc;
	}

	/* ===== STEP CONTENT ===== */
	.step-content {
		min-height: 340px;
	}

	.step-body {
		text-align: center;
	}

	.fade-in {
		animation: fadeIn 0.3s ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateX(10px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}

	.step-icon-wrapper {
		width: 56px;
		height: 56px;
		border-radius: 16px;
		background: linear-gradient(135deg, #eef2ff, #e0e7ff);
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 1rem;
	}

	.step-title {
		font-size: 1.35rem;
		font-weight: 700;
		color: #1a1a2e;
		margin-bottom: 0.5rem;
	}

	.step-desc {
		font-size: 0.9rem;
		color: #6b7280;
		line-height: 1.6;
		margin-bottom: 1.25rem;
	}

	/* ===== FLOW DIAGRAM (Step 1) ===== */
	.flow-diagram {
		display: flex;
		align-items: flex-start;
		justify-content: center;
		gap: 0.25rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	.flow-step {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		min-width: 80px;
	}

	.flow-number {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: #eef2ff;
		color: #6366f1;
		font-size: 0.8rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.flow-step.highlight .flow-number {
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
	}

	.flow-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: #374151;
	}

	.flow-sublabel {
		font-size: 0.7rem;
		color: #9ca3af;
	}

	.flow-arrow {
		color: #d1d5db;
		margin-top: 0.25rem;
	}

	.category-preview {
		background: #f9fafb;
		border-radius: 12px;
		padding: 0.75rem 1rem;
		text-align: left;
	}

	.category-preview-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #6b7280;
		display: block;
		margin-bottom: 0.5rem;
	}

	.category-tags {
		display: flex;
		gap: 0.375rem;
		flex-wrap: wrap;
	}

	.category-tag {
		background: #e0e7ff;
		color: #4338ca;
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.25rem 0.625rem;
		border-radius: 100px;
	}

	/* ===== DEMO BILL CARD (Step 2) ===== */
	.demo-bill-card {
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1rem;
		text-align: left;
		margin-bottom: 1rem;
	}

	.demo-bill-badge {
		display: inline-block;
		background: #ddd6fe;
		color: #6d28d9;
		font-size: 0.7rem;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 100px;
		margin-bottom: 0.375rem;
	}

	.demo-bill-title {
		font-size: 0.95rem;
		font-weight: 600;
		color: #1a1a2e;
		margin-bottom: 0.25rem;
		line-height: 1.4;
	}

	.demo-bill-desc {
		font-size: 0.8rem;
		color: #6b7280;
		line-height: 1.5;
	}

	/* ===== DEMO VOTE BUTTONS (Step 2) ===== */
	.demo-vote-buttons {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
		margin-bottom: 0.75rem;
	}

	.demo-vote-btn {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 0.625rem 1.25rem;
		border-radius: 14px;
		border: 2px solid #e5e7eb;
		background: white;
		cursor: pointer;
		transition: all 0.2s;
		overflow: hidden;
		min-width: 80px;
		-webkit-user-select: none;
		user-select: none;
		touch-action: none;
	}

	.demo-vote-btn:active {
		transform: scale(0.97);
	}

	.demo-vote-agree {
		border-color: #bbf7d0;
	}
	.demo-vote-neutral {
		border-color: #bfdbfe;
	}
	.demo-vote-disagree {
		border-color: #fecaca;
	}

	.demo-vote-agree.holding,
	.demo-vote-agree.voted {
		border-color: #22c55e;
		background: #f0fdf4;
	}
	.demo-vote-neutral.holding,
	.demo-vote-neutral.voted {
		border-color: #3b82f6;
		background: #eff6ff;
	}
	.demo-vote-disagree.holding,
	.demo-vote-disagree.voted {
		border-color: #ef4444;
		background: #fef2f2;
	}

	.demo-vote-fill {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		top: 0;
		transform-origin: bottom;
		border-radius: 12px;
		transition: none;
	}

	.demo-fill-agree {
		background: rgba(34, 197, 94, 0.15);
	}
	.demo-fill-neutral {
		background: rgba(59, 130, 246, 0.12);
	}
	.demo-fill-disagree {
		background: rgba(239, 68, 68, 0.12);
	}

	.demo-vote-emoji {
		position: relative;
		z-index: 1;
	}

	.demo-vote-label {
		position: relative;
		z-index: 1;
		font-size: 0.8rem;
		font-weight: 600;
		color: #374151;
	}

	.demo-voted-feedback {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		animation: fadeIn 0.3s ease;
	}

	.demo-feedback {
		font-size: 0.9rem;
		font-weight: 600;
		padding: 0.25rem 0.75rem;
		border-radius: 100px;
	}

	.demo-feedback-agree {
		background: #dcfce7;
		color: #166534;
	}
	.demo-feedback-neutral {
		background: #dbeafe;
		color: #1e40af;
	}
	.demo-feedback-disagree {
		background: #fee2e2;
		color: #991b1b;
	}

	.demo-feedback-hint {
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.demo-hint {
		font-size: 0.8rem;
		color: #9ca3af;
		animation: hintPulse 2s ease-in-out infinite;
	}

	@keyframes hintPulse {
		0%,
		100% {
			opacity: 0.6;
		}
		50% {
			opacity: 1;
		}
	}

	/* ===== DEMO CHIPS (Step 3) ===== */
	.demo-chips-row {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		margin-bottom: 1rem;
	}

	.demo-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.375rem 0.75rem;
		border-radius: 100px;
		font-size: 0.8rem;
		font-weight: 600;
		border: 2px solid transparent;
	}

	.demo-chip-completed {
		background: #d1fae5;
		color: #065f46;
		border-color: #10b981;
	}

	.demo-chip-active {
		background: #ddd6fe;
		color: #5b21b6;
		border-color: #8b5cf6;
	}

	.demo-chip-pending {
		background: #f3f4f6;
		color: #6b7280;
		border-color: #e5e7eb;
	}

	.demo-chip-check {
		font-size: 0.7rem;
	}

	.demo-progress-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		max-width: 300px;
		margin: 0 auto 1.25rem;
	}

	.demo-progress-bar-container {
		flex: 1;
		height: 6px;
		background: #e5e7eb;
		border-radius: 100px;
		overflow: hidden;
	}

	.demo-progress-bar {
		height: 100%;
		background: linear-gradient(90deg, #6366f1, #a855f7);
		border-radius: 100px;
	}

	.demo-progress-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #6b7280;
	}

	/* ===== DEMO NAVIGATION (Step 3) ===== */
	.demo-nav-illustration {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
		margin-bottom: 1rem;
	}

	.demo-nav-side {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
	}

	.demo-nav-circle {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		border: 2px solid #d1d5db;
		background: white;
		color: #6b7280;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.demo-nav-right-circle {
		border-color: #6366f1;
		background: #eef2ff;
		color: #6366f1;
	}

	.demo-nav-left-circle {
		border-color: #d1d5db;
		background: #f9fafb;
	}

	.pulse-hint {
		animation: pulseHint 2s ease-in-out infinite;
	}

	@keyframes pulseHint {
		0%,
		100% {
			transform: scale(1);
			box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.3);
		}
		50% {
			transform: scale(1.08);
			box-shadow: 0 0 0 8px rgba(99, 102, 241, 0);
		}
	}

	.demo-nav-text {
		font-size: 0.7rem;
		color: #9ca3af;
		font-weight: 500;
	}

	.demo-card-mini {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		padding: 0.75rem 1rem;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
		text-align: center;
	}

	.demo-card-mini-title {
		font-size: 0.75rem;
		font-weight: 600;
		color: #374151;
		margin-bottom: 0.375rem;
	}

	.demo-card-mini-buttons {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
	}

	.mini-btn {
		font-size: 0.9rem;
		width: 28px;
		height: 28px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.mini-agree {
		background: #dcfce7;
	}
	.mini-neutral {
		background: #dbeafe;
	}
	.mini-disagree {
		background: #fee2e2;
	}

	.demo-note {
		font-size: 0.75rem;
		color: #9ca3af;
		background: #f9fafb;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		text-align: left;
	}

	/* ===== DEMO IMPORTANCE (Step 4) ===== */
	.demo-importance-list {
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		margin-bottom: 0.75rem;
	}

	.demo-importance-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: #f9fafb;
		border: 1px solid #e5e7eb;
		border-radius: 10px;
		padding: 0.625rem 1rem;
	}

	.demo-importance-name {
		font-size: 0.85rem;
		font-weight: 600;
		color: #374151;
	}

	.demo-stars {
		display: flex;
		gap: 0.125rem;
	}

	.demo-star-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.125rem;
		border-radius: 4px;
		transition: transform 0.15s;
		display: flex;
		align-items: center;
	}

	.demo-star-btn:hover {
		transform: scale(1.2);
	}

	.ready-message {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: linear-gradient(135deg, #eef2ff, #e0e7ff);
		color: #4338ca;
		font-size: 0.9rem;
		font-weight: 600;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		margin-top: 1rem;
	}

	/* ===== FOOTER ===== */
	.tutorial-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid #f3f4f6;
	}

	.footer-left,
	.footer-right {
		min-width: 100px;
	}

	.footer-right {
		display: flex;
		justify-content: flex-end;
	}

	.step-counter {
		font-size: 0.75rem;
		font-weight: 500;
		color: #9ca3af;
	}

	.tutorial-nav-btn {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem 1rem;
		border-radius: 10px;
		border: none;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
	}

	.tutorial-prev {
		background: #f3f4f6;
		color: #374151;
	}

	.tutorial-prev:hover {
		background: #e5e7eb;
	}

	.tutorial-next {
		background: #6366f1;
		color: white;
	}

	.tutorial-next:hover {
		background: #4f46e5;
	}

	.tutorial-start {
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		padding: 0.5rem 1.25rem;
	}

	.tutorial-start:hover {
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
		transform: translateY(-1px);
	}

	/* ===== LOADING BAR ===== */
	.loading-bar {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 3px;
		background: #eef2ff;
		border-radius: 0 0 20px 20px;
		overflow: hidden;
	}

	.loading-bar-fill {
		height: 100%;
		width: 40%;
		background: linear-gradient(90deg, #6366f1, #a855f7);
		border-radius: 100px;
		animation: loadingSlide 1.2s ease-in-out infinite;
	}

	@keyframes loadingSlide {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(350%);
		}
	}

	.loading-dot-anim {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: white;
		animation: dotBlink 1s ease-in-out infinite;
	}

	@keyframes dotBlink {
		0%,
		100% {
			opacity: 0.3;
		}
		50% {
			opacity: 1;
		}
	}

	/* ===== EXPLANATION TAB CONTENT ===== */
	.explanation-content {
		padding: 0.5rem 0;
		text-align: left;
	}

	.explanation-intro {
		margin-bottom: 2rem;
	}

	.explanation-intro h3 {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 0.75rem;
	}

	.explanation-intro p {
		font-size: 0.95rem;
		color: #4b5563;
		line-height: 1.7;
	}

	.explanation-diagram {
		margin: 2rem 0;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.diagram-step {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
	}

	.diagram-step-number {
		flex-shrink: 0;
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		border-radius: 50%;
		font-weight: 700;
		font-size: 1rem;
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
	}

	.diagram-step-content {
		flex: 1;
	}

	.diagram-step-title {
		font-size: 1rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 0.5rem;
	}

	.diagram-step-visual {
		margin: 0.75rem 0;
		padding: 1rem;
		background: #f9fafb;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
	}

	.diagram-step-desc {
		font-size: 0.85rem;
		color: #6b7280;
		margin-top: 0.5rem;
		font-style: italic;
	}

	.diagram-arrow-down {
		text-align: center;
		font-size: 1.5rem;
		color: #6366f1;
		margin: 0.25rem 0;
	}

	/* Cluster Visual */
	.cluster-visual {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 0.5rem;
	}

	.cluster-box {
		padding: 0.5rem 0.75rem;
		background: linear-gradient(135deg, #ddd6fe, #e9d5ff);
		border-radius: 8px;
		text-align: center;
		font-weight: 600;
		font-size: 0.8rem;
		color: #5b21b6;
		border: 1px solid #c4b5fd;
	}

	/* Question Visual */
	.question-visual {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.question-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: white;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
	}

	.q-label {
		flex-shrink: 0;
		padding: 0.2rem 0.5rem;
		background: #6366f1;
		color: white;
		border-radius: 6px;
		font-weight: 600;
		font-size: 0.75rem;
	}

	.q-desc {
		font-size: 0.8rem;
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
		height: 160px;
		background: linear-gradient(135deg, #ede9fe 0%, #fae8ff 100%);
		border-radius: 8px;
		border: 2px solid #c4b5fd;
	}

	.vector-point {
		position: absolute;
		padding: 0.375rem 0.75rem;
		background: white;
		border-radius: 8px;
		font-weight: 600;
		font-size: 0.75rem;
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
		gap: 0.75rem;
	}

	.importance-bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.importance-bar > span:first-child {
		flex-shrink: 0;
		width: 100px;
		font-weight: 600;
		font-size: 0.8rem;
		color: #1f2937;
	}

	.bar-fill {
		flex: 1;
		height: 28px;
		background: linear-gradient(90deg, #fbbf24, #f59e0b);
		border-radius: 6px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		font-weight: 600;
		font-size: 0.8rem;
		box-shadow: 0 2px 6px rgba(245, 158, 11, 0.3);
	}

	/* Result Visual */
	.result-visual {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.result-card {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
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
		width: 40px;
		height: 40px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #6366f1;
		color: white;
		border-radius: 50%;
		font-weight: 700;
		font-size: 0.75rem;
	}

	.result-card.top .rank {
		background: linear-gradient(135deg, #f59e0b, #d97706);
	}

	.result-card .name {
		flex: 1;
		font-weight: 600;
		font-size: 0.9rem;
		color: #1f2937;
	}

	.result-card .score {
		flex-shrink: 0;
		font-size: 1.1rem;
		font-weight: 700;
		color: #6366f1;
	}

	.result-card.top .score {
		color: #d97706;
	}

	/* Explanation Details */
	.explanation-details {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		margin-top: 2rem;
	}

	.detail-card {
		padding: 1.25rem;
		background: white;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
	}

	.detail-card h4 {
		font-size: 1rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 0.75rem;
	}

	.detail-card p {
		font-size: 0.9rem;
		color: #4b5563;
		line-height: 1.6;
		margin-bottom: 0.75rem;
	}

	.detail-card ul {
		list-style: none;
		padding: 0;
		margin: 0.75rem 0;
	}

	.detail-card ul li {
		padding: 0.375rem 0;
		padding-left: 1.25rem;
		position: relative;
		font-size: 0.9rem;
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
		margin-top: 0.75rem;
		padding: 0.75rem;
		background: linear-gradient(135deg, #fef3c7, #fef9e7);
		border-left: 4px solid #f59e0b;
		border-radius: 6px;
		font-size: 0.85rem;
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
		margin: 0.75rem 0;
		padding: 0.75rem;
		background: #1f2937;
		border-radius: 8px;
		overflow-x: auto;
	}

	.formula-box code {
		color: #10b981;
		font-family: 'Monaco', 'Courier New', monospace;
		font-size: 0.85rem;
		white-space: nowrap;
	}

	:global(.inline-icon) {
		display: inline-block;
		vertical-align: -2px;
	}

	/* ===== RESPONSIVE ===== */
	@media (max-width: 480px) {
		.tutorial-card {
			padding: 1.5rem 1.25rem;
			max-height: 90vh;
			border-radius: 16px;
		}

		.tutorial-card.wide {
			max-width: 100%;
		}

		.step-title {
			font-size: 1.15rem;
		}

		.flow-diagram {
			gap: 0.125rem;
		}

		.flow-step {
			min-width: 60px;
		}

		.flow-label {
			font-size: 0.7rem;
		}

		.demo-vote-btn {
			min-width: 70px;
			padding: 0.5rem 0.75rem;
		}

		.demo-nav-illustration {
			gap: 0.75rem;
		}

		.explanation-details {
			gap: 1rem;
		}

		.detail-card {
			padding: 1rem;
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
