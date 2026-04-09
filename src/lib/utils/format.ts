/**
 * Format a bill reference string like "第219回 参法 第1号"
 */
export function formatBillRef(
	billType?: string | null,
	submissionSession?: number | null,
	billNumber?: number | null
): string | null {
	if (!billType || !submissionSession || !billNumber) return null;
	return `第${submissionSession}回 ${billType} 第${billNumber}号`;
}
