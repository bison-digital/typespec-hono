/**
 * The package's entry point: what a consumer may use, and the emitter written against it.
 *
 * **`typespec-http-zod` is re-exported deliberately.** This emitter runs the whole of it, so a
 * consumer of the generated server is already a consumer of those validators and their types. Making
 * them reach for a second package to name a schema this one caused to exist would be an accident of
 * packaging showing through.
 */
export * from "typespec-http-zod";
export { $lib } from "./lib.js";
export { $onEmit } from "./emitter.js";
export { renderApp, toHonoPath } from "./app.js";
