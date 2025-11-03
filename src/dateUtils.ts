// Helper to parse Japanese date format "令和○年○月○日" or "平成○年○月○日"
export function parseJapaneseDate(text: string): string | null {
	if (!text) return null;

	// Match patterns like "令和7年10月21日", "平成31年1月28日", or "令和元年1月28日"
	const eraMatch = text.match(/(令和|平成|昭和)(元|\d{1,2})年(\d{1,2})月(\d{1,2})日/);
	if (eraMatch) {
		const era = eraMatch[1];
		const eraYearStr = eraMatch[2];
		// 元年 (first year) should be treated as year 1
		const eraYear = eraYearStr === '元' ? 1 : parseInt(eraYearStr);
		const month = parseInt(eraMatch[3]);
		const day = parseInt(eraMatch[4]);

		const eraBase: Record<string, number> = {
			令和: 2018,
			平成: 1988,
			昭和: 1925
		};

		const year = eraBase[era] + eraYear;
		return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
	}

	// Match Western format "2019年1月28日"
	const westernMatch = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
	if (westernMatch) {
		const year = parseInt(westernMatch[1]);
		const month = parseInt(westernMatch[2]);
		const day = parseInt(westernMatch[3]);
		return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
	}

	return null;
}
