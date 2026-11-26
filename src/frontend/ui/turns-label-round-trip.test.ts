// F11 (2026-11-26) — ONE ANSWER, LIVE OR REPLAYED.
//
// THE MANDATE, verbatim (the requirement this file pins):
//   "All labels must be valid. Cannot have T? or T- etc... all labels must be unique, as no
//    thread share same labeling. This is because user using these label to reference as needed,
//    and having a bunch of T? means they cannot reference specific one. All thread that started,
//    regardless of failure etc... must be assigned a proper label."
//
// The operator reads a label in the streaming tile, types it into the composer, and expects it to
// resolve. That only holds if the SAME run carries the SAME address in every place the address
// appears, and there are three of them:
//
//   1. the LIVE tile's rows            — ui/turns.ts, minted as the events arrive;
//   2. the LIVE tile's block descriptors — ui/turns.ts `blocks()`, what the composer chips read;
//   3. the REPLAY projection            — ../../shared/agent-results.ts `listAgentResultBlocks`,
//                                         what a reload of the same record paints.
//
// F6 broke (3) against (1) in the other direction: it stopped the client minting for two shapes
// of run and painted `T?`, so a reload offered a token that could not be typed at all. F11 keeps
// the uniqueness rules and gives every row a real address, which makes the round trip — live row,
// live block, replayed block, reloaded DOM — the property worth pinning.
//
// A threadFork BRANCH is the one row whose DISPLAYED address is borrowed (`labelSource:
// 'shared'`): it shows its conversation's code, and a bare `#CODE` resolves to the conversation
// that owns the number, not to the fork copy. The fork stays addressable through its own
// `{ turnId, threadId: branch-N }`, and it keeps the `branch-N` badge, which is what makes two
// forks of one conversation tellable apart. This file asserts that split rather than pretending
// it away.
//
// Run: yarn vitest run --config src/frontend/vitest.config.ts ui/turns-label-round-trip.test.ts

import type { HarnessEvent, SessionTurn } from '../../server/protocol';
import { findAgentResultBlock, findLatestAgentResultBlock, listAgentResultBlocks } from '../../shared';
import { createTurnBoard } from './turns';
import type { TurnHandle } from './turns';

const withThread = (event: Record<string, unknown>, thread: Record<string, unknown>): HarnessEvent =>
    ({ ...event, thread } as unknown as HarnessEvent);

const delegateCall = (agent: string, id: string): HarnessEvent => ({
    type: 'tool_call',
    agent: 'writer',
    call: { id, name: 'delegate', arguments: JSON.stringify({ agent, input: 'child task' }) }
});

// A `threadFork` branch of the tile's own conversation: the figure the operator saw as a second
// `WR1` row, and the reason the shared projection needed a provenance field at all.
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
        { id: 'branch-1', kind: 'fork', branchId: 'branch-1', parentId: 'root' }
    );

// ONE turn holding every shape of run at once: the tile's own root, a delegated child that
// STARTED, a delegated attempt that never started, and a fork of the root conversation. The
// mixed fleet is the point — a per-shape test cannot show one shape stealing another's number.
const mixedEvents = (): HarnessEvent[] => [
    { type: 'start', agent: 'writer', model: 'm1' } as unknown as HarnessEvent,
    delegateCall('helper', 'd1'),
    withThread({ type: 'start', agent: 'helper', model: 'h1' }, { id: 't1', callId: 'd1', input: 'child task' }),
    delegateCall('helper', 'd2'),
    branchStart(),
    { type: 'finish', agent: 'helper', data: { text: 'child answer' } } as unknown as HarnessEvent,
    { type: 'finish', agent: 'writer', data: { text: 'root answer' } } as unknown as HarnessEvent
];

const recordedTurn = (events: readonly HarnessEvent[]): SessionTurn => ({
    id: 'turn-a',
    index: 0,
    prompt: 'tasks',
    status: 'done',
    startedAt: 5,
    updatedAt: 10,
    events
});

const mount = () => {
    const board = createTurnBoard({});
    document.body.replaceChildren(board.element);
    return board;
};

// A live tile bound to a server id — `bind` is what makes `blocks()` describable, exactly like
// the streamed path in main.ts.
const live = (board: ReturnType<typeof createTurnBoard>, prompt: string, id: string, index: number): TurnHandle => {
    const turn = board.begin(prompt);
    turn.bind({ id, index });
    return turn;
};

const threadRows = (turn: TurnHandle): HTMLElement[] => [
    ...((turn.element.parentElement as HTMLElement).querySelectorAll<HTMLElement>('.thread-row') ?? [])
];

// The three facts a row offers the operator: the code in the name slot, the identity it carries
// (`data-thread-id`, the same address the block descriptor uses), and the badge that separates
// two rows wearing one BORROWED code.
type Row = { name: string; id: string; identity: string | undefined; row: HTMLElement };

const rowsOf = (turn: TurnHandle): Row[] =>
    threadRows(turn).map((row) => ({
        name: row.querySelector('.thread-name')?.textContent ?? '',
        id: row.dataset.threadId ?? '',
        identity: row.dataset.threadIdentity,
        row
    }));

// The block's addressable identity, in the `<threadId>:<label>` spelling the twin projection
// tests use. `root` stands in for the root invocation, whose descriptor carries no `threadId`.
const identityOf = (block: { threadId?: string; label: string }): string => `${block.threadId ?? 'root'}:${block.label}`;

// A name the operator can type: the allocator's grammar, nothing else. `T?`, `T-`, `''` and a raw
// agent id all fail here, so this is the mandate's first half asserted as a property.
const ADDRESSABLE = /^[A-Z]{2}\d+$/;

it('streams and projects the same addresses for every run in a mixed fleet', () => {
    const board = mount();
    const events = mixedEvents();

    const turn = live(board, 'mixed fleet', 'turn-a', 0);
    for (const event of events) turn.apply(event);
    turn.setState('done');
    turn.flush();

    // (1) + (2): the rows on screen and the descriptors the composer reads are the SAME set of
    // addresses — each row's `data-thread-id` is the descriptor's `threadId`, and the code in the
    // name slot is the descriptor's `label`. The started child is ONE row (`t1`), not two: the
    // placeholder its spawning call minted is REKEYED by the adoption, and it keeps the number the
    // spawning call allocated (ui/turns.ts `adoptPlaceholder` → `adoptLabelOfPlaceholder`), which
    // is what makes `#HR1` name the run rather than the attempt that preceded it.
    expect(rowsOf(turn).map(({ name, id }) => `${id}:${name}`)).toEqual(['t1:HR1', 'call:d2:HR2', 'branch-1:WR1']);

    // (3): the reload of the same record answers with the same addresses, block for block.
    const record = recordedTurn(events);

    expect(turn.blocks().map(identityOf)).toEqual(listAgentResultBlocks([record]).map(identityOf));
    expect(turn.blocks().map(identityOf)).toEqual([
        'root:WR1',
        't1:HR1',
        'call:d2:HR2',
        'branch-1:WR1'
    ]);

    // Every rendered name is typeable, and no two rows share one ADDRESS — the `branch-1` row
    // shares WR1 with the tile by design, and its badge is what tells them apart.
    for (const { name } of rowsOf(turn)) expect(name).toMatch(ADDRESSABLE);
    expect(new Set(rowsOf(turn).map(({ id }) => id)).size).toBe(3);
});

it('keeps every address resolvable: a typed code finds its block, a badge finds its fork', () => {
    const board = mount();
    const events = mixedEvents();

    const turn = live(board, 'mixed fleet', 'turn-a', 0);
    for (const event of events) turn.apply(event);
    turn.setState('done');
    turn.flush();

    const turns = [recordedTurn(events)];

    // A row that OWNS its number: `#CODE` resolves to exactly that block. A row displaying a
    // BORROWED address (no badge ⇒ it owns its code) is asserted below by identity.
    for (const { name, id, identity } of rowsOf(turn)) {
        const found = findLatestAgentResultBlock(turns, name);

        // Every code on screen resolves to A block wearing it — the mandate's whole point.
        expect(found?.label).toBe(name);

        if (identity === undefined) {
            // No badge means the displayed code is this row's own address, so the lookup must land
            // on this very block: the chip the composer builds from `#CODE` points at this run.
            expect(identityOf(found ?? { label: name })).toBe(`${id}:${name}`);
        } else {
            // A badge means the code is borrowed from the conversation this row forks. The bare
            // lookup must NOT answer with the fork copy — it answers with the owner.
            expect(found?.threadId).not.toBe(id);
            // And the fork is still addressable by its OWN identity: the id-addressed door
            // (../../shared/agent-results.ts `findAgentResultBlock`), which is exactly the pair a
            // chip built from this row puts on the wire.
            expect(
                findAgentResultBlock(turns, { turnId: 'turn-a', threadId: identity, label: name })?.threadId
            ).toBe(id);
        }
    }
});

it('reloads the same record into the same rows the stream painted', () => {
    const liveBoard = mount();
    const events = mixedEvents();

    const streamed = live(liveBoard, 'mixed fleet', 'turn-a', 0);
    for (const event of events) streamed.apply(event);
    streamed.setState('done');
    streamed.flush();

    // The RELOAD: a fresh board, no events, only the record the server kept. Same turns, same
    // numbering — the board re-derives its counters from the labels it paints, exactly as the
    // streaming board did.
    const reloadedBoard = mount();
    const [reloaded] = reloadedBoard.hydrate([recordedTurn(events)]);
    reloaded.flush();

    expect(rowsOf(reloaded).map(({ name, id }) => `${id}:${name}`)).toEqual(
        rowsOf(streamed).map(({ name, id }) => `${id}:${name}`)
    );
    expect(reloaded.blocks().map(identityOf)).toEqual(streamed.blocks().map(identityOf));
});
