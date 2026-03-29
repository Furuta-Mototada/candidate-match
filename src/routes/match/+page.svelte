<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types.js';
	import { Vote, CircleCheck, TriangleAlert } from '@lucide/svelte';
	import {
		SetupPhase,
		QuestioningPhase,
		ClusterReviewPhase,
		GlobalResultsPhase,
		ExplanationModal
	} from '$lib/components/index.js';
	import type {
		SavedVectorInfo,
		GroupedSavedVector,
		MemberMatch,
		ClusterResult,
		GlobalMemberScore,
		MatchingPhase,
		MemberVectorForViz
	} from '$lib/types/index.js';

	interface NextQuestion {
		billId: number;
		title: string;
		description: string | null;
		passed: boolean;
		result: string | null;
		reason: string;
		dimensionTarget: number;
	}

	let { data }: { data: PageData } = $props();

	// State
	let savedVectors: SavedVectorInfo[] = $state((data.savedVectors || []) as SavedVectorInfo[]);
	let selectedSavedVectorKey: string | null = $state(null);

	let phase: MatchingPhase = $state('setup');
	let isLoading: boolean = $state(false);
	let error: string | null = $state(null);
	let mounted: boolean = $state(false);

	// Multi-cluster state
	let clusterLabelsToProcess: number[] = $state([]);
	let clusterLabelNameMap: Record<number, string> = $state({}); // clusterLabel -> name
	let currentClusterIndex: number = $state(0);
	let clusterResults: ClusterResult[] = $state([]);
	let globalScores: GlobalMemberScore[] = $state([]);

	// Current cluster session
	let sessionId: string | null = $state(null);
	let currentQuestion: NextQuestion | null = $state(null);
	let answeredCount: number = $state(0);
	let currentClusterBillCount: number = $state(0); // Total bills in current cluster
	let topMatches: MemberMatch[] = $state([]);
	let uncertainty: number[] = $state([]);
	let userVector: number[] = $state([]);

	// Save state
	let isSaving: boolean = $state(false);
	let snapshotSaved: boolean = $state(false);
	let clusterId: number | null = $state(null);
	let nComponents: number = $state(3);
	let currentClusterMatches: MemberMatch[] = $state([]);
	let currentClusterAnsweredBills: {
		billId: number;
		title: string;
		answer: number;
		source?: 'direct' | 'delegated';
		delegationStatus?: 'pending' | 'voted';
		delegateId?: string;
	}[] = $state([]);
	let isEditingAnswer: boolean = $state(false);
	let previousQuestion: NextQuestion | null = $state(null); // Store previous question for cancel editing

	// Rating state
	let pendingImportance: number = $state(3);
	let showExplanationModal: boolean = $state(false);

	// 2D Visualization state
	let memberVectorsForViz: MemberVectorForViz[] = $state([]);
	let explainedVariance: number[] = $state([]);
	let xDimension: number = $state(0);
	let yDimension: number = $state(1);
	let userVectorHistory: number[][] = $state([]); // Track user position over time

	// Group saved vectors by name + clusterId
	let groupedSavedVectors = $derived.by(() => {
		const groups = new SvelteMap<string, GroupedSavedVector>();
		for (const sv of savedVectors) {
			const key = `${sv.name}|${sv.clusterId}`;
			if (!groups.has(key)) {
				groups.set(key, {
					key,
					name: sv.name,
					clusterId: sv.clusterId,
					nComponents: sv.nComponents,
					dimensions: sv.dimensions,
					clusterCount: 0,
					totalMembers: sv.memberCount,
					totalBills: 0,
					vectors: [],
					createdAt: sv.createdAt,
					isDefault: sv.isDefault
				});
			}
			const group = groups.get(key)!;
			group.vectors.push(sv);
			group.clusterCount++;
			group.totalBills += sv.billCount;
			// If any vector in the group is default, mark the group as default
			if (sv.isDefault) group.isDefault = true;
		}
		return Array.from(groups.values()).sort(
			(a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
		);
	});

	// Get selected grouped vector
	let selectedGroupedVector = $derived(
		groupedSavedVectors.find((g) => g.key === selectedSavedVectorKey) || null
	);

	// Derived
	let currentClusterLabel = $derived(clusterLabelsToProcess[currentClusterIndex] ?? null);
	let currentClusterDisplayName = $derived(
		currentClusterLabel !== null
			? clusterLabelNameMap[currentClusterLabel] || `クラスター${currentClusterLabel}`
			: null
	);
	// Current cluster progress (answered or delegated / total in cluster)
	let clusterProgress = $derived.by(() => {
		if (currentClusterBillCount === 0) return 0;
		return (answeredCount / currentClusterBillCount) * 100;
	});

	// Stats for current cluster
	let directAnsweredCount = $derived(
		currentClusterAnsweredBills.filter(
			(b) => b.source !== 'delegated' && (b.answer === 1 || b.answer === -1)
		).length
	);
	let skippedCount = $derived(
		currentClusterAnsweredBills.filter((b) => b.source !== 'delegated' && b.answer === 0).length
	);
	let delegatedVotedCount = $derived(
		currentClusterAnsweredBills.filter(
			(b) => b.source === 'delegated' && b.delegationStatus === 'voted'
		).length
	);
	let delegatedPendingCount = $derived(
		currentClusterAnsweredBills.filter(
			(b) => b.source === 'delegated' && b.delegationStatus !== 'voted'
		).length
	);
	let unansweredCount = $derived(Math.max(0, currentClusterBillCount - answeredCount));
	let confidence = $derived.by(() => {
		if (uncertainty.length === 0) return 0;
		const avgUncertainty = uncertainty.reduce((a, b) => a + b, 0) / uncertainty.length;
		return Math.max(0, Math.min(100, (1 - avgUncertainty) * 100));
	});

	// Highlighted members for visualization (top matches)
	let highlightedMembersForViz = $derived(
		topMatches.map((m) => ({ memberId: m.memberId, similarity: m.similarity }))
	);

	// Calculate total unanswered bills across all clusters
	let totalUnansweredBills = $derived.by(() => {
		if (!selectedGroupedVector) return 0;

		let total = 0;
		for (const vectorInfo of selectedGroupedVector.vectors) {
			const clusterResult = clusterResults.find(
				(cr) => cr.clusterLabel === vectorInfo.clusterLabel
			);
			const answeredCount = clusterResult?.answeredCount || 0;
			total += Math.max(0, vectorInfo.billCount - answeredCount);
		}
		return total;
	});

	// Check if this is the last cluster in the current session
	let isLastClusterInSession = $derived.by(() => {
		// Check if there are more clusters with unanswered bills after current
		if (!selectedGroupedVector) return true;

		for (let i = currentClusterIndex + 1; i < clusterLabelsToProcess.length; i++) {
			const label = clusterLabelsToProcess[i];
			const vectorInfo = selectedGroupedVector.vectors.find((v) => v.clusterLabel === label);
			const clusterResult = clusterResults.find((cr) => cr.clusterLabel === label);

			if (vectorInfo) {
				const alreadyAnswered = clusterResult?.answeredCount || 0;
				if (alreadyAnswered < vectorInfo.billCount) {
					return false; // There's still a cluster with unanswered bills
				}
			}
		}
		return true;
	});

	/**
	 * Get display name for a cluster label
	 */
	function getClusterDisplayName(clusterLabel: number): string {
		return clusterLabelNameMap[clusterLabel] || `クラスター${clusterLabel}`;
	}

	/**
	 * Start matching with a saved vector configuration (all clusters)
	 */
	async function startWithSavedVector() {
		if (!selectedGroupedVector) {
			error = '保存済みベクトルを選択してください';
			return;
		}

		isLoading = true;
		error = null;
		clusterResults = [];
		globalScores = [];
		snapshotSaved = false;

		// Store cluster info for saving later
		clusterId = selectedGroupedVector.clusterId;
		nComponents = selectedGroupedVector.nComponents;

		// Get all cluster labels from the grouped vector, sorted
		const labels = selectedGroupedVector.vectors.map((v) => v.clusterLabel).sort((a, b) => a - b);

		if (labels.length === 0) {
			error = 'クラスターが見つかりません';
			isLoading = false;
			return;
		}

		// Build cluster label name map
		const nameMap: Record<number, string> = {};
		for (const v of selectedGroupedVector.vectors) {
			if (v.clusterLabelName) {
				nameMap[v.clusterLabel] = v.clusterLabelName;
			}
		}
		clusterLabelNameMap = nameMap;

		clusterLabelsToProcess = labels;
		currentClusterIndex = 0;

		// Start with the first cluster using its saved vector
		await startClusterSessionWithSavedVector(labels[0]);
	}

	/**
	 * Continue answering unanswered bills
	 */
	async function continueAnswering() {
		if (!selectedGroupedVector) return;

		// Find the first cluster with unanswered bills
		let clusterToResume: number | null = null;
		let clusterVectorInfo = null;

		for (const vectorInfo of selectedGroupedVector.vectors) {
			const clusterResult = clusterResults.find(
				(cr) => cr.clusterLabel === vectorInfo.clusterLabel
			);
			const answeredCount = clusterResult?.answeredCount || 0;

			if (answeredCount < vectorInfo.billCount) {
				clusterToResume = vectorInfo.clusterLabel;
				clusterVectorInfo = vectorInfo;
				break;
			}
		}

		if (clusterToResume === null || !clusterVectorInfo) {
			error = '全ての法案に回答済みです';
			return;
		}

		// Set up the cluster index and labels
		const labels = selectedGroupedVector.vectors.map((v) => v.clusterLabel).sort((a, b) => a - b);
		clusterLabelsToProcess = labels;
		currentClusterIndex = labels.indexOf(clusterToResume);

		// Get the existing result for this cluster
		const existingResult = clusterResults.find((cr) => cr.clusterLabel === clusterToResume);

		// Start a resumed session for this cluster
		isLoading = true;
		error = null;

		try {
			const response = await fetch('/api/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'resume',
					savedVectorId: clusterVectorInfo.id,
					existingUserVector: existingResult?.userVector,
					answeredBillIds: existingResult?.answeredBills?.map((b) => b.billId) || []
				})
			});

			const result = await response.json();

			if (!response.ok || !result.success) {
				throw new Error(result.error || 'セッションの再開に失敗しました');
			}

			sessionId = result.sessionId;
			currentQuestion = result.nextQuestion;
			answeredCount = result.preExistingAnswerCount || existingResult?.answeredCount || 0;
			currentClusterBillCount = clusterVectorInfo.billCount;
			currentClusterAnsweredBills =
				result.preExistingAnsweredBills || existingResult?.answeredBills || [];
			topMatches = result.topMatches || [];
			uncertainty = result.uncertainty || [];
			userVector = result.userVector || existingResult?.userVector || [];

			// Store member vectors for 2D visualization
			memberVectorsForViz = result.memberVectors || existingResult?.memberVectorsForViz || [];
			explainedVariance = result.explainedVariance || existingResult?.explainedVariance || [];
			userVectorHistory = existingResult?.userVectorHistory || [];

			if (currentQuestion) {
				phase = 'questioning';
			} else {
				// No more questions for this cluster, try the next one
				await findNextClusterWithUnanswered();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Find the next cluster with unanswered bills (for continue mode)
	 */
	/**
	 * Fill in missing cluster results for clusters that were skipped (fully answered from DB).
	 * This ensures all clusters have entries in clusterResults with their answeredBills.
	 */
	async function populateMissingClusterResults() {
		if (!selectedGroupedVector) return;

		for (const vectorInfo of selectedGroupedVector.vectors) {
			const label = vectorInfo.clusterLabel;
			const existingResult = clusterResults.find((cr) => cr.clusterLabel === label);

			if (!existingResult) {
				// This cluster was never processed — start a session to get pre-existing data
				try {
					const response = await fetch('/api/match', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							action: 'start',
							savedVectorId: vectorInfo.id
						})
					});

					const result = await response.json();

					if (response.ok && result.success) {
						// Get full matches by calling results
						let matches: MemberMatch[] = [];
						if (result.preExistingAnswerCount > 0) {
							const resultsResponse = await fetch('/api/match', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({
									action: 'results',
									sessionId: result.sessionId
								})
							});
							const resultsData = await resultsResponse.json();
							if (resultsResponse.ok && resultsData.success) {
								matches = resultsData.matches || [];
							}
						}

						const newResult: ClusterResult = {
							clusterLabel: label,
							clusterLabelName: clusterLabelNameMap[label] || null,
							matches,
							answeredCount: result.preExistingAnswerCount || 0,
							importance: 3, // Default importance
							userVector: result.userVector || [],
							answeredBills: result.preExistingAnsweredBills || [],
							memberVectorsForViz: result.memberVectors || [],
							explainedVariance: result.explainedVariance || [],
							userVectorHistory: [],
							xDimension: 0,
							yDimension: 1
						};

						clusterResults = [...clusterResults, newResult];
					}
				} catch {
					// Silently skip — this cluster just won't appear in results
				}
			}
		}
	}

	async function findNextClusterWithUnanswered() {
		if (!selectedGroupedVector) return;

		for (let i = currentClusterIndex + 1; i < clusterLabelsToProcess.length; i++) {
			const label = clusterLabelsToProcess[i];
			const vectorInfo = selectedGroupedVector.vectors.find((v) => v.clusterLabel === label);
			const clusterResult = clusterResults.find((cr) => cr.clusterLabel === label);

			if (vectorInfo) {
				const alreadyAnswered = clusterResult?.answeredCount || 0;
				if (alreadyAnswered < vectorInfo.billCount) {
					// Resume this cluster
					const existingResult = clusterResult;

					const response = await fetch('/api/match', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							action: 'resume',
							savedVectorId: vectorInfo.id,
							existingUserVector: existingResult?.userVector,
							answeredBillIds: existingResult?.answeredBills?.map((b) => b.billId) || []
						})
					});

					const result = await response.json();

					if (response.ok && result.success && result.nextQuestion) {
						// Only update index AFTER successful API call
						currentClusterIndex = i;

						sessionId = result.sessionId;
						currentQuestion = result.nextQuestion;
						answeredCount = result.preExistingAnswerCount || existingResult?.answeredCount || 0;
						currentClusterBillCount = vectorInfo.billCount;
						currentClusterAnsweredBills =
							result.preExistingAnsweredBills || existingResult?.answeredBills || [];
						topMatches = result.topMatches || [];
						userVector = result.userVector || existingResult?.userVector || [];
						memberVectorsForViz = result.memberVectors || existingResult?.memberVectorsForViz || [];
						explainedVariance = result.explainedVariance || existingResult?.explainedVariance || [];
						userVectorHistory = existingResult?.userVectorHistory || [];

						phase = 'questioning';
						return;
					}
				}
			}
		}

		// No more clusters with unanswered bills
		// Fill in any missing cluster results (fully answered clusters that were skipped)
		await populateMissingClusterResults();
		calculateGlobalScores();

		phase = 'global-results';
	}

	/**
	 * Save a snapshot of the current matching results
	 */
	async function saveSnapshot(name: string) {
		if (!clusterId) {
			throw new Error('セッション情報が不足しています');
		}

		isSaving = true;
		error = null;

		try {
			const response = await fetch('/api/saved-sessions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'snapshot',
					name,
					clusterId,
					clusterResults: clusterResults.map((cr) => ({
						clusterLabel: cr.clusterLabel,
						clusterLabelName: cr.clusterLabelName,
						importance: cr.importance,
						answeredCount: cr.answeredCount,
						matches: cr.matches,
						answeredBills: cr.answeredBills || []
					}))
				})
			});

			const result = await response.json();

			if (!response.ok || !result.success) {
				throw new Error(result.error || '保存に失敗しました');
			}

			snapshotSaved = true;
		} catch (e) {
			error = e instanceof Error ? e.message : '保存に失敗しました';
			throw e;
		} finally {
			isSaving = false;
		}
	}

	/**
	 * Start session for a specific cluster using saved vector
	 */
	async function startClusterSessionWithSavedVector(clusterLabel: number) {
		if (!selectedGroupedVector) return;

		isLoading = true;
		error = null;

		try {
			const savedVector = selectedGroupedVector.vectors.find(
				(v) => v.clusterLabel === clusterLabel
			);

			if (!savedVector) {
				throw new Error(`クラスター ${clusterLabel} の保存済みベクトルが見つかりません`);
			}

			const response = await fetch('/api/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'start',
					savedVectorId: savedVector.id
				})
			});

			const result = await response.json();

			if (!response.ok || !result.success) {
				throw new Error(result.error || 'セッションの開始に失敗しました');
			}

			sessionId = result.sessionId;
			currentQuestion = result.nextQuestion;
			answeredCount = result.preExistingAnswerCount || 0;
			currentClusterBillCount = savedVector.billCount; // Set the bill count for current cluster
			currentClusterAnsweredBills = result.preExistingAnsweredBills || [];

			console.log(
				`[startCluster] label=${clusterLabel}, preExistingAnswerCount=${result.preExistingAnswerCount}, preExistingAnsweredBills=${JSON.stringify(result.preExistingAnsweredBills?.length)}, currentClusterAnsweredBills=${currentClusterAnsweredBills.length}`
			);

			topMatches = result.topMatches || [];
			uncertainty = result.uncertainty || [];
			userVector = result.userVector || [];

			// Store member vectors for 2D visualization
			memberVectorsForViz = result.memberVectors || [];
			explainedVariance = result.explainedVariance || [];
			userVectorHistory = []; // Reset history for new cluster

			phase = 'questioning';
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Submit answer for current question
	 */
	async function submitAnswer(score: number) {
		if (!sessionId || !currentQuestion) return;

		// Capture info before update
		const billInfo = {
			billId: currentQuestion.billId,
			title: currentQuestion.title,
			answer: score,
			source: 'direct' as const
		};

		isLoading = true;
		error = null;

		try {
			const response = await fetch('/api/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'answer',
					sessionId: sessionId,
					billId: currentQuestion.billId,
					score: score
				})
			});

			const result = await response.json();

			if (!response.ok || !result.success) {
				throw new Error(result.error || '回答の送信に失敗しました');
			}

			// Record or update answer in currentClusterAnsweredBills
			const existingIndex = currentClusterAnsweredBills.findIndex(
				(b) => b.billId === billInfo.billId
			);
			if (existingIndex >= 0) {
				// Update existing answer
				currentClusterAnsweredBills = currentClusterAnsweredBills.map((b, i) =>
					i === existingIndex ? billInfo : b
				);
			} else {
				// Add new answer
				currentClusterAnsweredBills = [...currentClusterAnsweredBills, billInfo];
			}

			answeredCount = result.answeredBills;
			uncertainty = result.uncertainty || [];

			// Track user position history for visualization (only for new answers, not edits)
			if (!isEditingAnswer && userVector.length > 0 && userVector.some((v) => v !== 0)) {
				userVectorHistory = [...userVectorHistory, [...userVector]];
			}
			userVector = result.userVector || [];
			topMatches = result.topMatches || [];

			// Handle next question based on whether we were editing
			if (isEditingAnswer) {
				// After editing, go back to showing new questions (or null if cluster is complete)
				isEditingAnswer = false;
				currentQuestion = result.nextQuestion;
			} else {
				currentQuestion = result.nextQuestion;
				// Don't auto-advance when all questions are answered
				// User can manually finish the cluster or navigate to other clusters
			}
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Skip current question
	 */
	async function skipQuestion() {
		if (!sessionId || !currentQuestion) return;

		// Capture info before update
		const billInfo = {
			billId: currentQuestion.billId,
			title: currentQuestion.title,
			answer: 0, // 0 for skip/neutral
			source: 'direct' as const
		};

		isLoading = true;
		error = null;

		try {
			const response = await fetch('/api/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'skip',
					sessionId: sessionId,
					billId: currentQuestion.billId
				})
			});

			const result = await response.json();

			if (!response.ok || !result.success) {
				throw new Error(result.error || 'スキップに失敗しました');
			}

			// Record or update answer in currentClusterAnsweredBills
			const existingIndex = currentClusterAnsweredBills.findIndex(
				(b) => b.billId === billInfo.billId
			);
			if (existingIndex >= 0) {
				// Update existing answer
				currentClusterAnsweredBills = currentClusterAnsweredBills.map((b, i) =>
					i === existingIndex ? billInfo : b
				);
			} else {
				// Add new answer
				currentClusterAnsweredBills = [...currentClusterAnsweredBills, billInfo];
			}

			uncertainty = result.uncertainty || [];
			userVector = result.userVector || [];
			topMatches = result.topMatches || [];

			// Handle next question based on whether we were editing
			if (isEditingAnswer) {
				// After editing, go back to showing new questions (or null if cluster is complete)
				isEditingAnswer = false;
				currentQuestion = result.nextQuestion;
			} else {
				currentQuestion = result.nextQuestion;
				// Don't auto-advance when all questions are answered
				// User can manually finish the cluster or navigate to other clusters
			}
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Select a previously answered bill to edit the answer
	 */
	function selectBillToEdit(bill: {
		billId: number;
		title: string;
		answer: number;
		source?: 'direct' | 'delegated';
		delegationStatus?: 'pending' | 'voted';
	}) {
		// Store the current question so we can restore it on cancel
		previousQuestion = currentQuestion;

		// Create a Bill-like object for the current question
		currentQuestion = {
			billId: bill.billId,
			title: bill.title,
			description: null,
			passed: true, // We don't have this info, but it's not critical for editing
			result: null,
			reason: '回答を変更中',
			dimensionTarget: 0
		};
		isEditingAnswer = true;
	}

	/**
	 * Cancel editing and restore the previous question
	 */
	function cancelEditing() {
		isEditingAnswer = false;
		currentQuestion = previousQuestion;
		previousQuestion = null;
	}

	/**
	 * Handle delegation: after a bill is delegated, skip to the next question
	 */
	async function handleDelegateBill(billId: number) {
		if (!sessionId) return;

		// Find bill info from answered bills or current question
		const existingBill = currentClusterAnsweredBills.find((b) => b.billId === billId);
		const billTitle = existingBill?.title || currentQuestion?.title || `法案 #${billId}`;

		// Capture info before update - mark as delegated
		const billInfo = {
			billId,
			title: billTitle,
			answer: 0,
			source: 'delegated' as const,
			delegationStatus: 'pending' as const
		};

		isLoading = true;
		error = null;

		try {
			// If the bill is already answered in the session, we don't need to skip via API
			// (the session already has it). Just update the local record.
			const isAlreadyAnswered = existingBill != null;

			if (!isAlreadyAnswered && currentQuestion) {
				// New bill - skip via API to advance to next question
				const response = await fetch('/api/match', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						action: 'skip',
						sessionId: sessionId,
						billId
					})
				});

				const result = await response.json();

				if (!response.ok || !result.success) {
					throw new Error(result.error || '委任に失敗しました');
				}

				answeredCount = result.answeredBills ?? answeredCount + 1;
				uncertainty = result.uncertainty || [];
				userVector = result.userVector || [];
				topMatches = result.topMatches || [];

				if (isEditingAnswer) {
					isEditingAnswer = false;
				}
				currentQuestion = result.nextQuestion;
			}

			// Record as delegated in currentClusterAnsweredBills
			const existingIndex = currentClusterAnsweredBills.findIndex(
				(b) => b.billId === billInfo.billId
			);
			if (existingIndex >= 0) {
				currentClusterAnsweredBills = currentClusterAnsweredBills.map((b, i) =>
					i === existingIndex ? billInfo : b
				);
			} else {
				currentClusterAnsweredBills = [...currentClusterAnsweredBills, billInfo];
			}

			// If we were editing this bill, cancel edit and go back to previous question
			if (isEditingAnswer) {
				isEditingAnswer = false;
				currentQuestion = previousQuestion;
				previousQuestion = null;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	function scrollChipIntoView(el: HTMLElement) {
		el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
	}

	/**
	 * Navigate to a specific cluster by index
	 */
	async function navigateToCluster(targetIndex: number) {
		if (targetIndex === currentClusterIndex) return;
		if (targetIndex < 0 || targetIndex >= clusterLabelsToProcess.length) return;
		if (isLoading) return;

		const targetLabel = clusterLabelsToProcess[targetIndex];

		// Save current cluster state first if we have answers
		if (
			answeredCount > 0 &&
			currentClusterLabel !== null &&
			(phase === 'questioning' || phase === 'rating')
		) {
			// Get current matches if we don't have them
			let matchesToSave = currentClusterMatches;
			if (matchesToSave.length === 0 && sessionId) {
				try {
					const response = await fetch('/api/match', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							action: 'results',
							sessionId: sessionId
						})
					});
					const result = await response.json();
					if (response.ok && result.success) {
						matchesToSave = result.matches || [];
					}
				} catch (e) {
					console.error('Failed to get matches for saving:', e);
				}
			}

			// Save current cluster result
			const currentResult: ClusterResult = {
				clusterLabel: currentClusterLabel,
				clusterLabelName: clusterLabelNameMap[currentClusterLabel] || null,
				matches: matchesToSave,
				answeredCount: answeredCount,
				importance: pendingImportance,
				userVector: [...userVector],
				answeredBills: [...currentClusterAnsweredBills],
				memberVectorsForViz: [...memberVectorsForViz],
				explainedVariance: [...explainedVariance],
				userVectorHistory: userVectorHistory.map((v) => [...v]),
				xDimension,
				yDimension
			};

			const existingIndex = clusterResults.findIndex(
				(cr) => cr.clusterLabel === currentClusterLabel
			);
			if (existingIndex >= 0) {
				clusterResults = [
					...clusterResults.slice(0, existingIndex),
					currentResult,
					...clusterResults.slice(existingIndex + 1)
				];
			} else {
				clusterResults = [...clusterResults, currentResult];
			}
		}

		isLoading = true;
		error = null;

		try {
			// Check if we have an existing result for the target cluster
			const existingResult = clusterResults.find((cr) => cr.clusterLabel === targetLabel);
			const vectorInfo = selectedGroupedVector?.vectors.find((v) => v.clusterLabel === targetLabel);

			if (!vectorInfo) {
				throw new Error(`クラスター ${targetLabel} の情報が見つかりません`);
			}

			if (existingResult) {
				// Resume this cluster with existing state
				const response = await fetch('/api/match', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						action: 'resume',
						savedVectorId: vectorInfo.id,
						existingUserVector: existingResult.userVector,
						answeredBillIds: existingResult.answeredBills?.map((b) => b.billId) || []
					})
				});

				const result = await response.json();

				if (!response.ok || !result.success) {
					throw new Error(result.error || 'セッションの再開に失敗しました');
				}

				currentClusterIndex = targetIndex;
				sessionId = result.sessionId;
				currentQuestion = result.nextQuestion;
				answeredCount = existingResult.answeredCount;
				currentClusterBillCount = vectorInfo.billCount;
				currentClusterAnsweredBills = existingResult.answeredBills || [];
				topMatches = result.topMatches || [];
				uncertainty = result.uncertainty || [];
				userVector = result.userVector || existingResult.userVector || [];
				memberVectorsForViz = result.memberVectors || existingResult.memberVectorsForViz || [];
				explainedVariance = result.explainedVariance || existingResult.explainedVariance || [];
				userVectorHistory = existingResult.userVectorHistory || [];
				pendingImportance = existingResult.importance;
				xDimension = existingResult.xDimension ?? 0;
				yDimension = existingResult.yDimension ?? 1;
				currentClusterMatches = existingResult.matches || [];
			} else {
				// Start fresh for this cluster
				const response = await fetch('/api/match', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						action: 'start',
						savedVectorId: vectorInfo.id
					})
				});

				const result = await response.json();

				if (!response.ok || !result.success) {
					throw new Error(result.error || 'セッションの開始に失敗しました');
				}

				currentClusterIndex = targetIndex;
				sessionId = result.sessionId;
				currentQuestion = result.nextQuestion;
				answeredCount = 0;
				currentClusterBillCount = vectorInfo.billCount;
				currentClusterAnsweredBills = [];
				topMatches = [];
				uncertainty = result.uncertainty || [];
				userVector = result.userVector || [];
				memberVectorsForViz = result.memberVectors || [];
				explainedVariance = result.explainedVariance || [];
				userVectorHistory = [];
				pendingImportance = 3;
				xDimension = 0;
				yDimension = 1;
				currentClusterMatches = [];
			}

			phase = 'questioning';
			isEditingAnswer = false;
			previousQuestion = null;
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Finish current cluster early and get results
	 */
	async function finishCurrentCluster() {
		if (!sessionId) return;

		isLoading = true;
		error = null;

		try {
			const response = await fetch('/api/match', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action: 'results',
					sessionId: sessionId
				})
			});

			const result = await response.json();

			if (!response.ok || !result.success) {
				throw new Error(result.error || '結果の取得に失敗しました');
			}

			currentClusterMatches = result.matches || [];
			userVector = result.userVector || [];

			// In resume mode, use existing importance if available
			const existingResult = clusterResults.find((cr) => cr.clusterLabel === currentClusterLabel);
			pendingImportance = existingResult?.importance ?? 3;

			phase = 'rating';
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Save importance rating and move to next cluster or results
	 */
	async function saveImportanceAndContinue() {
		isLoading = true;
		error = null;

		try {
			// Save current cluster result
			const newResult: ClusterResult = {
				clusterLabel: currentClusterLabel!,
				clusterLabelName: clusterLabelNameMap[currentClusterLabel!] || null,
				matches: currentClusterMatches,
				answeredCount: answeredCount,
				importance: pendingImportance,
				userVector: [...userVector],
				answeredBills: [...currentClusterAnsweredBills],
				// Save visualization state
				memberVectorsForViz: [...memberVectorsForViz],
				explainedVariance: [...explainedVariance],
				userVectorHistory: userVectorHistory.map((v) => [...v]),
				xDimension,
				yDimension
			};

			// Check if this cluster already exists in results (resume mode)
			const existingIndex = clusterResults.findIndex(
				(cr) => cr.clusterLabel === currentClusterLabel
			);
			if (existingIndex >= 0) {
				// Update existing result
				clusterResults = [
					...clusterResults.slice(0, existingIndex),
					newResult,
					...clusterResults.slice(existingIndex + 1)
				];
			} else {
				// Add new result
				clusterResults = [...clusterResults, newResult];
			}

			// Move to next cluster or show results
			if (currentClusterIndex < clusterLabelsToProcess.length - 1) {
				const nextIndex = currentClusterIndex + 1;
				await startClusterSessionWithSavedVector(clusterLabelsToProcess[nextIndex]);
				// Only update the index after successful start
				currentClusterIndex = nextIndex;
			} else {
				// Fill in any missing cluster results before showing global results
				await populateMissingClusterResults();
				calculateGlobalScores();
				phase = 'global-results';
			}
		} catch (e) {
			error = e instanceof Error ? e.message : '不明なエラーが発生しました';
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Calculate global weighted scores
	 */
	function calculateGlobalScores() {
		// Collect all member IDs
		const allMemberIds = new SvelteSet<number>();
		for (const result of clusterResults) {
			for (const match of result.matches) {
				allMemberIds.add(match.memberId);
			}
		}

		// Calculate total weight
		const totalWeight = clusterResults.reduce((sum, r) => sum + r.importance, 0);

		// Calculate weighted scores for each member
		const memberScores: GlobalMemberScore[] = [];

		for (const memberId of allMemberIds) {
			let weightedSum = 0;
			const clusterScores: Record<number, number> = {};
			let memberName = '';
			let memberGroup: string | null = null;

			for (const result of clusterResults) {
				const match = result.matches.find((m) => m.memberId === memberId);
				if (match) {
					const similarity = match.similarity;
					clusterScores[result.clusterLabel] = similarity;
					weightedSum += (result.importance / totalWeight) * similarity;
					memberName = match.name;
					memberGroup = match.group;
				} else {
					clusterScores[result.clusterLabel] = 0;
				}
			}

			if (memberName) {
				memberScores.push({
					memberId,
					name: memberName,
					group: memberGroup,
					globalScore: weightedSum,
					clusterScores
				});
			}
		}

		// Sort by global score
		globalScores = memberScores.sort((a, b) => b.globalScore - a.globalScore);
	}

	/**
	 * Reset and start over
	 */
	function reset() {
		phase = 'setup';
		sessionId = null;
		currentQuestion = null;
		answeredCount = 0;
		currentClusterAnsweredBills = [];
		topMatches = [];
		uncertainty = [];
		userVector = [];
		clusterResults = [];
		globalScores = [];
		currentClusterIndex = 0;
		clusterLabelsToProcess = [];
		clusterLabelNameMap = {};
		error = null;
		// Reset visualization state
		memberVectorsForViz = [];
		explainedVariance = [];
		userVectorHistory = [];
		xDimension = 0;
		yDimension = 1;
		// Reset save state
		snapshotSaved = false;
		clusterId = null;
		// Clear URL params
		goto('/match', { replaceState: true });
	}

	// Trigger animations on mount
	onMount(() => {
		setTimeout(() => {
			mounted = true;
		}, 100);

		// Auto-select default configuration if none selected
		if (!selectedSavedVectorKey && groupedSavedVectors.length > 0) {
			const defaultGroup = groupedSavedVectors.find((g) => g.isDefault);
			if (defaultGroup) {
				selectedSavedVectorKey = defaultGroup.key;
			}
		}

		// Check for pending save after login/register
		const pendingSave = sessionStorage.getItem('pendingSaveData');
		if (pendingSave && data.user) {
			try {
				const parsed = JSON.parse(pendingSave);
				sessionStorage.removeItem('pendingSaveData');
				// Restore matching state
				selectedSavedVectorKey = parsed.selectedSavedVectorKey;
				clusterId = parsed.clusterId;
				nComponents = parsed.nComponents;
				clusterResults = parsed.clusterResults;
				globalScores = parsed.globalScores;
				clusterLabelsToProcess = parsed.clusterLabelsToProcess;
				clusterLabelNameMap = parsed.clusterLabelNameMap;
				phase = 'global-results';
				// Auto-open save after a short delay so UI renders
				showPendingSavePrompt = true;
			} catch {
				sessionStorage.removeItem('pendingSaveData');
			}
		}
	});

	// Pending save prompt state
	let showPendingSavePrompt = $state(false);

	/**
	 * Store matching state and redirect to login for saving
	 */
	function loginToSave() {
		const saveData = {
			selectedSavedVectorKey,
			clusterId,
			nComponents,
			clusterResults: clusterResults.map((cr) => ({
				clusterLabel: cr.clusterLabel,
				clusterLabelName: cr.clusterLabelName,
				userVector: cr.userVector,
				importance: cr.importance,
				answeredCount: cr.answeredCount,
				matches: cr.matches,
				memberVectorsForViz: cr.memberVectorsForViz,
				explainedVariance: cr.explainedVariance,
				userVectorHistory: cr.userVectorHistory,
				xDimension: cr.xDimension,
				yDimension: cr.yDimension,
				answeredBills: cr.answeredBills || []
			})),
			globalScores,
			clusterLabelsToProcess,
			clusterLabelNameMap
		};
		sessionStorage.setItem('pendingSaveData', JSON.stringify(saveData));
		goto('/auth/login?redirect=/match');
	}
</script>

<svelte:head>
	<title>議員マッチング | Candidate Match</title>
</svelte:head>

<div class="page" class:mounted>
	<!-- Hero Section (shown only in setup) -->
	{#if phase === 'setup'}
		<section class="hero">
			<div class="hero-badge animate-in" style="--delay: 0">
				<Vote size={16} class="inline-icon" /> AI議員マッチング
			</div>
			<h1 class="hero-title animate-in" style="--delay: 1">
				<span class="gradient-text">マッチング診断</span>
			</h1>
			<p class="hero-subtitle animate-in" style="--delay: 2">
				法案への賛否を答えて、あなたに近い議員を見つけましょう。過去の回答は自動的に引き継がれます。
			</p>
		</section>
	{:else}
		<!-- Compact Header for other phases -->
		<header class="compact-header">
			<div class="container">
				<h1 class="compact-title"><Vote size={20} class="inline-icon" /> 議員マッチング</h1>
			</div>
		</header>
	{/if}

	<main class="main-container">
		{#if showPendingSavePrompt}
			<div class="success-alert animate-in" style="margin-bottom: 1rem;">
				<div style="display: flex; align-items: center; gap: 0.5rem;">
					<span><CircleCheck size={16} color="#22c55e" /></span>
					<span>ログインしました。マッチング結果を保存できます。</span>
				</div>
			</div>
		{/if}

		{#if error}
			<div class="error-alert animate-in">
				<div class="error-icon"><TriangleAlert size={20} color="#f59e0b" /></div>
				<div>
					<span class="error-title">エラー</span>
					<p class="error-message">{error}</p>
				</div>
			</div>
		{/if}

		<!-- Progress section for multi-cluster -->
		{#if phase !== 'setup' && phase !== 'global-results'}
			<div class="progress-section animate-in">
				<!-- Cluster chips - horizontal scrollable -->
				<div class="cluster-chips-scroll" id="cluster-chips-scroll">
					{#each clusterLabelsToProcess as label, idx (label)}
						{@const displayName = getClusterDisplayName(label)}
						{@const hasAnswers =
							clusterResults.some((cr) => cr.clusterLabel === label && cr.answeredCount > 0) ||
							(label === currentClusterLabel && answeredCount > 0)}
						<button
							class="cluster-chip"
							class:completed={hasAnswers && idx !== currentClusterIndex}
							class:active={idx === currentClusterIndex}
							class:pending={!hasAnswers && idx !== currentClusterIndex}
							onclick={(e) => {
								navigateToCluster(idx);
								scrollChipIntoView(e.currentTarget);
							}}
							disabled={isLoading}
							title={idx === currentClusterIndex ? '現在のクラスター' : `${displayName}に移動`}
						>
							{#if hasAnswers && idx !== currentClusterIndex}
								<span class="chip-icon">✓</span>
							{/if}
							{displayName}
						</button>
					{/each}
				</div>

				{#if phase === 'questioning'}
					<!-- Progress bar - current cluster -->
					<div class="progress-bar-row">
						<div class="progress-bar-container">
							<div class="progress-bar" style="width: {clusterProgress}%"></div>
						</div>
						<span class="progress-label">{answeredCount}/{currentClusterBillCount}</span>
					</div>

					<!-- Stats row -->
					<div class="cluster-stats">
						<div class="stats-badges">
							{#if directAnsweredCount > 0}
								<span class="stat-badge stat-answered">回答 {directAnsweredCount}</span>
							{/if}
							{#if skippedCount > 0}
								<span class="stat-badge stat-skipped">スキップ {skippedCount}</span>
							{/if}
							{#if delegatedVotedCount > 0}
								<span class="stat-badge stat-delegated-voted">委任済 {delegatedVotedCount}</span>
							{/if}
							{#if delegatedPendingCount > 0}
								<span class="stat-badge stat-delegated-pending">委任中 {delegatedPendingCount}</span
								>
							{/if}
							{#if unansweredCount > 0}
								<span class="stat-badge stat-pending">未回答 {unansweredCount}</span>
							{/if}
						</div>
						<button
							onclick={finishCurrentCluster}
							disabled={isLoading || answeredCount < 2}
							class="btn-next-cluster"
						>
							{answeredCount >= 2
								? '次のクラスターに進む →'
								: `あと${2 - answeredCount}問回答してください`}
						</button>
					</div>
				{/if}
			</div>
		{/if}

		{#if phase === 'setup'}
			<SetupPhase
				{groupedSavedVectors}
				bind:selectedSavedVectorKey
				{selectedGroupedVector}
				{isLoading}
				isAdmin={data.user?.role === 'admin'}
				onStart={startWithSavedVector}
			/>
		{:else if phase === 'questioning'}
			<QuestioningPhase
				{currentClusterDisplayName}
				{answeredCount}
				{currentClusterBillCount}
				{currentQuestion}
				{isLoading}
				{isEditingAnswer}
				{topMatches}
				{memberVectorsForViz}
				{explainedVariance}
				bind:xDimension
				bind:yDimension
				{userVector}
				{userVectorHistory}
				{highlightedMembersForViz}
				{currentClusterAnsweredBills}
				onSubmitAnswer={submitAnswer}
				onSkipQuestion={skipQuestion}
				onDelegateBill={handleDelegateBill}
				isLoggedIn={!!data.user}
				onFinishCluster={finishCurrentCluster}
				onSelectBillToEdit={selectBillToEdit}
				onCancelEditing={cancelEditing}
			/>
		{:else if phase === 'rating'}
			<!-- Cluster Review Phase (Rating + Results) -->
			<ClusterReviewPhase
				{currentClusterDisplayName}
				{currentClusterMatches}
				bind:pendingImportance
				{currentClusterIndex}
				totalClusters={clusterLabelsToProcess.length}
				{isLastClusterInSession}
				{isLoading}
				{memberVectorsForViz}
				{explainedVariance}
				bind:xDimension
				bind:yDimension
				{userVector}
				{userVectorHistory}
				onSetImportance={(importance) => (pendingImportance = importance)}
				onSaveAndContinue={saveImportanceAndContinue}
			/>
		{:else if phase === 'global-results'}
			<!-- Global Results Phase -->
			<GlobalResultsPhase
				{clusterResults}
				{globalScores}
				onReset={reset}
				onSave={data.user ? saveSnapshot : undefined}
				{isSaving}
				{snapshotSaved}
				onContinue={continueAnswering}
				{totalUnansweredBills}
				isContinuing={isLoading}
				isLoggedIn={!!data.user}
				onLoginToSave={loginToSave}
			/>
		{/if}
	</main>

	<!-- Floating Help Button -->
	<button
		class="floating-help-btn"
		onclick={() => (showExplanationModal = true)}
		aria-label="マッチングの仕組みを見る"
	>
		<span class="help-icon">?</span>
		<span class="help-text">仕組み</span>
	</button>

	<!-- Explanation Modal -->
	<ExplanationModal show={showExplanationModal} onClose={() => (showExplanationModal = false)} />
</div>

<style>
	/* ===== KEYFRAME ANIMATIONS ===== */
	@keyframes fadeInUp {
		from {
			opacity: 0;
			transform: translateY(30px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.05);
		}
	}

	@keyframes gradientShift {
		0% {
			background-position: 0% 50%;
		}
		50% {
			background-position: 100% 50%;
		}
		100% {
			background-position: 0% 50%;
		}
	}

	@keyframes shimmer {
		0% {
			transform: translateX(-100%);
		}
		100% {
			transform: translateX(100%);
		}
	}

	/* ===== BASE STYLES ===== */
	:global(body) {
		background-color: #fafbfc;
	}

	.page {
		min-height: 100vh;
		background: #fafbfc;
	}

	.animate-in {
		opacity: 0;
		transform: translateY(30px);
	}

	.page.mounted .animate-in {
		animation: fadeInUp 0.8s ease forwards;
		animation-delay: calc(var(--delay, 0) * 0.15s);
	}

	/* ===== HERO SECTION ===== */
	.hero {
		text-align: center;
		padding: 4rem 2rem 3rem;
		max-width: 900px;
		margin: 0 auto;
	}

	.hero-badge {
		display: inline-block;
		background: linear-gradient(135deg, #eef2ff, #e0e7ff);
		color: #4f46e5;
		padding: 0.5rem 1.25rem;
		border-radius: 100px;
		font-size: 0.9rem;
		font-weight: 600;
		margin-bottom: 1.5rem;
	}

	.hero-title {
		font-size: clamp(2rem, 5vw, 3.5rem);
		font-weight: 800;
		line-height: 1.15;
		color: #1a1a2e;
		margin-bottom: 1.5rem;
		letter-spacing: -0.02em;
	}

	.gradient-text {
		background: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%);
		background-size: 200% 200%;
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
		animation: gradientShift 4s ease infinite;
	}

	.hero-subtitle {
		font-size: 1.1rem;
		color: #64748b;
		line-height: 1.7;
		max-width: 600px;
		margin: 0 auto 2rem;
	}

	/* ===== COMPACT HEADER ===== */
	.compact-header {
		background: white;
		border-bottom: 1px solid #e5e7eb;
		padding: 1rem 0;
		position: sticky;
		top: 0;
		z-index: 50;
		backdrop-filter: blur(10px);
		background: rgba(255, 255, 255, 0.95);
	}

	.compact-title {
		font-size: 1.25rem;
		font-weight: 700;
		color: #1a1a2e;
	}

	.container {
		max-width: 1024px;
		margin: 0 auto;
		padding: 0 1rem;
	}

	/* ===== MAIN LAYOUT ===== */
	.main-container {
		max-width: 64rem;
		margin: 0 auto;
		padding: 2rem 1rem;
	}

	/* ===== ERROR ALERT ===== */
	.error-alert {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		background: linear-gradient(135deg, #fee2e2, #fecaca);
		border: 1px solid #fca5a5;
		border-radius: 12px;
		padding: 1rem 1.5rem;
		margin-bottom: 1.5rem;
		box-shadow: 0 4px 12px rgba(239, 68, 68, 0.1);
	}

	.error-icon {
		font-size: 1.5rem;
		line-height: 1;
	}

	.error-title {
		display: block;
		font-weight: 700;
		color: #991b1b;
		margin-bottom: 0.25rem;
	}

	.error-message {
		color: #7f1d1d;
		font-size: 0.95rem;
		line-height: 1.5;
	}

	/* ===== PROGRESS SECTION ===== */
	.progress-section {
		margin-bottom: 2rem;
		max-width: 800px;
		margin-left: auto;
		margin-right: auto;
	}

	.progress-bar-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 0.75rem;
	}

	.progress-bar-container {
		flex: 1;
		height: 6px;
		background: #e5e7eb;
		border-radius: 100px;
		overflow: hidden;
		position: relative;
	}

	.progress-bar {
		height: 100%;
		background: linear-gradient(90deg, #6366f1 0%, #a855f7 100%);
		border-radius: 100px;
		transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
		position: relative;
		overflow: hidden;
	}

	.progress-bar::after {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;
		right: 0;
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
		animation: shimmer 2s infinite;
	}

	.progress-label {
		font-size: 0.8rem;
		font-weight: 600;
		color: #6b7280;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	/* ===== CLUSTER STATS ===== */
	.cluster-stats {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.stats-badges {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.btn-next-cluster {
		padding: 0.375rem 0.875rem;
		border-radius: 100px;
		font-weight: 600;
		font-size: 0.75rem;
		cursor: pointer;
		transition: all 0.2s ease;
		border: 1.5px solid #6366f1;
		background: white;
		color: #6366f1;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.btn-next-cluster:hover:not(:disabled) {
		background: #6366f1;
		color: white;
	}

	.btn-next-cluster:disabled {
		opacity: 0.4;
		cursor: not-allowed;
		border-color: #9ca3af;
		color: #9ca3af;
	}

	.stat-badge {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.25rem 0.625rem;
		border-radius: 100px;
		font-variant-numeric: tabular-nums;
	}

	.stat-answered {
		background: rgba(34, 197, 94, 0.12);
		color: #15803d;
	}

	.stat-skipped {
		background: rgba(59, 130, 246, 0.1);
		color: #2563eb;
	}

	.stat-delegated-voted {
		background: rgba(139, 92, 246, 0.1);
		color: #7c3aed;
	}

	.stat-delegated-pending {
		background: rgba(245, 158, 11, 0.12);
		color: #b45309;
	}

	.stat-pending {
		background: rgba(107, 114, 128, 0.1);
		color: #6b7280;
	}

	/* ===== CLUSTER CHIPS ===== */
	.cluster-chips-scroll {
		display: flex;
		gap: 0.5rem;
		overflow-x: auto;
		scroll-behavior: smooth;
		-webkit-overflow-scrolling: touch;
		scrollbar-width: none;
		padding-bottom: 2px;
	}

	.cluster-chips-scroll::-webkit-scrollbar {
		display: none;
	}

	.cluster-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.5rem 0.75rem;
		border-radius: 100px;
		font-size: 0.85rem;
		font-weight: 600;
		transition: all 0.2s ease;
		border: 2px solid transparent;
		cursor: pointer;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.cluster-chip:hover:not(:disabled):not(.active) {
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.cluster-chip:disabled {
		cursor: not-allowed;
		opacity: 0.7;
	}

	.cluster-chip.completed {
		background: #d1fae5;
		color: #065f46;
		border-color: #10b981;
	}

	.cluster-chip.completed:hover:not(:disabled) {
		background: #a7f3d0;
	}

	.cluster-chip.active {
		background: #ddd6fe;
		color: #5b21b6;
		border-color: #8b5cf6;
		cursor: default;
	}

	.cluster-chip.pending {
		background: #f3f4f6;
		color: #6b7280;
		border-color: #e5e7eb;
	}

	.cluster-chip.pending:hover:not(:disabled) {
		background: #e5e7eb;
		border-color: #9ca3af;
	}

	.chip-icon {
		font-size: 0.75rem;
	}

	/* ===== RESPONSIVE ===== */
	@media (max-width: 768px) {
		.hero {
			padding: 3rem 1.5rem 2rem;
		}

		.hero-title {
			font-size: 2rem;
		}

		.cluster-stats {
			flex-wrap: wrap;
			justify-content: space-between;
		}

		.stats-badges {
			justify-content: center;
			flex: 1;
		}
	}

	/* ===== FLOATING HELP BUTTON ===== */
	.floating-help-btn {
		position: fixed;
		bottom: 2rem;
		right: 2rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1.25rem;
		background: #6366f1;
		color: white;
		border-radius: 100px;
		border: none;
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
		cursor: pointer;
		z-index: 100;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		font-weight: 600;
	}

	.floating-help-btn:hover {
		transform: translateY(-2px);
		box-shadow: 0 6px 16px rgba(99, 102, 241, 0.5);
		background: #4f46e5;
	}

	.help-icon {
		font-size: 1.25rem;
		font-weight: 700;
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
