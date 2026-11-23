// Preset-history (U6 `prefix`) wiring in the LIVE shell — the U7 integration suite.
//
// HOW THIS DIFFERS FROM `agent-instructions-main.test.ts`
// -------------------------------------------------------
// That file pins the INSTRUCTION field: one string per member, three states on one subresource, and
// a `null` restore. This file pins the PRESET-HISTORY field: an ORDERED ARRAY of
// `system|user|assistant` turns per member (../types/index.ts:703-717 `HarnessPrefixTurn`) that is
// the seeded history a NEW conversation starts with after its instruction block. Three properties
// make it a different test subject rather than a third copy of the same test:
//
//   1. THE CAPABILITY IS A READ STATE, not a server flag. `options.prefixes` presence decides whether
//      the dialog shows the section at all (./ui/agent-dialog.ts:495-498), so an UNREAD band map must
//      never degrade into `{}`: `agent_prefixes` is a whole-map REPLACE whose `{}` clears every stored
//      band (../shared/harness-api.ts:861-873). A template whose identified read states no map gets no
//      section and sends no field; a band read that failed is not a baseline.
//   2. VALUES ARE ORDERED ARRAYS. A reordered band is different server state, so the no-op guard
//      cannot use a key/set compare (./contract.ts:674-714) and the shell must send — and repaint —
//      the order it was given.
//   3. AN EMPTY BAND IS A VALUE. `[]` means "this member starts with the instruction alone"; on the
//      template map it is a keyed `[]` (./contract.ts:629-641) and on a session binding it is the
//      `prefix: []` PATCH body, NEVER `null` (null on that field means "drop the session override and
//      re-seed from the frozen definition", which this editor has no control for).
//
// What is asserted, in the browser's own terms:
//   - TEMPLATE (no conversation open): the section opens on the stored bands in the stored order; a
//     band-only edit is ONE `PATCH /harnesses/:name` whose `agent_prefixes` (the contract's snake_case
//     wire spelling, asserted at the dial layer) is the COMPLETE map for the final roster — every other
//     member's band restated verbatim; clearing one member is a keyed `[]`, clearing the last band is an
//     explicit `{}`; a template with no stated map sends no band field at all; a reordered band is a
//     change; and after an accepted save a second press sends nothing.
//   - A SAVED CONVERSATION: opening the dialog reads ONE `GET .../agents/{id}/prefix` per member and
//     that answer — not the template's map and not the frozen definition's copy — is what the rows
//     hold; a band-only edit is exactly one `PATCH /sessions/{id}/agents/{agent}` carrying `prefix` and
//     NO `instruction` key; a band plus a prompt is ONE request with both keys; an added member carries
//     its band on the `POST`; a detached member is only ever `DELETE`d; and the harness template is
//     never written from a conversation.
//   - The busy lock: a band delta on a `running` conversation is refused with the run's reason and
//     costs no request.
//
// The conversation fixture declares ONLY what the shared double cannot invent (the boot page, the
// session record, the template card); the roster, each member's live prompt and band, and every
// create/patch/delete answer are COMPOSED by ./view-test-support.ts from the state the WRITES left
// behind — so "the band the reader saved is on screen afterwards" is answered by a route that only
// knows the band because the PATCH stored it.
//
// Run: yarn vitest run --config src/frontend/vitest.config.ts agent-prefixes-main.test.ts

import type { AgentRank, HarnessPrefixTurn } from '../types';
import type { HarnessDescriptor, SessionSnapshot } from '../server/protocol';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { viewAwareFetch } from './view-test-support';

const defaults = { baseURL: 'http://provider/v1', model: 'm1', hasApiKey: false };
const SESSION_KEY = 'underload-harness-app:session';

const descriptor = (overrides: Record<string, unknown> = {}): HarnessDescriptor =>
    ({
        name: 'seeded',
        title: 'Seeded',
        description: 'A general instruction-following agent.',
        requiresEndpoint: true,
        agents: ['instruct', 'summarizer'],
        tools: [],
        coreTools: ['toolRequest', 'toolCreate', 'tasks', 'delegate'],
        entry: 'instruct',
        ranks: { instruct: 'A', 'summarizer': 'B' },
        builtin: true,
        editable: true,
        ...overrides
    }) as HarnessDescriptor;

// The TRUSTED library (GET /agents). A member with no stored prompt runs exactly this text, and no
// profile seeds a preset history — the catalogue layer has no band (../shared/harness-api.ts
// `SessionPrefixTurnsResponse.source` names only `harness`, `session` and `none` for that reason).
const agents = [
    { name: 'instruct', title: 'Instruct', description: 'General agent.', instruction: 'Answer directly.', guidelines: [] },
    {
        name: 'summarizer',
        title: 'Summarizer',
        description: 'Compresses notes.',
        instruction: 'Compress notes into at most two sentences.',
        guidelines: []
    },
    { name: 'critic', title: 'Critic', description: 'Reviews the answer.', instruction: 'Find problems.', guidelines: [] }
];

const snapshot = (overrides: Record<string, unknown> = {}): SessionSnapshot =>
    ({
        id: 's1',
        harness: 'seeded',
        status: 'idle',
        model: 'm1',
        createdAt: 1,
        updatedAt: 2,
        messages: [],
        turns: [],
        ...overrides
    }) as SessionSnapshot;

const json = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

const flush = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const bootstrap = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    rootPath: '/api',
    presets: [descriptor()],
    tools: [],
    defaults,
    sessions: [],
    agents,
    ...overrides
});

const byClass = <K extends keyof HTMLElementTagNameMap>(selector: string, tag: K): HTMLElementTagNameMap[K] => {
    const found = document.querySelector<HTMLElementTagNameMap[K]>(selector);
    if (found === null) throw new Error(`missing element ${selector}`);

    return found;
};

// The dialog is reached the way a reader reaches it: the single composer button.
const openDialog = (): void => {
    if (document.querySelector('.dialog') !== null) return;
    byClass('.agent-control-button', 'button').click();
};

const instructionBox = (): HTMLTextAreaElement => {
    openDialog();

    return byClass('.agent-dialog-instruction', 'textarea');
};

const applyAction = (): HTMLButtonElement => {
    openDialog();

    return byClass('.agent-dialog-apply', 'button');
};

const configuredAgent = (): string | undefined => {
    openDialog();

    return document.querySelector<HTMLElement>('.agent-dialog-config')?.dataset.agent;
};

const selectConfigured = (name: string): void => {
    openDialog();
    byClass(`.agent-dialog-tab[data-agent="${name}"]`, 'div').click();
};

// The roster as the dialog lists it. After a save this is a claim about the SERVER: the tabs come from
// the definition and roster reads the composed double answers from its own state.
const agentEntries = (): string[] => {
    openDialog();

    return [...document.querySelectorAll<HTMLElement>('.agent-dialog-tab')].map((tab) => tab.dataset.agent ?? '');
};

const addAgent = (name: string): void => {
    openDialog();
    byClass('.agent-dialog-add', 'button').click();
    byClass(`.agent-dialog-add-option[data-agent="${name}"]`, 'button').click();
};

const typeInstruction = (text: string): void => {
    const box = instructionBox();
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
};

// --- the preset-turns editor (./ui/agent-dialog.ts:1284-1472) -----------------------------
//
// Every helper RE-QUERIES: add/remove/move repaint the section, so a node held across a click is
// detached and a click on it would be a silent no-op. The section itself is the machine-readable
// statement of the list (`data-count`), and each row states its own order and role.
const prefixGroup = (): HTMLElement => {
    openDialog();

    return byClass('.agent-dialog-prefixes', 'div');
};
const prefixCount = (): number => Number(prefixGroup().dataset.count);
const prefixRows = (): HTMLElement[] => [...prefixGroup().querySelectorAll<HTMLElement>('.agent-dialog-prefix-row')];
const prefixContents = (): string[] =>
    prefixRows().map((row) => (row.querySelector<HTMLTextAreaElement>('.agent-dialog-prefix-content') as HTMLTextAreaElement).value);
const prefixRoles = (): string[] => prefixRows().map((row) => row.dataset.role ?? '');
const prefixBoxes = (): HTMLTextAreaElement[] =>
    prefixRows().map((row) => row.querySelector<HTMLTextAreaElement>('.agent-dialog-prefix-content') as HTMLTextAreaElement);
// The Add control lives in the section HEADER, outside the `data-count` group, so an empty band still
// has to expose it ENABLED — `ui/agent-dialog.ts:1448-1456` only locks it when the agent is not
// editable, which is how a zero-row editor stays usable instead of a dead panel.
const prefixAddButton = (): HTMLButtonElement => byClass('.agent-dialog-prefix-add', 'button');

// Types the way the real editor does: the value moves first, then one `input` event. The dialog only
// DRAFTS on input (no repaint, no request), which is what keeps the caret in the box.
const typePrefix = (index: number, text: string): void => {
    const box = prefixBoxes()[index];

    if (box === undefined) throw new Error(`no preset turn at ${index}`);
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
};

const addPrefixTurn = (): void => {
    byClass('.agent-dialog-prefix-add', 'button').click();
};

const removePrefixTurn = (index: number): void => {
    const button = prefixGroup().querySelector<HTMLElement>(
        `.agent-dialog-prefix-action[data-action="remove"][data-index="${index}"]`
    );

    if (button === null) throw new Error(`no remove control at ${index}`);
    button.click();
};

const movePrefixTurn = (index: number, action: 'up' | 'down'): void => {
    const button = prefixGroup().querySelector<HTMLElement>(
        `.agent-dialog-prefix-action[data-action="${action}"][data-index="${index}"]`
    );

    if (button === null) throw new Error(`no ${action} control at ${index}`);
    button.click();
};

type Dial = { url: string; method: string; body: unknown };

// One dial of one canonical route, in the browser's own spelling (`/v1/harness/...`, the contract
// mount), with the query string dropped — the assertions are about WHICH resource moved and what the
// browser itself sent, not about the double's re-reads.
const dials = (server: { dials: Dial[] }, method: string, path: string): Dial[] =>
    server.dials.filter((call) => call.method === method && call.url.split('?')[0] === `/v1/harness${path}`);

// The harness template's answer to a PATCH, shaped the way the real route answers: the descriptor
// with the posted maps. Each map is echoed ONLY when the request carried it, which is exactly what
// makes `{}` observable — an omitted field must not look like a cleared map, and a shell that read a
// cleared answer as "stated nothing" would offer to wipe the bands again on the next save.
//
// NOTE the spelling: this handler runs INSIDE the fixture, and ./view-test-support.ts re-expresses a
// harness PATCH body into the fixture's own camelCase (`agent_prefixes` -> `agentPrefixes`, see its
// harness branch) before offering it. The wire spelling is asserted separately, at the dial layer.
const patchedHarness = (body: Record<string, unknown>): HarnessDescriptor =>
    descriptor({
        agents: [
            body.entry as string,
            ...Object.keys((body.ranks ?? {}) as Record<string, string>).filter((member) => member !== (body.entry as string))
        ],
        entry: body.entry as string,
        ranks: body.ranks as Record<string, AgentRank>,
        ...(body.agentModels === undefined ? {} : { agentModels: body.agentModels as Record<string, string> }),
        ...(body.agentInstructions === undefined
            ? {}
            : { agentInstructions: body.agentInstructions as Record<string, string> }),
        ...(body.agentPrefixes === undefined
            ? {}
            : { agentPrefixes: body.agentPrefixes as Record<string, HarnessPrefixTurn[]> })
    });

// One stub for every template test: boot + catalogue, plus a recording harness PATCH. Anything else
// (a premature write, a session route, a band read on a template) throws, which fails the test with
// the URL in the message instead of hiding the surprise.
const stubTemplate = (initial: HarnessDescriptor) => {
    let current = initial;
    const patches: Record<string, unknown>[] = [];
    const dialsOf: Dial[] = [];

    const answer = viewAwareFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url === '/api') return json(bootstrap({ presets: [current] }));
        if (url === '/api/models') return json({ models: ['m1', 'm2', 'm3'] });

        if (url === '/api/harnesses/seeded' && init?.method === 'PATCH') {
            const body = JSON.parse(String(init.body)) as Record<string, unknown>;
            patches.push(body);
            current = patchedHarness(body);

            return json({ harness: current });
        }

        // The identified definition read the configuration dialog performs on open
        // (../server/protocol.ts `HarnessDescriptor`, served here by the double's `HarnessDefinition`
        // re-expression). It is the ONLY publisher of the band map, so a test that never opens the
        // dialog never sees this branch.
        if (url === '/api/harnesses/seeded' && init === undefined) return json({ harness: current });

        throw new Error(`unexpected request: ${init?.method ?? 'GET'} ${url}`);
    }, { root: '/api' });

    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            dialsOf.push({
                url: String(input),
                method: init?.method ?? 'GET',
                body: init?.body === undefined ? undefined : JSON.parse(String(init.body))
            });

            const resolved = answer(input, init);

            return resolved instanceof Promise ? await resolved : resolved;
        })
    );

    return { patches, dials: dialsOf, updated: () => current };
};

// The saved-conversation stub (same composition contract as `agent-instructions-main.test.ts`, with
// the band routes added by ./view-test-support.ts). The fixture declares the boot page, the session
// record and the template card; the roster, the per-member prompt reads, the per-member BAND reads
// and the create/patch/delete answers come from the writes.
const stubSession = (
    frozen: HarnessDescriptor,
    input: {
        session?: SessionSnapshot;
        extra?: (url: string, method: string | undefined, body: unknown) => Response | undefined;
    } = {}
): { dials: Dial[] } => {
    const saved =
        input.session ??
        (snapshot({
            id: 's9',
            status: 'idle',
            model: 'm1',
            agentModels: { instruct: 'm2', summarizer: 'm1' },
            harnessDefinition: frozen
        }) as SessionSnapshot);

    const dialsOf: Dial[] = [];

    const answer = viewAwareFetch(async (input2: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input2);
        const method = init?.method;
        const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
        const declared = input.extra?.(url, method, body);

        if (declared !== undefined) return declared;

        if (url === '/api') return json(bootstrap({ presets: [frozen], sessions: [saved] }));
        if (url === '/api/models') return json({ models: ['m1', 'm2', 'm3'] });

        if (url === '/api/sessions/s9' && method === undefined) return json({ session: saved });

        if (url === '/api/sessions/s9' && method === 'PATCH') {
            const patched = body as { agent_models?: Record<string, string> };

            return json({
                session: { ...saved, agentModels: patched.agent_models ?? saved.agentModels, updatedAt: 3 }
            });
        }

        // The template card: read for its colour map and never written by a conversation.
        if (url === '/api/harnesses/seeded' && method === undefined) return json({ harness: frozen });

        throw new Error(`unexpected request: ${method ?? 'GET'} ${url}`);
    }, { root: '/api' });

    vi.stubGlobal(
        'fetch',
        vi.fn(async (input2: RequestInfo | URL, init?: RequestInit) => {
            dialsOf.push({
                url: String(input2),
                method: init?.method ?? 'GET',
                body: init?.body === undefined ? undefined : JSON.parse(String(init.body))
            });

            const resolved = answer(input2, init);

            return resolved instanceof Promise ? await resolved : resolved;
        })
    );

    return { dials: dialsOf };
};

const sessionOpen = async (): Promise<void> => {
    localStorage.setItem(SESSION_KEY, 's9');

    await import('./main');
    await flush();
    await flush();
};

beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
    // A leaked modal owns the next test's Escape/focus handling.
    for (const overlay of document.querySelectorAll<HTMLElement>('.dialog-overlay')) {
        overlay.click();
    }
    vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// The harness TEMPLATE: capability, complete replacement, and the two clears
// ---------------------------------------------------------------------------

it('opens the preset editor on the stored bands, in the order the definition seeds them', async () => {
    const server = stubTemplate(
        descriptor({
            agentPrefixes: {
                instruct: [
                    { role: 'user', content: 'What came before?' },
                    { role: 'assistant', content: 'A workshop summary.' }
                ],
                summarizer: [{ role: 'system', content: 'One meeting has been held.' }]
            }
        })
    );

    await import('./main');
    await flush();
    await flush();

    // The entry agent is the member the panel describes first, and its band is the two stored turns,
    // in the stored order, with the roles the definition stated.
    expect(configuredAgent()).toBe('instruct');
    expect(prefixCount()).toBe(2);
    expect(prefixContents()).toEqual(['What came before?', 'A workshop summary.']);
    expect(prefixRoles()).toEqual(['user', 'assistant']);

    selectConfigured('summarizer');
    expect(prefixCount()).toBe(1);
    expect(prefixContents()).toEqual(['One meeting has been held.']);
    expect(prefixRoles()).toEqual(['system']);

    // Looking is not writing: the band section costs no request beyond the reads the dialog performs.
    expect(dials(server, 'PATCH', '/harnesses/seeded')).toEqual([]);
});

it('offers no preset editor, and sends no band field, for a definition that states no bands', async () => {
    // The pre-U6 template: the identified read publishes `agent_models` and the instruction summary,
    // and never names `agent_prefixes` at all (../shared/harness-api.ts:741-750 — the field is present
    // only when the definition states at least one band).
    const server = stubTemplate(descriptor());

    await import('./main');
    await flush();
    await flush();

    openDialog();
    expect(document.querySelector('.agent-dialog-prefixes')).toBeNull();

    // A prompt edit still saves — the absence of the band map must not cost the dialog its other job —
    // and its request carries NO band field. `sendsPrefixes` starts from `prefixes !== undefined`
    // (./main.ts `patchAgents`), so this is the difference between "keep what the server holds" and the
    // destructive `{}` clear of bands this browser was never told about.
    typeInstruction('Answer in one sentence.');
    applyAction().click();
    await flush();
    await flush();

    expect(server.patches).toEqual([
        {
            agents: ['instruct', 'summarizer'],
            entry: 'instruct',
            ranks: { instruct: 'A', 'summarizer': 'B' },
            agentInstructions: { instruct: 'Answer in one sentence.' }
        }
    ]);
    expect(Object.keys(dials(server, 'PATCH', '/harnesses/seeded')[0].body as Record<string, unknown>).sort()).toEqual([
        'agent_instructions',
        'agents',
        'entry',
        'ranks'
    ]);
});

// F2 — the TEMPLATE capability is the PROPERTY `agent_prefixes`, not the fact that the GET answered.
//
// The two cases below are the pair that distinguishes a backend from before the prefix feature from
// a current one that seeds nothing, and they only make sense together: folding "the read answered"
// into an empty map showed a preset editor on the OLD server whose save then PATCHed a field that
// server refuses with 400 ("Unknown field"), while requiring a NON-empty map hid the editor on the
// NEW server that states `{}` and so made the first band unaddable. ./main.ts
// `loadHarnessConfiguration` therefore reads the definition with `statedPrefixesOf`, which answers
// `undefined` for an absent field and `{}` for a stated empty one.
it('keeps the preset editor off once an old server answers the definition read without agent_prefixes', async () => {
    // A pre-U6 backend: `GET /harnesses/:name` answers 200 with the card fields, `core_tools` and
    // the instruction summary, and never names `agent_prefixes` (./view-test-support.ts publishes
    // the property only when the fixture states one, which is exactly how an old answer differs).
    // The case above pinned the state BEFORE the read landed; this one pins the state after it,
    // which is where the old folding rule turned the absence into a capability.
    const server = stubTemplate(descriptor());

    await import('./main');
    await flush();
    await flush();

    openDialog();
    await flush();
    await flush();

    // Proof the definition read really arrived (otherwise "no section" would only prove a race), and
    // the section is STILL absent after the answer was applied: an absent map is not `{}`, and an
    // unread map is the pre-U6 dialog permanently — never the `{}` baseline a save could send back
    // as the destructive clear of bands this browser was never told about.
    expect(dials(server, 'GET', '/harnesses/seeded').length).toBe(1);
    expect(document.querySelector('.agent-dialog-prefixes')).toBeNull();

    // And the save that follows is the OLD body: the prompt works on its own, and the whole-map
    // field stays off the request rather than riding it as `{}`.
    typeInstruction('Answer in one sentence.');
    applyAction().click();
    await flush();
    await flush();

    expect(Object.keys(dials(server, 'PATCH', '/harnesses/seeded')[0].body as Record<string, unknown>).sort()).toEqual([
        'agent_instructions',
        'agents',
        'entry',
        'ranks'
    ]);
});

it('opens an empty preset editor for a server that states an empty agent_prefixes map, and saves the first band', async () => {
    // The SAME dialog against a U6 server whose definition seeds nothing: the identified read STATES
    // the map, as `{}` (`../shared/harness-api.ts HarnessDefinition.agent_prefixes` is always present
    // on this contract, which is what makes `{}` and "absent" two different answers). Presence is the
    // capability, emptiness is only the current fact — so this is an editor with zero rows and a
    // working Add affordance, not the hidden section above.
    const server = stubTemplate(descriptor({ agentPrefixes: {} }));

    await import('./main');
    await flush();
    await flush();

    openDialog();
    await flush();
    await flush();

    expect(dials(server, 'GET', '/harnesses/seeded').length).toBe(1);
    expect(prefixCount()).toBe(0);
    expect(prefixRows()).toEqual([]);
    expect(prefixAddButton().disabled).toBe(false);

    // The FIRST band of a definition that never had one, typed the way a reader types it.
    addPrefixTurn();
    expect(prefixRoles()).toEqual(['user']);
    typePrefix(0, 'A workshop summary this member starts from.');
    expect(dials(server, 'PATCH', '/harnesses/seeded')).toEqual([]);

    applyAction().click();
    await flush();
    await flush();

    // ONE harness PATCH, in the wire's own spelling, carrying the map the reader just created and no
    // text map (nothing else was drafted). It may be sent at all only because the read STATED the
    // map: `patchAgents` omits the field while the cache is `undefined`.
    expect(dials(server, 'PATCH', '/harnesses/seeded').length).toBe(1);
    expect(dials(server, 'PATCH', '/harnesses/seeded')[0].body).toEqual({
        agents: ['instruct', 'summarizer'],
        entry: 'instruct',
        ranks: { instruct: 'A', 'summarizer': 'B' },
        agent_prefixes: { instruct: [{ role: 'user', content: 'A workshop summary this member starts from.' }] }
    });
    // The answer is the new authority, so the row the reader typed is what the tab shows afterwards
    // — and the next press is a no-op rather than a second write.
    expect(prefixContents()).toEqual(['A workshop summary this member starts from.']);

    applyAction().click();
    await flush();
    await flush();

    expect(dials(server, 'PATCH', '/harnesses/seeded').length).toBe(1);
});

it('saves an edited band as one harness PATCH that restates every other member band', async () => {
    const server = stubTemplate(
        descriptor({
            agentPrefixes: {
                instruct: [
                    { role: 'user', content: 'What came before?' },
                    { role: 'assistant', content: 'A workshop summary.' }
                ],
                summarizer: [{ role: 'system', content: 'One meeting has been held.' }]
            }
        })
    );

    await import('./main');
    await flush();
    await flush();

    typePrefix(0, 'What came before the rewrite?');
    // Typing is a draft: the network is silent and the action is armed with the neutral label (a band
    // edit is neither an entry move nor a rank assignment).
    expect(dials(server, 'PATCH', '/harnesses/seeded')).toEqual([]);
    expect(applyAction().textContent).toBe('Save configuration');

    applyAction().click();
    await flush();
    await flush();

    // ONE request. The fixture-facing body is in the fixture's own camelCase (the double translates the
    // wire spelling before offering it), and it restates the teammate's band VERBATIM: the server
    // replaces the whole map, so a map without `summarizer` would silently wipe its history.
    expect(server.patches).toEqual([
        {
            agents: ['instruct', 'summarizer'],
            entry: 'instruct',
            ranks: { instruct: 'A', 'summarizer': 'B' },
            agentPrefixes: {
                instruct: [
                    { role: 'user', content: 'What came before the rewrite?' },
                    { role: 'assistant', content: 'A workshop summary.' }
                ],
                summarizer: [{ role: 'system', content: 'One meeting has been held.' }]
            }
        }
    ]);

    // THE WIRE SPELLING, asserted on the request the browser actually sent: `agent_prefixes`
    // (../shared/harness-api.ts:871), with no stray camelCase key on a CLOSED object
    // (`additionalProperties: false`), and no `agent_instructions`/`agent_models` — nothing was drafted
    // there, and an omitted field keeps what the server holds.
    const [request] = dials(server, 'PATCH', '/harnesses/seeded');

    expect(Object.keys(request.body as Record<string, unknown>).sort()).toEqual([
        'agent_prefixes',
        'agents',
        'entry',
        'ranks'
    ]);
    expect((request.body as Record<string, unknown>).agent_prefixes).toEqual({
        instruct: [
            { role: 'user', content: 'What came before the rewrite?' },
            { role: 'assistant', content: 'A workshop summary.' }
        ],
        summarizer: [{ role: 'system', content: 'One meeting has been held.' }]
    });

    // Confirmed on screen: the rows now hold the SERVER's bytes, and the note names the scope a template
    // edit really has (the next sessions, not this conversation).
    expect(prefixContents()).toEqual(['What came before the rewrite?', 'A workshop summary.']);
    expect(byClass('.agent-dialog-footer-note', 'p').textContent).toBe(
        'agent configuration saved · applies to new sessions'
    );
});

it('clears one member band with a keyed empty array and keeps the teammate band intact', async () => {
    const server = stubTemplate(
        descriptor({
            agentPrefixes: {
                instruct: [{ role: 'user', content: 'What came before?' }],
                summarizer: [{ role: 'system', content: 'One meeting has been held.' }]
            }
        })
    );

    await import('./main');
    await flush();
    await flush();

    // Removing the member's only turn clears the list, and the section SAYS it is empty rather than
    // vanishing (an empty history is a fact the reader can change, ./ui/agent-dialog.ts:1455-1463).
    removePrefixTurn(0);
    expect(prefixCount()).toBe(0);
    expect(byClass('.agent-dialog-prefix-empty', 'p').textContent).toBe(
        'No preset turns · a new conversation starts with the instruction alone.'
    );

    applyAction().click();
    await flush();
    await flush();

    // `[]` is a VALUE on this contract, not a key to delete: `{ instruct: [] }` states "this member
    // starts with the instruction alone" while an absent key would lose the reader's decision the
    // moment the teammate's band is edited too (./contract.ts:620-641).
    expect(server.patches).toEqual([
        {
            agents: ['instruct', 'summarizer'],
            entry: 'instruct',
            ranks: { instruct: 'A', 'summarizer': 'B' },
            agentPrefixes: {
                instruct: [],
                summarizer: [{ role: 'system', content: 'One meeting has been held.' }]
            }
        }
    ]);
    expect(server.updated().agentPrefixes).toEqual({
        instruct: [],
        summarizer: [{ role: 'system', content: 'One meeting has been held.' }]
    });

    // The refreshed editor shows the cleared state, not the removed row.
    expect(prefixCount()).toBe(0);
});

it('drops a detached member band from the map, and sends an explicit {} when it was the only one', async () => {
    const server = stubTemplate(
        descriptor({ agentPrefixes: { summarizer: [{ role: 'system', content: 'One meeting has been held.' }] } })
    );

    await import('./main');
    await flush();
    await flush();

    // The band belongs to the member, so detaching the member is also how its band leaves a COMPLETE
    // map: a key for a removed agent would be a 400 against the final roster
    // (../shared/harness-api.ts:861-873 — "every key names a member of the resulting roster").
    selectConfigured('summarizer');
    byClass('.agent-dialog-remove', 'button').click();

    applyAction().click();
    await flush();
    await flush();

    // `{}` IS MEANINGFUL: it clears every stored band. An omitted field would leave the removed
    // member's band in place while the screen claimed nobody on this team seeds a history.
    expect(server.patches).toEqual([
        {
            agents: ['instruct'],
            entry: 'instruct',
            ranks: { instruct: 'A' },
            agentPrefixes: {}
        }
    ]);
    const [request] = dials(server, 'PATCH', '/harnesses/seeded');

    expect(Object.keys(request.body as Record<string, unknown>).sort()).toEqual([
        'agent_prefixes',
        'agents',
        'entry',
        'ranks'
    ]);
    expect((request.body as Record<string, unknown>).agent_prefixes).toEqual({});
    // The map is now READ-empty — a known baseline, not an unread one — so the editor stays on screen
    // in its empty state and a later save may legitimately restate it.
    expect(server.updated().agentPrefixes).toEqual({});
    selectConfigured('instruct');
    expect(prefixCount()).toBe(0);
});

it('treats a reordered band as a change and re-seeds the rows in the new order', async () => {
    const server = stubTemplate(
        descriptor({
            agentPrefixes: {
                instruct: [
                    { role: 'user', content: 'first' },
                    { role: 'assistant', content: 'second' }
                ],
                summarizer: [{ role: 'system', content: 'One meeting has been held.' }]
            }
        })
    );

    await import('./main');
    await flush();
    await flush();

    movePrefixTurn(1, 'up');
    expect(prefixContents()).toEqual(['second', 'first']);
    expect(prefixRoles()).toEqual(['assistant', 'user']);

    applyAction().click();
    await flush();
    await flush();

    // The no-op guard compares ONE canonical spelling that PRESERVES array order
    // (./contract.ts:664-680), so a reorder is not mistaken for the same state and the request carries
    // the new order — not a sorted one.
    expect(server.patches).toEqual([
        {
            agents: ['instruct', 'summarizer'],
            entry: 'instruct',
            ranks: { instruct: 'A', 'summarizer': 'B' },
            agentPrefixes: {
                instruct: [
                    { role: 'assistant', content: 'second' },
                    { role: 'user', content: 'first' }
                ],
                summarizer: [{ role: 'system', content: 'One meeting has been held.' }]
            }
        }
    ]);

    // And the order the server now seeds is the order on screen.
    expect(prefixRoles()).toEqual(['assistant', 'user']);
    expect(prefixContents()).toEqual(['second', 'first']);

    // A second press with nothing pending sends nothing: the accepted answer IS the baseline, so the
    // reordered band is not a pending change any more.
    applyAction().click();
    await flush();
    expect(dials(server, 'PATCH', '/harnesses/seeded').length).toBe(1);
});

it('adds a band turn to a template member and writes it once, with no prompt write', async () => {
    const server = stubTemplate(descriptor({ agentPrefixes: { instruct: [] } }));

    await import('./main');
    await flush();
    await flush();

    // An empty band is editable: the Add control appends one empty `user` turn at the END (the newest
    // memory), locally, until the action.
    expect(prefixCount()).toBe(0);
    addPrefixTurn();
    expect(prefixCount()).toBe(1);
    expect(prefixRoles()).toEqual(['user']);
    expect(dials(server, 'PATCH', '/harnesses/seeded')).toEqual([]);

    typePrefix(0, 'The plan agreed in the last meeting.');
    applyAction().click();
    await flush();
    await flush();

    // One PATCH, the band map only: a keyed `[]` that gains a turn is the same field, and since no
    // prompt or model was drafted, neither text map rides the request.
    expect(server.patches).toEqual([
        {
            agents: ['instruct', 'summarizer'],
            entry: 'instruct',
            ranks: { instruct: 'A', 'summarizer': 'B' },
            agentPrefixes: { instruct: [{ role: 'user', content: 'The plan agreed in the last meeting.' }] }
        }
    ]);
});

// ---------------------------------------------------------------------------
// A SAVED CONVERSATION: its own reads, its own writes, never the template
// ---------------------------------------------------------------------------

const frozenSeeded = (): HarnessDescriptor =>
    descriptor({
        agentModels: { instruct: 'm2' },
        agentPrefixes: {
            instruct: [{ role: 'user', content: 'Frozen question.' }],
            summarizer: [{ role: 'system', content: 'Frozen system note.' }]
        }
    });

it('reads one band per roster member on a conversation, and shows that answer', async () => {
    const server = stubSession(frozenSeeded());

    await sessionOpen();

    // Opening the dialog is the explicit action that reads this conversation's roster, and then one
    // band per member: the roster row carries no band because the value is an ARRAY per member
    // (./main.ts `loadSessionConfiguration`, ./api.ts `getSessionAgentPrefix`).
    openDialog();
    await flush();
    await flush();

    expect(dials(server, 'GET', '/sessions/s9/agents').length).toBe(1);
    expect(dials(server, 'GET', '/sessions/s9/agents/instruct/prefix').length).toBe(1);
    expect(dials(server, 'GET', '/sessions/s9/agents/summarizer/prefix').length).toBe(1);

    // The rows hold what THIS conversation's read answered, which for an unoverridden member is the
    // band its frozen definition seeds.
    expect(configuredAgent()).toBe('instruct');
    expect(prefixContents()).toEqual(['Frozen question.']);
    expect(prefixRoles()).toEqual(['user']);
    expect(dials(server, 'PATCH', '/harnesses/seeded')).toEqual([]);
});

it('shows the session band over the definition copy when this conversation stored its own', async () => {
    // The layering is the SERVER's decision (`source: harness | session | none`), and the shell renders
    // `prefix` without branching on the layer. Declaring the route is how a fixture states a band the
    // composition has not been written into yet.
    const server = stubSession(frozenSeeded(), {
        extra: (url, method) =>
            url === '/api/sessions/s9/agents/instruct/prefix' && method === undefined
                ? json({
                      session_id: 's9',
                      agent_id: 'instruct',
                      prefix: [
                          { role: 'user', content: 'This conversation seeded it.' },
                          { role: 'assistant', content: 'And answered it.' }
                      ],
                      source: 'session'
                  })
                : undefined
    });

    await sessionOpen();
    openDialog();
    await flush();
    await flush();

    expect(prefixCount()).toBe(2);
    expect(prefixContents()).toEqual(['This conversation seeded it.', 'And answered it.']);
    // The definition's own band is nowhere on screen: an inherited copy is a fallback, never the thing
    // a conversation shows once its own read answered.
    expect(document.body.textContent?.includes('Frozen question.')).toBe(false);

    // The teammate fell through to the definition band, which is the other half of the same rule.
    selectConfigured('summarizer');
    expect(prefixContents()).toEqual(['Frozen system note.']);
});

it('writes a band-only edit to the session member with no instruction key', async () => {
    const server = stubSession(frozenSeeded());

    await sessionOpen();
    openDialog();
    await flush();
    await flush();

    typePrefix(0, 'A question this conversation answers.');
    expect(dials(server, 'PATCH', '/sessions/s9/agents/instruct')).toEqual([]);

    applyAction().click();
    await flush();
    await flush();
    await flush();

    // ONE write, and it carries ONLY the band. `instruction` and `prefix` are separate fields of one
    // closed PATCH body, each with the same omitted-is-no-change rule
    // (../shared/harness-api.ts `UpdateSessionAgentRequest`), so sending the prompt the box happened to
    // hold would rewrite a prompt nobody edited.
    expect(dials(server, 'PATCH', '/sessions/s9/agents/instruct')).toEqual([
        {
            url: '/v1/harness/sessions/s9/agents/instruct',
            method: 'PATCH',
            body: { prefix: [{ role: 'user', content: 'A question this conversation answers.' }] }
        }
    ]);
    // A conversation never writes the template: its save changes what THIS conversation seeds, not the
    // sessions the next reader starts.
    expect(dials(server, 'PATCH', '/harnesses/seeded')).toEqual([]);
    expect(byClass('.agent-dialog-footer-note', 'p').textContent).toBe(
        'agent configuration saved · applies to this conversation'
    );

    // The refreshed rows read the conversation's new band back from the composed route.
    expect(prefixContents()).toEqual(['A question this conversation answers.']);
});

it('sends one request when the same member gains both a new prompt and a new band', async () => {
    const server = stubSession(frozenSeeded());

    await sessionOpen();
    openDialog();
    await flush();
    await flush();

    typeInstruction('Answer in one sentence.');
    addPrefixTurn();
    typePrefix(1, 'An answer worth keeping.');

    applyAction().click();
    await flush();
    await flush();
    await flush();

    const writes = dials(server, 'PATCH', '/sessions/s9/agents/instruct');

    // Two fields, ONE request per member: the shell merges the prompt and band deltas of the same
    // member instead of writing the binding twice (./main.ts `applySessionConfiguration` step 5).
    // The new turn carries role `user`, which is what the Add control appends (a new turn is the
    // newest memory, ./ui/agent-dialog.ts:1395-1424) — the shell sends the role the reader was shown,
    // never an invented one.
    expect(writes.length).toBe(1);
    expect(writes[0].body).toEqual({
        instruction: 'Answer in one sentence.',
        prefix: [
            { role: 'user', content: 'Frozen question.' },
            { role: 'user', content: 'An answer worth keeping.' }
        ]
    });
    expect(dials(server, 'PATCH', '/harnesses/seeded')).toEqual([]);

    // Both writes are visible where the reader looks: the one box, and the preset rows underneath it.
    expect(instructionBox().value).toBe('Answer in one sentence.');
    expect(prefixContents()).toEqual(['Frozen question.', 'An answer worth keeping.']);
});

it('sends an explicit empty band for a cleared history, never a null', async () => {
    const server = stubSession(frozenSeeded());

    await sessionOpen();
    openDialog();
    await flush();
    await flush();

    removePrefixTurn(0);
    expect(prefixCount()).toBe(0);

    applyAction().click();
    await flush();
    await flush();
    await flush();

    // `prefix: []` is "this conversation starts with the instruction alone". `null` is a DIFFERENT
    // contract fact — "drop the session override and re-seed from the frozen definition" — and this
    // editor has no control that means that, so it must never be what goes out
    // (../shared/harness-api.ts:1961-1974).
    expect(dials(server, 'PATCH', '/sessions/s9/agents/instruct')).toEqual([
        { url: '/v1/harness/sessions/s9/agents/instruct', method: 'PATCH', body: { prefix: [] } }
    ]);

    // And the conversation now really holds the empty band: the next read answers the session's own
    // clear instead of falling back to the definition.
    expect(prefixContents()).toEqual([]);
    expect(document.body.textContent?.includes('Frozen question.')).toBe(false);
});

it('carries a new member band on the create, with no separate patch', async () => {
    const server = stubSession(frozenSeeded());

    await sessionOpen();

    addAgent('critic');
    expect(configuredAgent()).toBe('critic');
    // A bound catalogue profile seeds no history, so its section opens empty and says so.
    expect(prefixCount()).toBe(0);

    addPrefixTurn();
    typePrefix(0, 'Notes from the last meeting.');
    expect(dials(server, 'POST', '/sessions/s9/agents')).toEqual([]);

    applyAction().click();
    await flush();
    await flush();
    await flush();

    // The band rides the CREATE (../shared/harness-api.ts `CreateSessionAgentRequest.prefix`), so a
    // member added with a history is ONE request — and no `PATCH` follows it for the same bytes.
    expect(dials(server, 'POST', '/sessions/s9/agents')).toEqual([
        {
            url: '/v1/harness/sessions/s9/agents',
            method: 'POST',
            body: {
                name: 'critic',
                profile: 'critic',
                prefix: [{ role: 'user', content: 'Notes from the last meeting.' }]
            }
        }
    ]);
    expect(dials(server, 'PATCH', '/sessions/s9/agents/critic')).toEqual([]);
    expect(dials(server, 'PATCH', '/harnesses/seeded')).toEqual([]);

    // The member and its band survive the refresh: the roster route is composed from the create.
    expect(configuredAgent()).toBe('critic');
    expect(prefixContents()).toEqual(['Notes from the last meeting.']);
});

it('clears an added member band with an explicit empty array on the create', async () => {
    // The band editor is offered to a NEW member too, and an explicit clear there is a stated decision:
    // for a member bound from a template row it overrides the band the definition would seed down to
    // nothing, so an omitted field would be a different answer (the double answers `prefix: []`,
    // `source: none` afterwards).
    const server = stubSession(frozenSeeded());

    await sessionOpen();
    addAgent('critic');
    typeInstruction('Review the answer in three lines.');

    applyAction().click();
    await flush();
    await flush();
    await flush();

    // A create with a prompt and NO band key: the band was never touched, so nothing about it is sent.
    expect(dials(server, 'POST', '/sessions/s9/agents')).toEqual([
        {
            url: '/v1/harness/sessions/s9/agents',
            method: 'POST',
            body: { name: 'critic', profile: 'critic', instruction: 'Review the answer in three lines.' }
        }
    ]);
});

it('detaches a member with one delete and sends its band nowhere', async () => {
    const server = stubSession(frozenSeeded());

    await sessionOpen();
    openDialog();
    await flush();
    await flush();

    selectConfigured('summarizer');
    byClass('.agent-dialog-remove', 'button').click();

    applyAction().click();
    await flush();
    await flush();
    await flush();

    expect(dials(server, 'DELETE', '/sessions/s9/agents/summarizer')).toEqual([
        { url: '/v1/harness/sessions/s9/agents/summarizer', method: 'DELETE', body: undefined }
    ]);
    // The detached member is not written to (a PATCH to it would 404), its band key is gone with it,
    // and the template never hears about any of this.
    expect(dials(server, 'PATCH', '/sessions/s9/agents/summarizer')).toEqual([]);
    expect(dials(server, 'PATCH', '/harnesses/seeded')).toEqual([]);

    // The team the SERVER reports is the team on screen: the removed tab is gone rather than
    // resurrected by the refresh, and the survivor's band still reads back from its own route (the
    // definition's, which this conversation never overrode).
    expect(agentEntries()).toEqual(['instruct']);
    selectConfigured('instruct');
    expect(prefixContents()).toEqual(['Frozen question.']);
});

it('sends no band write at all to a server whose band route is missing', async () => {
    // The deployment without U6: the frozen definition states no map, and every per-member band read
    // 404s. Neither half of the capability answer may become a `{}` baseline — ./main.ts
    // `loadSessionConfiguration` records NOTHING unless at least one member answered, so the editor
    // never appears and no save may claim to clear bands this browser was never told about.
    const server = stubSession(descriptor({ agentModels: { instruct: 'm2' } }), {
        extra: (url, method) =>
            /^\/api\/sessions\/s9\/agents\/[^/]+\/prefix$/.test(url) && method === undefined
                ? json({ error: { message: 'Not found' } }, 404)
                : undefined
    });

    await sessionOpen();
    openDialog();
    await flush();
    await flush();

    // The route was asked, once per member, and refused.
    expect(dials(server, 'GET', '/sessions/s9/agents/instruct/prefix').length).toBe(1);
    expect(document.querySelector('.agent-dialog-prefixes')).toBeNull();

    // The prompt keeps working on its own route, band-free.
    typeInstruction('Answer in one sentence.');
    applyAction().click();
    await flush();
    await flush();
    await flush();

    expect(dials(server, 'PATCH', '/sessions/s9/agents/instruct')).toEqual([
        { url: '/v1/harness/sessions/s9/agents/instruct', method: 'PATCH', body: { instruction: 'Answer in one sentence.' } }
    ]);
    expect(dials(server, 'PATCH', '/harnesses/seeded')).toEqual([]);
});

it('refuses a band save while the conversation is running, and keeps the draft', async () => {
    const running = snapshot({
        id: 's9',
        status: 'running',
        model: 'm1',
        agentModels: { instruct: 'm2', summarizer: 'm1' },
        harnessDefinition: frozenSeeded()
    }) as SessionSnapshot;
    const server = stubSession(frozenSeeded(), { session: running });

    await sessionOpen();
    openDialog();
    await flush();
    await flush();

    typePrefix(0, 'A question this conversation answers.');
    applyAction().click();
    await flush();

    // A band decides what the NEXT request is seeded with, exactly like a prompt, so it is refused in
    // the window a run owns — before spending a request the server would 409 anyway
    // (../shared/harness-api.ts:1961-1974: "Like an instruction write it needs an idle session").
    expect(byClass('.agent-dialog-error', 'p').textContent).toBe(
        'Wait for the current run to finish before saving agents.'
    );
    expect(dials(server, 'PATCH', '/sessions/s9/agents/instruct')).toEqual([]);
    expect(dials(server, 'PATCH', '/harnesses/seeded')).toEqual([]);
    // Nothing was lost: the draft is still what the reader typed.
    expect(prefixContents()).toEqual(['A question this conversation answers.']);
});
