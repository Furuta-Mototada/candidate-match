type AnswerLabelOptions = {
	source?: 'direct' | 'delegated';
	delegationStatus?: 'pending' | 'voted' | string;
	nullLabel?: string;
	skipLabel?: string;
};

export function getAnswerLabel(
	score: number | null | undefined,
	options?: AnswerLabelOptions
): string {
	const { source, delegationStatus, nullLabel = '未回答', skipLabel = 'スキップ' } = options ?? {};

	if (score == null) return nullLabel;

	if (source === 'delegated') {
		if (delegationStatus === 'voted') {
			if (score === 1) return '委任: 賛成';
			if (score === -1) return '委任: 反対';
			return '委任済';
		}
		if (score === 1) return `委任(賛成)`;
		if (score === -1) return `委任(反対)`;
		return '委任中';
	}

	if (score === 1) return '賛成';
	if (score === -1) return '反対';
	return skipLabel;
}

export function getAnswerClass(
	score: number | null | undefined,
	options?: { source?: 'direct' | 'delegated'; delegationStatus?: string }
): string {
	const { source, delegationStatus } = options ?? {};

	if (score == null) return 'answer-none';

	if (source === 'delegated') {
		return delegationStatus === 'voted' ? 'answer-delegated-voted' : 'answer-delegated-pending';
	}

	if (score === 1) return 'answer-agree';
	if (score === -1) return 'answer-disagree';
	return 'answer-skip';
}
