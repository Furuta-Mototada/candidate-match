<script lang="ts">
	/**
	 * LatentSpaceVisualization Component
	 *
	 * A reusable 2D scatter plot for visualizing positions in latent space.
	 * Used in member-vectors page and match page to show member positions
	 * and optionally a user's position.
	 */

	interface MemberPoint {
		memberId: number;
		name: string;
		group: string | null;
		latentVector: number[];
	}

	interface HighlightedMember {
		memberId: number;
		similarity?: number;
	}

	interface Props {
		/** Array of members with their latent vectors */
		members: MemberPoint[];
		/** Explained variance for each dimension (optional) */
		explainedVariance?: number[];
		/** Which dimension to show on X axis */
		xDimension?: number;
		/** Which dimension to show on Y axis */
		yDimension?: number;
		/** User's current position vector (optional) */
		userVector?: number[];
		/** History of user positions for trajectory (optional) */
		userVectorHistory?: number[][];
		/** Members to highlight (e.g., top matches) */
		highlightedMembers?: HighlightedMember[];
		/** Width of the canvas */
		width?: number;
		/** Height of the canvas */
		height?: number;
		/** Whether to show dimension selectors */
		showDimensionSelectors?: boolean;
		/** Title for the visualization */
		title?: string;
		/** Whether to show the legend */
		showLegend?: boolean;
		/** Compact mode for smaller displays */
		compact?: boolean;
		/** Whether the visualization can be collapsed */
		collapsible?: boolean;
		/** Label for the button when collapsed */
		collapsedLabel?: string;
		/** Label for the button when expanded */
		expandedLabel?: string;
	}

	let {
		members = [],
		explainedVariance = [],
		xDimension = $bindable(0),
		yDimension = $bindable(1),
		userVector = [],
		userVectorHistory = [],
		highlightedMembers = [],
		width = 600,
		height = 450,
		showDimensionSelectors = true,
		title = '2D 可視化',
		showLegend = true,
		compact = false,
		collapsible = false,
		collapsedLabel = '表示',
		expandedLabel = '隠す'
	}: Props = $props();

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let hoveredMember: MemberPoint | null = $state(null);
	let isExpanded = $state(!collapsible);

	// Available dimensions based on vector length
	let availableDimensions = $derived(
		members.length > 0 && members[0].latentVector.length > 0
			? Array.from({ length: members[0].latentVector.length }, (_, i) => i)
			: userVector.length > 0
				? Array.from({ length: userVector.length }, (_, i) => i)
				: []
	);

	// Calculate bounds including all points
	let visualizationBounds = $derived.by(() => {
		if (!members.length && userVector.length === 0) {
			return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
		}

		let minX = Infinity,
			maxX = -Infinity;
		let minY = Infinity,
			maxY = -Infinity;

		// Include member positions
		for (const m of members) {
			const x = m.latentVector[xDimension] ?? 0;
			const y = m.latentVector[yDimension] ?? 0;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}

		// Include user vector
		if (userVector.length > 0) {
			const ux = userVector[xDimension] ?? 0;
			const uy = userVector[yDimension] ?? 0;
			if (ux < minX) minX = ux;
			if (ux > maxX) maxX = ux;
			if (uy < minY) minY = uy;
			if (uy > maxY) maxY = uy;
		}

		// Include history
		for (const vec of userVectorHistory) {
			const hx = vec[xDimension] ?? 0;
			const hy = vec[yDimension] ?? 0;
			if (hx < minX) minX = hx;
			if (hx > maxX) maxX = hx;
			if (hy < minY) minY = hy;
			if (hy > maxY) maxY = hy;
		}

		// Handle edge case where all points are the same
		if (minX === maxX) {
			minX -= 0.5;
			maxX += 0.5;
		}
		if (minY === maxY) {
			minY -= 0.5;
			maxY += 0.5;
		}

		// Add padding
		const padX = (maxX - minX) * 0.12;
		const padY = (maxY - minY) * 0.12;

		return {
			minX: minX - padX,
			maxX: maxX + padX,
			minY: minY - padY,
			maxY: maxY + padY
		};
	});

	function formatPercent(value: number): string {
		return (value * 100).toFixed(1) + '%';
	}

	function drawVisualization() {
		if (!canvasElement) return;
		if (!members.length && userVector.length === 0) return;

		const ctx = canvasElement.getContext('2d');
		if (!ctx) return;

		// Handle high-DPI displays
		const dpr = window.devicePixelRatio || 1;
		const displayWidth = width;
		const displayHeight = height;

		// Set actual canvas size in memory (scaled for DPI)
		canvasElement.width = displayWidth * dpr;
		canvasElement.height = displayHeight * dpr;

		// Scale context to match DPI
		ctx.scale(dpr, dpr);

		// Note: We rely on CSS for display size to ensure responsiveness
		// The inline style in the template handles width/height/aspect-ratio

		const bounds = visualizationBounds;
		const padding = compact ? 45 : 55;
		const plotWidth = displayWidth - padding * 2;
		const plotHeight = displayHeight - padding * 2;

		// Clear canvas
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, displayWidth, displayHeight);

		// Helper function to convert data to canvas coordinates
		const toCanvasX = (val: number) =>
			padding + ((val - bounds.minX) / (bounds.maxX - bounds.minX)) * plotWidth;
		const toCanvasY = (val: number) =>
			displayHeight - padding - ((val - bounds.minY) / (bounds.maxY - bounds.minY)) * plotHeight;

		// Draw grid
		ctx.strokeStyle = '#e5e7eb';
		ctx.lineWidth = 1;

		const gridLines = compact ? 4 : 5;
		for (let i = 0; i <= gridLines; i++) {
			const x = padding + (plotWidth / gridLines) * i;
			ctx.beginPath();
			ctx.moveTo(x, padding);
			ctx.lineTo(x, displayHeight - padding);
			ctx.stroke();
		}

		for (let i = 0; i <= gridLines; i++) {
			const y = padding + (plotHeight / gridLines) * i;
			ctx.beginPath();
			ctx.moveTo(padding, y);
			ctx.lineTo(displayWidth - padding, y);
			ctx.stroke();
		}

		// Draw axes
		ctx.strokeStyle = '#9ca3af';
		ctx.lineWidth = 2;

		// X axis
		ctx.beginPath();
		ctx.moveTo(padding, displayHeight - padding);
		ctx.lineTo(displayWidth - padding, displayHeight - padding);
		ctx.stroke();

		// Y axis
		ctx.beginPath();
		ctx.moveTo(padding, padding);
		ctx.lineTo(padding, displayHeight - padding);
		ctx.stroke();

		// Axis labels
		ctx.fillStyle = '#374151';
		ctx.font = compact ? '11px sans-serif' : '13px sans-serif';
		ctx.textAlign = 'center';

		const xLabel = explainedVariance[xDimension]
			? `次元 ${xDimension + 1} (${formatPercent(explainedVariance[xDimension])})`
			: `次元 ${xDimension + 1}`;
		ctx.fillText(xLabel, displayWidth / 2, displayHeight - (compact ? 8 : 12));

		ctx.save();
		ctx.translate(compact ? 12 : 16, displayHeight / 2);
		ctx.rotate(-Math.PI / 2);
		const yLabel = explainedVariance[yDimension]
			? `次元 ${yDimension + 1} (${formatPercent(explainedVariance[yDimension])})`
			: `次元 ${yDimension + 1}`;
		ctx.fillText(yLabel, 0, 0);
		ctx.restore();

		// Scale tick labels
		ctx.font = compact ? '9px sans-serif' : '10px sans-serif';
		ctx.fillStyle = '#6b7280';

		// X axis ticks
		for (let i = 0; i <= gridLines; i++) {
			const val = bounds.minX + ((bounds.maxX - bounds.minX) / gridLines) * i;
			const x = padding + (plotWidth / gridLines) * i;
			ctx.textAlign = 'center';
			ctx.fillText(val.toFixed(2), x, displayHeight - padding + (compact ? 12 : 14));
		}

		// Y axis ticks
		for (let i = 0; i <= gridLines; i++) {
			const val = bounds.maxY - ((bounds.maxY - bounds.minY) / gridLines) * i;
			const y = padding + (plotHeight / gridLines) * i;
			ctx.textAlign = 'right';
			ctx.fillText(val.toFixed(2), padding - 6, y + 3);
		}

		// Draw zero lines if in range
		ctx.strokeStyle = '#d1d5db';
		ctx.lineWidth = 1;
		ctx.setLineDash([4, 4]);

		if (bounds.minX < 0 && bounds.maxX > 0) {
			const zeroX = toCanvasX(0);
			ctx.beginPath();
			ctx.moveTo(zeroX, padding);
			ctx.lineTo(zeroX, displayHeight - padding);
			ctx.stroke();
		}

		if (bounds.minY < 0 && bounds.maxY > 0) {
			const zeroY = toCanvasY(0);
			ctx.beginPath();
			ctx.moveTo(padding, zeroY);
			ctx.lineTo(displayWidth - padding, zeroY);
			ctx.stroke();
		}

		ctx.setLineDash([]);

		// Create set of highlighted member IDs for quick lookup
		const highlightedIds = new Set(highlightedMembers.map((h) => h.memberId));

		// Draw members - first pass: draw non-highlighted members
		for (const member of members) {
			const x = toCanvasX(member.latentVector[xDimension] ?? 0);
			const y = toCanvasY(member.latentVector[yDimension] ?? 0);

			const isHighlighted = highlightedIds.has(member.memberId);
			const isHovered = hoveredMember?.memberId === member.memberId;

			// Skip highlighted/hovered members for now (draw them on top later)
			if (isHighlighted || isHovered) continue;

			// Draw regular point
			ctx.beginPath();
			ctx.arc(x, y, compact ? 5 : 6, 0, Math.PI * 2);
			ctx.fillStyle = '#6366f1';
			ctx.fill();
			ctx.strokeStyle = '#4f46e5';
			ctx.lineWidth = 1.5;
			ctx.stroke();
		}

		// Second pass: draw highlighted members
		for (const member of members) {
			if (!highlightedIds.has(member.memberId)) continue;
			if (hoveredMember?.memberId === member.memberId) continue;

			const x = toCanvasX(member.latentVector[xDimension] ?? 0);
			const y = toCanvasY(member.latentVector[yDimension] ?? 0);

			ctx.beginPath();
			ctx.arc(x, y, compact ? 6 : 7, 0, Math.PI * 2);
			ctx.fillStyle = '#f59e0b';
			ctx.fill();
			ctx.strokeStyle = '#d97706';
			ctx.lineWidth = 2;
			ctx.stroke();
		}

		// Third pass: draw hovered member
		if (hoveredMember) {
			const x = toCanvasX(hoveredMember.latentVector[xDimension] ?? 0);
			const y = toCanvasY(hoveredMember.latentVector[yDimension] ?? 0);

			ctx.beginPath();
			ctx.arc(x, y, compact ? 7 : 8, 0, Math.PI * 2);
			ctx.fillStyle = '#ec4899';
			ctx.fill();
			ctx.strokeStyle = '#db2777';
			ctx.lineWidth = 2;
			ctx.stroke();

			// Draw label
			ctx.fillStyle = '#1f2937';
			ctx.font = compact ? 'bold 10px sans-serif' : 'bold 12px sans-serif';
			ctx.textAlign = 'left';
			ctx.fillText(hoveredMember.name, x + (compact ? 10 : 12), y + 4);
		}

		// Draw user vector trajectory
		if (userVectorHistory.length > 0) {
			ctx.strokeStyle = '#10b981';
			ctx.lineWidth = 2;
			ctx.setLineDash([5, 5]);
			ctx.beginPath();

			for (let i = 0; i < userVectorHistory.length; i++) {
				const vec = userVectorHistory[i];
				const x = toCanvasX(vec[xDimension] ?? 0);
				const y = toCanvasY(vec[yDimension] ?? 0);

				if (i === 0) {
					ctx.moveTo(x, y);
				} else {
					ctx.lineTo(x, y);
				}
			}

			// Connect to current position
			if (userVector.length > 0) {
				const ux = toCanvasX(userVector[xDimension] ?? 0);
				const uy = toCanvasY(userVector[yDimension] ?? 0);
				ctx.lineTo(ux, uy);
			}

			ctx.stroke();
			ctx.setLineDash([]);

			// Draw intermediate points with fading opacity
			for (let i = 0; i < userVectorHistory.length; i++) {
				const vec = userVectorHistory[i];
				const x = toCanvasX(vec[xDimension] ?? 0);
				const y = toCanvasY(vec[yDimension] ?? 0);

				const alpha = 0.2 + (i / userVectorHistory.length) * 0.6;
				ctx.beginPath();
				ctx.arc(x, y, compact ? 3 : 4, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(16, 185, 129, ${alpha})`;
				ctx.fill();
			}
		}

		// Draw current user position (large, prominent)
		if (userVector.length > 0) {
			const hasNonZero = userVector.some((v) => v !== 0);
			if (hasNonZero || userVectorHistory.length > 0) {
				const ux = toCanvasX(userVector[xDimension] ?? 0);
				const uy = toCanvasY(userVector[yDimension] ?? 0);

				// Glow effect
				const gradient = ctx.createRadialGradient(ux, uy, 0, ux, uy, compact ? 16 : 22);
				gradient.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
				gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');
				ctx.fillStyle = gradient;
				ctx.beginPath();
				ctx.arc(ux, uy, compact ? 16 : 22, 0, Math.PI * 2);
				ctx.fill();

				// User dot
				ctx.beginPath();
				ctx.arc(ux, uy, compact ? 8 : 10, 0, Math.PI * 2);
				ctx.fillStyle = '#10b981';
				ctx.fill();
				ctx.strokeStyle = '#059669';
				ctx.lineWidth = 3;
				ctx.stroke();

				// "You" label
				ctx.fillStyle = '#065f46';
				ctx.font = compact ? 'bold 10px sans-serif' : 'bold 12px sans-serif';
				ctx.textAlign = 'left';
				ctx.fillText('あなた', ux + (compact ? 11 : 14), uy + 4);
			}
		}
	}

	function handleCanvasMouseMove(event: MouseEvent) {
		if (!canvasElement || !members.length) return;

		const rect = canvasElement.getBoundingClientRect();
		const scaleX = width / rect.width;
		const scaleY = height / rect.height;
		const mouseX = (event.clientX - rect.left) * scaleX;
		const mouseY = (event.clientY - rect.top) * scaleY;

		const bounds = visualizationBounds;
		const padding = compact ? 45 : 55;
		const plotWidth = width - padding * 2;
		const plotHeight = height - padding * 2;

		const toCanvasX = (val: number) =>
			padding + ((val - bounds.minX) / (bounds.maxX - bounds.minX)) * plotWidth;
		const toCanvasY = (val: number) =>
			height - padding - ((val - bounds.minY) / (bounds.maxY - bounds.minY)) * plotHeight;

		let found: MemberPoint | null = null;
		let minDist = Infinity;

		for (const member of members) {
			const x = toCanvasX(member.latentVector[xDimension] ?? 0);
			const y = toCanvasY(member.latentVector[yDimension] ?? 0);
			const dist = Math.sqrt((mouseX - x) ** 2 + (mouseY - y) ** 2);

			if (dist < 15 && dist < minDist) {
				minDist = dist;
				found = member;
			}
		}

		if (found !== hoveredMember) {
			hoveredMember = found;
			drawVisualization();
		}
	}

	function handleCanvasMouseLeave() {
		if (hoveredMember) {
			hoveredMember = null;
			drawVisualization();
		}
	}

	// Redraw when relevant state changes
	$effect(() => {
		if (canvasElement) {
			// Access reactive dependencies
			members;
			xDimension;
			yDimension;
			userVector;
			userVectorHistory;
			highlightedMembers;
			hoveredMember;
			width;
			height;
			drawVisualization();
		}
	});
</script>

<div class="latent-space-viz" class:collapsed={!isExpanded && collapsible}>
	{#if collapsible}
		<div class="viz-toggle-container">
			<button class="viz-toggle-btn" onclick={() => (isExpanded = !isExpanded)}>
				{isExpanded ? expandedLabel : collapsedLabel}
			</button>
		</div>
	{/if}

	{#if !collapsible || isExpanded}
		<div class="viz-content" class:fade-in={collapsible}>
			{#if title || showDimensionSelectors}
				<div class="viz-header">
					{#if title}
						<h3 class="viz-title">{title}</h3>
					{/if}
					{#if showDimensionSelectors && availableDimensions.length >= 2}
						<div class="dimension-selectors">
							<select bind:value={xDimension} class="dim-select">
								{#each availableDimensions as dim}
									<option value={dim}>X: 次元{dim + 1}</option>
								{/each}
							</select>
							<select bind:value={yDimension} class="dim-select">
								{#each availableDimensions as dim}
									<option value={dim}>Y: 次元{dim + 1}</option>
								{/each}
							</select>
						</div>
					{/if}
				</div>
			{/if}

			<div class="canvas-container">
				<canvas
					bind:this={canvasElement}
					class="viz-canvas"
					style="width: 100%; max-width: {width}px; height: auto; aspect-ratio: {width} / {height};"
					onmousemove={handleCanvasMouseMove}
					onmouseleave={handleCanvasMouseLeave}
				></canvas>
			</div>

			{#if showLegend}
				<div class="viz-legend">
					{#if userVector.length > 0}
						<div class="legend-item">
							<span class="legend-dot user"></span>
							<span>あなた</span>
						</div>
					{/if}
					{#if highlightedMembers.length > 0}
						<div class="legend-item">
							<span class="legend-dot highlighted"></span>
							<span>上位マッチ</span>
						</div>
					{/if}
					<div class="legend-item">
						<span class="legend-dot member"></span>
						<span>議員</span>
					</div>
					{#if userVectorHistory.length > 0}
						<div class="legend-item">
							<span class="legend-line"></span>
							<span>移動軌跡</span>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.latent-space-viz {
		background: white;
		border-radius: 0.5rem;
	}

	.viz-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1rem;
		flex-wrap: wrap;
		gap: 0.75rem;
	}

	.viz-title {
		font-size: 1rem;
		font-weight: 600;
		color: #1f2937;
		margin: 0;
	}

	.dimension-selectors {
		display: flex;
		gap: 0.75rem;
	}

	.dim-select {
		padding: 0.375rem 2rem 0.375rem 0.75rem;
		font-size: 0.875rem;
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		background-color: #f9fafb;
		color: #374151;
		cursor: pointer;
		appearance: none;
		background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
		background-position: right 0.5rem center;
		background-repeat: no-repeat;
		background-size: 1.5em 1.5em;
		transition: all 0.2s;
	}

	.dim-select:hover {
		border-color: #d1d5db;
		background-color: #fff;
	}

	.dim-select:focus {
		outline: none;
		border-color: #6366f1;
		box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.1);
	}

	.canvas-container {
		border: 1px solid #e5e7eb;
		border-radius: 0.375rem;
		overflow: hidden;
	}

	.viz-canvas {
		display: block;
		width: 100%;
		cursor: crosshair;
	}

	.viz-legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 1.5rem;
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid #f3f4f6;
		font-size: 0.875rem;
		color: #4b5563;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.legend-dot {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
	}

	.legend-dot.user {
		background-color: #10b981;
	}

	.legend-dot.highlighted {
		background-color: #f59e0b;
	}

	.legend-dot.member {
		background-color: #6366f1;
	}

	.legend-line {
		width: 1rem;
		height: 0;
		border-top: 2px dashed #10b981;
	}

	/* Collapsible styles */
	.latent-space-viz.collapsed {
		background: transparent;
		border: none;
	}

	.viz-toggle-container {
		display: flex;
		justify-content: center;
		padding: 0.5rem;
	}

	.viz-toggle-btn {
		background: white;
		border: 1px solid #e5e7eb;
		color: #4b5563;
		padding: 0.75rem 1.5rem;
		border-radius: 2rem;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
	}

	.viz-toggle-btn:hover {
		background: #f9fafb;
		border-color: #d1d5db;
		color: #1f2937;
	}

	.fade-in {
		animation: fadeIn 0.4s ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
