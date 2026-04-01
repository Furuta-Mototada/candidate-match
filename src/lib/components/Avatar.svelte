<script lang="ts">
	interface Props {
		username: string;
		avatarUrl?: string | null;
		size?: 'xs' | 'sm' | 'md' | 'lg';
	}

	let { username, avatarUrl = null, size = 'md' }: Props = $props();

	let imgError = $state(false);

	function handleImgError() {
		imgError = true;
	}

	let showImage = $derived(!!avatarUrl && !imgError);
	let initial = $derived(username.charAt(0).toUpperCase());

	// ImageKit URL transformation for appropriate sizes
	let sizeMap = { xs: 24, sm: 32, md: 36, lg: 80 };
	let imgSize = $derived(sizeMap[size]);
	let optimizedUrl = $derived(
		avatarUrl ? `${avatarUrl}?tr=w-${imgSize * 2},h-${imgSize * 2},fo-face,c-at_max` : ''
	);
</script>

<span class="avatar avatar-{size}">
	{#if showImage}
		<img src={optimizedUrl} alt={username} class="avatar-img" onerror={handleImgError} />
	{:else}
		<span class="avatar-initial">{initial}</span>
	{/if}
</span>

<style>
	.avatar {
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		overflow: hidden;
		background: linear-gradient(135deg, #6366f1, #8b5cf6);
		color: white;
		font-weight: 700;
		line-height: 1;
	}

	.avatar-xs {
		width: 1.5rem;
		height: 1.5rem;
		font-size: 0.6875rem;
	}

	.avatar-sm {
		width: 2rem;
		height: 2rem;
		font-size: 0.75rem;
	}

	.avatar-md {
		width: 2.25rem;
		height: 2.25rem;
		font-size: 0.875rem;
	}

	.avatar-lg {
		width: 5rem;
		height: 5rem;
		font-size: 1.75rem;
	}

	.avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.avatar-initial {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
	}
</style>
