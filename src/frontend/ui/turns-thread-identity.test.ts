// F10 (2026-11-26) — A COMPILED ROW'S IDENTITY ARRIVES, OR THE ROW SAYS `T?`.
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
//     (`setState`, turns.ts:5386) and a compiled row has none (`compiledEntryOf` passes
//     `callId: undefined`), so the eager mint was never refunded, while the shared projection
//     fed exactly those numbers into the durable `labelHighWater` (that half is R10.3, pinned in
//     ../agent-results-block-identity.test.ts);
//   - and the rows whose label the wire DID author arrived as an EMPTY `.thread-name`, because
//     `paintCompiledSection` only paints a non-empty `agentLabel` (turns.ts:9698).
//
// WHAT IS PINNED HERE (the requirement, not an observation):
//   I1. a compiled row consumes NO ordinal — ever. Its name is exactly one of: its own
//       `TurnSection.agentLabel`, the roster join's conversation code, or `T?`;
//   I2. a compiled row's identity figures still RESERVE their number, so the numbering after a
//       replayed turn continues where the SERVER'S names left off (the wire label is as
//       authoritative here as `turn.threadLabel` has always been);
//   I3. a row that genuinely owns no address reads `T?` AND states the record's better identity
//       (`branchId`, else `invocationId`) in a separate `.thread-runid` badge — never in the
//       name slot, which must stay unaddressable (`T?`), never an invented `IT13`;
//   I4. a row the wire or the roster DOES name wears that address and gets NO badge, so the
//       common row's DOM, width and column alignment are byte-identical to the pre-F10 board
//       (the shape ./turns-thread-repeat-labels.test.ts pins);
//   I5. the identity is on the row as DATA (`data-thread-identity`) in every state that has one,
//       including the rows whose repeated code the R7/D2 rule withdraws — an exchange of a
//       conversation the card above already speaks for is still identifiable.
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

describe('I1/I2 — a compiled row never spends the conversation numbering', () => {
    it('paints T? and burns NOTHING when the wire authored no label', () => {
        const board = mount();

        render(
            board,
            viewOf({
                t1: rootSection('t1', [child('t1:1', { agent: 'helper' })])
            })
        );

        const row = rowOf(board, 't1:1');

        // The honest unknown, NOT a minted `HR1`. An empty name is equally wrong: the row would
        // render nothing at all in the identity slot.
        expect(nameText(row)).toBe('T?');

        // THEN: the number is still in circulation. A later tile's REAL `helper` run is `HR1`,
        // because the replayed row never took it. (Before F10 the compiled row minted `HR1` and
        // this read `HR2` — the gap the operator's `labelHighWater` recorded as `WE:12`/`RR:11`
        // while the conversation join stopped at WE11/RR10.)
        const live = board.begin('next', 'turn-b', 1);

        live.apply({ type: 'start', agent: 'helper', model: 'm1' } as never);
        live.flush();

        expect(live.element.querySelector('.tile-agent')?.textContent).toBe('HR1');
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

describe('I3 — a row with no address says so, and states the identity it does have', () => {
    it('badges a threadless run with its recorded invocation id, name still T?', () => {
        const board = mount();

        // The R10.5 pair, in the shape the reviewer could not read: the run cannot be addressed
        // (no label, no conversation), but the record is not silent — it knows `inv-3`.
        render(
            board,
            viewOf({
                t1: rootSection('t1', [child('t1:1', { agent: 'helper', invocationId: 'inv-3' })])
            })
        );

        const row = rowOf(board, 't1:1');

        expect(nameText(row)).toBe('T?');
        expect(badgeText(row)).toBe('inv-3');
        expect(row.dataset.threadIdentity).toBe('inv-3');

        // The badge is a figure a reader can see (styles.css `.thread-runid`) — that is the whole
        // point of R10.5 — and it sits in the identity half of the row, before the preview.
        expect(painted(badge(row))).toBe(true);
        expect(selectChildren(row)).toEqual(['thread-name', 'thread-runid', 'thread-preview', 'thread-top']);
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
        // A branch is not addressable, so the name slot stays `T?` (I1) — the badge is the
        // supplement, never a replacement.
        expect(nameText(row)).toBe('T?');
    });

    it('renders NO badge and NO data when the record holds no identity at all', () => {
        const board = mount();

        // The five rows of the operator's turn that carried literally nothing: an empty name is
        // then the ONLY honest state, and inventing a badge would be inventing an id.
        render(
            board,
            viewOf({
                t1: rootSection('t1', [child('t1:1', { agent: 'workspace' })])
            })
        );

        const row = rowOf(board, 't1:1');

        expect(nameText(row)).toBe('T?');
        expect(badge(row)).toBeNull();
        expect(row.dataset.threadIdentity).toBeUndefined();
        expect(selectChildren(row)).toEqual(['thread-name', 'thread-preview', 'thread-top']);
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

        // No wire label and no roster yet: the row is honest about owning no address.
        expect(nameText(before)).toBe('T?');
        expect(badgeText(before)).toBe('inv-we7-1');

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

        // The join's conversation code REPLACES the unknown (it always did) and the badge goes
        // with it: a row that wears `WE7` needs no second identity figure.
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
