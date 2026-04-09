<script lang="ts">
	import { ChevronRight, ChevronLeft, Star, Rocket, X, BookOpen, Cog } from '@lucide/svelte';
	import { createHoldGesture } from '$lib/utils/hold-gesture.svelte.js';
	import VoteButton from '$lib/components/match/VoteButton.svelte';
	import ExplanationContent from '$lib/components/match/ExplanationContent.svelte';

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
								{#each [1, 0, -1] as score (score)}
									<VoteButton
										{score}
										isHolding={demoHold.holdingId === score}
										progress={demoHold.progress}
										iconSize={24}
										className={demoVoted === score ? 'voted' : ''}
										onpointerdown={() => demoHold.start(score)}
										onpointerup={demoHold.cancel}
										onpointerleave={demoHold.cancel}
									/>
								{/each}
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
					<ExplanationContent compact />
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

		.demo-nav-illustration {
			gap: 0.75rem;
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
