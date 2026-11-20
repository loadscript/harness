// A tiny real-filesystem glob used by the two UI tests that exercise the
// composer/preview pattern shapes end to end.
//
// The browser package is standalone: it does not import the server-side `glob`
// tool (or the library that ships it), so these tests walk a disposable tree with
// this local matcher instead. It implements exactly the pattern surface the UI
// sends: `**/` may consume zero or more directories, `*` never crosses a `/`,
// `?` is one character, and matching is case-sensitive. Paths are returned
// root-prefixed (absolute when the root is absolute), matching the wire shape the
// real tool answers with.

import { readdir } from 'node:fs/promises';
import path from 'node:path';

export type GlobOptions = {
    patterns: readonly string[];
    paths?: readonly string[];
    maxResults?: number;
};

export type GlobAnswer = {
    files: string[];
    truncated: boolean;
};

const escapeRegExp = (value: string): string => value.replace(/[.+^${}()|[\]\\]/gu, '\\$&');

const globRegExp = (pattern: string): RegExp => {
    let source = '^';

    for (let index = 0; index < pattern.length; index += 1) {
        const char = pattern[index] ?? '';

        if (char === '*') {
            if (pattern[index + 1] === '*') {
                index += 1;
                if (pattern[index + 1] === '/') {
                    index += 1;
                    source += '(?:.*/)?';
                } else {
                    source += '.*';
                }
            } else {
                source += '[^/]*';
            }
            continue;
        }

        if (char === '?') {
            source += '[^/]';
            continue;
        }

        source += escapeRegExp(char);
    }

    return new RegExp(`${source}$`, 'u');
};

const walk = async (directory: string, files: string[]): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(full, files);
        else if (entry.isFile()) files.push(full);
    }
};

export const glob = async ({
    patterns,
    paths = ['.'],
    maxResults = Number.POSITIVE_INFINITY
}: GlobOptions): Promise<GlobAnswer> => {
    const matchers = patterns.map(globRegExp);
    const matches = new Set<string>();

    for (const root of paths) {
        const files: string[] = [];
        await walk(path.resolve(root), files);

        for (const file of files) {
            const relative = path.relative(path.resolve(root), file).replace(/\\/gu, '/');
            if (matchers.some((matcher) => matcher.test(relative))) matches.add(file);
        }
    }

    const ordered = [...matches];
    return {
        files: ordered.slice(0, maxResults),
        truncated: ordered.length > maxResults
    };
};
