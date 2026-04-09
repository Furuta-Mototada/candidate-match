<script lang="ts">
	import { ThumbsUp, ThumbsDown, CircleQuestionMark } from '@lucide/svelte';

	interface Props {
		/** The vote score this button represents: 1 (agree), 0 (neutral), -1 (disagree) */
		score: number;
		/** Whether this button's score is currently being held */
		isHolding: boolean;
		/** Progress of the hold gesture (0 to 1) */
		progress: number;
		/** Whether button is disabled */
		disabled?: boolean;
		/** Icon size */
		iconSize?: number;
		/** Callback when pointer down */
		onpointerdown: () => void;
		/** Callback when pointer up */
		onpointerup: () => void;
		/** Callback when pointer leaves */
		onpointerleave: () => void;
		/** Extra class applied to the button */
		className?: string;
	}

	let {
		score,
		isHolding,
		progress,
		disabled = false,
		iconSize = 28,
		onpointerdown,
		onpointerup,
		onpointerleave,
		className = ''
	}: Props = $props();

	const VOTE_CONFIG: Record<
		number,
		{
			variant: string;
			label: string;
			color: string;
			activeColor: string;
		}
	> = {
		1: { variant: 'agree', label: '賛成', color: '#22c55e', activeColor: '#166534' },
		0: { variant: 'neutral', label: 'わからない', color: '#3b82f6', activeColor: '#1e40af' },
		'-1': { variant: 'disagree', label: '反対', color: '#ef4444', activeColor: '#991b1b' }
	};

	let config = $derived(VOTE_CONFIG[score] ?? VOTE_CONFIG[0]);
</script>

<button
	{onpointerdown}
	{onpointerup}
	{onpointerleave}
	{disabled}
	class="vote-btn vote-{config.variant} {className}"
	class:holding={isHolding}
>
	<span
		class="vote-fill vote-fill-{config.variant}"
		style="transform: scaleY({isHolding ? progress : 0})"
	></span>
	<span class="vote-emoji">
		{#if score === 1}
			<ThumbsUp size={iconSize} color={isHolding ? config.activeColor : config.color} />
		{:else if score === 0}
			<CircleQuestionMark size={iconSize} color={isHolding ? config.activeColor : config.color} />
		{:else}
			<ThumbsDown size={iconSize} color={isHolding ? config.activeColor : config.color} />
		{/if}
	</span>
	<span class="vote-label" class:vote-label-active={isHolding}>{config.label}</span>
</button>

<style>
	.vote-btn {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.375rem;
		padding: 1rem 0.5rem;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		cursor: pointer;
		overflow: hidden;
		transition: all 0.2s ease;
		background: #f9fafb;
		-webkit-user-select: none;
		user-select: none;
		touch-action: none;
	}

	.vote-btn:disabled {
		opacity: 0.5;
		pointer-events: none;
	}

	.vote-fill {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 100%;
		transform-origin: bottom;
		transition: transform 0.05s linear;
		border-radius: 12px;
	}

	.vote-fill-agree {
		background: rgba(34, 197, 94, 0.15);
	}
	.vote-fill-neutral {
		background: rgba(59, 130, 246, 0.15);
	}
	.vote-fill-disagree {
		background: rgba(239, 68, 68, 0.15);
	}

	.vote-emoji {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
	}

	.vote-label {
		position: relative;
		z-index: 1;
		font-size: 0.75rem;
		font-weight: 600;
		color: #6b7280;
		transition: all 0.2s;
	}

	.vote-label-active {
		color: #1f2937;
	}

	.vote-agree:hover {
		background: rgba(34, 197, 94, 0.08);
	}
	.vote-neutral:hover {
		background: rgba(59, 130, 246, 0.08);
	}
	.vote-disagree:hover {
		background: rgba(239, 68, 68, 0.08);
	}

	.vote-btn.holding {
		transform: scale(0.97);
	}
</style>
