# Vote Delegation Feature — Technical Documentation

## Overview

Vote delegation allows users to entrust their vote on a specific bill to a trusted friend. The delegate can then vote on behalf of the delegator, reject the delegation, or further forward (redelegate) it to another friend. Delegation chains of arbitrary length are supported (A→B→C→...), with built-in cycle detection and privacy-preserving anonymization.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Status Lifecycle](#2-status-lifecycle)
3. [API Endpoints](#3-api-endpoints)
4. [Chain Traversal Algorithms](#4-chain-traversal-algorithms)
5. [Anonymization & Privacy](#5-anonymization--privacy)
6. [Proxy Voting Mechanism](#6-proxy-voting-mechanism)
7. [Rationale Feature](#7-rationale-feature)
8. [Chain End Status Tracking](#8-chain-end-status-tracking)
9. [Cycle Detection](#9-cycle-detection)
10. [Notification System](#10-notification-system)
11. [UI Architecture](#11-ui-architecture)
12. [Flow Chart Visualization](#12-flow-chart-visualization)
13. [Key Constraints & Invariants](#13-key-constraints--invariants)
14. [File Reference](#14-file-reference)

---

## 1. Database Schema

### `vote_delegation` table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `serial` | PRIMARY KEY | Auto-increment ID |
| `delegator_id` | `text` | NOT NULL, FK → `auth_user.id` (CASCADE) | User who delegates |
| `delegate_id` | `text` | NOT NULL, FK → `auth_user.id` (CASCADE) | User who receives the delegation |
| `bill_id` | `integer` | NOT NULL, FK → `bill.id` | The bill being delegated |
| `status` | `delegation_status` | NOT NULL, DEFAULT `'pending'` | Current delegation status |
| `vote_rationale` | `text` | nullable | Delegate's explanation for their vote (max 500 chars) |
| `created_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Creation time |
| `updated_at` | `timestamp` | NOT NULL, DEFAULT `now()` | Last update time |

**Unique constraint**: `(delegator_id, bill_id)` — a user can only have one active delegation per bill.

### `delegation_status` enum

```sql
CREATE TYPE delegation_status AS ENUM ('pending', 'rejected', 'redelegated', 'voted');
```

### `friend_request` table (prerequisite)

Delegation requires an accepted friendship between delegator and delegate.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `serial` | PRIMARY KEY |
| `sender_id` | `text` | FK → `auth_user.id` |
| `receiver_id` | `text` | FK → `auth_user.id` |
| `status` | `friend_request_status` | `'pending'`, `'accepted'`, `'rejected'` |

**Unique constraint**: `(sender_id, receiver_id)`.

### `user_bill_answer` interaction

When a user delegates a vote, their `user_bill_answer` is set to `'delegated'`. This special sentinel value distinguishes delegated bills from unanswered ones. It is:
- Set when a delegation is created
- Removed when a delegation is retracted or rejected (allowing the user to vote again)
- Restored when an undo-reject reverses a rejection

### Migration History

1. **0019**: `friend_request` table created
2. **0020**: `vote_delegation` table created (original enum: `pending`, `accepted`, `rejected`, `retracted`, `voted`)
3. **0021**: Added `redelegated` to enum
4. **0026**: Enum simplified to `pending`, `rejected`, `redelegated`, `voted` (removed `accepted` and `retracted` — acceptance is implicit in `voted`, retraction deletes the row)

---

## 2. Status Lifecycle

```
               ┌──────────── retract (delete row) ──────────────┐
               │                                                 │
               ▼                                                 │
  [delegation created] ──→ pending ──┬──→ voted                  │
                                     ├──→ rejected               │
                                     └──→ redelegated            │
                                                                 │
  voted ──────→ undo-vote ──→ pending                            │
  rejected ───→ undo-reject ──→ pending                          │
                                                                 │
  any status ──→ retract ──→ (row deleted) ◄─────────────────────┘
```

**State transitions:**

| From | Action | To | Side Effects |
|------|--------|----|-------------|
| (new) | `delegate` | `pending` | Creates row; sets delegator's answer to `'delegated'`; auto-marks delegator's own pending incomings as `'redelegated'` |
| `pending` | `accept` | `voted` | Stores vote rationale; notifies all direct & upstream delegators |
| `pending` | `reject` | `rejected` | Removes delegator's `'delegated'` answer; notifies delegator |
| `pending` | `redelegate` | `redelegated` | Creates new delegation B→C; marks delegator's answer as `'delegated'` |
| `voted` | `undo-vote` | `pending` | Clears rationale |
| `rejected` | `undo-reject` | `pending` | Restores delegator's `'delegated'` answer |
| any | `retract` | (deleted) | Removes `'delegated'` answer; restores upstream `'redelegated'` → `'pending'` |

**Important**: `accept`, `reject`, `redelegate`, `undo-vote`, and `undo-reject` are **bulk operations** — they affect ALL pending/voted/rejected delegations for the same bill directed at the same delegate, not just the specified delegation ID.

---

## 3. API Endpoints

**File**: `src/routes/api/delegations/+server.ts`

### GET `/api/delegations`

| Parameter | Values | Description |
|-----------|--------|-------------|
| `action` | `incoming` | Pending delegations where user is delegate |
| | `outgoing` | All delegations user has made |
| | `for-bill` | Check delegation status for a specific bill (requires `billId`) |
| | `all` | Combined view for delegation management page |
| `debug` | `true` | Admin-only: reveals full chain details |

#### `action=all` Response Structure

In **non-debug mode** (normal users):

```typescript
{
  success: true,
  incoming: AnonymizedIncomingDelegation[],  // identity stripped
  outgoing: OutgoingDelegation[],            // with terminal status
  isAdmin: boolean,
  debugMode: false,
  incomingCountBuckets: Record<billId, string>  // e.g. { 42: "1〜3" }
}
```

In **debug mode** (admins only):

```typescript
{
  success: true,
  incoming: IncomingDelegationWithChain[],  // full identities, upstream paths
  outgoing: OutgoingDelegationWithChain[],  // full chain, vote counts
  isAdmin: true,
  debugMode: true
}
```

### POST `/api/delegations`

| Action | Required Fields | Description |
|--------|----------------|-------------|
| `delegate` | `delegateId`, `billId` | Create or update delegation |
| `accept` | `delegationId`, optionally `score` (1/0/-1), `rationale` | Accept and vote |
| `reject` | `delegationId` | Reject all pending for that bill |
| `redelegate` | `delegationId`, `delegateId` (new target) | Forward to another friend |
| `retract` | `delegationId` | Cancel delegation (deletes row) |
| `undo-vote` | `delegationId` | Revert voted → pending |
| `undo-reject` | `delegationId` | Revert rejected → pending |

---

## 4. Chain Traversal Algorithms

**File**: `src/lib/server/delegation-helpers.ts`

### `getDelegationChainDownstream(startUserId, billId)`

Walks forward from a user following outgoing delegations. Used in admin debug mode to show the full forward chain.

```
Input:  User B, Bill #42
Chain:  B→C→D (D has voted)
Output: [{ username: "C", status: "redelegated" }, { username: "D", status: "voted" }]
```

**Termination conditions**: No further delegation found, or status is terminal (not `pending`/`redelegated`).

### `getDelegationChainUpstream(startDelegatorId, billId)`

Walks backward from a delegator through `redelegated` chains. Returns the chain of upstream delegators.

```
Input:  User C, Bill #42 (where A→B→C exists, A→B is redelegated)
Output: [{ username: "A", status: "redelegated" }]
```

### `getDelegationTreeUpstream(userId, billId)`

Builds a full tree of ALL upstream delegators recursively. Unlike the chain functions, this captures branching (multiple people delegating to the same user).

```typescript
type UpstreamNode = {
  username: string;
  status: string;
  upstream: UpstreamNode[];  // recursive children
};
```

### `flattenUpstreamTree(nodes)`

Converts the tree to an array of paths (each path from leaf to root), used for rendering in the flow chart.

### `countTotalVotes(userId, billId)`

Returns `1 + count(all upstream delegators in tree)` — the total number of votes a user controls for a bill.

### `resolveDelegatedVotes(userId, filterBillIds?)`

For matching/scoring purposes: given a user's outgoing delegations, walks each chain to find the terminal voter's answer. Returns a `Map<billId, score>` of resolved votes.

### `findDownstreamTerminal(delegateId, billId)` (inline in API)

Used in normal (non-debug) mode to find the terminal status and vote result at the end of a redelegation chain. Returns:

```typescript
{
  rationale: string | null,
  terminalStatus: string | null,
  terminalVoteScore: number | null
}
```

---

## 5. Anonymization & Privacy

The anonymization system ensures that **delegates cannot identify who delegated to them**, preventing social pressure and ensuring honest voting.

### Normal Mode (Non-Admin)

#### Incoming Delegations — Fully Anonymized

When loading incoming delegations in `action=all`, the API strips all identity information:

```typescript
const anonymizedIncoming = incoming.map(d => ({
  id: d.id,
  delegatorId: '',           // stripped
  delegatorUsername: '',      // stripped
  delegatorAvatarUrl: null,  // stripped
  billId: d.billId,
  billTitle: d.billTitle,
  // ... bill metadata preserved
  status: d.status,
  voteRationale: d.voteRationale,
  myExistingScore: d.myExistingScore,
  upstreamChain: [],         // stripped
  upstreamPaths: [],         // stripped
  createdAt: d.createdAt,
  updatedAt: d.updatedAt
}));
```

**Key fields anonymized:**
- `delegatorId` → empty string
- `delegatorUsername` → empty string
- `delegatorAvatarUrl` → null
- `upstreamChain` → empty array
- `upstreamPaths` → empty array

#### Bucketed Counts

Instead of exact counts, the number of delegations per bill is bucketed to prevent inference:

```typescript
function bucketCount(count: number): string {
  if (count === 0) return '0';
  if (count <= 3) return '1〜3';
  if (count <= 10) return '4〜10';
  if (count <= 30) return '11〜30';
  return '30+';
}
```

The buckets are returned at the response level as `incomingCountBuckets: Record<billId, string>`, so the delegate only sees something like "1〜3人" rather than an exact count.

#### Outgoing Delegations — Transparent to Delegator

The delegator sees:
- Their delegate's username and avatar
- The delegation status
- Terminal chain end status (voted/pending/rejected) without revealing intermediaries
- The terminal voter's rationale and vote result (if voted)

But they do NOT see:
- Who the delegate further forwarded to (no chain details in non-debug mode)
- The names of any intermediaries in the redelegation chain

#### Notification Anonymization

When a delegation is received, the notification message does NOT include the delegator's identity:

```typescript
await createNotification({
  userId: delegateId,
  type: 'delegation_received',
  actorId: undefined,  // anonymous: don't reveal who delegated
  message: `${billLabel}の投票があなたに委任されました`
  //         ^^^^ No username mentioned
});
```

However, when a delegate **acts** on a delegation (votes, rejects, redelegates, retracts), the delegator IS notified with the delegate's identity — this is intentional, as the delegator chose that delegate.

### Admin Debug Mode

Activated via `?debug=true` query parameter (admin role required):

- Full delegator identities visible on incoming delegations
- Complete upstream paths rendered
- Full downstream chain for outgoing delegations
- Vote counts per chain member
- All data unmasked in flow chart visualization

### Privacy Invariants

1. A delegate **never** knows the exact number of people who delegated to them (only a bucket range)
2. A delegate **never** knows the identity of who delegated to them (in normal mode)
3. A delegator **never** knows who their delegate further forwarded to
4. A delegator CAN see the chain-end status (voted/pending) and vote result, but not how the chain is structured
5. Redelegation chain details (A→B→C→D) are collapsed: A sees "B → [terminal status]" without knowing C or D exist

---

## 6. Proxy Voting Mechanism

The system supports two proxy voting flows:

### Flow 1: Approve with Existing Vote (既存の投票で承認)

If the delegate already has their own vote for the bill:
1. Their existing `user_bill_answer` score is used
2. All pending incoming delegations for that bill are marked `'voted'`
3. Optional rationale can be provided
4. Direct delegators and all upstream chain members are notified

### Flow 2: Cast New Proxy Vote (代理投票する)

If the delegate hasn't voted on the bill yet:
1. User is navigated from the delegation tab (委任) to the answer history tab (回答履歴)
2. The bill detail modal opens for the delegate to cast a vote
3. After voting, a rationale prompt appears
4. On confirmation, the delegation is accepted with the provided rationale
5. The vote is stored in `user_bill_answer` as the delegate's own vote

### Vote Resolution in user_bill_answer

When a delegation is accepted:
- The delegate's `user_bill_answer` stores the actual vote (source of truth)
- The `vote_delegation.status` becomes `'voted'`
- The `vote_delegation.vote_rationale` stores the optional explanation
- Each delegator's `user_bill_answer` remains `'delegated'`

For matching score calculation, `resolveDelegatedVotes()` walks chains to find terminal voters' answers and uses those scores.

---

## 7. Rationale Feature

### Storage

The `vote_rationale` column on `vote_delegation` stores a text explanation (max 500 chars, server-side enforced):

```typescript
const sanitizedRationale = typeof rationale === 'string' 
  ? rationale.trim().slice(0, 500) 
  : null;
```

### Propagation via `findDownstreamTerminal`

When a chain A→B→C exists and C votes with a rationale:
1. C's rationale is stored on the B→C delegation record
2. When A's view builds outgoing data, `findDownstreamTerminal()` walks B→C and returns C's rationale
3. A sees C's rationale even though they don't know C exists

The rationale "bubbles up" through the chain so every upstream delegator sees the explanation.

### Display Contexts

| Context | Shows Rationale? |
|---------|-----------------|
| Delegation card (outgoing) | Yes, if status is voted |
| Delegation card (incoming, already voted) | Yes |
| Notification (delegation_voted) | Yes, appended to message |
| Proxy voting modal | Input field for delegate |

### Terminology

Standardized to **投票理由** ("voting rationale") throughout the UI. Not 理由 (too generic).

---

## 8. Chain End Status Tracking

For outgoing delegations where the delegate has redelegated (A→B→C), the system provides chain-end visibility without revealing the chain structure.

### API Implementation

In `findDownstreamTerminal()`:

```
A→B (status: redelegated) → B→C (status: voted, C's vote = 1)
```

Returns:
```typescript
{
  terminalStatus: 'voted',
  terminalVoteScore: 1,       // 1=賛成, -1=反対, 0=わからない
  rationale: "C's explanation"
}
```

These fields are attached to the outgoing delegation response:
- `terminalStatus`: The status at the end of the chain
- `terminalVoteScore`: The actual vote score if terminal status is `'voted'`

### UI Display

For outgoing delegations:
- If `status === 'voted'` (direct) or `terminalStatus === 'voted'` (chain end): shows 投票結果 badge with 賛成/反対/わからない
- The flow chart shows a dashed-edge terminal node (···) with status color for redelegated chains

---

## 9. Cycle Detection

**Function**: `detectDelegationCycle(delegatorId, delegateId, billId)`

Before creating A→B, the algorithm walks forward from B following active delegations (`pending` or `redelegated` status). If the walk reaches A, a cycle would be formed and the delegation is rejected.

```typescript
// Pseudocode
function detectCycle(delegatorId, delegateId, billId):
  visited = { delegatorId }
  current = delegateId
  while current exists:
    if current in visited: return true  // cycle!
    visited.add(current)
    next = findActiveDelegation(current, billId)
    if not next: break
    current = next.delegateId
  return false
```

Error message: `委任の循環が検出されました。この委任先には委任できません。`

---

## 10. Notification System

### Notification Types

| Type | Recipient | Identity Revealed? | Message Example |
|------|-----------|-------------------|-----------------|
| `delegation_received` | Delegate | **No** (actorId = undefined) | `「法案名」の投票があなたに委任されました` |
| `delegation_voted` | Delegator(s) | Yes (delegate's name) | `Bさんが「法案名」に「賛成」と委任投票しました` |
| `delegation_rejected` | Delegator | Yes | `Bさんが「法案名」の委任を拒否しました` |
| `delegation_redelegated` | Delegator | Yes | `Bさんが「法案名」の委任を他のフレンドに転送しました` |
| `delegation_retracted` | Delegate | **No** (no actorId) | `「法案名」の委任が取り消されました` |
| `delegation_vote_changed` | Delegator(s) | Yes | `Bさんが「法案名」の委任投票を「反対」に変更しました` |
| `delegation_overridden` | Delegate | **No** | `「法案名」の委任者が直接投票し、委任が取り消されました` |

### Upstream Notification Propagation

**Function**: `notifyUpstreamDelegatorsVoted()`

When a delegate votes, the system recursively walks upstream through `redelegated` chains to notify every upstream delegator:

```
Chain: A → B → C → D
D votes.
Notifications sent to: C, B, A (all receive delegation_voted with D's username, score, and rationale)
```

The recursion follows `redelegated` status links:

```typescript
async function notifyUpstreamDelegatorsVoted(delegateId, ...) {
  const redelegated = findRedelegatedPointingAt(delegateId, billId);
  for (const d of redelegated) {
    await notifyDelegationVoted(d.delegatorId, ...);
    // Recursively notify further upstream
    await notifyUpstreamDelegatorsVoted(d.delegatorId, ...);
  }
}
```

---

## 11. UI Architecture

**File**: `src/routes/match/saved/+page.svelte`

### Tab Structure

The delegation management lives in the third tab (委任) of the `/match/saved` page. Tabs:
1. **スナップショット** — Saved matching snapshots
2. **回答履歴** — Answer history (bills list with voting)
3. **委任** — Delegation management

### TypeScript Types

```typescript
type IncomingDelegation = {
  id: number;
  delegatorId: string;        // empty in anonymous mode
  delegatorUsername: string;   // empty in anonymous mode
  delegatorAvatarUrl: string | null;
  billId: number;
  billTitle: string | null;
  billType: string;
  billSubmissionSession: number;
  billNumber: number;
  status: string;
  voteRationale: string | null;
  myExistingScore: number | null;  // delegate's own vote if it exists
  upstreamChain: { username: string; status: string }[];
  upstreamPaths: Array<Array<{ username: string; status: string }>>;
  createdAt: string;
  updatedAt: string;
};

type OutgoingDelegation = {
  id: number;
  delegateId: string;
  delegateUsername: string;
  delegateAvatarUrl: string | null;
  billId: number;
  billTitle: string | null;
  billType: string;
  billSubmissionSession: number;
  billNumber: number;
  status: string;
  voteRationale: string | null;
  myVoteScore: number | null;
  chain: { username: string; status: string; totalVotes?: number }[];
  delegateVotes?: number;
  terminalStatus?: string | null;
  terminalVoteScore?: number | null;
  createdAt: string;
  updatedAt: string;
};

type DelegationGroup = {
  billId: number;
  billTitle: string | null;
  billType: string;
  billSubmissionSession: number;
  billNumber: number;
  incomingList: IncomingDelegation[];
  outgoing: OutgoingDelegation | null;
};
```

### Delegation Grouping

Delegations are grouped by `billId` into `DelegationGroup` objects. Each group can have:
- Only incoming (you're a delegate)
- Only outgoing (you delegated to someone)
- Both (you're a "middleman" — received delegation and forwarded it)

### Delegation Card Structure

Each card shows:
1. **Bill header**: session, type, number, title
2. **Role badge**: 受信 (incoming), 送信 (outgoing), 転送 (middleman/forwarded)
3. **Flow chart**: Visual chain representation
4. **Status badges**: 保留中, 投票済み, 拒否, 転送済み
5. **投票結果**: Vote result badge (賛成/反対/わからない) when available
6. **投票理由**: Rationale text when available
7. **Action buttons**: Context-dependent (accept, reject, redelegate, retract, undo)

### Action Buttons by State

| Condition | Available Actions |
|-----------|-------------------|
| Incoming pending, no outgoing | 既存の投票で承認 / 代理投票する / 別のフレンドに転送 / 拒否する |
| Incoming all voted | 投票を取り消す |
| Incoming all rejected | 拒否を取り消す |
| Has outgoing (any status) | 取り消して自分で投票する / 委任を取り消す / etc. |

---

## 12. Flow Chart Visualization

**Files**: `src/lib/components/match/DelegationFlowChart.svelte`, `src/lib/components/match/DelegationFlowNode.svelte`

Built with `@xyflow/svelte`.

### Anonymous Mode (Normal Users)

```
[?人] ──→ [あなた] ──→ [Delegate Name]
                            │
                        ···(terminal node, if redelegated)
```

- **Anonymous incoming node**: Shows bucketed count (e.g., "1〜3人") with `?` icon
- **Me node**: Purple, labeled "あなた"
- **Delegate node**: Shows username, avatar, status icon
- **Terminal node** (if chain continues): Shows "···" with dashed edge, status color reflects chain end

### Non-Anonymous Mode (Admin Debug)

Full graph with all upstream paths rendered, each person identified by username and avatar.

### Node Types

| Node Type | Visual | Condition |
|-----------|--------|-----------|
| `isMe` | Purple background, "あなた" | Current user |
| `isAnonymous` | Light blue, "?" icon | Anonymous aggregate in normal mode |
| `isTerminal` | "···" label | Chain continues beyond visible scope |
| Regular | White with status icon | Named user in debug mode |

### Edge Styles

| Status | Color | Animation | Line |
|--------|-------|-----------|------|
| `pending` | Orange (#f59e0b) | Animated | Solid |
| `voted` | Green (#22c55e) | Static | Solid |
| `rejected` | Red (#ef4444) | Static | Solid |
| `redelegated` | Blue (#3b82f6) | Static | Solid |
| Terminal (dashed) | Same as status | Static | Dashed (`stroke-dasharray: 6 3`) |

### Status Icons

| Status | Icon |
|--------|------|
| `pending` | Hourglass |
| `voted` | CircleCheck |
| `rejected` | XCircle |
| `redelegated` | RefreshCw |

---

## 13. Key Constraints & Invariants

1. **One delegation per user per bill** — UNIQUE constraint on `(delegator_id, bill_id)`
2. **No self-delegation** — `delegateId !== userId` validated in API
3. **Friends only** — `checkFriendship()` validated before creating any delegation
4. **No cycles** — `detectDelegationCycle()` runs before every delegation creation/redelegation
5. **Bulk status transitions** — Accept/reject/redelegate affect ALL pending for the same bill+delegate, not just the targeted one
6. **Vote suppression** — Creating a delegation upserts the delegator's `user_bill_answer` to `'delegated'`
7. **Upstream restoration** — Retracting a delegation restores all upstream `'redelegated'` back to `'pending'`
8. **Auto-redelegation** — If you create a delegation while having pending incoming ones for the same bill, those are auto-marked as `'redelegated'`
9. **Auto-chain detection** — If the delegate already has an outgoing delegation for the bill, the new incoming is immediately marked `'redelegated'`
10. **Answer cleanup on rejection** — Rejecting deletes the delegator's `'delegated'` answer, allowing them to vote themselves

---

## 14. File Reference

| File | Purpose |
|------|---------|
| `src/lib/server/db/schema.ts` | `voteDelegation` table, `delegationStatusEnum`, `friendRequest` table, `notification` table |
| `src/routes/api/delegations/+server.ts` | GET/POST API: all 7 actions, anonymization logic, `bucketCount()`, `findDownstreamTerminal()` |
| `src/lib/server/delegation-helpers.ts` | Chain traversal: `getDelegationChainDownstream`, `getDelegationChainUpstream`, `getDelegationTreeUpstream`, `flattenUpstreamTree`, `countTotalVotes`, `checkFriendship`, `detectDelegationCycle`, `resolveDelegatedVotes` |
| `src/lib/server/notifications.ts` | 8 notification helpers: received, rejected, redelegated, voted, retracted, vote_changed, overridden, upstream propagation |
| `src/routes/match/saved/+page.svelte` | Delegation tab UI: grouping, cards, actions, proxy voting modals, rationale prompts |
| `src/lib/components/match/DelegationFlowChart.svelte` | @xyflow/svelte graph: anonymous/debug modes, nodes, edges, layout |
| `src/lib/components/match/DelegationFlowNode.svelte` | Individual node component: avatar, status icons, terminal display |
| `drizzle/0019_friend_requests.sql` | Friend request table creation |
| `drizzle/0020_vote_delegation.sql` | Vote delegation table creation |
| `drizzle/0026_remove_accepted_delegation.sql` | Simplify delegation status enum to 4 values |
