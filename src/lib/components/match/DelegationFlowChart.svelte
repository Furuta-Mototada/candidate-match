<script lang="ts">
	import { SvelteFlow, type Node, type Edge, Position } from '@xyflow/svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import DelegationFlowNode from './DelegationFlowNode.svelte';
	import '@xyflow/svelte/dist/style.css';

	type ChainLink = { username: string; status: string; totalVotes?: number };

	type IncomingDelegation = {
		id: number;
		delegatorId: string;
		delegatorUsername: string;
		delegatorAvatarUrl?: string | null;
		billId: number;
		status: string;
		upstreamPaths: Array<Array<{ username: string; status: string }>>;
	};

	type OutgoingDelegation = {
		delegateUsername: string;
		delegateAvatarUrl?: string | null;
		delegateVotes?: number;
		chain: ChainLink[];
		status: string;
		terminalStatus?: string | null;
		terminalVoteScore?: number | null;
	};

	let {
		incomingList = [],
		outgoing = null,
		anonymous = false,
		anonymousCountBucket = ''
	}: {
		incomingList: IncomingDelegation[];
		outgoing: OutgoingDelegation | null;
		anonymous?: boolean;
		anonymousCountBucket?: string;
	} = $props();

	const nodeTypes = { delegation: DelegationFlowNode };

	const X_GAP = 170;
	const Y_GAP = 52;

	function getStatusColor(status: string): string {
		switch (status) {
			case 'pending':
				return '#f59e0b';
			case 'voted':
				return '#22c55e';
			case 'rejected':
				return '#ef4444';
			case 'redelegated':
				return '#3b82f6';
			default:
				return '#94a3b8';
		}
	}

	function makeNode(id: string, x: number, y: number, data: Record<string, unknown>): Node {
		return {
			id,
			type: 'delegation',
			position: { x, y },
			data,
			sourcePosition: Position.Right,
			targetPosition: Position.Left
		};
	}

	function makeEdge(source: string, target: string, status: string): Edge {
		const color = getStatusColor(status);
		return {
			id: `e-${source}-${target}`,
			source,
			target,
			type: 'smoothstep',
			animated: status === 'pending',
			style: `stroke: ${color}; stroke-width: 2;`
		};
	}

	function makeDashedEdge(source: string, target: string, status: string): Edge {
		const color = getStatusColor(status);
		return {
			id: `e-${source}-${target}`,
			source,
			target,
			type: 'smoothstep',
			animated: status === 'pending',
			style: `stroke: ${color}; stroke-width: 2; stroke-dasharray: 6 3;`
		};
	}

	let { nodes, edges } = $derived.by(() => {
		const ns: Node[] = [];
		const es: Edge[] = [];
		const nodeIdsMap = new SvelteMap<string, string>();
		let nextId = 0;

		function getNodeId(key: string): string {
			if (!nodeIdsMap.has(key)) {
				nodeIdsMap.set(key, `n${nextId++}`);
			}
			return nodeIdsMap.get(key)!;
		}

		const seenUpstream = new SvelteSet<string>();

		// In anonymous mode, skip individual upstream nodes entirely
		if (anonymous && incomingList.length > 0) {
			// Simple layout: [anonymous node] -> [Me] -> [delegate]
			const meCol = 1;
			const meY = 0;

			// "Me" node
			const meId = getNodeId('me');
			ns.push(makeNode(meId, meCol * X_GAP, meY, { label: 'あなた', isMe: true }));

			// Single anonymous incoming node
			const anonId = getNodeId('anonymous-incoming');
			// Determine dominant status for the edge color
			const hasPending = incomingList.some((d) => d.status === 'pending');
			const hasVoted = incomingList.some((d) => d.status === 'voted');
			const hasRejected = incomingList.some((d) => d.status === 'rejected');
			const dominantStatus = hasPending
				? 'pending'
				: hasVoted
					? 'voted'
					: hasRejected
						? 'rejected'
						: 'redelegated';
			ns.push(
				makeNode(anonId, 0, meY, {
					label: `${anonymousCountBucket}人`,
					isAnonymous: true,
					status: dominantStatus,
					statusColor: getStatusColor(dominantStatus)
				})
			);
			es.push(makeEdge(anonId, meId, dominantStatus));

			// Forward chain (outgoing)
			if (outgoing) {
				const delegateId = getNodeId(`forward-${outgoing.delegateUsername}`);
				ns.push(
					makeNode(delegateId, (meCol + 1) * X_GAP, meY, {
						label: outgoing.delegateUsername,
						status: outgoing.status,
						statusColor: getStatusColor(outgoing.status),
						votes: outgoing.delegateVotes,
						avatarUrl: outgoing.delegateAvatarUrl
					})
				);
				es.push(makeEdge(meId, delegateId, outgoing.status));

				// When delegate has redelegated, show "?" node for downstream chain
				if (outgoing.status === 'redelegated') {
					const terminalNodeId = getNodeId('forward-terminal');
					const tStatus = outgoing.terminalStatus ?? 'pending';
					ns.push(
						makeNode(terminalNodeId, (meCol + 2) * X_GAP, meY, {
							label: '',
							isTerminal: true,
							status: tStatus,
							statusColor: getStatusColor(tStatus),
							terminalVoteScore: outgoing.terminalVoteScore
						})
					);
					es.push(makeDashedEdge(delegateId, terminalNodeId, tStatus));
				}
			}

			return { nodes: ns, edges: es };
		}

		// Non-anonymous mode: full graph

		// Find max upstream depth
		let maxUpstreamDepth = 0;
		for (const inc of incomingList) {
			if (inc.upstreamPaths) {
				for (const path of inc.upstreamPaths) {
					if (path.length > maxUpstreamDepth) maxUpstreamDepth = path.length;
				}
			}
		}

		const meCol = maxUpstreamDepth + 1;
		const delegatorCol = meCol - 1;

		type PersonNode = {
			username: string;
			status: string;
			col: number;
			avatarUrl?: string | null;
		};
		const personNodesList: PersonNode[] = [];
		const addedPersons = new SvelteSet<string>();

		// Add incoming delegators
		for (const inc of incomingList) {
			const key = `${inc.delegatorUsername}-col${delegatorCol}`;
			if (!addedPersons.has(key)) {
				addedPersons.add(key);
				personNodesList.push({
					username: inc.delegatorUsername,
					status: inc.status,
					col: delegatorCol,
					avatarUrl: inc.delegatorAvatarUrl
				});
			}
		}

		// Add upstream nodes at appropriate columns
		for (const inc of incomingList) {
			if (inc.upstreamPaths) {
				for (const path of inc.upstreamPaths) {
					for (let i = 0; i < path.length; i++) {
						const depthFromDelegator = path.length - i;
						const col = delegatorCol - depthFromDelegator;
						const key = `upstream-${path[i].username}-col${col}`;
						if (!addedPersons.has(key)) {
							addedPersons.add(key);
							personNodesList.push({
								username: path[i].username,
								status: path[i].status,
								col: col
							});
						}
					}
				}
			}
		}

		// Group by column for Y positioning
		const colGroups = new SvelteMap<number, PersonNode[]>();
		for (const p of personNodesList) {
			if (!colGroups.has(p.col)) colGroups.set(p.col, []);
			colGroups.get(p.col)!.push(p);
		}

		const maxRows = Math.max(1, ...Array.from(colGroups.values()).map((g) => g.length));
		const meY = ((maxRows - 1) * Y_GAP) / 2;

		// "Me" node
		const meId = getNodeId('me');
		ns.push(makeNode(meId, meCol * X_GAP, meY, { label: 'あなた', isMe: true }));

		// Person nodes
		for (const [col, group] of colGroups) {
			const totalHeight = (group.length - 1) * Y_GAP;
			const startY = meY - totalHeight / 2;
			for (let i = 0; i < group.length; i++) {
				const p = group[i];
				const id = getNodeId(`${p.username}-col${col}`);
				ns.push(
					makeNode(id, col * X_GAP, startY + i * Y_GAP, {
						label: p.username,
						status: p.status,
						statusColor: getStatusColor(p.status),
						avatarUrl: p.avatarUrl
					})
				);
			}
		}

		// Forward chain (outgoing)
		if (outgoing) {
			const delegateId = getNodeId(`forward-${outgoing.delegateUsername}`);
			ns.push(
				makeNode(delegateId, (meCol + 1) * X_GAP, meY, {
					label: outgoing.delegateUsername,
					status: outgoing.status,
					statusColor: getStatusColor(outgoing.status),
					votes: outgoing.delegateVotes,
					avatarUrl: outgoing.delegateAvatarUrl
				})
			);
			es.push(makeEdge(meId, delegateId, outgoing.status));

			let prevId = delegateId;
			let nextCol = meCol + 2;
			if (outgoing.chain) {
				for (let i = 0; i < outgoing.chain.length; i++) {
					const link = outgoing.chain[i];
					const linkId = getNodeId(`forward-chain-${i}-${link.username}`);
					ns.push(
						makeNode(linkId, nextCol * X_GAP, meY, {
							label: link.username,
							status: link.status,
							statusColor: getStatusColor(link.status),
							votes: link.totalVotes
						})
					);
					es.push(makeEdge(prevId, linkId, link.status));
					prevId = linkId;
					nextCol++;
				}
			}

			// When delegate has redelegated and no debug chain shown, show "?" terminal node
			if (outgoing.status === 'redelegated' && (!outgoing.chain || outgoing.chain.length === 0)) {
				const terminalNodeId = getNodeId('forward-terminal');
				const tStatus = outgoing.terminalStatus ?? 'pending';
				ns.push(
					makeNode(terminalNodeId, nextCol * X_GAP, meY, {
						label: '',
						isTerminal: true,
						status: tStatus,
						statusColor: getStatusColor(tStatus),
						terminalVoteScore: outgoing.terminalVoteScore
					})
				);
				es.push(makeDashedEdge(prevId, terminalNodeId, tStatus));
			}
		}

		// Edges: upstream → delegator and delegator → me
		for (const inc of incomingList) {
			if (inc.upstreamPaths) {
				for (const path of inc.upstreamPaths) {
					for (let i = 0; i < path.length; i++) {
						const depthFromDelegator = path.length - i;
						const col = delegatorCol - depthFromDelegator;
						const srcId = getNodeId(`${path[i].username}-col${col}`);

						let tgtId: string;
						if (i < path.length - 1) {
							const nextDepth = path.length - (i + 1);
							const nextCol = delegatorCol - nextDepth;
							tgtId = getNodeId(`${path[i + 1].username}-col${nextCol}`);
						} else {
							tgtId = getNodeId(`${inc.delegatorUsername}-col${delegatorCol}`);
						}

						const edgeKey = `e-${srcId}-${tgtId}`;
						if (!seenUpstream.has(edgeKey)) {
							seenUpstream.add(edgeKey);
							es.push(makeEdge(srcId, tgtId, path[i].status));
						}
					}
				}
			}

			const delegatorNodeId = getNodeId(`${inc.delegatorUsername}-col${delegatorCol}`);
			const edgeKey = `e-${delegatorNodeId}-${meId}`;
			if (!seenUpstream.has(edgeKey)) {
				seenUpstream.add(edgeKey);
				es.push(makeEdge(delegatorNodeId, meId, inc.status));
			}
		}

		return { nodes: ns, edges: es };
	});
</script>

<div class="delegation-flow-container">
	<SvelteFlow
		{nodes}
		{edges}
		{nodeTypes}
		fitView
		fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
		nodesDraggable={false}
		nodesConnectable={false}
		elementsSelectable={false}
		panOnDrag={false}
		zoomOnScroll={false}
		zoomOnDoubleClick={false}
		zoomOnPinch={false}
		preventScrolling={false}
		proOptions={{ hideAttribution: true }}
	/>
</div>

<style>
	.delegation-flow-container {
		width: 100%;
		height: 180px;
		margin: 0.5rem 0;
		border-radius: 10px;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		overflow: hidden;
	}

	.delegation-flow-container :global(.svelte-flow) {
		--xy-background-color: transparent;
		--xy-node-border-default: none;
		--xy-node-boxshadow-hover-default: none;
		--xy-node-boxshadow-selected-default: none;
	}

	.delegation-flow-container :global(.svelte-flow__node) {
		cursor: default;
	}

	.delegation-flow-container :global(.svelte-flow__handle) {
		opacity: 0;
		width: 1px;
		height: 1px;
	}

	.delegation-flow-container :global(.svelte-flow__edge-path) {
		stroke-linecap: round;
	}
</style>
