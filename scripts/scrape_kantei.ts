import { fetch } from 'undici';
import dotenv from 'dotenv';
dotenv.config();
import { load } from 'cheerio';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { parseJapaneseDate } from './date-utils';
/* eslint-disable @typescript-eslint/no-explicit-any */

function parsePeriod(periodText: string): { start: string | null; end: string | null } {
	if (!periodText) return { start: null, end: null };

	// Check if this indicates "present" (現在) - if so, end date should be null
	const hasPresent = /現在|present/i.test(periodText);

	const parts = periodText
		.split(/～|〜|~/)
		.map((s) => s.trim())
		.filter(Boolean);
	const startRaw = parts[0] || '';
	const endRaw = parts[1] || '';

	// Parse using unified date parser (handles both era and Western formats)
	const start = parseJapaneseDate(startRaw);
	let end: string | null = null;

	// If the text contains "現在" (present), the end date is null (ongoing)
	if (hasPresent) {
		end = null;
	} else if (endRaw) {
		end = parseJapaneseDate(endRaw);
	}
	return { start, end };
}

function resolveUrl(base: string, href: string) {
	try {
		return new URL(href, base).toString();
	} catch {
		return href;
	}
}

async function main() {
	const DATABASE_URL = process.env.DATABASE_URL;
	const DRY_RUN = process.argv.includes('--dry-run');

	if (!DATABASE_URL && !DRY_RUN) {
		console.error(
			'DATABASE_URL is not set. Provide DATABASE_URL or run with --dry-run to skip DB writes.'
		);
		process.exit(1);
	}

	let client: ReturnType<typeof postgres> | null = null;
	let db: ReturnType<typeof drizzle> | null = null;
	if (!DRY_RUN && DATABASE_URL) {
		client = postgres(DATABASE_URL);
		db = drizzle(client, { schema });
	}

	const root = 'https://www.kantei.go.jp/jp/rekidainaikaku/index.html';
	console.log('Fetching main page:', root);
	const res = await fetch(root);
	if (res.status !== 200) {
		console.error('Failed to fetch main page', res.status);
		process.exit(1);
	}
	const body = await res.text();
	const $ = load(body);

	// Collect cabinet entries from the index list items (.his-block)
	const anchors: Array<{ text: string; href: string; period?: string }> = [];
	$('li.his-block').each((i, el) => {
		const genText = $(el).find('.his-generation').first().text().trim();
		const name =
			$(el).find('.his-name a').first().text().trim() ||
			$(el).find('.his-name').first().text().trim();
		const href = $(el).find('.his-name a').attr('href') || '';
		const period = $(el).find('.his-period').first().text().trim();
		if (genText && /第\s*\d+\s*代/.test(genText)) {
			anchors.push({ text: `${genText} ${name}`, href: resolveUrl(root, href), period });
		}
	});

	console.log(`Found ${anchors.length} cabinet entries on index page`);

	// Keep only 第90代 and onward (i.e., number >= 90)
	const filtered = anchors
		.map((a) => {
			const m = a.text.match(/第\s*(\d+)\s*代/);
			const num = m ? Number(m[1]) : NaN;
			return { ...a, num };
		})
		.filter((a) => !Number.isNaN(a.num) && a.num >= 90)
		.sort((x, y) => x.num - y.num);

	console.log(`Processing ${filtered.length} cabinets (>=第90代)`);

	for (const entry of filtered) {
		console.log(`Processing ${entry.text} -> ${entry.href}`);
		try {
			let startDate: string | null = null;
			let endDate: string | null = null;

			// derive a default pmName from the index entry text
			let pmName: string | null = entry.text.replace(/第\s*\d+\s*代/i, '').trim();

			// If the index captured a period string (his-period), prefer it as the canonical tenure
			if (entry.period && /年/.test(entry.period) && /[～〜~]/.test(entry.period)) {
				const p = parsePeriod(entry.period);
				startDate = p.start;
				endDate = p.end;
			}

			// If href is empty or points to the index page, and we already derived period from index, skip detail extraction
			if (!entry.href || entry.href === root) {
				// nothing more to do for dates; we'll still try to get the name from the index-derived text
			} else {
				const r = await fetch(entry.href);
				if (r.status !== 200) {
					console.warn('Failed to fetch detail page', r.status, entry.href);
					continue;
				}
				const dbody = await r.text();
				const $$ = load(dbody);

				// Often link text includes the PM name after the number, e.g. "第90代 氏名"
				const after = entry.text.replace(/第\s*\d+\s*代/i, '').trim();
				if (after) pmName = after;

				// Fallbacks: try document title, h1 or h2
				if (!pmName) {
					const docTitle = ($$('title').text() || '').trim();
					if (docTitle) pmName = docTitle.replace(/第\s*\d+\s*代/i, '').trim();
				}
				if (!pmName) {
					const h1 = $$('h1').first().text().trim();
					if (h1) pmName = h1.replace(/第\s*\d+\s*代/i, '').trim();
				}

				// Try to find name inside page content: look for "内閣総理大臣" nearby
				if (!pmName) {
					const possible = $$(':contains("内閣総理大臣")').first().text();
					if (possible) {
						// try to strip the label
						pmName = possible.replace(/.*内閣総理大臣\s*/, '').trim();
					}
				}

				pmName = pmName ? pmName.replace(/^[：:\-\s]+|[：:\-\s]+$/g, '') : null;

				// If we didn't already get dates from the index period, try to extract from the detail page
				if (!startDate || !endDate) {
					// Extract dates from detail page (try Gregorian first, then era dates)
					const textAll = $$('body').text();

					// Check if this is the current cabinet (contains "現在" = present)
					const hasPresent = /現在|present/i.test(textAll);

					const dates: string[] = [];
					const dateRe = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/g;
					let mm: RegExpExecArray | null;
					while ((mm = dateRe.exec(textAll))) {
						dates.push(`${mm[1]}年${mm[2]}月${mm[3]}日`);
						if (dates.length >= 2) break;
					}

					const maybeStart = dates[0] ? parseJapaneseDate(dates[0]) : null;
					const maybeEnd = hasPresent ? null : dates[1] ? parseJapaneseDate(dates[1]) : null;

					if (!startDate) startDate = maybeStart;
					if (!endDate) endDate = maybeEnd;

					// If no Gregorian dates found, try era-based dates in the detail page
					if (!startDate || (!endDate && !hasPresent)) {
						if (!startDate) startDate = parseJapaneseDate(textAll);
						if (!endDate && !hasPresent) {
							// try to find two era dates
							const eraRe = /(令和|平成|昭和)(元|\d{1,4})年\s*\d{1,2}月\s*\d{1,2}日/g;
							const eraMatches: string[] = [];
							let em: RegExpExecArray | null;
							while ((em = eraRe.exec(textAll))) {
								eraMatches.push(em[0]);
								if (eraMatches.length >= 2) break;
							}
							if (eraMatches.length >= 2) {
								endDate = parseJapaneseDate(eraMatches[1]);
							} else if (eraMatches.length === 1) {
								if (!startDate) startDate = parseJapaneseDate(eraMatches[0]);
							}
						}
					}
				}
			}

			if (!pmName) {
				console.warn('Could not determine PM name for', entry.href);
				continue;
			}

			// Normalize name by removing excessive whitespace
			const name = pmName.replace(/\s+/g, ' ').trim();

			console.log(`Found PM: ${name} (${startDate} - ${endDate ?? 'present'})`);

			// DB operations (or dry-run)
			// 1. If member does not exist, insert
			let memberId: number | null = null;
			if (DRY_RUN) {
				console.log(`[dry-run] Would upsert member name=${name}`);
			} else {
				const existing = await db!.select().from(schema.member).where(eq(schema.member.name, name));
				if (existing.length === 0) {
					const [ins] = await db!
						.insert(schema.member)
						.values({ name } as any)
						.returning();
					memberId = ins.id as number;
					console.log(`Inserted member id=${memberId} name=${name}`);
				} else {
					memberId = existing[0].id as number;
					console.log(`Member exists id=${memberId} name=${name}`);
				}
			}

			// 2. Insert cabinet entry
			if (DRY_RUN) {
				console.log(
					`[dry-run] Would insert cabinet for member(name=${name}) start=${startDate} end=${endDate}`
				);
			} else {
				// avoid duplicates: check existing cabinets for this member
				const existingCabinets = await db!
					.select()
					.from(schema.cabinet)
					.where(eq(schema.cabinet.memberId, memberId!));
				const exists = existingCabinets.some((c) => {
					const cs = c.startDate ? new Date(c.startDate).toISOString().slice(0, 10) : null;
					const ce = c.endDate ? new Date(c.endDate).toISOString().slice(0, 10) : null;
					return cs === startDate && ce === endDate;
				});
				if (exists) {
					console.log(
						`Skipping insert: identical cabinet already exists for memberId=${memberId} start=${startDate} end=${endDate}`
					);
				} else {
					const insertedCabinet = await db!
						.insert(schema.cabinet)
						.values({
							memberId,
							// pass ISO date strings (YYYY-MM-DD) instead of Date objects
							startDate: startDate ? startDate : null,
							endDate: endDate ? endDate : null
						} as any)
						.returning();

					if (insertedCabinet && insertedCabinet.length > 0) {
						console.log(`Inserted cabinet id=${insertedCabinet[0].id} for memberId=${memberId}`);
					} else {
						console.log(`Inserted cabinet for memberId=${memberId}`);
					}
				}
			}
		} catch (err) {
			console.error('Error processing entry', entry.href, err);
		}
	}

	console.log('Done');
	if (client) await client.end();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
