import { describe, it, expect } from 'vitest';
import { parseJapaneseDate } from './dateUtils';

describe('parseJapaneseDate', () => {
	describe('元年 (first year) handling', () => {
		it('should parse 令和元年 correctly', () => {
			expect(parseJapaneseDate('令和元年1月28日')).toBe('2019-01-28');
			expect(parseJapaneseDate('令和元年5月1日')).toBe('2019-05-01');
		});

		it('should parse 平成元年 correctly', () => {
			expect(parseJapaneseDate('平成元年1月28日')).toBe('1989-01-28');
			expect(parseJapaneseDate('平成元年1月8日')).toBe('1989-01-08');
		});

		it('should parse 昭和元年 correctly', () => {
			expect(parseJapaneseDate('昭和元年12月25日')).toBe('1926-12-25');
		});
	});

	describe('regular era year handling', () => {
		it('should parse 令和 years correctly', () => {
			expect(parseJapaneseDate('令和1年1月28日')).toBe('2019-01-28');
			expect(parseJapaneseDate('令和7年10月21日')).toBe('2025-10-21');
		});

		it('should parse 平成 years correctly', () => {
			expect(parseJapaneseDate('平成31年1月28日')).toBe('2019-01-28');
			expect(parseJapaneseDate('平成1年1月8日')).toBe('1989-01-08');
		});

		it('should parse 昭和 years correctly', () => {
			expect(parseJapaneseDate('昭和64年1月7日')).toBe('1989-01-07');
		});
	});

	describe('Western date format', () => {
		it('should parse Western dates correctly', () => {
			expect(parseJapaneseDate('2019年1月28日')).toBe('2019-01-28');
			expect(parseJapaneseDate('2025年10月21日')).toBe('2025-10-21');
		});
	});

	describe('edge cases', () => {
		it('should return null for empty or invalid input', () => {
			expect(parseJapaneseDate('')).toBe(null);
			expect(parseJapaneseDate('invalid')).toBe(null);
			expect(parseJapaneseDate('2019-01-28')).toBe(null);
		});

		it('should handle single-digit months and days', () => {
			expect(parseJapaneseDate('令和元年5月1日')).toBe('2019-05-01');
			expect(parseJapaneseDate('平成31年1月8日')).toBe('2019-01-08');
		});
	});
});
