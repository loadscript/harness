// The package root of @loadscript/harness.
//
// The reusable browser client of the harness, moved here from
// @underload/harness unchanged: the API/contract helpers, the panel extension
// seam, and the UI panels. `./frontend/index.ts` is the client barrel; the
// application shell (`./frontend/main.ts`) is deliberately not exported.
export * from './frontend';
