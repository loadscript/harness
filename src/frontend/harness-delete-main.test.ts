// R6/R3 — per-harness delete in the left sidebar.
//
// The contracts pinned here are the ones that make a durable removal safe to expose on
// a row the reader is aiming at with the mouse:
//   - the row is a wrapper: the select button and the delete control are SIBLINGS, so
//     pressing delete can never also select the harness;
//   - confirmation is two-step (first press arms, second press starts the cascade, and a
//     control outside the row cannot leave a stale arm);
//   - the cascade is ORDERED: every page of the harness's server directory is read
//     BEFORE the first destructive request, every session is deleted one at a time
//     through the ordinary session DELETE, and the harness DELETE is sent last;
//   - a failed enumeration sends no deletes; a failed session delete stops the sequence,
//     keeps the harness row and reports the exact prefix that was removed; a 409 on the
//     final harness DELETE is surfaced, never reported as success;
//   - success removes the row and reselects another harness when the deleted one was
//     selected;
//   - an empty roster does not crash the shell, and the playground's temporary session
//     that belonged to the deleted harness is part of the same ordered cleanup;
//   - legacy orphan sessions (a harness removed outside this page) stay reachable through
//     the archived directory.
//
// Run: yarn vitest run --config src/frontend/vitest.config.ts harness-delete-main.test.ts

import type { HarnessDescriptor, SessionSnapshot, ToolDescriptor } from '../server/protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { viewAwareFetch } from './view-test-support';
import { sessionToolPage, sessionToolRow } from './session-config-test-support';

const flush = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const json = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

const descriptor = (name: string): HarnessDescriptor =>
    ({
        name,
        title: name === 'alpha' ? 'Alpha' : 'Beta',
        description: `The ${name} harness.`,
        requiresEndpoint: true,
        agents: ['instruct'],
        tools: ['read'],
        coreTools: ['toolRequest'],
        entry: 'instruct',
        ranks: { instruct: 'A' },
        builtin: true,
        editable: true
    }) as HarnessDescriptor;

const coreTool: ToolDescriptor = {
    name: 'toolRequest',
    group: 'Core tools',
    description: 'toolRequest core tool',
    tags: ['core', 'harness'],
    visibility: 'core',
    sessionBound: true,
    parameters: {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' } } },
        required: ['tags']
    }
};

const snapshot = (
    id: string,
    harness: string,
    overrides: Record<string, unknown> = {}
): SessionSnapshot =>
    ({
        id,
        harness,
        status: 'idle',
        model: 'm1',
        createdAt: 1,
        updatedAt: 2,
        messages: [],
        turns: [],
        ...overrides
    }) as SessionSnapshot;

// A recorded turn, so an archived conversation has something to render when it is
// reopened (same record shape main.test.ts uses: `status`/`events`/`eventTimes`).
const turn = (prompt: string): Record<string, unknown> => ({
    id: `t-${prompt.length}`,
    index: 0,
    prompt,
    status: 'done',
    startedAt: 1,
    updatedAt: 2,
    events: [
        {
            type: 'done',
            agent: 'instruct',
            message: { role: 'assistant', content: `Answer to ${prompt}.` }
        }
    ],
    eventTimes: [2]
});

type Call = { url: string; method: string | undefined };

// `notFoundFor` answers a DELETE with 404 (unknown harness), and `failFor` answers 500,
// so the two failure shapes of the accepted backend contract are both exercisable.
// `records` backs GET /api/sessions/:id, which is how a session is (re)opened.
const stubServer = (options: {
    presets: HarnessDescriptor[];
    tools?: ToolDescriptor[];
    sessions?: SessionSnapshot[];
    records?: Record<string, SessionSnapshot>;
    notFoundFor?: string;
    failFor?: string;
    conflictFor?: string;
    // R3: explicit paged answers for the harness-filtered directory read. The map is
    // harness -> pages of session ids; the stub issues `p1`, `p2`, … as `next_cursor`
    // so the test proves the CLIENT followed the server's cursors (and not the cache).
    directory?: Record<string, string[][]>;
    // Simulates a server/gateway that ignores `?harness=` entirely: the page still
    // answers, but every row belongs to whatever the fixture holds.
    ignoreHarnessFilter?: boolean;
    failDirectoryFor?: string;
    failSessionDeleteFor?: string;
    missingSessionFor?: string;
    holdSessionDeleteFor?: string;
    holdSessionDelete?: () => Promise<unknown>;
    holdDelete?: () => Promise<unknown>;
}): Call[] => {
    const calls: Call[] = [];
    // The fake server's MUTABLE directory. `options.sessions` is the boot document; this
    // list is what a later list/delete/create sees, so the enumeration can prove live
    // server ownership rather than a fixture that keeps repeating deleted ids.
    const live = [...(options.sessions ?? [])];

    // T45: the log is taken on the OUTSIDE of `viewAwareFetch`, i.e. it records the URL the
    // BROWSER asked for (`/v1/harness/...`, ../shared/harness-api.ts:69). On the inside, the
    // adapter rewrites every canonical route to this fixture's raw twin AND re-reads that
    // twin for its own composition answers (`hostOf`/`hostEx`, ./view-test-support.ts), so a
    // raw-side count of `/api/sessions/:id` mixes client reads with adapter reads and can no
    // longer prove "one read per open". The fixture's own routes stay declared the raw way;
    // only the recorded log — and every URL assertion below — is canonical.
    const answer = viewAwareFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method;

        if (url === '/api') {
            return json({
                rootPath: '/api',
                presets: options.presets,
                tools: options.tools ?? [],
                defaults: { baseURL: 'http://provider/v1', model: 'm1', hasApiKey: false },
                sessions: options.sessions ?? [],
                agents: []
            });
        }
        if (url === '/api/models') return json({ models: ['m1'] });

        // T4: the ⚒ pane lists the CONVERSATION's toolbox (`GET /sessions/{id}/tools`), and a
        // toolbox row carries NO argument schema (../shared/harness-api.ts `SessionToolSummary`),
        // so the runner pays the deployment's identified detail read (`GET /tools/{name}`,
        // ./api.ts `getTool`) — execution stayed deployment-scoped. Both come from the same
        // `tools` list these fixtures already state, and `sessionToolRow` gives the row the
        // contract's semantics for `protected`/`declared`/`origin`/`enabled`
        // (./session-config-test-support.ts): `protected` is the UNREGISTER axis, and R5 means the
        // pane reads only `enabled` — which these fixtures leave at the double's default (ON for a
        // registered name), because a conversation's toolbox here is a subject for the delete flow,
        // not a figure this file pins.
        const toolboxMatch = /^\/api\/sessions\/[^/]+\/tools/.exec(url);

        if (toolboxMatch !== null && method === undefined) {
            return json(
                sessionToolPage(
                    (options.tools ?? []).map((tool) =>
                        sessionToolRow({
                            name: tool.name,
                            group: tool.group,
                            description: tool.description,
                            tags: tool.tags,
                            visibility: tool.visibility,
                            enabled: tool.visibility !== 'core'
                        })
                    )
                )
            );
        }

        const toolDetail = /^\/api\/tools\/([^/?]+)$/.exec(url);

        if (toolDetail !== null && method === undefined) {
            const tool = (options.tools ?? []).find((candidate) => candidate.name === decodeURIComponent(toolDetail[1]));

            if (tool === undefined) return json({ error: { message: `Unknown tool ${toolDetail[1]}` } }, 404);

            return json({
                tool: {
                    ...tool,
                    session_bound: tool.sessionBound ?? false,
                    execution: { scope: tool.visibility === 'core' ? 'session_required' : 'global', manual: true }
                }
            });
        }

        if (url === '/api/tools/toolRequest' && method === 'POST') {
            return json({ ok: true, result: { enabled: [], tools: [], truncated: false, remaining: 0 }, durationMs: 4 });
        }
        if (url === '/api/sessions' && method === 'POST') {
            const created = snapshot('temp-1', options.presets[0].name);

            // A created session is a server record, so the filtered enumeration must see
            // it. Without this the playground cleanup would look like a special case the
            // cascade missed rather than the same ordered DELETE.
            live.push(created);
            return json({ session: created }, 201);
        }

        // R3: the harness cascade asks the SERVER for one harness's pages. The answer is
        // the canonical page shape (`items` + `next_cursor`), so `viewAwareFetch` passes it
        // through unchanged. `directory` names explicit pages for the paging tests; without
        // it the fixture's live sessions for that harness are one page, which is all the
        // single-page tests need.
        //
        // ONLY a harness-filtered read is declared here. Unfiltered directory reads stay
        // undeclared so the adapter composes them from the boot document exactly as it did
        // before this stub grew a route (declaring the bare `/sessions` read was enough to
        // make the boot directory empty).
        if (method === undefined && url.startsWith('/api/sessions?')) {
            const query = new URLSearchParams(url.slice(url.indexOf('?') + 1));
            const harness = query.get('harness');

            if (harness !== null) {
                if (harness === options.failDirectoryFor) {
                    return json({ error: { message: 'The session index is unavailable.' } }, 500);
                }

                if (options.ignoreHarnessFilter === true) {
                    return json({
                        items: live.map((session) => ({ id: session.id, harness: session.harness })),
                        limit: 100,
                        next_cursor: null,
                        observed_at: 1,
                        revision: 1
                    });
                }

                const pages =
                    options.directory?.[harness] ??
                    [live.filter((session) => session.harness === harness).map((session) => session.id)];
                const cursor = query.get('cursor');
                const index = cursor === null ? 0 : Number.parseInt(cursor.replace(/^p/, ''), 10);
                const ids = pages[index] ?? [];
                const next = index + 1 < pages.length ? `p${index + 1}` : null;

                return json({
                    // The row names its OWN harness, exactly like `SessionSummary`: the
                    // cleanup verifies it as a second line of defence against a server
                    // that ignores the filter.
                    items: ids.map((id) => ({ id, harness })),
                    limit: 100,
                    next_cursor: next,
                    observed_at: 1,
                    revision: 1
                });
            }
        }

        // A saved conversation is authoritative on its own: it carries the definition
        // it froze at creation, whether or not its harness still exists.
        if (url.startsWith('/api/sessions/') && method === undefined) {
            const id = decodeURIComponent(url.split('/').pop() as string);
            const record =
                options.records?.[id] ?? live.find((s) => s.id === id) ?? (options.sessions ?? []).find((s) => s.id === id);

            if (record === undefined) return json({ error: { message: `Unknown session ${id}` } }, 404);

            return json({ session: record });
        }

        if (url.startsWith('/api/sessions/') && method === 'DELETE') {
            const id = decodeURIComponent(url.split('/').pop() as string);

            // R3 sequentiality: the next DELETE must not leave the browser while this one
            // is unanswered. Only the named id is held, so the release proves the ORDER.
            if (id === options.holdSessionDeleteFor && options.holdSessionDelete !== undefined) {
                await options.holdSessionDelete();
            }

            if (id === options.failSessionDeleteFor) {
                return json({ error: { message: 'The session is locked.' } }, 500);
            }
            if (id === options.missingSessionFor) {
                return json({ error: { message: `Unknown session ${id}.` } }, 404);
            }

            const index = live.findIndex((session) => session.id === id);
            if (index >= 0) live.splice(index, 1);

            return json({ deleted: true });
        }

        // R6: the harness delete route, with the shapes the backend worker agreed to.
        if (url.startsWith('/api/harnesses/') && method === 'DELETE') {
            const name = decodeURIComponent(url.split('/').pop() as string);

            // The busy-state contract: while ONE delete is in flight, no other delete
            // may start (main.ts locks the whole roster).
            if (options.holdDelete !== undefined) await options.holdDelete();

            if (name === options.notFoundFor) {
                return json({ error: { message: `Unknown harness ${name}` } }, 404);
            }
            if (name === options.failFor) {
                return json({ error: { message: 'The registry could not be written' } }, 500);
            }
            if (name === options.conflictFor) {
                // The server's ownership guard: a session appeared after the cleanup (the
                // concurrent-create race), so the harness must stay.
                return json(
                    {
                        error: {
                            message: `Harness "${name}" still owns 1 session. Delete it first; a harness can only be deleted after all of its sessions are deleted.`
                        }
                    },
                    409
                );
            }

            return json({ deleted: true });
        }

        throw new Error(`unexpected request: ${method ?? 'GET'} ${url}`);
    }, { root: '/api' });

    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            calls.push({ url: String(input), method: init?.method });

            return answer(input, init);
        })
    );

    return calls;
};

const boot = async (): Promise<void> => {
    await import('./main');
    await flush();
    await flush();
};

const rowFor = (name: string): HTMLElement => {
    const found = document.querySelector<HTMLElement>(`.harness-row[data-harness="${name}"]`);
    if (found === null) throw new Error(`missing harness row ${name}`);
    return found;
};

const selectFor = (name: string): HTMLButtonElement => {
    const found = rowFor(name).querySelector<HTMLButtonElement>('.harness-item');
    if (found === null) throw new Error(`missing select button ${name}`);
    return found;
};

const deleteFor = (name: string): HTMLButtonElement => {
    const found = rowFor(name).querySelector<HTMLButtonElement>('.harness-delete');
    if (found === null) throw new Error(`missing delete control ${name}`);
    return found;
};

// First press arms, second press deletes: one helper for the confirmed path.
const deleteHarnessRow = async (name: string): Promise<void> => {
    deleteFor(name).click();
    await flush();
    deleteFor(name).click();
    await flush();
    await flush();
};

const pressedHarnesses = (): (string | undefined)[] =>
    [...document.querySelectorAll<HTMLElement>('.harness-item')]
        .filter((node) => node.getAttribute('aria-pressed') === 'true')
        .map((node) => node.dataset.harness);

const statusState = (): string | null => document.querySelector<HTMLElement>('.status')?.dataset.state ?? null;
const statusDetail = (): string => document.querySelector('.status-detail')?.textContent ?? '';

const deletes = (calls: Call[], url: string): Call[] =>
    calls.filter((call) => call.url === url && call.method === 'DELETE');

// The identified conversation RECORD read (`GET /v1/harness/sessions/:id`,
// ../shared/harness-api.ts `HARNESS_ROUTES.sessionsBySessionId`). Exact on purpose: the
// same open dials `/turns`, `/threads`, `/actions` and `/turns/:tid/display` underneath
// it, and only this path is the "one read per open" the test claims.
const readRecord = (calls: Call[], id: string): Call[] =>
    calls.filter((call) => call.url === `/v1/harness/sessions/${id}` && call.method === undefined);

// T9: the session directory (live AND archived pills) is the Sessions dashboard behind the
// harness title, so "is this conversation listed?" means "open that layer". `dashboard()`
// opens it when it is closed and returns the strip; `closeDashboard()` puts the layer away
// again so a later rail gesture is not reading a modal page.
const dashboard = (): HTMLElement => {
    const open = document.querySelector<HTMLElement>('.session-pills-bar-dialog');
    if (open !== null) return open;

    const trigger = document.querySelector<HTMLButtonElement>('.harness-title-button');
    if (trigger === null) throw new Error('missing harness title button');
    trigger.click();

    const bar = document.querySelector<HTMLElement>('.session-pills-bar-dialog');
    if (bar === null) throw new Error('missing session dashboard');
    return bar;
};

// Scoped to the SESSION layer: a deck dialog can be stacked on top, and a document-wide
// `.dialog-close` would then dismiss the wrong one.
const closeDashboard = (): void => {
    const panel = document.querySelector('.session-pills-bar-dialog')?.closest('.dialog');
    panel?.querySelector<HTMLButtonElement>('.dialog-close')?.click();
};

beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

it('offers an accessible delete control beside each row without selecting the harness', async () => {
    stubServer({ presets: [descriptor('alpha'), descriptor('beta')] });
    await boot();

    const row = rowFor('beta');

    // Buttons cannot nest, so the delete control is a SIBLING of the select button.
    expect(selectFor('beta').parentElement).toBe(row);
    expect(deleteFor('beta').parentElement).toBe(row);
    expect(row.contains(selectFor('beta'))).toBe(true);

    // A real button with a name that says what it does and which row it belongs to.
    expect(deleteFor('beta').type).toBe('button');
    expect(deleteFor('beta').disabled).toBe(false);
    expect(deleteFor('beta').getAttribute('aria-label')).toBe('Delete harness beta');
    expect(deleteFor('beta').title).toBe(
        'Delete Beta (beta) permanently. Every session it owns is deleted too.'
    );

    // Pressing delete must not move the selection: the first press only arms.
    expect(pressedHarnesses()).toEqual(['alpha']);
    const before = document.querySelector('.main-title')?.textContent;
    deleteFor('beta').click();
    await flush();

    expect(pressedHarnesses()).toEqual(['alpha']);
    expect(document.querySelector('.main-title')?.textContent).toBe(before);

    // The armed row is unmistakable: the control asks, and a text line names the
    // consequence. No request went out for the arm. (`rowFor` re-queries: arming
    // rebuilds the rail, so the row node captured before the click is detached.)
    const armed = rowFor('beta');
    expect(armed.dataset.armed).toBe('true');
    expect(deleteFor('beta').textContent).toBe('Delete?');
    expect(deleteFor('beta').getAttribute('aria-label')).toBe('Confirm delete harness beta');
    expect(deleteFor('beta').title).toBe(
        'Delete Beta (beta) permanently, including every session it owns. Press again to confirm, or pick another row to cancel.'
    );
    expect(armed.querySelector('.harness-delete-hint')?.textContent).toBe(
        'Delete “Beta” (beta) permanently? Every session and conversation it owns will be deleted first, and this cannot be undone from the UI.'
    );
    expect(deleteFor('beta').getAttribute('aria-describedby')).toBe('harness-delete-hint-beta');
    expect(armed.contains(deleteFor('beta'))).toBe(true);

    // Arming ANOTHER row moves the confirmation instead of stacking a second one.
    deleteFor('alpha').click();
    await flush();
    expect(rowFor('beta').dataset.armed).toBeUndefined();
    expect(rowFor('alpha').dataset.armed).toBe('true');

    // Escape abandons it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    expect(rowFor('alpha').dataset.armed).toBeUndefined();
});

it('deletes the selected harness after the second press and reselects another one', async () => {
    const calls = stubServer({
        presets: [descriptor('alpha'), descriptor('beta')],
        sessions: [snapshot('chat-a', 'alpha'), snapshot('chat-b', 'beta')]
    });
    await boot();

    // alpha is selected by boot; delete it and the shell must land somewhere sensible.
    await deleteHarnessRow('alpha');

    // R3: the server directory is read FIRST (filtered to the exact harness), then the
    // harness's one session is deleted, and the harness DELETE is last.
    const listedAt = calls.findIndex(
        (call) => call.method === undefined && call.url === '/v1/harness/sessions?limit=100&harness=alpha'
    );
    const firstDeleteAt = calls.findIndex((call) => call.method === 'DELETE');

    expect(listedAt).toBeGreaterThanOrEqual(0);
    expect(listedAt).toBeLessThan(firstDeleteAt);
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
        { url: '/v1/harness/sessions/chat-a', method: 'DELETE' },
        { url: '/v1/harness/harnesses/alpha', method: 'DELETE' }
    ]);
    expect(document.querySelectorAll('.harness-row[data-harness="alpha"]')).toHaveLength(0);

    // Reselect sensibly: the remaining production harness is now the selected one.
    expect(pressedHarnesses()).toEqual(['beta']);
    expect(document.querySelector('.main-title')?.textContent).toBe('Beta');
    // T24: reselecting IS entering, and entering a harness resolves its most recently used
    // conversation. beta holds `chat-b`, so the centre column now shows that saved
    // conversation — which is exactly why the editable-harness note is gone (a saved
    // session prints no note at all) and why the header cycler names an id.
    expect(document.querySelector<HTMLElement>('.session-cycle')?.dataset.sessionId).toBe('chat-b');
    expect(document.querySelector('.harness-note')?.textContent).toBe('');
    expect(document.querySelector('.harness-note')?.hidden).toBe(true);
    expect(selectFor('beta').disabled).toBe(false);

    // The deleted harness's conversation is gone from the directory too: the cascade
    // removed the record, so there is no archived pill to reach in this flow.
    const bar = dashboard();
    expect(
        [...bar.querySelectorAll<HTMLElement>('.session-pill[data-archived=false]')].map(
            (node) => node.dataset.sessionId
        )
    ).toEqual(['chat-b']);
    expect([...bar.querySelectorAll<HTMLElement>('.session-pill')].map((node) => node.dataset.sessionId)).toEqual([
        'chat-b'
    ]);
    closeDashboard();

    expect(statusState()).toBe('idle');
    expect(statusDetail()).toBe('deleted alpha');
});

it('treats a 404 as already gone and keeps every other failure actionable', async () => {
    const missing = stubServer({ presets: [descriptor('alpha'), descriptor('beta')], notFoundFor: 'beta' });
    await boot();
    await deleteHarnessRow('beta');

    // The desired end state is "no row": an already-gone harness clears it without an
    // error, and says so in the status line.
    expect(deletes(missing, '/v1/harness/harnesses/beta')).toHaveLength(1);
    expect(document.querySelectorAll('.harness-row[data-harness="beta"]')).toHaveLength(0);
    expect(statusState()).toBe('idle');
    expect(statusDetail()).toBe('beta was already gone');
    expect(pressedHarnesses()).toEqual(['alpha']);

    vi.unstubAllGlobals();

    // A real failure keeps the row, reports the server's message, and leaves no stale
    // confirmation waiting on the control.
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';

    const failing = stubServer({ presets: [descriptor('alpha'), descriptor('beta')], failFor: 'beta' });
    await boot();

    deleteFor('beta').click();
    await flush();
    // The arm is visible on the ROW, and the failure path must not leave it armed.
    expect(rowFor('beta').dataset.armed).toBe('true');
    deleteFor('beta').click();
    await flush();
    await flush();

    expect(deletes(failing, '/v1/harness/harnesses/beta')).toHaveLength(1);
    expect(document.querySelectorAll('.harness-row[data-harness="beta"]')).toHaveLength(1);
    expect(statusState()).toBe('error');
    expect(statusDetail()).toBe('delete harness: The registry could not be written');
    expect(rowFor('beta').dataset.armed).toBeUndefined();
    expect(document.querySelector('.main-title')?.textContent).toBe('Alpha');
});

it('sends one delete for a double press and preserves the selection of another harness', async () => {
    const calls = stubServer({ presets: [descriptor('alpha'), descriptor('beta')] });
    await boot();

    // Arm, then release the press twice as fast as any reader: the arm is consumed by the
    // first DELETE, so the extra press cannot send a second one.
    deleteFor('beta').click();
    await flush();
    deleteFor('beta').click();
    deleteFor('beta').click();
    await flush();
    await flush();

    expect(deletes(calls, '/v1/harness/harnesses/beta')).toHaveLength(1);

    // Deleting a harness the reader is NOT looking at leaves the conversation alone.
    expect(pressedHarnesses()).toEqual(['alpha']);
    expect(document.querySelector('.main-title')?.textContent).toBe('Alpha');
    expect(rowFor('alpha').contains(selectFor('alpha'))).toBe(true);
});

it('survives an empty roster and releases the playground session bound to the deleted harness', async () => {
    // T4: the tools toggle only renders while a conversation is bound, so the harness that is
    // about to disappear is shown with one of its own. The PLAYGROUND session is a separate
    // conversation the session-bound call itself mints (`temp-1`), and that is what R7 releases.
    const calls = stubServer({
        presets: [descriptor('alpha')],
        tools: [coreTool],
        sessions: [snapshot('chat-a', 'alpha')]
    });
    await boot();

    // Build a playground context first: a session-bound call creates the temporary
    // session (R7), on the same harness that is about to disappear.
    document.querySelector<HTMLButtonElement>('.tools-toggle')?.click();
    await flush();
    // R1 (swap): the playground's runner opens from the row's corner INFO mark — the tile writes
    // enablement now, and a playground call must not touch the conversation's toolbox.
    document.querySelector<HTMLButtonElement>('.tool-tab-info[data-tool="toolRequest"]')?.click();
    await flush();
    document.querySelector<HTMLTextAreaElement>('.tool-args')!.value = '{"tags":["web"]}';
    document.querySelector<HTMLButtonElement>('.tool-card button.primary')?.click();
    await flush();
    await flush();

    expect(posts(calls, '/v1/harness/sessions', 'POST')).toHaveLength(1);

    await deleteHarnessRow('alpha');

    // The roster is empty: the rail says so instead of crashing. Deleting the CURRENT
    // conversation has always closed the tools view (`syncConfigScope` -> the view is
    // session-bound), so with every session now gone the centre column is the empty-stage
    // guidance rather than a pane describing a context that no longer exists.
    expect(document.querySelectorAll('.harness-row')).toHaveLength(0);
    expect(document.querySelector('.harness-list .field-hint')?.textContent).toBe(
        'No harnesses reported by the server yet.'
    );
    expect(pressedHarnesses()).toEqual([]);
    expect(document.querySelector('.stage .tools-pane')).toBeNull();
    expect(document.querySelector('.empty .field-hint')?.textContent).toBe(
        'No harness is available. Create one with “+ New” in the harnesses panel.'
    );
    expect(document.querySelector('.tools-session-note')).toBeNull();

    // R7/R3: the temporary session belonged to that harness, so the SAME ordered cleanup
    // removed it — one DELETE, and no second fire-and-forget request from the playground's
    // own release path. The cascade CLAIMED the id before deleting the current conversation,
    // which is what the tools view's own close path consults.
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
        { url: '/v1/harness/sessions/chat-a', method: 'DELETE' },
        { url: '/v1/harness/sessions/temp-1', method: 'DELETE' },
        { url: '/v1/harness/harnesses/alpha', method: 'DELETE' }
    ]);
    expect(deletes(calls, '/v1/harness/sessions/temp-1')).toHaveLength(1);

    // No `playground cleanup` rejection repainted over the harness outcome.
    expect(statusState()).toBe('idle');
    expect(statusDetail()).toBe('deleted alpha');
});

it('clears a deleted playground session immediately so a later failure cannot reuse it', async () => {
    const calls = stubServer({
        presets: [descriptor('alpha')],
        tools: [coreTool],
        sessions: [snapshot('chat-a', 'alpha')],
        // The playground's temp-1 is created at runtime; the explicit page names it first
        // so the cascade deletes it BEFORE the session that then fails.
        directory: { alpha: [['temp-1', 'chat-a']] },
        failSessionDeleteFor: 'chat-a'
    });
    await boot();

    // Build the playground context: one session-bound call creates temp-1 on alpha.
    document.querySelector<HTMLButtonElement>('.tools-toggle')?.click();
    await flush();
    document.querySelector<HTMLButtonElement>('.tool-tab-info[data-tool="toolRequest"]')?.click();
    await flush();
    document.querySelector<HTMLTextAreaElement>('.tool-args')!.value = '{"tags":["web"]}';
    document.querySelector<HTMLButtonElement>('.tool-card button.primary')?.click();
    await flush();
    await flush();

    expect(posts(calls, '/v1/harness/sessions', 'POST')).toHaveLength(1);

    // temp-1 is deleted, then chat-a's DELETE fails. The tools view stays open because
    // the bound conversation (chat-a) survived.
    await deleteHarnessRow('alpha');

    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
        { url: '/v1/harness/sessions/temp-1', method: 'DELETE' },
        { url: '/v1/harness/sessions/chat-a', method: 'DELETE' }
    ]);
    expect(document.querySelector('.stage .tools-pane')).not.toBeNull();
    expect(statusState()).toBe('error');
    expect(statusDetail()).toBe(
        'session cleanup failed after 1 of 2 sessions were deleted or already absent (The session is locked.). Harness alpha was not deleted.'
    );

    // The next playground call must create a NEW context (a second POST), never reuse the
    // tombstoned temp-1 and never fire a second cleanup DELETE for it.
    document.querySelector<HTMLButtonElement>('.tool-card button.primary')?.click();
    await flush();
    await flush();

    expect(posts(calls, '/v1/harness/sessions', 'POST')).toHaveLength(2);
    expect(deletes(calls, '/v1/harness/sessions/temp-1')).toHaveLength(1);
    expect(statusDetail()).not.toContain('playground cleanup');
});

it('replaces the chat column with guidance when the last harness is deleted outside the tools view', async () => {
    stubServer({ presets: [descriptor('alpha')], sessions: [snapshot('chat-a', 'alpha')] });
    await boot();

    // The chat owns the centre column here (the tools view was never opened).
    expect(document.querySelector('.stage .tools-pane')).toBeNull();

    await deleteHarnessRow('alpha');

    // No crash and no stale conversation: the column names the way back, the composer is
    // out of the way, and the sessions dashboard falls back to its "select a harness" hint.
    expect(document.querySelector('.empty .field-hint')?.textContent).toBe(
        'No harness is available. Create one with “+ New” in the harnesses panel.'
    );
    expect(document.querySelectorAll('.harness-row')).toHaveLength(0);
    expect(pressedHarnesses()).toEqual([]);
    // T3/R1 + T9: the dashboard is empty — the cascade deleted the harness's only session
    // before the harness itself, so there is no orphan pill left behind. With no harness
    // left to scope the list, the empty sentence is the "select a harness" hint (the old
    // archived pill was what made this case read "no sessions yet"). The rail's
    // `.sessions-scope` sentence is gone with the rail.
    expect(document.querySelector('.sessions-scope')).toBeNull();
    const bar = dashboard();
    expect(bar.querySelector('.session-pills-empty')?.textContent).toBe('Select a harness to see its sessions.');
    expect([...bar.querySelectorAll<HTMLElement>('.session-pill')].map((node) => node.dataset.sessionId)).toEqual([]);
    closeDashboard();
    expect((document.querySelector('.composer') as HTMLFormElement | null)?.hidden).toBe(true);
    expect((document.querySelector('.agent-slot') as HTMLElement | null)?.hidden).toBe(true);
});

it('locks every delete control while one delete is in flight', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });

    const calls = stubServer({
        presets: [descriptor('alpha'), descriptor('beta')],
        holdDelete: () => held
    });
    await boot();

    // Arm, then confirm: the DELETE leaves and stays unanswered.
    deleteFor('beta').click();
    await flush();
    deleteFor('beta').click();
    await flush();

    expect(deletes(calls, '/v1/harness/harnesses/beta')).toHaveLength(1);

    // Busy state: the in-flight row AND the other row are both locked, so a reader cannot
    // race a second registry write (and the armed control is no longer armed).
    expect(deleteFor('beta').disabled).toBe(true);
    expect(deleteFor('alpha').disabled).toBe(true);
    expect(rowFor('beta').dataset.armed).toBeUndefined();

    // A press in that window is refused by the handler too, not only by the disabled
    // control, so the request count cannot grow.
    deleteFor('beta').click();
    await flush();
    expect(deletes(calls, '/v1/harness/harnesses/beta')).toHaveLength(1);

    // The delete then commits normally.
    release?.();
    await flush();
    await flush();

    expect(document.querySelectorAll('.harness-row[data-harness="beta"]')).toHaveLength(0);
    expect(deleteFor('alpha').disabled).toBe(false);
    expect(pressedHarnesses()).toEqual(['alpha']);
});

// ---------------------------------------------------------------------------
// R3: the browser automates "delete every session, then the harness".
// ---------------------------------------------------------------------------
//
// The server refuses DELETE /harnesses/:name while it still owns a session (409) and has
// no bulk session route. These tests pin the browser half: every page of the SERVER's
// harness-filtered directory is read before the first delete, the deletes are sequential,
// the harness DELETE is last, and every failure stops the workflow at a truthful point.

it('enumerates every page of the exact harness before deleting, and deduplicates repeated ids', async () => {
    const calls = stubServer({
        presets: [descriptor('alpha'), descriptor('beta')],
        // The browser's cache holds only these two rows: the cascade must still find the
        // ids that exist only on the server's later pages.
        sessions: [snapshot('chat-a', 'alpha'), snapshot('chat-b', 'beta')],
        // The same id on both pages proves the defensive dedupe: one DELETE, not two.
        directory: { alpha: [['chat-a', 'chat-c'], ['chat-c', 'chat-d']] },
        // A page can name an id another browser already deleted; that is the desired end
        // state and must not stop the sequence.
        missingSessionFor: 'chat-c'
    });
    await boot();

    await deleteHarnessRow('alpha');

    // BOTH pages were read, and the filter names the exact canonical harness on each. The
    // unfiltered boot directory read is deliberately excluded: the claim is about the
    // cascade's own enumeration.
    expect(
        calls
            .filter(
                (call) => call.method === undefined && call.url.includes('harness=alpha')
            )
            .map((call) => call.url)
    ).toEqual([
        '/v1/harness/sessions?limit=100&harness=alpha',
        '/v1/harness/sessions?limit=100&cursor=p1&harness=alpha'
    ]);

    // BOTH pages were read before the FIRST destructive request: the cascade enumerates
    // the whole ownership set first, then deletes.
    const lastPageAt = calls.findIndex(
        (call) => call.url === '/v1/harness/sessions?limit=100&cursor=p1&harness=alpha'
    );
    const firstDeleteAt = calls.findIndex((call) => call.method === 'DELETE');
    expect(lastPageAt).toBeGreaterThanOrEqual(0);
    expect(lastPageAt).toBeLessThan(firstDeleteAt);

    // Sequential order: page 1, page 2, then the harness. The duplicate chat-c was
    // deleted once; the 404 counted as already gone rather than a failure; chat-b (another
    // harness) was never touched.
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
        { url: '/v1/harness/sessions/chat-a', method: 'DELETE' },
        { url: '/v1/harness/sessions/chat-c', method: 'DELETE' },
        { url: '/v1/harness/sessions/chat-d', method: 'DELETE' },
        { url: '/v1/harness/harnesses/alpha', method: 'DELETE' }
    ]);
    expect(document.querySelectorAll('.harness-row[data-harness="alpha"]')).toHaveLength(0);
    expect(pressedHarnesses()).toEqual(['beta']);
    expect(document.querySelector('.main-title')?.textContent).toBe('Beta');
    expect(document.querySelector<HTMLElement>('.session-cycle')?.dataset.sessionId).toBe('chat-b');
    expect(statusState()).toBe('idle');
    expect(statusDetail()).toBe('deleted alpha');
});

it('waits for each session DELETE before sending the next, and sends the harness DELETE last', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });

    const calls = stubServer({
        presets: [descriptor('alpha')],
        sessions: [snapshot('chat-a', 'alpha'), snapshot('chat-b', 'alpha')],
        holdSessionDeleteFor: 'chat-a',
        holdSessionDelete: () => held
    });
    await boot();

    deleteFor('alpha').click();
    await flush();
    deleteFor('alpha').click();
    await flush();

    // The first session DELETE is unanswered: no later session DELETE and no harness
    // DELETE may have left the browser (this is the sequential contract, not only an
    // ordering of the recorded log after the fact).
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
        { url: '/v1/harness/sessions/chat-a', method: 'DELETE' }
    ]);
    expect(deletes(calls, '/v1/harness/sessions/chat-b')).toEqual([]);
    expect(deletes(calls, '/v1/harness/harnesses/alpha')).toEqual([]);

    // The whole cascade keeps the roster locked while its first request is in flight.
    expect(deleteFor('alpha').disabled).toBe(true);
    expect(rowFor('alpha').dataset.armed).toBeUndefined();

    // R3 lock: a rail press on ANOTHER session during the cascade must not race it with a
    // second DELETE. The guard (not merely the control's disabled attribute) is what
    // refuses the press: chat-b is not in `removingSessions` yet.
    dashboard()
        .querySelector<HTMLButtonElement>('.session-pill[data-session-id="chat-b"] .session-pill-delete')
        ?.click();
    await flush();
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
        { url: '/v1/harness/sessions/chat-a', method: 'DELETE' }
    ]);
    closeDashboard();

    release?.();
    await flush();
    await flush();
    await flush();

    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
        { url: '/v1/harness/sessions/chat-a', method: 'DELETE' },
        { url: '/v1/harness/sessions/chat-b', method: 'DELETE' },
        { url: '/v1/harness/harnesses/alpha', method: 'DELETE' }
    ]);
    expect(document.querySelectorAll('.harness-row[data-harness="alpha"]')).toHaveLength(0);
    expect(statusState()).toBe('idle');
    expect(statusDetail()).toBe('deleted alpha');
});

it('stops at the first failed session, keeps the harness and reports the removed prefix', async () => {
    const calls = stubServer({
        presets: [descriptor('alpha'), descriptor('beta')],
        sessions: [
            snapshot('chat-a', 'alpha'),
            snapshot('chat-b', 'alpha'),
            snapshot('chat-c', 'alpha')
        ],
        directory: { alpha: [['chat-a', 'chat-b'], ['chat-c']] },
        failSessionDeleteFor: 'chat-b'
    });
    await boot();

    await deleteHarnessRow('alpha');

    // chat-a was removed, chat-b failed, and the sequence STOPPED before chat-c and the
    // harness. No rollback and no claim of completion.
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
        { url: '/v1/harness/sessions/chat-a', method: 'DELETE' },
        { url: '/v1/harness/sessions/chat-b', method: 'DELETE' }
    ]);
    expect(deletes(calls, '/v1/harness/harnesses/alpha')).toEqual([]);

    // The harness row STAYS and is usable again (no stale arm, no permanent lock).
    expect(document.querySelectorAll('.harness-row[data-harness="alpha"]')).toHaveLength(1);
    expect(rowFor('alpha').dataset.armed).toBeUndefined();
    expect(deleteFor('alpha').disabled).toBe(false);
    expect(pressedHarnesses()).toEqual(['alpha']);
    expect(document.querySelector('.main-title')?.textContent).toBe('Alpha');

    // The cache mirrors exactly what settled: chat-a is gone, chat-b (failed) and chat-c
    // (never attempted) remain listed.
    const bar = dashboard();
    expect(
        [...bar.querySelectorAll<HTMLElement>('.session-pill')]
            .map((node) => node.dataset.sessionId)
            .sort()
    ).toEqual(['chat-b', 'chat-c']);
    closeDashboard();

    expect(statusState()).toBe('error');
    expect(statusDetail()).toBe(
        'session cleanup failed after 1 of 3 sessions were deleted or already absent (The session is locked.). Harness alpha was not deleted.'
    );
});

it('sends no delete at all when the session enumeration fails', async () => {
    const calls = stubServer({
        presets: [descriptor('alpha')],
        sessions: [snapshot('chat-a', 'alpha')],
        failDirectoryFor: 'alpha'
    });
    await boot();

    await deleteHarnessRow('alpha');

    // Non-destructive: no session DELETE and no harness DELETE left the browser.
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);
    expect(document.querySelectorAll('.harness-row[data-harness="alpha"]')).toHaveLength(1);
    expect(rowFor('alpha').dataset.armed).toBeUndefined();
    expect(deleteFor('alpha').disabled).toBe(false);
    expect(pressedHarnesses()).toEqual(['alpha']);

    // The session is still on the server and still in the directory.
    const bar = dashboard();
    expect([...bar.querySelectorAll<HTMLElement>('.session-pill')].map((node) => node.dataset.sessionId)).toEqual([
        'chat-a'
    ]);
    closeDashboard();

    expect(statusState()).toBe('error');
    expect(statusDetail()).toBe(
        'could not list sessions of alpha (The session index is unavailable.). No session or harness was deleted.'
    );
});

it('sends no delete when the directory names another harness’s session', async () => {
    const calls = stubServer({
        presets: [descriptor('alpha')],
        // A server/gateway that ignores `?harness=`: the alpha cleanup is answered with
        // beta's row. The client must refuse to delete anything rather than trust it.
        sessions: [snapshot('chat-b', 'beta')],
        ignoreHarnessFilter: true
    });
    await boot();

    await deleteHarnessRow('alpha');

    // Enumeration COMPLETED (one filtered page), but no session and no harness DELETE.
    expect(
        calls.filter((call) => call.method === undefined && call.url.includes('harness=alpha')).map((call) => call.url)
    ).toEqual(['/v1/harness/sessions?limit=100&harness=alpha']);
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([]);

    // The harness row stays usable (no stale arm, no permanent lock), and the error names
    // exactly why the ownership set could not be trusted.
    expect(document.querySelectorAll('.harness-row[data-harness="alpha"]')).toHaveLength(1);
    expect(rowFor('alpha').dataset.armed).toBeUndefined();
    expect(deleteFor('alpha').disabled).toBe(false);
    expect(statusState()).toBe('error');
    expect(statusDetail()).toBe(
        'could not verify sessions of alpha (the server returned session chat-b for beta). No session or harness was deleted.'
    );
});

it('surfaces a 409 on the final harness delete after a completed session cleanup', async () => {
    const calls = stubServer({
        presets: [descriptor('alpha')],
        sessions: [snapshot('chat-a', 'alpha')],
        // The cleanup succeeded, but a concurrent session appeared before the harness
        // DELETE: the server's ownership guard is the authority and must be surfaced.
        conflictFor: 'alpha'
    });
    await boot();

    await deleteHarnessRow('alpha');

    // The session really was deleted first; only the harness write failed.
    expect(calls.filter((call) => call.method === 'DELETE')).toEqual([
        { url: '/v1/harness/sessions/chat-a', method: 'DELETE' },
        { url: '/v1/harness/harnesses/alpha', method: 'DELETE' }
    ]);
    expect(document.querySelectorAll('.harness-row[data-harness="alpha"]')).toHaveLength(1);
    expect(deleteFor('alpha').disabled).toBe(false);
    expect(rowFor('alpha').dataset.armed).toBeUndefined();

    // No success claim: the session cleanup is visible (the pill is gone), but the
    // app-scoped pill reports the server's 409 sentence.
    const bar = dashboard();
    expect([...bar.querySelectorAll<HTMLElement>('.session-pill')]).toEqual([]);
    closeDashboard();
    expect(statusState()).toBe('error');
    expect(statusDetail()).toBe(
        'delete harness: Harness "alpha" still owns 1 session. Delete it first; a harness can only be deleted after all of its sessions are deleted.'
    );
});

// ---------------------------------------------------------------------------
// R6: LEGACY orphan sessions stay reachable through the archived directory.
// ---------------------------------------------------------------------------
//
// The current harness delete removes every session it can list BEFORE the definition, so
// it no longer produces orphans. A record from an EARLIER deletion (or a harness removed
// outside this page) still has no rail row to select, and without an explicit archived
// group it would become unreachable until the exact name was recreated. These tests pin
// the archived projection, the reopen from the record's FROZEN definition, and the rule
// that nothing is ever written back to the registry.
const frozenAlpha = (): HarnessDescriptor => ({
    ...descriptor('alpha'),
    // Distinct on purpose: the reopened chat must render THIS definition (the one the
    // session froze), never a live or re-created one.
    title: 'Alpha (frozen)',
    description: 'The definition alpha ran with when the session started.'
});

const archivedRecord = (): SessionSnapshot =>
    snapshot('chat-a', 'alpha', {
        harnessDefinition: frozenAlpha(),
        turns: [turn('Plan the release')]
    });

it('keeps a legacy orphan session reachable as an archived pill and reopens it from its frozen definition', async () => {
    const calls = stubServer({
        // alpha has NO registry row: this record is what an earlier deletion (or a
        // delete from another client) left behind. Boot lands on beta.
        presets: [descriptor('beta')],
        sessions: [archivedRecord()]
    });
    await boot();

    // T9: read the archive in the dashboard behind the title. The record is flagged
    // `data-archived` from the start; T3/R1 dropped the labelled rail group and its
    // explanatory hint — the dashed/muted pill frame and the harness in the tooltip carry
    // the same fact one line lower.
    const pill = dashboard().querySelector<HTMLElement>('.session-pill[data-session-id="chat-a"]');
    expect(pill?.dataset.archived).toBe('true');
    expect(pill?.dataset.status).toBe('idle');
    const select = pill?.querySelector<HTMLElement>('.session-pill-select');
    // Only the eight-character prefix is visible; the harness the record belongs to is in
    // the tooltip, which is what replaces the old `.session-harness` line.
    expect(select?.textContent).toBe('chat-a');
    expect(select?.title).toBe('alpha · idle · chat-a');

    // Opening it is the normal path: one identified record read, nothing else. Boot never
    // opened this record (beta is the selected harness and alpha's only conversation is
    // archived), so the count taken here is the archived open's OWN cost. (`readRecord` is
    // the exact `/v1/harness/sessions/:id` path only, so the open's `/turns`, `/threads`,
    // `/actions` and `/turns/:tid/display` subresources cannot inflate it.)
    const readsBefore = readRecord(calls, 'chat-a').length;
    pill?.querySelector<HTMLButtonElement>('.session-pill-select')?.click();
    await flush();
    await flush();

    expect(readRecord(calls, 'chat-a')).toHaveLength(readsBefore + 1);

    // The chat reopens on alpha's own saved label, and the note is what says the harness
    // is gone (R6). T45: the CAPTION wording is not a user requirement — the header names
    // the harness the conversation belongs to — while the DELETED-DEFINITION fact is the
    // sentence below, so that note assertion is the one that carries the requirement.
    expect(document.querySelector('.main-title')?.textContent).toBe('Alpha');
    expect(document.querySelector('.harness-note')?.textContent).toBe(
        'Deleted harness · saved session kept and reopened from its frozen definition'
    );

    // The conversation really reopened (its recorded prompt is on screen). The pill is now
    // the ACTIVE one and still appears exactly once — the archived pass must never
    // duplicate a conversation the selected (deleted) harness already owns.
    expect(document.querySelector('.stage')?.textContent).toContain('Plan the release');
    const bar = dashboard();
    expect(bar.querySelectorAll('.session-pill[data-session-id="chat-a"]')).toHaveLength(1);
    // T9: reopening the dashboard BUILDS a new strip from the projection, so the row the
    // reader pressed is a stale node and the live list holds exactly one fresh one — proof
    // the directory is re-projected rather than appended to (the old rail could duplicate a
    // row).
    const opened = bar.querySelector<HTMLElement>('.session-pill[data-session-id="chat-a"]');
    expect(opened).not.toBe(pill);
    expect(opened?.parentElement).not.toBe(pill?.parentElement);
    expect(opened?.getAttribute('data-active')).toBe('true');
    expect(opened?.getAttribute('data-archived')).toBe('true');

    // NO registry resurrection: the rail still shows only the surviving harness, nothing
    // was POSTed to /harnesses, and a new session cannot start on a harness that is gone.
    expect(document.querySelectorAll('.harness-row')).toHaveLength(1);
    expect(document.querySelector('.harness-row[data-harness="beta"]')).not.toBeNull();
    expect(calls.filter((call) => call.method === 'POST' && call.url.startsWith('/v1/harness/harnesses'))).toEqual([]);
    expect(pressedHarnesses()).toEqual([]);
    // R6: the header `+` refuses to start a session on a harness that is gone (the archived
    // record stays readable, but `POST /sessions` would only error).
    expect((document.querySelector('.harness-title-row .new-session') as HTMLButtonElement | null)?.disabled).toBe(
        true
    );

    // The saved record itself is untouched: no session delete was sent for it.
    expect(calls.filter((call) => call.url === '/v1/harness/sessions/chat-a' && call.method === 'DELETE')).toEqual([]);
});

it('reopens a legacy orphan conversation even when no harness is left at all', async () => {
    const calls = stubServer({ presets: [], sessions: [archivedRecord()] });
    await boot();

    // Empty roster: there is no harness row to select, but the conversation is still
    // offered — a definition removed by an earlier deletion must not orphan the record.
    expect(document.querySelectorAll('.harness-row')).toHaveLength(0);
    const bar = dashboard();
    // T4: this is the Sessions-only layer. Its accessible name says exactly that (there is
    // no harness head to reuse), and NOTHING below the dashboard is stale: the description,
    // the `harnessMeta` line, the repeated note and the aggregate totals all describe a
    // harness the registry does not have.
    const panel = document.querySelector('.dialog');
    expect(panel?.querySelector('.dialog-title')?.textContent).toBe('Sessions');
    expect(panel?.querySelector('.harness-details-description')).toBeNull();
    expect(panel?.querySelector('.harness-details-meta')).toBeNull();
    expect(panel?.querySelector('.harness-details-note')).toBeNull();
    expect(panel?.querySelector('.harness-details-stats')).toBeNull();
    // The dashboard itself is intact: one archived pill for the deleted harness's record.
    expect(bar.querySelectorAll('.session-pill[data-archived=true][data-session-id="chat-a"]')).toHaveLength(1);
    closeDashboard();

    // Reopening the layer is how the reader reaches the record: one press on the archived
    // pill opens it and dismisses the dialog.
    dashboard()
        .querySelector<HTMLElement>('.session-pill[data-session-id="chat-a"]')
        ?.querySelector<HTMLButtonElement>('.session-pill-select')
        ?.click();
    await flush();
    await flush();

    // Same caption rule as the beta case above: the reopened conversation is alpha's, and
    // the deleted-harness sentence is the header NOTE (asserted in the other test, where
    // the note is the fact this pair of tests exists for).
    expect(document.querySelector('.main-title')?.textContent).toBe('Alpha');
    expect(document.querySelector('.stage')?.textContent).toContain('Plan the release');

    // Nothing was written to the registry, so `alpha` cannot have been re-created by
    // reading one of its conversations.
    expect(
        calls.filter(
            (call) =>
                call.url.startsWith('/v1/harness/harnesses') &&
                (call.method === 'POST' || call.method === 'PATCH' || call.method === 'PUT')
        )
    ).toEqual([]);
    expect(document.querySelectorAll('.harness-row')).toHaveLength(0);
});

it('refuses an archived record with no frozen definition instead of inventing a harness', async () => {
    const legacy = snapshot('chat-l', 'alpha', { turns: [] });
    stubServer({
        presets: [descriptor('beta')],
        sessions: [legacy],
        records: { 'chat-l': legacy }
    });
    await boot();

    // T9: the legacy orphan is offered in the dashboard behind the title.
    dashboard()
        .querySelector<HTMLElement>('.session-pill[data-session-id="chat-l"]')
        ?.querySelector<HTMLButtonElement>('.session-pill-select')
        ?.click();
    await flush();
    await flush();

    // No `harnessDefinition` to rebuild from, so the honest answer is an error and the
    // selection stays where it was.
    expect(statusState()).toBe('error');
    expect(statusDetail()).toBe('unknown harness "alpha"');
    expect(document.querySelector('.main-title')?.textContent).toBe('Beta');
    expect(pressedHarnesses()).toEqual(['beta']);
});

const posts = (calls: Call[], url: string, method: string): Call[] =>
    calls.filter((call) => call.url === url && call.method === method);
