<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types.js';
	import type { ResultSnapshotData } from '$lib/types/index.js';
	import { ClipboardList } from '@lucide/svelte';
	import GlobalResultsPhase from '$lib/components/match/GlobalResultsPhase.svelte';

	let { data }: { data: PageData } = $props();

	let snapshot: ResultSnapshotData & { clusterName?: string } = $state(data.snapshot);
	let mounted: boolean = $state(false);

	function formatDate(dateStr: string): string {
		const date = new Date(dateStr);
		return date.toLocaleDateString('ja-JP', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	onMount(() => {
		setTimeout(() => {
			mounted = true;
		}, 100);
	});
</script>

<svelte:head>
	<title>{snapshot.name} | スナップショット</title>
</svelte:head>

<div class="page" class:mounted>
	<header class="page-header">
		<div class="container">
			<div class="breadcrumb">
				<a href="/match/saved" class="breadcrumb-link"
					><ClipboardList size={14} class="inline-icon" /> 保存済みデータ</a
				>
				<span class="breadcrumb-sep">/</span>
				<span class="breadcrumb-current">{snapshot.name}</span>
			</div>

			<div class="header-content">
				<div>
					<h1 class="page-title">{snapshot.name}</h1>
					<div class="snapshot-meta">
						<span class="meta-item">
							<span class="meta-label">保存日:</span>
							{formatDate(snapshot.createdAt)}
						</span>
						<span class="meta-divider">|</span>
						<span class="meta-item">
							<span class="meta-label">回答数:</span>
							{snapshot.totalAnswered}件
						</span>
						{#if snapshot.clusterName}
							<span class="meta-divider">|</span>
							<span class="meta-item">
								<span class="meta-label">クラスタリング:</span>
								{snapshot.clusterName}
							</span>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</header>

	<main class="main-container">
		<GlobalResultsPhase
			clusterResults={snapshot.clusterResults || []}
			globalScores={snapshot.globalScores || []}
			readonly={true}
		/>
	</main>
</div>

<style>
	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	.page {
		min-height: 100vh;
		background: #fafbfc;
	}

	.page-header {
		background: white;
		border-bottom: 1px solid #e5e7eb;
		padding: 1.5rem 0 2rem;
	}

	.container {
		max-width: 1024px;
		margin: 0 auto;
		padding: 0 1rem;
	}

	.breadcrumb {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
		margin-bottom: 1rem;
	}

	.breadcrumb-link {
		color: #6366f1;
		text-decoration: none;
	}

	.breadcrumb-link:hover {
		text-decoration: underline;
	}

	.breadcrumb-sep {
		color: #d1d5db;
	}

	.breadcrumb-current {
		color: #6b7280;
	}

	.header-content {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
	}

	.page-title {
		font-size: 1.75rem;
		font-weight: 700;
		color: #1a1a2e;
		margin-bottom: 0.5rem;
	}

	.snapshot-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-size: 0.9rem;
	}

	.meta-item {
		color: #6b7280;
	}

	.meta-label {
		font-weight: 600;
		color: #4b5563;
	}

	.meta-divider {
		color: #d1d5db;
	}

	.main-container {
		max-width: 1024px;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	@media (max-width: 640px) {
		.snapshot-meta {
			flex-direction: column;
			gap: 0.25rem;
		}

		.meta-divider {
			display: none;
		}
	}
</style>
