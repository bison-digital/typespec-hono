import "@typespec/http";

using Http;

/**
 * **The registration shapes, which are this package's own and nobody else's.**
 *
 * A LOCAL fixture. `service.tsp` beside it is vendored from `typespec-http-zod` and digest-guarded,
 * because both packages serve one spec to answer "can an application be built on both". How a verb
 * reaches a router is not a question the library has, so it belongs here rather than in the shared
 * file, and adding it there would desynchronise two repositories over a Hono concern.
 *
 * Hono rewrites every HEAD request to GET before matching, so a `@head` operation is registered
 * under GET. That gives two cases which behave differently and which the emitter must tell apart:
 *
 * - **a HEAD sharing its path with a GET** shares one registration, and the handler reads
 *   `c.req.method` to decide which operation it is;
 * - **a HEAD alone on its path** has nothing to share with, so registering it under GET would answer
 *   a `GET` the document never declared. `headOnly` is the guard that keeps that route honest, by
 *   giving a real GET the 404 it would have got had the route never been registered.
 *
 * **The second case was emitted by nothing this package compiles.** Measured across every fixture:
 * `headOnly,` appeared zero times, while the conformance corpus emitted it 89 times. Corpus output is
 * differentiated against the document but never handed to `tsc` and never sent a request, so the
 * guarded branch was covered by nothing that would notice it breaking.
 */
@service(#{ title: "Verbs" })
namespace Verbs;

model Widget {
  id: string;
  name: string;
}

@route("/widgets/{widgetId}")
@get
op readWidget(@path widgetId: string): Widget;

/** Shares the registration above: one slot, two operations, told apart by `c.req.method`. */
@route("/widgets/{widgetId}")
@head
op widgetExists(@path widgetId: string): void;

/** Alone on its path, so the registration needs `headOnly` to refuse a GET nobody declared. */
@route("/status")
@head
op statusExists(): void;
