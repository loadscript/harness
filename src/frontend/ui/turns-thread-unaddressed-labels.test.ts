// F6 (2026-11-25) — the CLIENT twin of the mint-leak fix (AC1: no ordinal is consumed by a
// run that can never own one).
//
// `../../shared/agent-results.ts` stopped minting per-agent ordinals for two kinds of block:
// a threadFork BRANCH run (`reserveLabel: false`, :630-661) and a `delegate` PLACEHOLDER whose
// child never started (the end-of-turn sweep, :845-869). Both read `UNADDRESSABLE_BLOCK_LABEL`
// (`T?`), and `collectAgentLabelCounters` (:912-940) derives the durable counters from the
// labels on screen, so a number no conversation answers to is never published.
//
// The browser's own tile allocator had the same leak: `nextLabel` published every allocation
// into the board's `labelCounters` (ui/turns.ts), so a live session showed `IT13 … IT19` with
// nothing behind them and skipped those numbers for good. These pins own the client rule:
//   - AC1  a branch run and a settled un-adopted placeholder consume NOTHING, and the board's
//          numbering continues without a gap (asserted through the labels of the NEXT tile,
//          which is the only thing the shared counter is observable through);
//   - AC2  a LIVE pending delegation still shows its number (the state ui/blocks.test.ts pins
//          against the shared projection) — the retirement happens only once the turn settles;
//   - and a placeholder that DID adopt its child keeps its number, so the counter keeps
//         advancing exactly as far as the runs that really happened.
//
// F10 (R10.2) adds the two late-adoption pins at the bottom of this file: a row that handed its
// number back and THEN became addressable again takes its own number back when it is provably
// free, and the next free number when it is not — see `reinstateEntryLabel` in ui/turns.ts.
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

// The visible per-invocation code of every row, in DOM order. `T?` IS the expected value here:
// it is the text the row must show when its run owns no addressable label.
const rowLabels = (turn: TurnHandle): string[] =>
    threadRows(turn).map((row) => row.querySelector('.thread-name')?.textContent ?? '');

// The tile's own root code (the root invocation has no row).
const rootLabel = (turn: TurnHandle): string => turn.element.querySelector('.tile-agent')?.textContent ?? '';

// Identity-only comparison (the same field set ui/blocks.test.ts pins): the descriptor's
// `status`/`content` follow the tile's transport state, which is not what these labels are
// about, and a live tile legitimately reports a different status from a projected block.
const identityOf = (block: { threadId?: string; label: string }): string => `${block.threadId ?? 'root'}:${block.label}`;

it('consumes no ordinal for a threadFork branch, and gives the freed number to the next run that can own one', () => {
    const board = mount();

    const first = live(board, 'fork this', 'turn-a', 0);
    const firstEvents = [{ type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent, branchStart()];
    for (const event of firstEvents) first.apply(event);
    first.flush();

    // The branch row owns no addressable identity: unknown label, and NO number taken from the
    // writer sequence.
    expect(rowLabels(first)).toEqual(['T?']);
    expect(rootLabel(first)).toBe('WR1');
    expect(first.blocks().map(identityOf)).toEqual(['root:WR1', 'branch-1:T?']);

    // The settled record's own projection says the same, one identity per block — the client
    // cannot renumber a run the shared projection refuses a label for.
    const record = serverTurn({ id: 'turn-a', index: 0, status: 'running', events: firstEvents });
    expect(first.blocks().map(identityOf)).toEqual(listAgentResultBlocks([record]).map(identityOf));

    // A LATER turn's runs of the same code continue straight after WR1: the branch never
    // burned WR2, so the sequence has no gap. Before the fix these read WR1 / WR4 (root WR2
    // for the branch, WR3 for the root, WR4 for the child).
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

it('keeps a live pending delegation numbered, and retires the number only once the turn settles', () => {
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

    // The turn ends with NO child frame at all. The row is still rendered (the call really
    // happened) but it is not a run, so it gives up the ordinal it tentatively took.
    first.setState('error', 'boom');
    first.flush();

    expect(rowLabels(first)).toEqual(['T?']);
    expect(first.blocks().map(identityOf)).toEqual(['root:WR1', 'call:d1:T?']);

    // The same recorded turn, replayed through the hydration path, lands on the same label —
    // the retirement is a property of the record, not of the live moment it was observed in.
    const replayBoard = mount();
    const replayRecord = serverTurn({ id: 'turn-a', index: 0, status: 'error', events: firstEvents });
    const [replay] = replayBoard.hydrate([replayRecord]);
    expect(rowLabels(replay)).toEqual(['T?']);
    expect(replay.blocks().map(identityOf)).toEqual(listAgentResultBlocks([replayRecord]).map(identityOf));

    // AC1 — the freed ordinal is back in circulation: a later turn's REAL helper run is HR1,
    // not HR2, and the writer sequence is untouched (WR2 for its root).
    const second = live(board, 'retry', 'turn-b', 1);
    for (const event of [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('helper', 'd2'),
        withThread({ type: 'start', agent: 'helper', model: 'h1' }, { id: 't2', callId: 'd2', input: 'child task' })
    ])
        second.apply(event);
    second.flush();

    expect(rootLabel(second)).toBe('WR2');
    expect(rowLabels(second)).toEqual(['HR1']);
});

// F10 (R10.2) — the twin failure of the retraction above. The row that gave its number back is
// not necessarily finished: a `delegate` placeholder can adopt its child LATE (the worker's
// trailing `start` frame, a `thread` record that lands after the terminal frame, a roster poll
// that delivers the join before the child's transcript). Re-admitting that run has to answer the
// question the retraction already settled — which number is ITS OWN — and both wrong answers were
// observed on the operator's board:
//   - minting a FRESH ordinal left a hole the reader reads as a broken sequence (`RR9` retracted,
//     the late child shown at `RR10`, `RR9` now nobody's); and
//   - reusing a number WITHOUT CHECKING puts two visible rows on one name when another tile took
//     the freed number in the meantime, which is the one failure this fold may never cause.
// The rule (ui/turns.ts `reinstateEntryLabel` → `ordinalIsFree`) is: take the freed number back
// iff no server-recorded floor reaches it, no row on ANY tile of the board wears it, and this
// tile's high water is below it; otherwise mint the next free ordinal — never `T?`, because the
// row is a run now.
it('gives a retracted row its OWN number back when its child arrives after the settle', () => {
    const board = mount();

    const first = live(board, 'delegate', 'turn-a', 0);
    const firstEvents: HarnessEvent[] = [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('helper', 'd1')
    ];
    for (const event of firstEvents) first.apply(event);
    first.flush();

    // The pending call owns HR1, then gives it up when the turn settles with no child frame.
    expect(rowLabels(first)).toEqual(['HR1']);
    first.setState('error', 'boom');
    first.flush();
    expect(rowLabels(first)).toEqual(['T?']);

    // The child's frame lands AFTER the settle sweep. The row is addressable again
    // (`call:d1` → `t1`), and the number it handed back has not been spent by anyone.
    first.apply(withThread({ type: 'start', agent: 'helper', model: 'h1' }, { id: 't1', callId: 'd1', input: 'child task' }));
    first.flush();

    // HR1 — ITS OWN number, the one the operator saw before the retraction — and not the fresh
    // HR2 the tile allocator would hand out (HR1 is above this tile's high water, which the
    // refund lowered to 0, and below nothing else).
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

it('mint the next number instead of a worn one when another tile took the freed ordinal first', () => {
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

    // HR1 is free, so a LATER tile's real helper run takes it (the no-gap rule pinned above).
    const second = live(board, 'retry', 'turn-b', 1);
    for (const event of [
        { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
        delegateCall('helper', 'd2'),
        withThread({ type: 'start', agent: 'helper', model: 'h1' }, { id: 't2', callId: 'd2', input: 'child task' })
    ])
        second.apply(event);
    second.flush();
    expect(rowLabels(second)).toEqual(['HR1']);

    // Now the late child of turn-a arrives. HR1 is displayed on THIS board (turn-b's row), so
    // reinstating it would put two rows on one address; the row takes the next free ordinal
    // instead, and both rows stay addressable.
    first.apply(withThread({ type: 'start', agent: 'helper', model: 'h1' }, { id: 't1', callId: 'd1', input: 'child task' }));
    first.flush();

    expect(rowLabels(first)).toEqual(['HR2']);
    expect(rowLabels(second)).toEqual(['HR1']);
    expect(new Set([...rowLabels(first), ...rowLabels(second)]).size).toBe(2);
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

    // The child started, so the end-of-turn sweep must NOT touch it: the settle transition
    // closes the row (`done`) and its number stays owned. Over-retracting here would re-mint
    // HR1 in a later tile and put two visible rows on one address.
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
