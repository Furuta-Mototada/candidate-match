/**
 * Creates a reusable hold/long-press gesture tracker.
 *
 * Returns reactive state (`holdingId`, `progress`) and control functions (`start`, `cancel`).
 * The `onComplete` callback fires when the hold reaches the target duration.
 *
 * Usage:
 *   const hold = createHoldGesture<number>({ onComplete: (vote) => submitVote(vote) });
 *   <button onpointerdown={() => hold.start(1)} onpointerup={hold.cancel} onpointerleave={hold.cancel}>
 *     <div style="transform: scaleY({hold.holdingId === 1 ? hold.progress : 0})"></div>
 *   </button>
 */
export function createHoldGesture<T = number>(options: {
	duration?: number;
	onComplete: (id: T) => void;
	disabled?: () => boolean;
}) {
	const duration = options.duration ?? 600;

	let holdingId = $state<T | null>(null);
	let progress = $state(0);
	let timer: ReturnType<typeof setInterval> | null = null;
	let startTime = 0;

	function start(id: T) {
		if (options.disabled?.()) return;
		holdingId = id;
		progress = 0;
		startTime = Date.now();
		timer = setInterval(() => {
			const elapsed = Date.now() - startTime;
			progress = Math.min(elapsed / duration, 1);
			if (progress >= 1) {
				cancel();
				options.onComplete(id);
			}
		}, 16);
	}

	function cancel() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		holdingId = null;
		progress = 0;
	}

	return {
		get holdingId() {
			return holdingId;
		},
		get progress() {
			return progress;
		},
		start,
		cancel
	};
}
