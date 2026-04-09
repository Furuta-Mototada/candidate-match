import type { MemberDetail } from '$lib/types/index.js';

export async function fetchMemberDetail(
	memberId: number,
	billIds: number[],
	signal?: AbortSignal
): Promise<MemberDetail | null> {
	let url = `/api/member-detail?memberId=${encodeURIComponent(String(memberId))}`;
	if (billIds.length > 0) url += `&billIds=${encodeURIComponent(billIds.join(','))}`;
	const res = await fetch(url, { signal });
	if (res.ok) {
		return (await res.json()) as MemberDetail;
	}
	return null;
}
