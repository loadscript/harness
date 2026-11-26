// F6 (2026-11-25) / F11 (2026-11-26) — EVERY ROW OF A LIVE TILE KEEPS ITS OWN VALID LABEL.
//
// THE MANDATE, verbatim (it is the requirement these tests pin, not an observation):
//   "All labels must be valid. Cannot have T? or T- etc... all labels must be unique, as no
//    thread share same labeling. This is because user using these label to reference as needed,
//    and having a bunch of T? means they cannot reference specific one. All thread that started,
//    regardless of failure etc... must be assigned a proper label."
//
// WHAT CHANGED, and what did NOT.
//
// F6 stopped the CLIENT tile from spending an ordinal on two kinds of run — a threadFork BRANCH
// and a `delegate` placeholder whose child NEVER STARTED — and painted both `UNKNOWN_THREAD_LABEL`
// (`T?`), mirroring `UNADDRESSABLE_BLOCK_LABEL` in ../../shared/agent-results.ts. That fixed the
// phantom `IT13 … IT19` the operator measured, and it introduced the defect F11 removes: a screen
// full of `T?`, none of which could be typed, and a failed run with no address at all.
//
// F11 keeps the LEAK rules and drops the PLACEHOLDER:
//   AC1  a row that is rendered carries a valid `<CODE><ordinal>` — never `T?`, never the empty
//        string — and the number it shows is RESERVED while it shows it (the board's numbering
//        continues after every displayed label, so two visible rows can never share one name);
//   AC2  a LIVE pending delegation still shows its number (the state ui/blocks.test.ts pins
//        against the shared projection) and KEEPS it once the turn settles — the settle pass
//        (ui/turns.ts `settleUnstartedLabels`) only MOVES a number when it clashes with a
//        stronger claim, it never takes the address away;
//   AC3  a threadFork BRANCH displays the address of the conversation it forked FROM
//        (`labelShared`, the twin of ../../shared/agent-results.ts `branchSharedLabelOf`),
//        burning nothing from that agent's sequence, and keeps its `branch-N` badge so two forks
//        of one conversation are distinguishable;
//   AC4  a row that hands its number back (a roster join, a wire label, a borrowed conversation
//        code) and then LATE becomes a real run takes a provably free ordinal back — its own when
//        it is still free, the next free one when another tile took it (ui/turns.ts
//        `reinstateEntryLabel` → `ordinalIsFree`), which is the one place the F6 retraction
//        machinery is still reachable.
//
// Run: yarn vitest run --config src/frontend/vitest.config.ts ui/turns-thread-unaddressed-labels.test.ts

import type { HarnessEvent, SessionTurn } from '../../server/protocol';
import { listAgentResultBlocks } from '../../shared';
import { createTurnBoard } from './turns';
import type { TurnHandle } from './turns';

// Frozen `thread` metadata on an otherwise ordinary event (the same cast the sibling
// transcript tests use — the runtime types gain the field from the worker).
const withThread = (event: Record<string, unknown>, thread: Record<string, unknown>): HarnessEvent =>
    ({ ...event, thread } as unknown as HarnessEvent);

const delegateCall = (agent: string, id: string): HarnessEvent => ({
    type: 'tool_call',
    agent: 'writer',
    call: { id, name: 'delegate', arguments: JSON.stringify({ agent, input: 'child task' }) }
});

const branchStart = (): HarnessEvent =>
    withThread(
        {
            type: 'branch_start',
            agent: 'writer',
            branch: {
                branchId: 'branch-1',
                agent: 'writer',
                kind: 'fork',
                rank: 'B',
                forkDepth: 1,
                model: 'm1',
                tools: [],
                label: 'audit'
            }
        },
        // The runtime contract (harness.ts `branchThreadOf`) stamps every branch frame with the
        // BRANCH's own id, kind and branchId — the three spellings `isBranchRun` accepts.
        { id: 'branch-1', kind: 'fork', branchId: 'branch-1', parentId: 'root' }
    );

const serverTurn = (options: {
    id: string;
    index: number;
    status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';
    events: HarnessEvent[];
}): SessionTurn => ({
    id: options.id,
    index: options.index,
    prompt: 'tasks',
    status: options.status,
    startedAt: 5,
    updatedAt: 10,
    events: options.events
});

const mount = () => {
    const board = createTurnBoard({});
    document.body.replaceChildren(board.element);
    return board;
};

// A live tile bound to a server id: `bind` is what makes `blocks()` describable, exactly like
// the streamed path in main.ts.
const live = (board: ReturnType<typeof createTurnBoard>, prompt: string, id: string, index: number): TurnHandle => {
    const turn = board.begin(prompt);
    turn.bind({ id, index });
    return turn;
};

const threadRows = (turn: TurnHandle): HTMLElement[] => [
    ...((turn.element.parentElement as HTMLElement).querySelectorAll<HTMLElement>('.thread-row') ?? [])
];

// The visible per-invocation code of every row, in DOM order. Under F11 this is ALWAYS a
// `<CODE><ordinal>`: `T?` (`UNKNOWN_THREAD_LABEL`, deleted from ./threads.ts) and the empty name
// are both failures, and every case below asserts the exact expected code.
const rowLabels = (turn: TurnHandle): string[] =>
    threadRows(turn).map((row) => row.querySelector('.thread-name')?.textContent ?? '');

// The tile's own root code (the root invocation has no row).
const rootLabel = (turn: TurnHandle): string => turn.element.querySelector('.tile-agent')?.textContent ?? '';

// The row's identity BADGE — the figure that separates two rows that display the same borrowed
// conversation code (a fork), and the one thing F11 keeps from F10/R10.5.
const rowIdentity = (turn: TurnHandle): (string | undefined)[] =>
    threadRows(turn).map((row) => row.dataset.threadIdentity);

// Identity-only comparison (the same field set ui/blocks.test.ts pins): the descriptor's
// `status`/`content` follow the tile's transport state, which is not what these labels are
// about, and a live tile legitimately reports a different status from a projected block.
const identityOf = (block: { threadId?: string; label: string }): string => `${block.threadId ?? 'root'}:${block.label}`;

it('names a threadFork branch with its conversation and gives the next run the very next number', () => {
    const board = mount();

    const first = live(board, 'fork this', 'turn-a', 0);
    const firstEvents = [{ type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent, branchStart()];
    for (const event of firstEvents) first.apply(event);
    first.flush();

    // AC3: the branch row displays `WR1` — the address of the conversation it forked from — and
    // takes NOTHING from the writer sequence beyond what the conversation itself owns. `T?` (the
    // F6 answer) is gone: a branch row is on screen, so it wears a valid, typeable code, and the
    // `branch-1` figure rides as the row's identity data so two forks of `WR1` differ.
    expect(rowLabels(first)).toEqual(['WR1']);
    expect(rowIdentity(first)).toEqual(['branch-1']);
    expect(rootLabel(first)).toBe('WR1');
    expect(first.blocks().map(identityOf)).toEqual(['root:WR1', 'branch-1:WR1']);

    // The settled record's own projection says the same, one identity per block — the client
    // cannot renumber a run the shared projection names (`labelSource: 'shared'`).
    const record = serverTurn({ id: 'turn-a', index: 0, status: 'running', events: firstEvents });
    expect(first.blocks().map(identityOf)).toEqual(listAgentResultBlocks([record]).map(identityOf));

    // A LATER turn's runs of the same code continue straight after WR1: the branch burned no
    // ordinal of its own, so the sequence has no gap (F6's no-gap rule, unchanged by F11 — the
    // branch's label is the CONVERSATION's number, already reserved by the conversation).
    const second = live(board, 'next', 'turn-b', 1);
    const secondEvents: HarnessEvent[] = [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('writer', 'd9'),
        withThread({ type: 'start', agent: 'writer', model: 'm1' }, { id: 't9', callId: 'd9', input: 'next task' })
    ];
    for (const event of secondEvents) second.apply(event);
    second.flush();

    expect(rootLabel(second)).toBe('WR2');
    expect(rowLabels(second)).toEqual(['WR3']);
    expect(
        listAgentResultBlocks([record, serverTurn({ id: 'turn-b', index: 1, status: 'running', events: secondEvents })])
            .map(identityOf)
            .filter((identity) => identity.startsWith('root') || identity === 't9:WR3')
    ).toEqual(['root:WR1', 'root:WR2', 't9:WR3']);
});

it('keeps a live pending delegation numbered, and keeps it once the turn settles', () => {
    const board = mount();

    const first = live(board, 'delegate', 'turn-a', 0);
    const firstEvents: HarnessEvent[] = [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('helper', 'd1')
    ];
    for (const event of firstEvents) first.apply(event);
    first.flush();

    // AC2 — the live pending delegation KEEPS its number: the child may still start, and a
    // composer chip may bind this block by that number (ui/blocks.test.ts pins the same figure
    // against the shared projection).
    expect(rowLabels(first)).toEqual(['HR1']);
    expect(first.blocks().map(identityOf)).toEqual(['root:WR1', 'call:d1:HR1']);
    expect(first.blocks().map(identityOf)).toEqual(
        listAgentResultBlocks([serverTurn({ id: 'turn-a', index: 0, status: 'running', events: firstEvents })]).map(
            identityOf
        )
    );

    // THE F11 HALF: the turn ends with NO child frame at all. F6 handed `HR1` back and painted
    // `T?`; F11 keeps the number, because the row is on screen, the call really happened, and the
    // operator points at a refused delegation by its code. The number is the row's OWN address
    // permanently — `collectAgentLabelCounters` reserves it, so no later turn can name a
    // conversation with it.
    first.setState('error', 'boom');
    first.flush();

    expect(rowLabels(first)).toEqual(['HR1']);
    expect(first.blocks().map(identityOf)).toEqual(['root:WR1', 'call:d1:HR1']);

    // The same recorded turn, replayed through the hydration path, lands on the same label —
    // live and replay agree, which is the property the label has to have to be citable.
    const replayBoard = mount();
    const replayRecord = serverTurn({ id: 'turn-a', index: 0, status: 'error', events: firstEvents });
    const [replay] = replayBoard.hydrate([replayRecord]);
    expect(rowLabels(replay)).toEqual(['HR1']);
    expect(replay.blocks().map(identityOf)).toEqual(listAgentResultBlocks([replayRecord]).map(identityOf));

    // AC1 — the ordinal is RESERVED, not back in circulation: a later turn's REAL helper run is
    // `HR2`, so the board never shows `HR1` twice. (F6's answer was `HR1` again — the number had
    // been refunded — and that is exactly the renumbering F11 forbids: the operator may already
    // be holding `#HR1` from the failed row.)
    const second = live(board, 'retry', 'turn-b', 1);
    for (const event of [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('helper', 'd2'),
        withThread({ type: 'start', agent: 'helper', model: 'h1' }, { id: 't2', callId: 'd2', input: 'child task' })
    ])
        second.apply(event);
    second.flush();

    expect(rootLabel(second)).toBe('WR2');
    expect(rowLabels(second)).toEqual(['HR2']);
    expect(new Set([...rowLabels(first), ...rowLabels(second)]).size).toBe(2);
});

// F10 (R10.2) machinery, still reachable under F11 — but only for a row that gave its number up
// for a BETTER NAME (a wire label, a roster conversation join, a borrowed conversation code),
// never because a settle pass decided the row owns nothing. The two wrong answers F10 measured
// on the operator's board stay pinned:
//   - minting a FRESH ordinal after a refund left a hole the reader reads as a broken sequence; and
//   - reusing a number WITHOUT CHECKING puts two visible rows on one name when another tile took
//     the freed number in the meantime, which is the one failure this fold may never cause.
// The rule (ui/turns.ts `reinstateEntryLabel` → `ordinalIsFree`) is: take the freed number back
// iff no server-recorded floor reaches it, no row on ANY tile of the board wears it, and this
// tile's high water is below it; otherwise mint the next free ordinal — never a placeholder,
// because the row is a run now.
it('gives a row that borrowed a conversation code a provably free ordinal when its child arrives late', () => {
    const board = mount();

    const first = live(board, 'delegate', 'turn-a', 0);
    const firstEvents: HarnessEvent[] = [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('helper', 'd1')
    ];
    for (const event of firstEvents) first.apply(event);
    first.flush();

    // The pending call owns HR1…
    expect(rowLabels(first)).toEqual(['HR1']);

    // …and under F11 it STILL owns it after the turn settles with no child frame: the settle pass
    // reserves the mint rather than retracting it, so the late-adoption path has nothing to
    // reclaim and the row keeps the exact code the operator was reading.
    first.setState('error', 'boom');
    first.flush();
    expect(rowLabels(first)).toEqual(['HR1']);

    // The child's frame lands AFTER the settle pass. The row is addressable by its conversation
    // id now (`call:d1` → `t1`) and keeps its number — no re-mint, no hole.
    first.apply(withThread({ type: 'start', agent: 'helper', model: 'h1' }, { id: 't1', callId: 'd1', input: 'child task' }));
    first.flush();

    expect(rowLabels(first)).toEqual(['HR1']);
    expect(first.blocks().map(identityOf)).toEqual(['root:WR1', 't1:HR1']);

    // The sequence continues after a real run rather than around a hole, and the two rows of the
    // board address different runs.
    const second = live(board, 'again', 'turn-b', 1);
    for (const event of [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('helper', 'd2'),
        withThread({ type: 'start', agent: 'helper', model: 'h1' }, { id: 't2', callId: 'd2', input: 'child task' })
    ])
        second.apply(event);
    second.flush();

    expect(rowLabels(second)).toEqual(['HR2']);
    expect([...rowLabels(first), ...rowLabels(second)]).toEqual(['HR1', 'HR2']);
    expect(new Set([...rowLabels(first), ...rowLabels(second)]).size).toBe(2);
});

it('never re-wears a number another row holds: the reserved mint outranks a later tile', () => {
    const board = mount();

    const first = live(board, 'delegate', 'turn-a', 0);
    for (const event of [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('helper', 'd1')
    ])
        first.apply(event);
    first.flush();
    first.setState('error', 'boom');
    first.flush();

    // F6 freed HR1 here, so a later tile's real helper run took it. Under F11 the failed row is
    // STILL wearing HR1, and the allocator's floor says so: the later run must not be put on the
    // same address, and it is not — it reads HR2.
    const second = live(board, 'retry', 'turn-b', 1);
    for (const event of [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('helper', 'd2'),
        withThread({ type: 'start', agent: 'helper', model: 'h1' }, { id: 't2', callId: 'd2', input: 'child task' })
    ])
        second.apply(event);
    second.flush();

    expect(rowLabels(first)).toEqual(['HR1']);
    expect(rowLabels(second)).toEqual(['HR2']);
    expect(new Set([...rowLabels(first), ...rowLabels(second)]).size).toBe(2);

    // And the late child of turn-a changes nothing: its row already owns HR1, and the tile does
    // not re-mint a code that is already displayed.
    first.apply(withThread({ type: 'start', agent: 'helper', model: 'h1' }, { id: 't1', callId: 'd1', input: 'child task' }));
    first.flush();

    expect(rowLabels(first)).toEqual(['HR1']);
    expect(rowLabels(second)).toEqual(['HR2']);
});

it('gives two refused attempts of one agent two different labels', () => {
    const board = mount();

    // The case that made `T?` unshippable: the operator's turn held SEVERAL delegations that never
    // started. One shared placeholder token made them indistinguishable; two ordinals name each
    // attempt, and the record projects the same two codes.
    const first = live(board, 'delegate twice', 'turn-a', 0);
    const firstEvents: HarnessEvent[] = [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('helper', 'd1'),
        delegateCall('helper', 'd2')
    ];
    for (const event of firstEvents) first.apply(event);
    first.setState('error', 'boom');
    first.flush();

    expect(rowLabels(first)).toEqual(['HR1', 'HR2']);
    expect(first.blocks().map(identityOf)).toEqual([
        'root:WR1',
        'call:d1:HR1',
        'call:d2:HR2'
    ]);

    // The projection of the SAME record agrees, block for block — the live board and a reload
    // cannot offer the operator two different answers to `#HR1`.
    const record = serverTurn({ id: 'turn-a', index: 0, status: 'error', events: firstEvents });

    expect(first.blocks().map(identityOf)).toEqual(listAgentResultBlocks([record]).map(identityOf));

    // A later REAL helper run continues after both attempts, so the numbering stays dense and
    // collision-free across a mixed fleet of failed and real runs.
    const second = live(board, 'third time', 'turn-b', 1);
    for (const event of [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('helper', 'd3'),
        withThread({ type: 'start', agent: 'helper', model: 'h1' }, { id: 't3', callId: 'd3', input: 'child task' })
    ])
        second.apply(event);
    second.flush();

    expect(rowLabels(second)).toEqual(['HR3']);
    expect(
        new Set([...rowLabels(first), ...rowLabels(second)]).size
    ).toBe(3);
});

it('keeps the number of a placeholder that adopted its child, so the numbering continues after a real run', () => {
    const board = mount();

    const first = live(board, 'delegate', 'turn-a', 0);
    for (const event of [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('helper', 'd1'),
        withThread({ type: 'start', agent: 'helper', model: 'h1' }, { id: 't1', callId: 'd1', input: 'child task' })
    ])
        first.apply(event);
    first.flush();

    expect(rowLabels(first)).toEqual(['HR1']);

    // The child started, so the settle pass must NOT move the row: the settle transition closes
    // the row (`done`) and its number stays owned. Over-retiring here would re-mint HR1 in a later
    // tile and put two visible rows on one address.
    first.setState('done');
    first.flush();

    expect(rowLabels(first)).toEqual(['HR1']);
    expect(threadRows(first)[0].dataset.state).toBe('done');

    const second = live(board, 'again', 'turn-b', 1);
    for (const event of [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('helper', 'd2'),
        withThread({ type: 'start', agent: 'helper', model: 'h1' }, { id: 't2', callId: 'd2', input: 'child task' })
    ])
        second.apply(event);
    second.flush();

    expect(rootLabel(second)).toBe('WR2');
    expect(rowLabels(second)).toEqual(['HR2']);
});
