// T-C4 (2026-11-26) — THE NO-BROKEN-CHIPS MATRIX, CLIENT HALF.
//
// THE CONTRACT, stated once (the twin of the server proof in the underload package,
// @underload/harness src/server/references.test.ts 'the no-broken-chips matrix'):
//
//   EVERY CHIP THE PICKER MINTS MUST BIND AT SUBMIT.
//
// Two doors decide that on this side, and they must never disagree about a row:
//
//   1. the picker's gate      — ./references.ts `isReferenceableBlock`, what the `#` popup may
//                               offer and therefore what may ever reach
//                               `SubmitTaskRequest.references`;
//   2. the projector's summary — ../../server/turn-projector.ts `blockSummaries()`
//                               `referenceable`, the boolean the wire carries so a reader applies
//                               one flag instead of restating a status rule
//                               (harness-server.swagger.yaml `DisplayBlockSummary`).
//
// Before this fold the two doors differed by exactly the terminal statuses: the gate had
// relaxed to "a label is the address" (R-TREF) while this summary still asserted the OLD rule
// (`done || running || queued`). A board reading the summary flag would have hidden rows the
// picker happily minted — the same defect mirrored. The rule is now the ONE label parser
// (`agentLabelParts` → `AGENT_REFERENCE_LABEL_PATTERN`) on both sides, and the projector twin in
// @underload/harness (src/server/turn-projector.ts) reads the same line, so parity here is
// parity there.
//
// The status rows below are the matrix the server proof walks row by row:
//   done + content  binds (content injected)      done, no content  binds (the note)
//   error           binds (the note)              cancelled         binds (the note)
//   running         binds at enqueue, read later  queued            binds at enqueue, read later
// and the drop half — a label that is not an address — is the ONLY thing either door refuses.
//
// Run: yarn vitest run --config src/frontend/vitest.config.ts ui/turn-projector-referenceable-matrix.test.ts

import { projectTurn } from '../../server/turn-projector';
import type { SessionTurn } from '../../server/protocol';
import type { DisplayProjectContext } from '../../shared/turn-display';
import type { AgentResultBlock, AgentResultStatus } from '../../shared';
import { isReferenceableBlock } from './references';

// Every status the projection can put on a row (`AgentResultStatus`), in the order the wire
// enum lists them (harness-server.swagger.yaml `DisplayBlockSummary.status`).
const STATUSES: readonly AgentResultStatus[] = ['done', 'running', 'queued', 'error', 'cancelled'];

// A RECORDED turn, in the shape the store hands the projector on a reload. The events do not
// matter for the summary's block rows — they arrive through `blocksOf`, exactly as the store
// supplies them in production — so the record is kept minimal and the status is the one under
// test.
const recordOf = (status: SessionTurn['status']): SessionTurn =>
    ({
        id: 'turn-1',
        index: 0,
        prompt: 'the prompt',
        status,
        startedAt: 1,
        updatedAt: 2,
        events: [],
        eventTimes: []
    }) as SessionTurn;

// The summary rows the WIRE carries for one block descriptor: the store's own seam
// (`DisplayProjectContext.blocksOf`), so this is the projector's real output rather than a
// restatement of it.
const summaryBlocksOf = (block: AgentResultBlock, status: SessionTurn['status']) =>
    projectTurn(recordOf(status), { entry: 'worker', blocksOf: () => [block] } as DisplayProjectContext).summary
        .blocks;

it('marks every status the server binds as referenceable — the terminal relaxation, row by row', () => {
    // Each row of the matrix, asserted with the EXACT summary object the route ships. Before the
    // fold, the three rows below marked `false` would have hidden a row the picker offers: a
    // failed child, a run the operator stopped, and an attempt that never started.
    expect(summaryBlocksOf({ turnId: 'turn-1', label: 'WR1', agent: 'worker', status: 'done', content: 'the answer' }, 'done')).toEqual([
        { turnId: 'turn-1', label: 'WR1', agent: 'worker', status: 'done', preview: 'the answer', referenceable: true }
    ]);

    expect(
        summaryBlocksOf({ turnId: 'turn-1', label: 'WR1', agent: 'worker', status: 'error', content: 'the answer' }, 'error')
    ).toEqual([
        { turnId: 'turn-1', label: 'WR1', agent: 'worker', status: 'error', preview: 'the answer', referenceable: true }
    ]);

    expect(
        summaryBlocksOf(
            { turnId: 'turn-1', label: 'WR1', agent: 'worker', status: 'cancelled', content: 'the answer' },
            'cancelled'
        )
    ).toEqual([
        {
            turnId: 'turn-1',
            label: 'WR1',
            agent: 'worker',
            status: 'cancelled',
            preview: 'the answer',
            referenceable: true
        }
    ]);

    // The unsettled rows bind too (the server stores the binding and reads the target after it
    // settles), so they stay referenceable exactly as they were.
    expect(
        summaryBlocksOf({ turnId: 'turn-1', label: 'WR1', agent: 'worker', status: 'running', content: 'the answer' }, 'running')
    ).toEqual([
        { turnId: 'turn-1', label: 'WR1', agent: 'worker', status: 'running', preview: 'the answer', referenceable: true }
    ]);

    expect(
        summaryBlocksOf({ turnId: 'turn-1', label: 'WR1', agent: 'worker', status: 'queued', content: 'the answer' }, 'queued')
    ).toEqual([
        { turnId: 'turn-1', label: 'WR1', agent: 'worker', status: 'queued', preview: 'the answer', referenceable: true }
    ]);
});

it('marks a labelled row with NO result as referenceable, with no preview key at all', () => {
    // THE NEVER-STARTED-ATTEMPT SHAPE: a nested `delegate` attempt the runtime refused keeps its
    // ordinal (F11) and its turn's terminal status, and records no answer. The server binds it and
    // composes `referencedResultUnavailableNote`; a summary that hid it would strand the label the
    // user was told to type. Exact object equality also pins the ABSENT `preview` key — there are
    // no bytes to preview.
    expect(
        summaryBlocksOf({ turnId: 'turn-1', threadId: 'call:call_self', label: 'LD2', agent: 'lead', status: 'error' }, 'done')
    ).toEqual([
        { turnId: 'turn-1', threadId: 'call:call_self', label: 'LD2', agent: 'lead', status: 'error', referenceable: true }
    ]);
});

it('answers exactly what the picker gate answers, for every status and every label shape', () => {
    // THE INVARIANT, stated as an equality the two doors must satisfy on the SAME row: the flag a
    // reader sees is the gate's own answer. `T?` is the pre-F11 placeholder, `IT0` an ordinal the
    // grammar rejects, `branch-3` a branch identity that was never an address — the three shapes
    // that still arrive from a hand-built descriptor or an older record.
    const labels = ['WR1', 'HR12', 'T?', 'IT0', 'branch-3', ''];

    const matrix = STATUSES.map((status) => ({
        status,
        // What the wire says per label, in the order `labels` lists them.
        summary: labels.map((label) =>
            summaryBlocksOf({ turnId: 'turn-1', label, agent: 'worker', status, content: 'the answer' }, status)[0]
                .referenceable
        ),
        // What the picker would mint per label, same order.
        gate: labels.map((label) => isReferenceableBlock({ status, label }))
    }));

    for (const row of matrix) expect(row.summary, `status ${row.status}`).toEqual(row.gate);

    // The shared column, pinned EXACTLY (not derived from either door): a real ordinal is offered
    // in every status, and the three unaddressable shapes plus the empty label are refused in every
    // status. A `false` in the first three columns for a terminal status, or a `true` in the last
    // three, is a chip minted that dies at submit — or a row the user can see and never name.
    expect(matrix.map((row) => row.summary)).toEqual([
        [true, true, false, false, false, false],
        [true, true, false, false, false, false],
        [true, true, false, false, false, false],
        [true, true, false, false, false, false],
        [true, true, false, false, false, false]
    ]);
});
