import {
	pgTable,
	serial,
	integer,
	text,
	boolean,
	date,
	unique,
	primaryKey,
	pgEnum
} from 'drizzle-orm/pg-core';

// Enums
export const chamberEnum = pgEnum('chamber', ['参議院', '衆議院']);
export const billTypeEnum = pgEnum('bill_type', ['衆法', '参法', '閣法']);
export const votingMethodEnum = pgEnum('voting_method', [
	'異議なし採決',
	'起立投票',
	'記名投票',
	'押しボタン'
]);

// Bill table
export const bill = pgTable(
	'bill',
	{
		id: serial('id').primaryKey(),
		type: billTypeEnum('type').notNull(), // 種類 (衆法/参法/閣法)
		submissionSession: integer('submission_session').notNull(), // 提出回次
		number: integer('number').notNull(), // 番号
		submissionDate: date('submission_date'), // 提出日
		deliberationCompleted: boolean('deliberation_completed').default(false), // 審議終了
		passed: boolean('passed').default(false) // 可決
	},
	(table) => [unique().on(table.type, table.submissionSession, table.number)]
);

export type Bill = typeof bill.$inferSelect;
export type NewBill = typeof bill.$inferInsert;

// Bill detail table
export const billDetail = pgTable('bill_detail', {
	billId: integer('bill_id')
		.primaryKey()
		.references(() => bill.id),
	title: text('title'), // 件名
	description: text('description') // 解説
});

export type BillDetail = typeof billDetail.$inferSelect;
export type NewBillDetail = typeof billDetail.$inferInsert;

// Committee table
export const committee = pgTable('committee', {
	id: serial('id').primaryKey(),
	chamber: chamberEnum('chamber').notNull(), // 議会 (参議院/衆議院)
	name: text('name').notNull() // 委員会名
});

export type Committee = typeof committee.$inferSelect;
export type NewCommittee = typeof committee.$inferInsert;

// Committee-Bill relation table
export const committeeBill = pgTable('committee_bill', {
	id: serial('id').primaryKey(),
	committeeId: integer('committee_id')
		.notNull()
		.references(() => committee.id),
	billId: integer('bill_id')
		.notNull()
		.references(() => bill.id),
	session: integer('session').notNull() // 回次
});

export type CommitteeBill = typeof committeeBill.$inferSelect;
export type NewCommitteeBill = typeof committeeBill.$inferInsert;

// Member table
export const member = pgTable('member', {
	id: serial('id').primaryKey(),
	name: text('name').notNull() // 議員名
});

export type Member = typeof member.$inferSelect;
export type NewMember = typeof member.$inferInsert;

// Party table
export const party = pgTable('party', {
	id: serial('id').primaryKey(),
	name: text('name').notNull() // 政党名
});

export type Party = typeof party.$inferSelect;
export type NewParty = typeof party.$inferInsert;

// Member-Party relation table
export const memberParty = pgTable('member_party', {
	id: serial('id').primaryKey(),
	memberId: integer('member_id')
		.notNull()
		.references(() => member.id),
	partyId: integer('party_id')
		.notNull()
		.references(() => party.id),
	startDate: date('start_date'), // 所属開始日
	endDate: date('end_date') // 所属終了日
});

export type MemberParty = typeof memberParty.$inferSelect;
export type NewMemberParty = typeof memberParty.$inferInsert;

// Group table
export const group = pgTable('group', {
	id: serial('id').primaryKey(),
	name: text('name').notNull() // 会派名
});

export type Group = typeof group.$inferSelect;
export type NewGroup = typeof group.$inferInsert;

// Cabinet table
export const cabinet = pgTable('cabinet', {
	id: serial('id').primaryKey(),
	memberId: integer('member_id')
		.notNull()
		.references(() => member.id), // 総理大臣のmember ID
	startDate: date('start_date').notNull(), // 在職開始日
	endDate: date('end_date') // 在職終了日
});

export type Cabinet = typeof cabinet.$inferSelect;
export type NewCabinet = typeof cabinet.$inferInsert;

// Member-Group relation table
export const memberGroup = pgTable('member_group', {
	id: serial('id').primaryKey(),
	memberId: integer('member_id')
		.notNull()
		.references(() => member.id),
	groupId: integer('group_id')
		.notNull()
		.references(() => group.id),
	startDate: date('start_date'), // 所属開始日
	endDate: date('end_date') // 所属終了日
});

export type MemberGroup = typeof memberGroup.$inferSelect;
export type NewMemberGroup = typeof memberGroup.$inferInsert;

// Bill sponsors (many-to-many)
export const billSponsors = pgTable(
	'bill_sponsors',
	{
		billId: integer('bill_id')
			.notNull()
			.references(() => bill.id),
		memberId: integer('member_id')
			.notNull()
			.references(() => member.id)
	},
	(table) => [primaryKey({ columns: [table.billId, table.memberId] })]
);

export type BillSponsor = typeof billSponsors.$inferSelect;
export type NewBillSponsor = typeof billSponsors.$inferInsert;

// Bill sponsor groups (many-to-many)
export const billSponsorGroups = pgTable(
	'bill_sponsor_groups',
	{
		billId: integer('bill_id')
			.notNull()
			.references(() => bill.id),
		groupId: integer('group_id')
			.notNull()
			.references(() => group.id)
	},
	(table) => [primaryKey({ columns: [table.billId, table.groupId] })]
);

export type BillSponsorGroup = typeof billSponsorGroups.$inferSelect;
export type NewBillSponsorGroup = typeof billSponsorGroups.$inferInsert;

// Bill supporters (many-to-many)
export const billSupporters = pgTable(
	'bill_supporters',
	{
		billId: integer('bill_id')
			.notNull()
			.references(() => bill.id),
		memberId: integer('member_id')
			.notNull()
			.references(() => member.id)
	},
	(table) => [primaryKey({ columns: [table.billId, table.memberId] })]
);

export type BillSupporter = typeof billSupporters.$inferSelect;
export type NewBillSupporter = typeof billSupporters.$inferInsert;

// Bill votes table
export const billVotes = pgTable('bill_votes', {
	id: serial('id').primaryKey(),
	billId: integer('bill_id')
		.notNull()
		.references(() => bill.id),
	chamber: chamberEnum('chamber').notNull(), // 議会 (衆議院/参議院)
	votingMethod: votingMethodEnum('voting_method').notNull(), // 表決形式 (異議なし採決/起立投票/記名投票/押しボタン)
	votingDate: date('voting_date') // 議決日
});

export type BillVote = typeof billVotes.$inferSelect;
export type NewBillVote = typeof billVotes.$inferInsert;

// Bill votes result by group
export const billVotesResultGroup = pgTable(
	'bill_votes_result_group',
	{
		billVotesId: integer('bill_votes_id')
			.notNull()
			.references(() => billVotes.id),
		groupId: integer('group_id')
			.notNull()
			.references(() => group.id),
		approved: boolean('approved').notNull() // 承認
	},
	(table) => [primaryKey({ columns: [table.billVotesId, table.groupId] })]
);

export type BillVotesResultGroup = typeof billVotesResultGroup.$inferSelect;
export type NewBillVotesResultGroup = typeof billVotesResultGroup.$inferInsert;

// Bill votes result by member
export const billVotesResultMember = pgTable(
	'bill_votes_result_member',
	{
		billVotesId: integer('bill_votes_id')
			.notNull()
			.references(() => billVotes.id),
		memberId: integer('member_id')
			.notNull()
			.references(() => member.id),
		approved: boolean('approved').notNull() // 承認
	},
	(table) => [primaryKey({ columns: [table.billVotesId, table.memberId] })]
);

export type BillVotesResultMember = typeof billVotesResultMember.$inferSelect;
export type NewBillVotesResultMember = typeof billVotesResultMember.$inferInsert;
