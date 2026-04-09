<script lang="ts">
	import { Target, Brain, Lightbulb, Ruler, Scale, Search, Palette } from '@lucide/svelte';

	interface Props {
		compact?: boolean;
	}

	let { compact = false }: Props = $props();
</script>

<div class="explanation-content" class:compact>
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
					<strong>情報価値の最大化</strong>：その次元に関連する法案（因子負荷量が高い法案）を選択
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
					<strong>クラスタリング</strong>：似た性質の法案をグループ化することで、効率的に質問できる
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

<style>
	.explanation-content {
		padding: 0;
	}

	.explanation-content.compact {
		padding: 0.5rem 0;
		text-align: left;
	}

	/* ===== INTRO ===== */
	.explanation-intro {
		margin-bottom: 3rem;
	}

	.compact .explanation-intro {
		margin-bottom: 2rem;
	}

	.explanation-intro h3 {
		font-size: 1.5rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 1rem;
	}

	.compact .explanation-intro h3 {
		font-size: 1.25rem;
		margin-bottom: 0.75rem;
	}

	.explanation-intro p {
		font-size: 1.05rem;
		color: #4b5563;
		line-height: 1.7;
	}

	.compact .explanation-intro p {
		font-size: 0.95rem;
	}

	/* ===== DIAGRAM ===== */
	.explanation-diagram {
		margin: 3rem 0;
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.compact .explanation-diagram {
		margin: 2rem 0;
		padding: 0;
		gap: 1rem;
	}

	.diagram-step {
		display: flex;
		gap: 1.5rem;
		align-items: flex-start;
	}

	.compact .diagram-step {
		gap: 1rem;
	}

	.diagram-step-number {
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

	.compact .diagram-step-number {
		width: 36px;
		height: 36px;
		font-size: 1rem;
	}

	.diagram-step-content {
		flex: 1;
	}

	.diagram-step-title {
		font-size: 1.125rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 1rem;
	}

	.compact .diagram-step-title {
		font-size: 1rem;
		margin-bottom: 0.5rem;
	}

	.diagram-step-visual {
		margin: 1rem 0;
		padding: 1.5rem;
		background: #f9fafb;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
	}

	.compact .diagram-step-visual {
		margin: 0.75rem 0;
		padding: 1rem;
	}

	.diagram-step-desc {
		font-size: 0.95rem;
		color: #6b7280;
		margin-top: 0.75rem;
		font-style: italic;
	}

	.compact .diagram-step-desc {
		font-size: 0.85rem;
		margin-top: 0.5rem;
	}

	.diagram-arrow-down {
		text-align: center;
		font-size: 2rem;
		color: #6366f1;
		margin: 0.5rem 0;
	}

	.compact .diagram-arrow-down {
		font-size: 1.5rem;
		margin: 0.25rem 0;
	}

	/* ===== Cluster Visual ===== */
	.cluster-visual {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 0.75rem;
	}

	.compact .cluster-visual {
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 0.5rem;
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

	.compact .cluster-box {
		padding: 0.5rem 0.75rem;
		font-size: 0.8rem;
	}

	/* ===== Question Visual ===== */
	.question-visual {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.compact .question-visual {
		gap: 0.5rem;
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

	.compact .question-item {
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
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

	.compact .q-label {
		padding: 0.2rem 0.5rem;
		font-size: 0.75rem;
	}

	.q-desc {
		font-size: 0.9rem;
		color: #4b5563;
	}

	.compact .q-desc {
		font-size: 0.8rem;
	}

	/* ===== Vector Visual ===== */
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

	.compact .vector-space {
		height: 160px;
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

	.compact .vector-point {
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
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

	/* ===== Importance Visual ===== */
	.importance-visual {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.compact .importance-visual {
		gap: 0.75rem;
	}

	.importance-bar {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.compact .importance-bar {
		gap: 0.75rem;
	}

	.importance-bar > span:first-child {
		flex-shrink: 0;
		width: 120px;
		font-weight: 600;
		font-size: 0.9rem;
		color: #1f2937;
	}

	.compact .importance-bar > span:first-child {
		width: 100px;
		font-size: 0.8rem;
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

	.compact .bar-fill {
		height: 28px;
		font-size: 0.8rem;
	}

	/* ===== Result Visual ===== */
	.result-visual {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.compact .result-visual {
		gap: 0.5rem;
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

	.compact .result-card {
		gap: 0.75rem;
		padding: 0.75rem 1rem;
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

	.compact .result-card .rank {
		width: 40px;
		height: 40px;
		font-size: 0.75rem;
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

	.compact .result-card .name {
		font-size: 0.9rem;
	}

	.result-card .score {
		flex-shrink: 0;
		font-size: 1.25rem;
		font-weight: 700;
		color: #6366f1;
	}

	.compact .result-card .score {
		font-size: 1.1rem;
	}

	.result-card.top .score {
		color: #d97706;
	}

	/* ===== Explanation Details ===== */
	.explanation-details {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1.5rem;
		margin-top: 3rem;
	}

	.compact .explanation-details {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		margin-top: 2rem;
	}

	.detail-card {
		padding: 1.5rem;
		background: white;
		border-radius: 12px;
		border: 1px solid #e5e7eb;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
	}

	.compact .detail-card {
		padding: 1.25rem;
	}

	.detail-card h4 {
		font-size: 1.125rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 1rem;
	}

	.compact .detail-card h4 {
		font-size: 1rem;
		margin-bottom: 0.75rem;
	}

	.detail-card p {
		font-size: 0.95rem;
		color: #4b5563;
		line-height: 1.6;
		margin-bottom: 1rem;
	}

	.compact .detail-card p {
		font-size: 0.9rem;
		margin-bottom: 0.75rem;
	}

	.detail-card ul {
		list-style: none;
		padding: 0;
		margin: 1rem 0;
	}

	.compact .detail-card ul {
		margin: 0.75rem 0;
	}

	.detail-card ul li {
		padding: 0.5rem 0;
		padding-left: 1.5rem;
		position: relative;
		font-size: 0.95rem;
		color: #4b5563;
		line-height: 1.6;
	}

	.compact .detail-card ul li {
		padding: 0.375rem 0;
		padding-left: 1.25rem;
		font-size: 0.9rem;
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

	.compact .detail-note {
		margin-top: 0.75rem;
		padding: 0.75rem;
		font-size: 0.85rem;
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

	.compact .formula-box {
		margin: 0.75rem 0;
		padding: 0.75rem;
	}

	.formula-box code {
		color: #10b981;
		font-family: 'Monaco', 'Courier New', monospace;
		font-size: 0.9rem;
		white-space: nowrap;
	}

	.compact .formula-box code {
		font-size: 0.85rem;
	}

	@media (max-width: 480px) {
		.explanation-details {
			gap: 1rem;
		}

		.detail-card {
			padding: 1rem;
		}
	}
</style>
