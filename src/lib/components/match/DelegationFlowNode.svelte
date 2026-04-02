<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import { Hourglass, CircleCheck, XCircle, RefreshCw } from '@lucide/svelte';
	import Avatar from '$lib/components/Avatar.svelte';

	let {
		data,
		sourcePosition,
		targetPosition
	}: {
		data: {
			label: string;
			status?: string;
			isMe?: boolean;
			isAnonymous?: boolean;
			votes?: number;
			statusColor?: string;
			avatarUrl?: string | null;
		};
		sourcePosition?: Position;
		targetPosition?: Position;
	} = $props();
</script>

<Handle type="target" position={targetPosition ?? Position.Left} />

<div class="delegation-node" class:me={data.isMe} class:anonymous={data.isAnonymous}>
	{#if data.isAnonymous}
		<span class="anonymous-icon">?</span>
	{:else}
		<Avatar username={data.label} avatarUrl={data.avatarUrl} size="xs" />
	{/if}
	<span class="status-icon" style:color={data.isMe ? 'white' : (data.statusColor ?? '#6b7280')}>
		{#if !data.isMe}
			{#if data.status === 'pending'}
				<Hourglass size={12} />
			{:else if data.status === 'voted'}
				<CircleCheck size={12} />
			{:else if data.status === 'rejected'}
				<XCircle size={12} />
			{:else if data.status === 'redelegated'}
				<RefreshCw size={12} />
			{/if}
		{/if}
	</span>
	<span class="label">{data.label}</span>
	{#if data.votes && data.votes > 1}
		<span class="votes">{data.votes}票</span>
	{/if}
</div>

<Handle type="source" position={sourcePosition ?? Position.Right} />

<style>
	.delegation-node {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 6px 12px;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 500;
		color: #334155;
		background: white;
		border: 1.5px solid var(--node-border, #cbd5e1);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
		min-width: 80px;
		white-space: nowrap;
	}

	.delegation-node.me {
		background: #6366f1;
		color: white;
		border-color: #4f46e5;
		font-weight: 600;
	}

	.delegation-node.anonymous {
		background: #f0f4ff;
		border-color: #a5b4fc;
		color: #4338ca;
		font-weight: 600;
	}

	.anonymous-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: #c7d2fe;
		color: #4338ca;
		font-size: 0.75rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	.status-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.label {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.votes {
		font-size: 0.7rem;
		background: rgba(0, 0, 0, 0.08);
		padding: 1px 5px;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.me .votes {
		background: rgba(255, 255, 255, 0.2);
	}
</style>
