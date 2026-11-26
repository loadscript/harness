// F10 (2026-11-26) / F11 (2026-11-26) — A COMPILED ROW'S IDENTITY ARRIVES, OR THE ROW MINTS A
// PROVISIONAL ADDRESS. NOTHING ON THE BOARD READS `T?` ANY MORE.
//
// THE DEFECT (R10.1 + R10.5, measured on the operator's own session `Temp/agenttools/snapshot/
// session.json`, turn `caaa372e…`, reproduced end-to-end through the real server fold and the
// real board by `Temp/review-v3/probe-real-session2.ts` and `Temp/fix-f10/probe-identity.ts`):
// every row of a COMPILED (display-wire) turn went through the tile's local allocator, so the
// five sections whose wire carried NO identity at all (`agentLabel: ''` and no `invocationId`/
// `threadId`/`branchId` — the projector could not attribute them either) were painted
// `IT13`, `WE1`, `IT14`, `IT15`, `IT16`. Those numbers were:
//   - FABRICATED — no conversation answers to them, and no `#` reference resolves them;
//   - UNRECOVERABLE — the end-of-turn retraction sweep only fires for a row with a `callId`
//     (`setState`, ui/turns.ts) and a compiled row has none (`compiledEntryOf` passes
//     `callId: undefined`), so the eager mint was never refunded, while the shared projection
//     fed exactly those numbers into the durable `labelHighWater` (that half is R10.3, pinned in
//     ../agent-results-block-identity.test.ts);
//   - and the rows whose label the wire DID author arrived as an EMPTY `.thread-name`, because
//     `paintCompiledSection` only paints a non-empty `agentLabel`.
//
// F10's answer was "consume nothing, read `T?`". F11 REMOVES THE TOKEN, on the operator's direct
// mandate ("All labels must be valid. Cannot have T? or T- etc… all labels must be unique… user
// using these label to reference as needed, and having a bunch of T? means they cannot reference
// specific one"), and the answer is now:
//   - an unnamed compiled row mints a PROVISIONAL ordinal and shows it (`clientLabel`) — the row
//     is citable, and `paintCompiledSection` hands the number back the moment the wire authors a
//     real one, so F10's unrecoverable leak is still gone;
//   - a branch row displays the CONVERSATION it forked from (`labelShared`, the twin of
//     ../../shared/agent-results.ts `branchSharedLabelOf`), and keeps its `branch-N` badge, which
//     is what tells two forks of one conversation apart;
//   - a row with no address of its own shows the record's better identity (`branchId` →
//     `invocationId` → F11's `callId`) in a separate `.thread-runid` badge — beside its name,
//     never instead of it.
//
// WHAT IS PINNED HERE (the requirement, not an observation):
//   I1. a compiled row's name is exactly one of: its own `TurnSection.agentLabel`, the roster
//       join's conversation code, the conversation a branch borrows, or a provisional mint — and
//       NEVER a placeholder or the empty string (asserted by the name text of every fixture);
//   I2. an identity that ARRIVES still RESERVES its number, so the numbering after a replayed turn
//       continues where the SERVER'S names left off; a provisional mint reserves its number too
//       (F11: what is on screen is what is reserved) — the leak F10 fixed is that a mint no row
//       displays any more is refunded, and that refund is pinned here;
//   I3. a row that owns no address of its own states the identity the record DOES hold, in a
//       separate badge, and the badge never moves into the name slot;
//   I4. a row the wire or the roster DOES name wears that address and gets NO badge, so the common
//       row's DOM, width and column alignment are byte-identical to the pre-F10 board (the shape
//       ./turns-thread-repeat-labels.test.ts pins);
//   I5. the identity is on the row as DATA (`data-thread-identity`) in every state that has one,
//       including the rows whose repeated code the R7/D2 rule withdraws.
//
// The badge is measured through the SHIPPED stylesheet (the device ./turns-thread-empty-rows.test.ts
// and ./turns-thread-repeat-labels.test.ts use), so "a reader can see it" is jsdom's answer and
// not this file's restatement of a selector.
//
// Run: yarn vitest run --config src/frontend/vitest.config.ts ui/turns-thread-identity.test.ts

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ContextBlock, DisplayNode, TurnSection, TurnSummary } from '../../shared/turn-display';
import type { SessionView } from '../../server/protocol';
import { createTurnBoard, type TurnBoard } from './turns';
import type { SessionThreadEntry } from './threads';

const T = 1_700_000_000_000;

const stylesheet = [
    'src/frontend/styles.css',
    'src/styles.css',
    'packages/loadscript/harness/src/frontend/styles.css'
]
    .map((candidate) => resolve(process.cwd(), candidate))
    .find((candidate) => existsSync(candidate));

if (stylesheet === undefined) throw new Error('styles.css not found');

const css = readFileSync(stylesheet, 'utf8');

beforeAll(() => {
    const style = document.createElement('style');
    style.id = 'shipped-stylesheet';
    style.textContent = css;
    document.head.append(style);
});

// ---------------------------------------------------------------------------
// Fixtures. `rootSection` is the turn's own flow; `run` is one child section as the display
// wire delivers it. `unattributed` is the shape the projector produced FIVE times on the
// operator's turn: no `agentLabel`, no `threadId`, no `invocationId`, no `branchId`.
// ---------------------------------------------------------------------------

const block = (sectionId: string, id: string): ContextBlock =>
    ({
        kind: 'tool',
        id,
        turnId: sectionId.split(':')[0] as string,
        sectionId,
        name: `call-${id}`,
        chars: 100,
        argsChars: 40,
        resultChars: 60,
        inPrompt: true,
        state: 'ok',
        eventFrom: 7,
        eventTo: 9,
        at: T,
        endedAt: T + 500
    }) as ContextBlock;

const answer = (id: string, text: string): DisplayNode =>
    ({ kind: 'text', id, text, committed: true }) as unknown as DisplayNode;

const section = (overrides: Partial<TurnSection> & { id: string }): TurnSection =>
    ({
        rank: 'B',
        agent: 'helper',
        // The wire's OWN identity for the run. `''` is a real state of the frozen contract: the
        // projector authors no label for a run it cannot attribute.
        agentLabel: '',
        state: 'done',
        nodes: [],
        startedAt: T,
        endedAt: T + 900,
        latestInput: 1_200,
        cachedInput: 300,
        ...overrides
    }) as TurnSection;

const rootSection = (turnId: string, sections: TurnSection[]): TurnSection[] => [
    section({
        id: `${turnId}:0`,
        rank: 'A',
        agent: 'instruct',
        agentLabel: 'IT1',
        threadId: 'th-instruct',
        invocationId: `inv-it1-${turnId}`,
        threadLabel: 'IT1',
        context: [block(`${turnId}:0`, `${turnId}0-tool-7`)],
        nodes: [answer(`${turnId}0`, `${turnId} prose`)]
    }),
    ...sections
];

const child = (id: string, overrides: Partial<TurnSection> = {}): TurnSection =>
    section({ id, parentSectionId: `${id.split(':')[0]}:0`, context: [], nodes: [], ...overrides });

const summary = (id: string, index: number, sections: number): TurnSummary =>
    ({
        id,
        index,
        prompt: 'stress test',
        status: 'done',
        state: 'done',
        threadId: 'th-instruct',
        threadLabel: 'IT1',
        updatedAt: T + 400_000,
        sectionCount: sections,
        stepCount: 0,
        activeAgents: ['instruct'],
        blocks: []
    }) as TurnSummary;

const viewOf = (documents: Record<string, TurnSection[]>, sessionId = 's1'): SessionView =>
    ({
        id: sessionId,
        harness: 'instruct',
        status: 'idle',
        model: 'm1',
        createdAt: 1,
        updatedAt: T + 400_000,
        turns: Object.entries(documents).map(([id, sections]) => summary(id, 0, sections.length)).map((item, index) => ({ ...item, index })),
        displays: Object.fromEntries(
            Object.entries(documents).map(([id, sections]) => [id, { turnId: id, sections }])
        )
    }) as unknown as SessionView;

const mount = (sessionId = 's1'): TurnBoard => {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const board = createTurnBoard({ empty });
    board.bindSession(sessionId);
    document.body.replaceChildren(board.element);

    return board;
};

const render = (board: TurnBoard, view: SessionView): void => {
    for (const handle of board.reconcileView(view)) handle.flush();
};

// ---------------------------------------------------------------------------
// Readers. A compiled row's identity lives in three places, and a reviewer asked for each of
// them to be honest: the NAME slot (`.thread-name`), the BADGE (`.thread-runid`), and the DATA
// (`data-thread-identity`). All three are read here, plus `painted`, which asks the shipped
// stylesheet whether a figure is actually on screen (text + visibility + display + the
// 1px/clip-path visually-hidden box).
// ---------------------------------------------------------------------------

const rowOf = (board: TurnBoard, key: string): HTMLElement => {
    const row = board.element.querySelector<HTMLElement>(`.thread-row[data-thread-id="${key}"]`);

    if (row === null) throw new Error(`no thread-row for ${key}`);

    return row;
};

const nameText = (row: HTMLElement): string => row.querySelector('.thread-name')?.textContent ?? '';

const badge = (row: HTMLElement): HTMLElement | null => row.querySelector<HTMLElement>('.thread-runid');

const badgeText = (row: HTMLElement): string | undefined => badge(row)?.textContent ?? undefined;

// The header's children in DOM order — the figure ./turns-thread-repeat-labels.test.ts pins the
// column alignment with, and the figure a badge must NOT disturb unless it is earned.
const selectChildren = (row: HTMLElement): string[] => [
    ...row.querySelectorAll<HTMLElement>(':scope > .thread-tile > .thread-select > *')
].map((node) => node.className);

const painted = (node: HTMLElement | null | undefined): boolean => {
    if (node === null || node === undefined || node.hidden) return false;

    const style = getComputedStyle(node);

    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.width === '1px') return false;
    if (style.clipPath.includes('inset(50%')) return false;

    return (node.textContent ?? '').trim().length > 0;
};

// F11: the token this file used to pin as an honest state. It must not come back in ANY name
// slot of any fixture, so every case below asserts a real address instead and this guard makes
// the mandate a property of the whole file rather than of one assertion.
const PLACEHOLDER = 'T?';

describe('I1/I2 — a compiled row is named, and reserves what it shows', () => {
    it('mints a provisional address when the wire authored no label, and refunds it when the label lands', () => {
        const board = mount();

        render(
            board,
            viewOf({
                t1: rootSection('t1', [child('t1:1', { agent: 'helper' })])
            })
        );

        const row = rowOf(board, 't1:1');

        // F11: `HR1`, the provisional ordinal this board minted — NOT `T?` and NOT the empty name
        // F10 left behind. The row occupies the board, so it carries an address the operator can
        // type; `clientLabel` marks it as refundable, which the second half of this case pins.
        expect(nameText(row)).toBe('HR1');
        expect(nameText(row)).not.toBe(PLACEHOLDER);

        // A provisional mint IS displayed, so it reserves its number while it is on screen (V6 of
        // the shared contract): a later tile's `helper` run continues AFTER it, and does not
        // collide with the row the operator can see.
        const live = board.begin('next', 'turn-b', 1);

        live.apply({ type: 'start', agent: 'helper', model: 'm1' } as never);
        live.flush();

        expect(live.element.querySelector('.tile-agent')?.textContent).toBe('HR2');

        // THE REFUND (what F10 actually fixed): when the wire DOES author the label, the compiled
        // row repaints to the server's name and the provisional ordinal goes back to the tile. A
        // third tile's `helper` run therefore continues after the SERVER's number (`HR2`), and the
        // provisional mint is not a scar in the numbering.
        render(
            board,
            viewOf({
                t1: rootSection('t1', [child('t1:1', { agent: 'helper', agentLabel: 'HR3', threadId: 'th-h3' })]),
                t2: rootSection('t2', [child('t2:1', { agent: 'helper', agentLabel: 'HR4', threadId: 'th-h4' })])
            })
        );

        expect(nameText(rowOf(board, 't1:1'))).toBe('HR3');

        const third = board.begin('third', 'turn-c', 2);

        third.apply({ type: 'start', agent: 'helper', model: 'm1' } as never);
        third.flush();

        // The floor the wire's `HR3`/`HR4` set is what answers here: the mint was refunded, and the
        // sequence never re-wears a displayed number.
        expect(third.element.querySelector('.tile-agent')?.textContent).toBe('HR5');
    });

    it('reserves a label the WIRE authored, so the numbering continues after a replayed turn', () => {
        const board = mount();

        render(
            board,
            viewOf({
                t1: rootSection('t1', [child('t1:1', { agent: 'helper', agentLabel: 'HR1', threadId: 'th-h1' })])
            })
        );

        const row = rowOf(board, 't1:1');

        // The server's own code is shown verbatim — no re-mint, no re-format.
        expect(nameText(row)).toBe('HR1');

        const live = board.begin('next', 'turn-b', 1);

        live.apply({ type: 'start', agent: 'helper', model: 'm1' } as never);
        live.flush();

        // …and it RESERVED the number: the next run of the same code continues after it, exactly
        // as `turn.threadLabel` has always been reserved (`reserveConversationLabel`).
        expect(live.element.querySelector('.tile-agent')?.textContent).toBe('HR2');
    });
});

describe('I3 — a row with no address of its own states the identity it does have', () => {
    it('carries its recorded invocation id as data, beside its provisional name', () => {
        const board = mount();

        // The R10.5 pair, in the shape the reviewer could not read: the run has no CONVERSATION,
        // but the record is not silent — it knows `inv-3`.
        render(
            board,
            viewOf({
                t1: rootSection('t1', [child('t1:1', { agent: 'helper', invocationId: 'inv-3' })])
            })
        );

        const row = rowOf(board, 't1:1');

        // F11: the name is the row's own provisional ordinal, and the record's id rides as the
        // row's IDENTITY DATA. No `.thread-runid` badge is painted, because the row wears a real
        // address (I4's rule, unchanged since F10): the badge belongs to rows whose name is NOT
        // their own, and a fabricated-but-owned ordinal is one the operator can type.
        expect(nameText(row)).toBe('HR1');
        expect(badge(row)).toBeNull();
        expect(row.dataset.threadIdentity).toBe('inv-3');
        expect(selectChildren(row)).toEqual(['thread-name', 'thread-preview', 'thread-top']);
    });

    it('badges a threadFork branch with its branch id, which outranks the run id', () => {
        const board = mount();

        // `branchId` FIRST: on the operator's session every `branch-N` section ALSO carries the
        // PARENT's `threadId` (`thread-52`), so the conversation figure would claim the branch is
        // its owner's conversation. `threadIdentityOf` (./threads.ts) prefers the branch, and the
        // run id is the fallback for the rows that have no branch.
        render(
            board,
            viewOf({
                t1: rootSection('t1', [
                    child('t1:1', { agent: 'instruct', branchId: 'branch-3', invocationId: 'branch-3', threadId: 'thread-52' })
                ])
            })
        );

        const row = rowOf(board, 't1:1');

        expect(badgeText(row)).toBe('branch-3');
        expect(row.dataset.threadIdentity).toBe('branch-3');
        // F11: a branch is not the conversation's OWNER, so it DISPLAYS the conversation's code —
        // the label of the flow this turn runs (`IT1`, the root section's own address), the twin of
        // ../../shared/agent-results.ts `branchSharedLabelOf` / `labelSource: 'shared'`. `T?` is
        // gone, and the `branch-3` badge above is what separates two forks of one conversation. A
        // bare `#IT1` still resolves to the conversation's OWN block, because the threadless label
        // lookup skips a `shared` row.
        expect(nameText(row)).toBe('IT1');
    });

    it('mints its own name and NO badge when the record holds no identity at all', () => {
        const board = mount();

        // The five rows of the operator's turn that carried literally nothing. F10 called the empty
        // name "the only honest state"; F11 rejects it — a rendered row must show something the
        // reader can point at, and inventing a BADGE would be the only lie (an id the record does
        // not hold). So: a provisional ordinal, and no badge.
        render(
            board,
            viewOf({
                t1: rootSection('t1', [child('t1:1', { agent: 'workspace' })])
            })
        );

        const row = rowOf(board, 't1:1');

        expect(nameText(row)).toBe('WE1');
        expect(badge(row)).toBeNull();
        expect(row.dataset.threadIdentity).toBeUndefined();
        expect(selectChildren(row)).toEqual(['thread-name', 'thread-preview', 'thread-top']);

        // And the number it displays is RESERVED while it is displayed — the operator's `WE:12`
        // leak is not back: this is one occurrence, and the next `workspace` run reads `WE2`.
        const live = board.begin('next', 'turn-b', 1);

        live.apply({ type: 'start', agent: 'workspace', model: 'm1' } as never);
        live.flush();

        expect(live.element.querySelector('.tile-agent')?.textContent).toBe('WE2');
    });
});

describe('I4/I5 — an address beats the badge, and the data outlives it', () => {
    it('drops the badge the moment the wire authors the row label', () => {
        const board = mount();

        // A row is CREATED nameless (the display frame that opens a section may carry no label
        // yet) and is repainted by `paintCompiledSection`. The badge from the first paint must go
        // with the namelessness it explained — otherwise a row would state a run id beside the
        // conversation code that replaced it, and the header would gain a child no test owns.
        render(
            board,
            viewOf({
                t1: rootSection('t1', [child('t1:1', { agent: 'workspace', agentLabel: 'WE7', threadId: 'th-we7', invocationId: 'inv-we7-1' })])
            })
        );

        const row = rowOf(board, 't1:1');

        expect(nameText(row)).toBe('WE7');
        expect(badge(row)).toBeNull();
        // I5: the identity stays as DATA — a row that has an address still says which RUN it is,
        // which is what a support read (or the repeat pass) needs when the code itself is
        // withdrawn on an exchange row.
        expect(row.dataset.threadIdentity).toBe('inv-we7-1');
        expect(selectChildren(row)).toEqual(['thread-name', 'thread-preview', 'thread-top']);
    });

    it('drops the badge when the roster joins the conversation, and stamps the persistent marker', () => {
        const board = mount();

        render(
            board,
            viewOf({
                t1: rootSection('t1', [child('t1:1', { agent: 'workspace', threadId: 'th-we7', invocationId: 'inv-we7-1' })])
            })
        );

        const before = rowOf(board, 't1:1');

        // F11: no wire label and no roster yet — the row wears its provisional ordinal, and the
        // run id the record does hold rides as the row's identity DATA. It is citable from the
        // first frame, which is the change; no badge, because the provisional name IS an address.
        expect(nameText(before)).toBe('WE1');
        expect(badge(before)).toBeNull();
        expect(before.dataset.threadIdentity).toBe('inv-we7-1');

        const roster: SessionThreadEntry[] = [
            {
                id: 'th-we7',
                agent: 'workspace',
                origin: 'host',
                status: 'idle',
                sequence: 7,
                label: 'WE7',
                invocationId: 'inv-we7-1'
            }
        ];

        board.setThreads(roster);

        const again = viewOf({
            t1: rootSection('t1', [child('t1:1', { agent: 'workspace', threadId: 'th-we7', invocationId: 'inv-we7-1' })])
        });

        for (const handle of board.reconcileView(again)) handle.flush();

        const row = rowOf(board, 't1:1');

        // The join's conversation code REPLACES the provisional mint (it always replaced the
        // unknown) and the badge goes with it: a row that wears `WE7` needs no second identity
        // figure — and the provisional `WE1` was refunded, which is what keeps `WE2` free.
        expect(nameText(row)).toBe('WE7');
        expect(badge(row)).toBeNull();
        expect(row.dataset.persistentThread).toBe('th-we7');
        expect(row.dataset.threadIdentity).toBe('inv-we7-1');
    });

    it('keeps the repeated code of an exchange row withdrawable while still identifying the run', () => {
        const board = mount();

        // Two runs of ONE conversation, both labelled `HR1` by the wire: the first is the card,
        // the second is its exchange, and the R7/D2 rule hides the second row's repeated code
        // (./turns-thread-repeat-labels.test.ts). F10 deliberately does NOT badge that row — the
        // code it hides is a real address — but it does stamp the data, which is the figure that
        // answers "which run is this?" without disturbing the columns.
        render(
            board,
            viewOf({
                t1: rootSection('t1', [
                    child('t1:1', { agent: 'helper', agentLabel: 'HR1', threadId: 'th-h1', invocationId: 'inv-h1' }),
                    child('t1:2', { agent: 'helper', agentLabel: 'HR1', threadId: 'th-h1', invocationId: 'inv-h2' })
                ])
            })
        );

        const card = rowOf(board, 't1:1');
        const exchange = rowOf(board, 't1:2');

        expect(card.dataset.threadExchange).toBeUndefined();
        expect(exchange.dataset.threadExchange).toBe('th-h1');
        expect(nameText(exchange)).toBe('HR1');
        expect(painted(rowOf(board, 't1:2').querySelector<HTMLElement>('.thread-name'))).toBe(false);
        expect(badge(exchange)).toBeNull();
        expect(exchange.dataset.threadIdentity).toBe('inv-h2');
        expect(selectChildren(exchange)).toEqual(['thread-name', 'thread-preview', 'thread-top']);
        // The card keeps its readable code — exactly one copy per conversation (R6/R7).
        expect(painted(card.querySelector<HTMLElement>('.thread-name'))).toBe(true);
        expect(card.dataset.threadIdentity).toBe('inv-h1');
    });
});

// ---------------------------------------------------------------------------
// F11 — THE MANDATE, AS A WHOLE-FILE PROPERTY. Two rows of one board never wear the same name
// unless one of them is a branch's shared copy, and no name slot on any of the fixtures above
// carries the retired placeholder. A mixed fleet (a labelled run, an unattributed run, a branch
// and the tile's own conversation) is the shape the operator's turn had, and the exact expected
// set is written out rather than measured.
// ---------------------------------------------------------------------------

describe('F11 — every rendered row is named, and no two rows share a name', () => {
    it('names the mixed fleet with four distinct addresses and no placeholder', () => {
        const board = mount();

        render(
            board,
            viewOf({
                t1: rootSection('t1', [
                    // the wire named this one
                    child('t1:1', { agent: 'helper', agentLabel: 'HR9', threadId: 'th-h9', invocationId: 'inv-h9' }),
                    // the wire named nothing at all
                    child('t1:2', { agent: 'workspace' }),
                    // a fork of the turn's own conversation
                    child('t1:3', {
                        agent: 'instruct',
                        branchId: 'branch-9',
                        invocationId: 'branch-9',
                        threadId: 'th-instruct'
                    })
                ])
            })
        );

        const names = ['t1:1', 't1:2', 't1:3'].map((key) => nameText(rowOf(board, key)));

        // Exact, in tree order: the wire's own code, the workspace row's provisional mint, and the
        // branch's SHARED copy of the conversation's address.
        expect(names).toEqual(['HR9', 'WE1', 'IT1']);
        expect(names.every((name) => name.length > 0 && name !== PLACEHOLDER)).toBe(true);
        // The branch row is an EXCHANGE of its own conversation (the tile's root flow is that
        // conversation's card), so the R7/D2 rule withdraws the repeated CODE the same way it
        // withdraws it from a second run of one conversation (./turns-thread-repeat-labels.test.ts)
        // — and the row still identifies itself, because the badge and `data-thread-identity` carry
        // `branch-9`. That is the F11 bargain: the name slot is never a placeholder, and the figure
        // that distinguishes two forks is the record's own id, not an invented number.
        const branchRow = rowOf(board, 't1:3');

        expect(painted(branchRow.querySelector<HTMLElement>('.thread-name'))).toBe(false);
        expect(painted(badge(branchRow))).toBe(true);
        expect(branchRow.dataset.threadExchange).toBe('th-instruct');
        expect(branchRow.dataset.threadIdentity).toBe('branch-9');
        // The only repeat allowed among the nested rows is the branch's borrowed copy — and it is
        // the CONVERSATION'S number, so it burned nothing: the workspace mint is `WE1`, the first of
        // its code. (The tile's own root row is the fourth row of this turn and wears `IT1` as the
        // conversation's OWNER; the threadless `#IT1` lookup skips the branch's `shared` copy, so it
        // still resolves to that root block — pinned against the real block list in
        // ./turns-threads.test.ts and in
        // ../../../../underload/harness/src/engine/shared/agent-results-block-identity.test.ts.)
        expect(new Set(names).size).toBe(3);
    });
});
