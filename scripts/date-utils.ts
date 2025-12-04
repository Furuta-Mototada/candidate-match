/**
 * Shared date parsing utilities for Japanese date formats
 */

/**
 * Parse Japanese dates in multiple formats:
 * - Japanese era format: "令和7年10月21日", "平成元年4月1日", "昭和64年1月7日"
 * - Western format: "2019年1月28日"
 *
 * Supports 元年 as year 1 for era dates.
 *
 * @param text - Date string in Japanese format
 * @returns ISO date string (YYYY-MM-DD) or null if parsing fails
 */
export function parseJapaneseDate(text: string): string | null {
	if (!text) return null;

	// Try Japanese era format first (令和|平成|昭和)
	// Supports both regular numbers and 元年 (first year)
	const eraMatch = text.match(/(令和|平成|昭和)(元|\d{1,4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
	if (eraMatch) {
		const era = eraMatch[1];
		const yearPart = eraMatch[2] === '元' ? 1 : parseInt(eraMatch[2]);
		const month = parseInt(eraMatch[3]);
		const day = parseInt(eraMatch[4]);

		const eraBase: Record<string, number> = {
			令和: 2018,
			平成: 1988,
			昭和: 1925
		};

		const base = eraBase[era];
		if (!base) return null;

		const year = base + yearPart;
		return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
	}

	// Try Western format "2019年1月28日"
	const westernMatch = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
	if (westernMatch) {
		const year = parseInt(westernMatch[1]);
		const month = parseInt(westernMatch[2]);
		const day = parseInt(westernMatch[3]);
		return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
	}

	return null;
}
