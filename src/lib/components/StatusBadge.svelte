<script lang="ts">
	type Status = 'passed' | 'completed' | 'pending' | 'failed';

	interface Props {
		status: Status;
		label?: string;
	}

	let { status, label }: Props = $props();

	const statusConfig: Record<Status, { text: string; class: string }> = {
		passed: { text: '可決', class: 'passed' },
		completed: { text: '審議終了', class: 'completed' },
		pending: { text: '審議中', class: 'pending' },
		failed: { text: '否決', class: 'failed' }
	};

	const config = statusConfig[status];
</script>

<span class="status-badge {config.class}">
	{label || config.text}
</span>

<style>
	.status-badge {
		display: inline-block;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.passed {
		background-color: #d1fae5;
		color: #047857;
	}

	.completed {
		background-color: #dbeafe;
		color: #1d4ed8;
	}

	.pending {
		background-color: #fef3c7;
		color: #b45309;
	}

	.failed {
		background-color: #fee2e2;
		color: #dc2626;
	}
</style>
