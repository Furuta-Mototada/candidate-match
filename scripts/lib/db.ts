/**
 * Shared database utilities for scraping scripts
 */

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray, and } from 'drizzle-orm';
import * as schema from '../../src/lib/server/db/schema';

export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

// Export type aliases for enum values
export type BillType = '衆法' | '参法' | '閣法';
export type Chamber = '衆議院' | '参議院';
export type VotingMethod = '異議なし採決' | '起立投票' | '記名投票' | '押しボタン';

// Export valid voting methods for mapping
export const VALID_VOTING_METHODS: VotingMethod[] = [
	'異議なし採決',
	'起立投票',
	'記名投票',
	'押しボタン'
];

/**
 * Check if a string is a valid bill type
 */
export function isValidBillType(type: string): type is BillType {
	return type === '衆法' || type === '参法' || type === '閣法';
}

/**
 * Check if a string is a valid voting method
 */
export function isValidVotingMethod(method: string): method is VotingMethod {
	return VALID_VOTING_METHODS.includes(method as VotingMethod);
}

/**
 * Create a database connection
 */
export function createDbConnection(databaseUrl: string) {
	const client = postgres(databaseUrl);
	const db = drizzle(client, { schema });
	return { client, db };
}

/**
 * Wrapper for database operations with automatic connection cleanup
 */
export async function withDatabase<T>(
	databaseUrl: string,
	fn: (db: DrizzleDB) => Promise<T>
): Promise<T> {
	const client = postgres(databaseUrl);
	const db = drizzle(client, { schema });
	try {
		return await fn(db);
	} finally {
		await client.end();
	}
}

/**
 * Get or create a member by name
 */
export async function getOrCreateMember(db: DrizzleDB, memberName: string): Promise<number> {
	const existing = await db.select().from(schema.member).where(eq(schema.member.name, memberName));

	if (existing.length > 0) {
		return existing[0].id;
	}

	const [newMember] = await db.insert(schema.member).values({ name: memberName }).returning();

	console.log(`  Inserted member: ${memberName} (ID: ${newMember.id})`);
	return newMember.id;
}

/**
 * Get or create a group by name
 */
export async function getOrCreateGroup(db: DrizzleDB, groupName: string): Promise<number> {
	const existing = await db.select().from(schema.group).where(eq(schema.group.name, groupName));

	if (existing.length > 0) {
		return existing[0].id;
	}

	const [newGroup] = await db.insert(schema.group).values({ name: groupName }).returning();

	console.log(`  Inserted group: ${groupName} (ID: ${newGroup.id})`);
	return newGroup.id;
}

/**
 * Batch get or create members
 * Returns a Map of member name to member ID
 */
export async function batchGetOrCreateMembers(
	db: DrizzleDB,
	memberNames: string[]
): Promise<Map<string, number>> {
	if (memberNames.length === 0) {
		return new Map();
	}

	// Remove duplicates
	const uniqueNames = [...new Set(memberNames)];

	// Get existing members
	const existing = await db
		.select()
		.from(schema.member)
		.where(inArray(schema.member.name, uniqueNames));

	const memberMap = new Map<string, number>();
	existing.forEach((m) => memberMap.set(m.name, m.id));

	// Find names that don't exist yet
	const newNames = uniqueNames.filter((name) => !memberMap.has(name));

	// Batch insert new members
	if (newNames.length > 0) {
		const inserted = await db
			.insert(schema.member)
			.values(newNames.map((name) => ({ name })))
			.returning();

		inserted.forEach((m) => {
			memberMap.set(m.name, m.id);
			console.log(`  Inserted member: ${m.name} (ID: ${m.id})`);
		});
	}

	return memberMap;
}

/**
 * Batch get or create groups
 * Returns a Map of group name to group ID
 */
export async function batchGetOrCreateGroups(
	db: DrizzleDB,
	groupNames: string[]
): Promise<Map<string, number>> {
	if (groupNames.length === 0) {
		return new Map();
	}

	// Remove duplicates
	const uniqueNames = [...new Set(groupNames)];

	// Get existing groups
	const existing = await db
		.select()
		.from(schema.group)
		.where(inArray(schema.group.name, uniqueNames));

	const groupMap = new Map<string, number>();
	existing.forEach((g) => groupMap.set(g.name, g.id));

	// Find names that don't exist yet
	const newNames = uniqueNames.filter((name) => !groupMap.has(name));

	// Batch insert new groups
	if (newNames.length > 0) {
		const inserted = await db
			.insert(schema.group)
			.values(newNames.map((name) => ({ name })))
			.returning();

		inserted.forEach((g) => {
			groupMap.set(g.name, g.id);
			console.log(`  Inserted group: ${g.name} (ID: ${g.id})`);
		});
	}

	return groupMap;
}

/**
 * Get or create a committee
 */
export async function getOrCreateCommittee(
	db: DrizzleDB,
	name: string,
	chamber: '衆議院' | '参議院'
): Promise<number> {
	const existing = await db
		.select()
		.from(schema.committee)
		.where(and(eq(schema.committee.name, name), eq(schema.committee.chamber, chamber)));

	if (existing.length > 0) {
		return existing[0].id;
	}

	const [newCommittee] = await db.insert(schema.committee).values({ name, chamber }).returning();

	console.log(`  Inserted committee: ${name} (${chamber}) ID: ${newCommittee.id}`);
	return newCommittee.id;
}

// Export schema for convenience
export { schema };
