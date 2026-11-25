// A ROW THAT PAINTS NOTHING (issue F4 — "some threads have no label, like IT13, IT15 … some
// are EMPTY in total").
//
// THE REPORTED DEFECT, in the shape the harness can reproduce: an Instruct session lists several
// persistent conversations, and some of their rows render as an empty band — no code, no task,
// no clock, no tally, nothing. It is not one rule going wrong. A compiled child row's header has
// four candidate figures, and FOUR rules can each take one away:
//
//   1. the conversation CODE, withdrawn for a repeat/exchange row (styles.css:3640,
//      `visibility: hidden` — R6/R7 in ./turns-thread-repeat-labels.test.ts) whenever another
//      card already prints that code;
//   2. the task PREVIEW, hidden while the row is expanded (styles.css `.thread-row.is-expanded
//      .thread-preview`) because the body renders the task as Markdown — a premise that only
//      holds when the body HAS a task block, and a run no roster row claimed has none
//      (`TurnSection` carries no task text; `createThread`'s `input` is the roster's bounded
//      transcript preview, never the delegate's argument);
//   3. the CLOCK and the TALLY, both `[hidden]` — and `[hidden] { display: none !important }`
//      (styles.css:124) removes them from the line — for a section whose wire carried no
//      `startedAt`/`endedAt` and no `latestInput`/`cachedInput`;
//   4. the STATE WORD, clipped to a 1px screen-reader box in every header state
//      (styles.css:3866, the `clip-path: inset(50%)` rule).
//
// All four are correct on their own and all four are server-honest. Together, on an EXPANDED
// repeat/exchange row of a run that recorded no stamps, no usage and no task text, they leave
// ZERO readable figures: the "empty in total" row. Two of them were also unreachable by any
// amount of label work — the tile had no way to know the run had nothing to print.
//
// WHAT THIS FILE PINS, against the SHIPPED stylesheet so the answer is measured in jsdom and not
// mirrored here (same device as ./turns-thread-repeat-labels.test.ts:78):
//
//   F1 (U1, U2) no row renders without a figure a reader can see. For every row state this board
//      can build — card, in-tile exchange, cross-tile repeat, collapsed, expanded — the header
//      carries at least one of: its conversation code, its task line, a real measurement figure,
//      or its STATE WORD. The state word is the new figure of last resort, and it is legal
//      precisely because `TurnSection.state` is the one measurement the wire ALWAYS carries:
//      `ui/turns.ts` marks a row `data-figures='none'` when both labels are hidden and
//      styles.css answers by un-clipping the word. NOTHING is invented: no `0ms`, no `0` tokens,
//      no fabricated duration.
//   F2 the deliberate design still holds where it was designed to: a row that DOES have figures
//      keeps its repeated code withdrawn and its state word clipped, one readable copy per
//      conversation, and a row whose body really does render the task still hides the header
//      preview when expanded.
//   F3 (U4) an EXPANDED card with nothing recorded — `context: []`, `nodes: []`, no tail block —
//      reads as "nothing recorded", not as a broken render: its strip says `no recorded context`
//      and that caption is on screen, while the header carries the task line and the state word.
//   F4 (U3) a compiled row states the REAL task text when the tile's own record names the
//      spawning call: the parent section's `delegate` / `threadFork` `DisplayStep` carries the
//      brief in `argsPreview`, which is the same evidence the raw plane already reads
//      (`delegateOf`, turns.ts:8026). It is attributed only when the pairing is PROVEN — one
//      same-agent child with one matching call, or the call's recorded RESULT naming this child's
//      `invocationId`/`threadId`/`branchId` as a complete id (`stepNamesId`, turns.ts:1995) — and
//      every looser shape keeps the pinned literal `delegated task`. F10 (R10.4) removed the
//      "equal counts, pair by position" third case; see the F4 group for the measurements.
//   F5 the stylesheet contract behind all of it: the three new rules exist, use `visibility` /
//      `display` (never the `hidden` attribute, never a collapse that would knock the columns
//      out of line), and the pre-existing rules the other files pin are byte-intact.
//
// Run: yarn vitest run --config src/frontend/vitest.config.ts ui/turns-thread-empty-rows.test.ts

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ContextBlock, DisplayNode, DisplayStep, TurnSection, TurnSummary } from '../../shared/turn-display';
import type { SessionView } from '../../server/protocol';
import { createTurnBoard, type TurnBoard } from './turns';
import type { SessionThreadEntry } from './threads';

const T = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// The shipped stylesheet, injected for the whole file. jsdom parses and applies it, so
// `getComputedStyle` answers "what can a reader actually see" instead of this file restating
// the rules — the same reason ./turns-thread-repeat-labels.test.ts refuses a mirrored selector.
// ---------------------------------------------------------------------------

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
// Fixtures. The reported shape is a persistent conversation whose runs recorded NO stamps and
// NO usage, with NO roster transcript preview — which is exactly how an Instruct session ends
// up with a row that has nothing to print. `bare` is that shape; `figure` is the same section
// as a normal run, and it is what keeps F2 honest.
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

/** One recorded `delegate` / `threadFork` call — a `DisplayStep` IS a display node
 *  (../../shared/turn-display.ts:921), which is why the tile can read it off `section.nodes`.
 *  `preview` is the call's recorded RESULT summary (../shared/turn-display.ts `DisplayStep.preview`,
 *  bounded by `DISPLAY_NODE_PREVIEW_CHARS`): since F10/R10.4 it is the ONLY figure that can prove
 *  WHICH child a call spawned, so a test that wants a pairing to be accepted must put the child's
 *  `invocationId`/`threadId`/`branchId` in it. Absent = "the result said nothing about the child",
 *  which is the honest miss (a guardrail rejection, or a preview that bounded the id away). */
const call = (sectionId: string, id: string, name: string, argsPreview: string, preview?: string): DisplayStep =>
    ({
        kind: 'tool',
        id,
        turnId: sectionId.split(':')[0] as string,
        sectionId,
        callId: `call-${id}`,
        name,
        argsPreview,
        ...(preview === undefined ? {} : { preview }),
        state: 'ok',
        detail: { stepId: id, resultStepId: id, hasResult: true, truncated: preview === undefined ? false : true }
    }) as DisplayStep;

const section = (overrides: Partial<TurnSection> & { id: string }): TurnSection =>
    ({
        rank: 'B',
        agent: 'workspace',
        agentLabel: 'RH1',
        state: 'done',
        nodes: [],
        // A RUN AS THE SERVER RECORDS IT: clocks and one request's context. Absent in `bare`.
        startedAt: T,
        endedAt: T + 900,
        latestInput: 1_200,
        cachedInput: 300,
        ...overrides
    }) as TurnSection;

// A section in the reported state: the wire names no clock and no usage for it.
const bare = (overrides: Partial<TurnSection> & { id: string }): TurnSection =>
    section({ startedAt: undefined, endedAt: undefined, latestInput: undefined, cachedInput: undefined, ...overrides });

// The turn's own flow. `nodes` lets a test put the spawning call in the parent, where the
// compiled plane looks for it (F4).
const root = (turnId: string, nodes: DisplayNode[] = [answer(`${turnId}0`, `${turnId} prose`)]): TurnSection =>
    section({
        id: `${turnId}:0`,
        rank: 'A',
        agent: 'instruct',
        agentLabel: 'IT1',
        threadId: 'th-instruct',
        invocationId: `inv-it1-${turnId}`,
        threadLabel: 'IT1',
        context: [block(`${turnId}:0`, `${turnId}0-tool-7`)],
        nodes
    });

// One RUN of the persistent conversation `th-we7`. No roster in these fixtures claims it, which
// is the documented way a row loses its task text (`createThread`'s `input`).
const weRun = (turnId: string, invocation: string, overrides: Partial<TurnSection> = {}): TurnSection =>
    section({
        id: `${turnId}:1`,
        agent: 'workspace',
        agentLabel: 'WE7',
        threadId: 'th-we7',
        invocationId: invocation,
        parentSectionId: `${turnId}:0`,
        context: [block(`${turnId}:1`, `${turnId}1-tool-4`)],
        nodes: [answer(`${turnId}1`, 'run text')],
        ...overrides
    });

const summary = (id: string, index: number): TurnSummary =>
    ({
        id,
        index,
        prompt: 'run the audit',
        status: 'done',
        state: 'done',
        threadId: 'th-instruct',
        threadLabel: 'IT1',
        updatedAt: T + 400_000,
        sectionCount: 2,
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
        turns: Object.keys(documents).map((id, index) => summary(id, index)),
        displays: Object.fromEntries(
            Object.entries(documents).map(([id, sections]) => [id, { turnId: id, sections }])
        )
    }) as unknown as SessionView;

// The cross-tile REPEAT: one conversation running in an earlier turn and in a later one, both
// runs bare. The second tile's card is the row styles.css:3640 withdraws the code from. Each
// turn is its own builder because the "already open when the earlier tile arrives" sequence needs
// to render tile 2 on its own first.
const T1_BARE = (): TurnSection[] => [
    root('t1'),
    bare({ id: 't1:1', threadId: 'th-we7', invocationId: 'inv-we7-1', agentLabel: 'WE7', parentSectionId: 't1:0' })
];

const T2_BARE = (): TurnSection[] => [
    root('t2'),
    bare({ id: 't2:1', threadId: 'th-we7', invocationId: 'inv-we7-2', agentLabel: 'WE7', parentSectionId: 't2:0' })
];

const REPEAT_BARE = (): Record<string, TurnSection[]> => ({ t1: T1_BARE(), t2: T2_BARE() });

// One run of the conversation `th-rr1` inside ONE turn. The FIRST run is the tile's card; the
// reply-run carries NO `parentSectionId` (../harness.ts spawns a `threadSend` reply-run without
// one), which is what makes the tile elect it as that card's exchange. `figure` picks between the
// run the wire timed and counted and the reported run that has neither.
const rrRun = (id: string, invocation: string, figure: boolean): TurnSection => {
    const shape = {
        id,
        agent: 'research',
        agentLabel: 'RR1',
        threadId: 'th-rr1',
        invocationId: invocation,
        ...(id.endsWith(':1') ? { parentSectionId: 't1:0' } : {}),
        context: [block('t1:1', '1-tool-4')],
        nodes: [answer(id === 't1:1' ? '1' : '2', id === 't1:1' ? 'first run' : 'reply run')]
    } as Partial<TurnSection> & { id: string };

    return (figure ? section : bare)(shape);
};

const EXCHANGE_BARE = (): Record<string, TurnSection[]> => ({
    t1: [root('t1'), rrRun('t1:1', 'inv-rr1', false), rrRun('t1:2', 'inv-rr1-b', false)]
});

const EXCHANGE_FIGURES = (): Record<string, TurnSection[]> => ({
    t1: [root('t1'), rrRun('t1:1', 'inv-rr1', true), rrRun('t1:2', 'inv-rr1-b', true)]
});

const mount = (sessionId = 's1'): TurnBoard => {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const board = createTurnBoard({ empty });
    board.bindSession(sessionId);
    document.body.replaceChildren(board.element);

    return board;
};

/** One authoritative document, the way `main.ts` routes it: `reconcileView`, then flush. */
const render = (board: TurnBoard, view: SessionView): void => {
    for (const handle of board.reconcileView(view)) handle.flush();
};

// ---------------------------------------------------------------------------
// Readers. Every one of them is a QUESTION A READER COULD ASK, answered through the browser
// engine rather than through a mirror of the stylesheet.
//
// `painted` is the whole point of this file: a figure is on screen when it has text AND
// `visibility` is not hidden AND `display` is not none AND it is not clipped into a 1px box.
// The clip case cannot be read through `visibility` at all — the base rule hides the state word
// with `clip-path: inset(50%)` + `width: 1px` (styles.css:3866), which is the standard
// visually-hidden pattern and leaves both `visibility` and `display` at their visible values —
// so `width` and `clip-path` are read as well.
// ---------------------------------------------------------------------------

const painted = (node: HTMLElement | null | undefined): boolean => {
    if (node === null || node === undefined || node.hidden) return false;

    const style = getComputedStyle(node);

    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    // The visually-hidden box: 1px wide, clipped down the middle. `width` is the figure jsdom
    // answers reliably for a stylesheet-declared length; `clip-path` is read as well so a
    // future rule that hides with the clip alone still fails this reader.
    if (style.width === '1px') return false;
    if (style.clipPath.includes('inset(50%')) return false;

    return (node.textContent ?? '').trim().length > 0;
};

const rows = (board: TurnBoard): HTMLElement[] => [...board.element.querySelectorAll<HTMLElement>('.thread-row')];

const rowOf = (board: TurnBoard, sectionId: string): HTMLElement => {
    const row = rows(board).find((candidate) => candidate.dataset.threadId === sectionId);

    if (row === undefined) throw new Error(`no row for ${sectionId}`);

    return row;
};

const press = (row: HTMLElement): void => {
    row.querySelector<HTMLElement>(':scope > .thread-tile > .thread-select')?.click();
};

// The four figures a header can show, addressed the way the stylesheet addresses them.
const headerFigures = (row: HTMLElement): {
    code: boolean;
    task: boolean;
    figures: boolean;
    state: boolean;
    taskText: string;
} => {
    const name = row.querySelector<HTMLElement>(':scope > .thread-tile > .thread-select > .thread-name');
    const preview = row.querySelector<HTMLElement>(':scope > .thread-tile > .thread-select > .thread-preview');
    const elapsed = row.querySelector<HTMLElement>(':scope > .thread-tile > .thread-select > .thread-top > .thread-elapsed');
    const tokens = row.querySelector<HTMLElement>(':scope > .thread-tile > .thread-select > .thread-top > .thread-tokens');
    const status = row.querySelector<HTMLElement>(
        ':scope > .thread-tile > .thread-select > .thread-top > .thread-status > .thread-status-text'
    );

    return {
        code: painted(name),
        task: painted(preview),
        figures: painted(elapsed) || painted(tokens),
        state: painted(status),
        taskText: preview?.textContent ?? ''
    };
};

// The F1 invariant, in one readable assertion: a row that renders must render SOMETHING.
const readableFigureCount = (row: HTMLElement): number => {
    const figures = headerFigures(row);

    return Number(figures.code) + Number(figures.task) + Number(figures.figures) + Number(figures.state);
};

// The row's own honest self-report, for the assertions that need the marker itself.
const markersOf = (row: HTMLElement): Record<string, string | undefined> => ({
    figures: row.dataset.figures,
    preview: row.dataset.threadPreview,
    repeat: row.dataset.threadRepeat,
    exchange: row.dataset.threadExchange,
    card: row.dataset.threadCard
});

const bodyDisplay = (row: HTMLElement): string => {
    const body = row.querySelector<HTMLElement>(':scope > .thread-tile > .thread-body');

    return body === null ? 'missing' : getComputedStyle(body).display;
};

// The stylesheet block for one selector, comments stripped so the rationale written beside a
// rule cannot satisfy a "this property is absent" assertion.
const rulesOf = (selector: string): string => {
    const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const found = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter((match) => match[1].includes(selector))
        .map((match) => match[2]);

    expect(found.length, `no rule for ${selector}`).toBeGreaterThan(0);

    return found.join('\n');
};

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('F1 — no row renders without a figure a reader can see (U1, U2)', () => {
    it('states the honest figure state on a row the wire gave no clock and no tally', () => {
        const board = mount();
        render(board, viewOf(REPEAT_BARE()));

        // The marker is what makes the rest testable, and it is a STATE, not a guess: the
        // labels are `[hidden]`, so the measurement line paints nothing (`turns.ts`
        // `createBlockMeta` reports the pair after every paint).
        expect(markersOf(rowOf(board, 't1:1'))).toMatchObject({ figures: 'none' });
        expect(markersOf(rowOf(board, 't2:1'))).toMatchObject({ figures: 'none' });

        // Both labels are still `[hidden]` — the fix never fabricates a figure.
        const row = rowOf(board, 't1:1');

        expect(row.querySelector<HTMLElement>('.thread-elapsed')?.hidden).toBe(true);
        expect(row.querySelector<HTMLElement>('.thread-tokens')?.hidden).toBe(true);
        expect(row.querySelector<HTMLElement>('.thread-elapsed')?.textContent).toBe('');
        expect(row.querySelector<HTMLElement>('.thread-tokens')?.textContent).toBe('');
    });

    it('a repeat row and an open no-figure row both still render figures a reader can see', () => {
        const board = mount();

        // Tile 2 arrives first (the lazy plane's "load older" prepends the tile a reader has
        // never seen). Its run is this conversation's only card here, so the press opens it — the
        // state the defect is about: OPEN, no clock, no tally, no task text of its own.
        render(board, viewOf({ t2: T2_BARE() }));

        const opened = rowOf(board, 't2:1');

        press(opened);

        expect(opened.className).toContain('is-expanded');
        expect(markersOf(opened)).toMatchObject({ card: 'th-we7', figures: 'none' });
        expect(headerFigures(opened)).toEqual({
            code: true,
            task: true,
            figures: false,
            state: true,
            taskText: 'delegated task'
        });

        // The older turn then arrives by its OWN `turn` frame — `applyViewOps` is the one place a
        // card that appeared mid-stream re-derives the session-wide code rule (turns.ts:12053-12056,
        // R6), and the tile already on screen is not rebuilt, so its row keeps its expansion.
        const applied = board.applyViewOps('t1', [{ op: 'turn', turnId: 't1', summary: summary('t1', 0) }], viewOf(REPEAT_BARE()));

        expect(applied).toBe(true);

        // R6's documented ranking is the board's turn ARRAY, and an ops `turn` upsert APPENDS:
        // until the next snapshot heals it, the run that arrived first holds the code. So the
        // older tile's row is the one marked `data-thread-repeat` here.
        const late = rowOf(board, 't1:1');

        expect(markersOf(late)).toMatchObject({ repeat: '', figures: 'none' });
        expect(rowOf(board, 't2:1').className).toContain('is-expanded');

        // The marked row, COLLAPSED: the task line plus the state word carry it.
        expect(headerFigures(late)).toEqual({
            code: false,
            task: true,
            figures: false,
            state: true,
            taskText: 'delegated task'
        });

        // The open row keeps its code: with no clock and no tally, the code is the only identity
        // the row has, and F1 (never an empty row) outranks one-copy-per-conversation for as long
        // as the row states `data-figures='none'`. That is the whole point of Rule C, and it is
        // why the copy count here is measured rather than assumed.
        expect(rowOf(board, 't2:1').querySelector<HTMLElement>('.thread-name')?.textContent).toBe('WE7');

        // The snapshot heal: a full re-render puts the turns back in RECORDED order, so the
        // later tile loses the code and every row is rebuilt collapsed. Both rows are still
        // legible, and one readable `WE7` is back.
        render(board, viewOf(REPEAT_BARE()));

        expect(rowOf(board, 't2:1').dataset.threadRepeat).toBe('');
        expect(painted(rowOf(board, 't1:1').querySelector<HTMLElement>('.thread-name'))).toBe(true);
        expect(painted(rowOf(board, 't2:1').querySelector<HTMLElement>('.thread-name'))).toBe(false);

        for (const row of rows(board)) expect(readableFigureCount(row)).toBeGreaterThan(0);
    });

    it('an in-tile exchange that is EXPANDED keeps its code, its task line and its state word', () => {
        const board = mount();
        render(board, viewOf(EXCHANGE_BARE()));

        const exchange = rowOf(board, 't1:2');

        expect(markersOf(exchange)).toMatchObject({ exchange: 'th-rr1', figures: 'none' });

        expect(headerFigures(exchange)).toEqual({
            code: false,
            task: true,
            figures: false,
            state: true,
            taskText: 'delegated task'
        });

        press(exchange);

        expect(headerFigures(exchange)).toEqual({
            code: true,
            task: true,
            figures: false,
            state: true,
            taskText: 'delegated task'
        });
    });

    it('every row this board builds renders at least one header figure', () => {
        // The invariant as an EXACT projection, not a `> 0` sweep: each row's readable-figure
        // count, in document order. `3` = its own code + the task line + the state word; `2` =
        // the task line + the state word, with the code withdrawn because another card prints it.
        const repeat = mount();

        render(repeat, viewOf(REPEAT_BARE()));

        expect(
            rows(repeat).map((row) => [row.dataset.threadId, readableFigureCount(row)] as const)
        ).toEqual([
            ['t1:1', 3],
            ['t2:1', 2]
        ]);

        const exchange = mount();

        render(exchange, viewOf(EXCHANGE_BARE()));

        expect(
            rows(exchange).map((row) => [row.dataset.threadId, readableFigureCount(row)] as const)
        ).toEqual([
            ['t1:1', 3],
            ['t1:2', 2]
        ]);

        // Expanded, both rows of the in-tile pair: the card's body has no task block either, so
        // neither row loses its header line, and the exchange's code is back because it has no
        // figures. (The cross-tile repeat cannot be opened by its own press — R8 — so its open
        // state is the exchange shape above, which the test below measures through a real press.)
        for (const row of rows(exchange)) press(row);

        expect(
            rows(exchange).map((row) => [row.dataset.threadId, readableFigureCount(row)] as const)
        ).toEqual([
            ['t1:1', 3],
            ['t1:2', 3]
        ]);
    });

    it('a row with real figures states them and stays honest about the pair', () => {
        const board = mount();

        render(
            board,
            viewOf({
                t1: [root('t1'), weRun('t1', 'inv-we7-1', { startedAt: T, endedAt: T + 1_800, latestInput: 35_736, cachedInput: 319_929 })]
            })
        );

        const row = rowOf(board, 't1:1');

        expect(row.dataset.figures).toBe('shown');
        expect(painted(row.querySelector<HTMLElement>('.thread-elapsed'))).toBe(true);
        expect(painted(row.querySelector<HTMLElement>('.thread-tokens'))).toBe(true);
        expect(headerFigures(row)).toEqual({
            code: true,
            task: true,
            figures: true,
            // A row WITH figures keeps the design the shipped stylesheet asks for: the word is a
            // screen-reader label and the two figures carry the line.
            state: false,
            taskText: 'delegated task'
        });
    });
});

describe('F2 — the one-code-per-conversation design still holds where it was designed to (U1)', () => {
    it('a figure-bearing exchange row keeps its code withdrawn, collapsed AND expanded', () => {
        const board = mount();

        // The same two runs as `EXCHANGE_BARE`, but recorded with clocks and usage: the shape the
        // withdrawal rules were written for.
        render(board, viewOf(EXCHANGE_FIGURES()));

        const card = rowOf(board, 't1:1');
        const exchange = rowOf(board, 't1:2');

        expect(markersOf(exchange)).toMatchObject({ exchange: 'th-rr1', figures: 'shown' });
        expect(painted(card.querySelector<HTMLElement>('.thread-name'))).toBe(true);
        expect(painted(exchange.querySelector<HTMLElement>('.thread-name'))).toBe(false);

        // An exchange row's press DOES open it inline (`turns.ts:6252`), so this is the state
        // Rule C could switch on — and it must not, because this row prints a clock and a tally.
        press(exchange);

        expect(exchange.className).toContain('is-expanded');
        expect(painted(exchange.querySelector<HTMLElement>('.thread-name'))).toBe(false);
        expect(painted(exchange.querySelector<HTMLElement>('.thread-preview'))).toBe(true);
        expect(headerFigures(exchange)).toEqual({
            code: false,
            task: true,
            figures: true,
            state: false,
            taskText: 'delegated task'
        });
    });

    it('a cross-tile repeat row keeps its code withdrawn while the card above prints it', () => {
        const board = mount();

        render(
            board,
            viewOf({
                t1: [root('t1'), weRun('t1', 'inv-we7-1')],
                t2: [root('t2'), weRun('t2', 'inv-we7-2')]
            })
        );

        const card = rowOf(board, 't1:1');
        const repeat = rowOf(board, 't2:1');

        expect(repeat.dataset.threadRepeat).toBe('');
        expect(painted(card.querySelector<HTMLElement>('.thread-name'))).toBe(true);
        expect(painted(repeat.querySelector<HTMLElement>('.thread-name'))).toBe(false);

        // A repeat row's own press steers the card above it (R8 of
        // ./turns-thread-repeat-labels.test.ts) rather than opening itself, so a repeat row is
        // normally read collapsed — and with figures on it, nothing about the withdrawal changes.
        press(repeat);

        expect(painted(rowOf(board, 't1:1').querySelector<HTMLElement>('.thread-name'))).toBe(true);
        expect(painted(repeat.querySelector<HTMLElement>('.thread-name'))).toBe(false);
        expect(headerFigures(repeat)).toEqual({
            code: false,
            task: true,
            figures: true,
            state: false,
            taskText: 'delegated task'
        });
    });

    it('a row whose body really does render the task still hides the header line when expanded', () => {
        const board = mount();

        // A roster preview is the server's own bounded task text: `createThread` then renders the
        // task as Markdown in the body, and the duplication rule keeps governing.
        const roster: SessionThreadEntry[] = [
            {
                id: 'th-we7',
                agent: 'workspace',
                origin: 'host',
                status: 'idle',
                sequence: 7,
                label: 'WE7',
                invocationId: 'inv-we7-1',
                preview: 'Summarise the notes under notes/ and report the risks.'
            }
        ] as SessionThreadEntry[];

        board.setThreads(roster);
        render(board, viewOf({ t1: [root('t1'), weRun('t1', 'inv-we7-1')] }));

        const row = rowOf(board, 't1:1');

        expect(row.dataset.threadPreview).toBeUndefined();
        expect(row.querySelector<HTMLElement>('.thread-prompt')?.textContent).toContain('Summarise the notes');
        expect(painted(row.querySelector<HTMLElement>('.thread-preview'))).toBe(true);

        press(row);

        // The body shows the task in full, so the header line goes — that is the rule the fix
        // must not break, and the marker is what distinguishes it from the content-less case.
        expect(painted(row.querySelector<HTMLElement>('.thread-preview'))).toBe(false);
        expect(painted(row.querySelector<HTMLElement>('.thread-prompt'))).toBe(true);
        expect(row.dataset.figures).toBe('shown');
        // …and the row is still not empty: it has its code and its figures.
        expect(headerFigures(row)).toEqual({ code: true, task: false, figures: true, state: false, taskText: 'Summarise the notes under notes/ and report the risks.' });
    });
});

describe('F3 — an expanded content-less card reads as "nothing recorded", not as a broken render (U4)', () => {
    it('shows the honest strip caption while the header still carries identity', () => {
        const board = mount();

        // The content-less shape: the server states the section HAS no context (`context: []`,
        // authoritative) and it recorded no blocks at all.
        render(
            board,
            viewOf({
                t1: [root('t1'), bare({ id: 't1:1', threadId: 'th-we7', invocationId: 'inv-we7-1', context: [], nodes: [] })]
            })
        );

        const row = rowOf(board, 't1:1');

        press(row);

        expect(bodyDisplay(row)).toBe('flex');

        // The strip's own affordance (the wording is pinned by ./context-bar.test.ts:540 and
        // ../view-context.test.ts:542, and this file does not restate it): a dashed "nothing
        // recorded" box with a visible caption, not an empty band.
        const caption = row.querySelector<HTMLElement>('.context-bar-caption');

        expect(caption?.textContent).toBe('no recorded context');
        expect(painted(caption)).toBe(true);
        expect(row.querySelector<HTMLElement>('.context-bar-host')?.hidden).toBe(false);

        // And the header that sits above it: the task line plus the state word, so the card
        // never reads as a card whose content failed to render.
        expect(headerFigures(row)).toEqual({
            code: true,
            task: true,
            figures: false,
            state: true,
            taskText: 'delegated task'
        });

        // The toolbar is the other affordance an open card owns, and it is painted.
        expect(row.querySelector('button.thread-delete')).not.toBeNull();
    });
});

describe('F4 — the spawning call names the task when the tile holds it (U3)', () => {
    const delegated = (argsPreview: string): DisplayNode[] => [
        answer('t10', 't1 prose'),
        call('t1:0', '7', 'delegate', argsPreview)
    ];

    // A child run of THIS turn, recorded bare and with nothing in its own body — the row the
    // defect is about. `parentSectionId` is what lets the tile read the spawning call out of the
    // parent's recorded nodes (../shared/turn-display.ts `TurnSection.parentSectionId`).
    const child = (id: string, overrides: Partial<TurnSection> = {}): TurnSection =>
        bare({ id, parentSectionId: 't1:0', context: [], nodes: [], ...overrides });

    it('states the brief the parent recorded, instead of the placeholder', () => {
        const board = mount();

        render(
            board,
            viewOf({
                t1: [
                    root('t1', delegated('{"agent":"workspace","input":"Read notes/meeting.md and list every decision."}')),
                    child('t1:1', { agent: 'workspace', threadId: 'th-we7', invocationId: 'inv-we7-1' })
                ]
            })
        );

        const row = rowOf(board, 't1:1');

        // The row says what the run was asked to do — recorded text from the parent's own call,
        // and the `data-thread-preview` marker stays set so styles.css keeps the line visible
        // while the row is expanded (the body has no prose to duplicate).
        expect(row.querySelector<HTMLElement>('.thread-preview')?.textContent).toBe(
            'Read notes/meeting.md and list every decision.'
        );
        expect(row.dataset.threadPreview).toBe('true');

        press(row);

        expect(painted(row.querySelector<HTMLElement>('.thread-preview'))).toBe(true);
        expect(row.querySelector('.thread-prompt')).toBeNull();
    });

    it('recovers the brief from a bounded argument preview that is not valid JSON', () => {
        const board = mount();

        // `previewArguments` bounds `argsPreview` at 200 characters
        // (../../../underload/harness/src/server/turn-projector.ts), so a real brief usually
        // arrives as TRUNCATED JSON — the field scan reads the recorded prefix rather than
        // failing the parse and printing nothing.
        render(
            board,
            viewOf({
                t1: [
                    root('t1', delegated('{"agent":"workspace","input":"Audit every file under Temp and report the three biggest')),
                    child('t1:1', { agent: 'workspace', threadId: 'th-we7', invocationId: 'inv-we7-1' })
                ]
            })
        );

        expect(rowOf(board, 't1:1').querySelector<HTMLElement>('.thread-preview')?.textContent).toBe(
            'Audit every file under Temp and report the three biggest'
        );
    });

    it('names a forked branch by the task the fork call carries', () => {
        const board = mount();

        render(
            board,
            viewOf({
                t1: [
                    root('t1', [
                        answer('t10', 't1 prose'),
                        call('t1:0', '9', 'threadFork', '{"input":"Fork and audit the branch, then summarise.","label":"audit"}')
                    ]),
                    child('t1:1', {
                        agent: 'instruct',
                        threadId: 'th-we7',
                        invocationId: 'inv-we7-1',
                        branchId: 'branch-1'
                    })
                ]
            })
        );

        expect(rowOf(board, 't1:1').querySelector<HTMLElement>('.thread-preview')?.textContent).toBe(
            'Fork and audit the branch, then summarise.'
        );
    });

    // F10 (2026-11-26, R10.4) — the four shapes below REPLACE the rule "equal counts, pair
    // position with position", which the operator's own session showed was not a pairing at all.
    // Measured on `Temp/agenttools/snapshot/session.json`, turn `caaa372e…`
    // (`Temp/fix-f10/probe-stepjoin2.ts`, `Temp/fix-f10/probe-stepjoin3.ts`):
    //   - the ROOT section holds 34 recorded calls while one agent has 7 same-agent children, so
    //     "equal counts" almost never holds, and where it did, it paired a run with a call that
    //     had rejected a DIFFERENT child (its result was a guardrail failure naming no id);
    //   - `TurnSection` is allocated in the projector's ARRIVAL order, which for reply-runs and
    //     forks is not the order the parent made its calls, so position-with-position swapped
    //     briefs between siblings even when the counts matched.
    // The shipped rule therefore accepts a call only when the ONE figure the wire actually
    // carries proves the spawn: the call's recorded result names this child's id
    // (`turns.ts:1995` `stepNamesId`), or the pairing is forced by singleness. The projector resolves
    // the same join through the call id (`../../../underload/harness/src/server/turn-projector.ts`
    // `createChild`), but `TurnSection` has no `callId` on the frozen wire, so a client cannot.
    it('pairs each brief by the result that names its child, never by position', () => {
        const board = mount();

        // The anti-position fixture: the CALLS are recorded in one order, the SECTIONS in the
        // other. Positional pairing would have hung `inv-a`'s brief above `inv-b`'s run; the id
        // join cannot, because each result names exactly one child.
        render(
            board,
            viewOf({
                t1: [
                    root('t1', [
                        answer('t10', 't1 prose'),
                        call(
                            't1:0',
                            '7',
                            'delegate',
                            '{"agent":"workspace","input":"First brief: read the notes."}',
                            '{"agent":"workspace","content":"","invocationId":"inv-a","threadId":"th-a"}'
                        ),
                        call(
                            't1:0',
                            '9',
                            'delegate',
                            '{"agent":"workspace","input":"Second brief: read the logs."}',
                            '{"agent":"workspace","content":"","invocationId":"inv-b","threadId":"th-b"}'
                        )
                    ]),
                    child('t1:1', { agent: 'workspace', threadId: 'th-b', invocationId: 'inv-b' }),
                    child('t1:2', { agent: 'workspace', threadId: 'th-a', invocationId: 'inv-a' })
                ]
            })
        );

        expect(rowOf(board, 't1:1').querySelector<HTMLElement>('.thread-preview')?.textContent).toBe(
            'Second brief: read the logs.'
        );
        expect(rowOf(board, 't1:2').querySelector<HTMLElement>('.thread-preview')?.textContent).toBe(
            'First brief: read the notes.'
        );
    });

    it('states nothing when the recorded results name no child at all', () => {
        const board = mount();

        // The measured common case: both calls settled on a GUARDRAIL rejection
        // (`Tool "delegate" failed: …`), which names no run, so nothing proves which child (if
        // any) they spawned. The old rule printed a confident brief on both rows; the shipped
        // rule prints the honest placeholder, because a wrong brief beside a run is worse.
        const rejected = 'Tool "delegate" failed: instruct holds Rank A and cannot delegate to "workspace" (Rank A).';

        render(
            board,
            viewOf({
                t1: [
                    root('t1', [
                        answer('t10', 't1 prose'),
                        call('t1:0', '7', 'delegate', '{"agent":"workspace","input":"First brief: read the notes."}', rejected),
                        call('t1:0', '9', 'delegate', '{"agent":"workspace","input":"Second brief: read the logs."}', rejected)
                    ]),
                    child('t1:1', { agent: 'workspace', threadId: 'th-a', invocationId: 'inv-a' }),
                    child('t1:2', { agent: 'workspace', threadId: 'th-b', invocationId: 'inv-b' })
                ]
            })
        );

        expect(rowOf(board, 't1:1').querySelector<HTMLElement>('.thread-preview')?.textContent).toBe('delegated task');
        expect(rowOf(board, 't1:2').querySelector<HTMLElement>('.thread-preview')?.textContent).toBe('delegated task');
    });

    it('refuses the pairing when two calls name the same child', () => {
        const board = mount();

        // `agent:debugger` on the operator's session: TWO delegations into ONE persistent
        // conversation, so both results carry `"threadId":"agent:debugger"`. The shared
        // conversation id is not a per-child key, and choosing between the two callers is the
        // coin flip the rule forbids.
        const shared = '{"agent":"debugger","content":"PONG","threadId":"agent:debugger","invocationId":"inv-d"}';

        render(
            board,
            viewOf({
                t1: [
                    root('t1', [
                        answer('t10', 't1 prose'),
                        call('t1:0', '7', 'delegate', '{"agent":"debugger","input":"First debugger brief."}', shared),
                        call('t1:0', '9', 'delegate', '{"agent":"debugger","input":"Second debugger brief."}', shared)
                    ]),
                    child('t1:1', { agent: 'debugger', threadId: 'agent:debugger', invocationId: 'inv-d' })
                ]
            })
        );

        expect(rowOf(board, 't1:1').querySelector<HTMLElement>('.thread-preview')?.textContent).toBe('delegated task');
    });

    it('will not read a short id out of a longer one', () => {
        const board = mount();

        // Runtime invocation ids are short numeric-ish strings, so `includes` is worthless: the
        // first result names `thread-68` and `"invocationId":"168"`, NEITHER of which is the child
        // `inv-6`/`th-6`, and a substring test would have paired them. `stepNamesId`
        // (turns.ts:1995, used by `delegationTaskOf` at :9405 — the join itself is :9480) requires the id delimited by
        // non-id characters — which is also what makes `"invocationId":"68"` a proof for the run
        // the operator's session recorded as `68`. The second call is the only proven one, so it
        // is the only brief that may print (with ONE call the forced-singleness rule still wins,
        // which the "states the brief the parent recorded" case above pins).
        render(
            board,
            viewOf({
                t1: [
                    root('t1', [
                        answer('t10', 't1 prose'),
                        call(
                            't1:0',
                            '7',
                            'delegate',
                            '{"agent":"workspace","input":"Brief that belongs to another run."}',
                            '{"agent":"workspace","threadId":"thread-68","invocationId":"168"}'
                        ),
                        call(
                            't1:0',
                            '9',
                            'delegate',
                            '{"agent":"workspace","input":"The brief this run was actually given."}',
                            '{"agent":"workspace","threadId":"th-6","invocationId":"inv-6"}'
                        )
                    ]),
                    child('t1:1', { agent: 'workspace', threadId: 'th-6', invocationId: 'inv-6' })
                ]
            })
        );

        expect(rowOf(board, 't1:1').querySelector<HTMLElement>('.thread-preview')?.textContent).toBe(
            'The brief this run was actually given.'
        );
    });

    it('keeps the literal whenever the attribution would be a guess', () => {
        // Two recorded briefs, ONE child row: which call spawned it is not in the data.
        const ambiguous = mount();

        render(
            ambiguous,
            viewOf({
                t1: [
                    root('t1', [
                        answer('t10', 't1 prose'),
                        call('t1:0', '7', 'delegate', '{"agent":"workspace","input":"First brief."}'),
                        call('t1:0', '9', 'delegate', '{"agent":"workspace","input":"Second brief."}')
                    ]),
                    child('t1:1', { agent: 'workspace', threadId: 'th-a', invocationId: 'inv-a' })
                ]
            })
        );

        expect(rowOf(ambiguous, 't1:1').querySelector<HTMLElement>('.thread-preview')?.textContent).toBe('delegated task');

        // A call that names a DIFFERENT agent is a different sibling's spawn, never this row's.
        const mismatched = mount();

        render(
            mismatched,
            viewOf({
                t1: [
                    root('t1', delegated('{"agent":"research","input":"Somebody else\u2019s brief."}')),
                    child('t1:1', { agent: 'workspace', threadId: 'th-a', invocationId: 'inv-a' })
                ]
            })
        );

        expect(rowOf(mismatched, 't1:1').querySelector<HTMLElement>('.thread-preview')?.textContent).toBe('delegated task');

        // No call at all, and a section with no parent in this tile: the pinned literal stands.
        const literal = mount();

        render(literal, viewOf({ t1: [root('t1'), child('t1:1', { threadId: 'th-a', invocationId: 'inv-a' })] }));

        expect(rowOf(literal, 't1:1').querySelector<HTMLElement>('.thread-preview')?.textContent).toBe('delegated task');
    });

    it('never rewrites the task text the server itself supplied', () => {
        const board = mount();
        const roster: SessionThreadEntry[] = [
            {
                id: 'th-we7',
                agent: 'workspace',
                origin: 'host',
                status: 'idle',
                sequence: 7,
                label: 'WE7',
                invocationId: 'inv-we7-1',
                preview: 'The roster\u2019s own bounded preview.'
            }
        ] as SessionThreadEntry[];

        board.setThreads(roster);
        render(
            board,
            viewOf({
                t1: [
                    root('t1', delegated('{"agent":"workspace","input":"The parent\u2019s brief."}')),
                    child('t1:1', { agent: 'workspace', threadId: 'th-we7', invocationId: 'inv-we7-1' })
                ]
            })
        );

        // The roster preview is the server's figure for the conversation's task; a recovered
        // call argument never overwrites it.
        expect(rowOf(board, 't1:1').querySelector<HTMLElement>('.thread-preview')?.textContent).toBe(
            'The roster\u2019s own bounded preview.'
        );
    });
});

describe('F5 — the stylesheet contract (U1, U2, U4)', () => {
    it('un-clips the state word only for a thread row that states it has no figures', () => {
        const rules = rulesOf(".thread-row[data-figures='none'] .thread-status-text");

        expect(rules).toContain('clip-path: none');
        expect(rules).toContain('position: static');
        expect(rules).toContain('width: auto');
        // The base visually-hidden rule still governs everything else, untouched.
        expect(rulesOf(':is(.tile, .thread-tile) :is(.tile-status-text, .thread-status-text)')).toContain(
            'clip-path: inset(50%)'
        );
    });

    it('restores the withdrawn code with `visibility`, never with a layout change', () => {
        // The single-line head of the rule: `rulesOf` matches selector TEXT, and the shipped rule
        // wraps its descendant part onto the next line.
        const selector = ".thread-row.is-expanded[data-figures='none']:is([data-thread-repeat], [data-thread-exchange])";
        const rules = rulesOf(selector);

        expect(rules).toContain('visibility: visible');
        // `display`/`hidden` would collapse the row's flex slot and shift `.thread-preview` out
        // of column — the failure ./turns-thread-repeat-labels.test.ts pins as D2.
        expect(rules).not.toContain('display');

        // The withdrawal rule itself is byte-intact, so R6/R7/R8 still mean what they say.
        expect(css).toContain(
            '.thread-row[data-thread-repeat] > .thread-tile > .thread-select > .thread-name,\n' +
                '.thread-row[data-thread-exchange] > .thread-tile > .thread-select > .thread-name {\n' +
                '    visibility: hidden;\n' +
                '}'
        );
    });

    it('keeps the header task line for an expanded row whose body has no task block', () => {
        const rules = rulesOf(".thread-row.is-expanded[data-thread-preview='true'] .thread-preview");

        expect(rules).toContain('display: block');
        // The duplication rule it answers still exists exactly as ./thread-style.test.ts:125 pins it.
        expect(css).toContain('.thread-row.is-expanded .thread-preview {\n    display: none;\n}');
    });
});
