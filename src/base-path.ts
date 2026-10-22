import { getServers, type HttpServer } from "@typespec/http";
import type { Namespace, Program } from "@typespec/compiler";

/**
 * The path prefix the DOCUMENT says this service is served under.
 *
 * **Without this the two artefacts from one spec disagree, which is the thing this project exists
 * to prevent.** `@server("/api/v1")` reaches OpenAPI as `servers: [{ url: "/api/v1" }]`, and an
 * OpenAPI path is relative to its server, so the document says `/api/v1/accounts` while the
 * generated router answered `/accounts`. Measured: every client generated from the document, and
 * every "try it" button in a rendered document, 404s.
 *
 * **Every declared prefix is honoured, because the document publishes all of them.** A route
 * mounted under only one of several still matches and still answers, and answers the wrong URL for
 * every caller who followed one of the others.
 */

/** The static path of a server URL, or `undefined` when it has none this can rely on. */
function pathOf(server: HttpServer): string | undefined {
	const url = server.url;
	/**
	 * **A templated URL is not a mismatch and must not warn.** `@server("{endpoint}")`, which most
	 * of `@typespec/http-specs` uses, means the whole origin is supplied by the caller, so the paths
	 * the document publishes are already relative to whatever they choose. Mounting at the root is
	 * correct there, and warning would raise noise on the majority of real specs.
	 */
	if (url.includes("{")) return undefined;
	// An absolute URL carries a host; only its path is a prefix.
	const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? (URL.parse(url)?.pathname ?? "/") : url;
	const trimmed = path.replace(/\/+$/, "");
	return trimmed === "" || trimmed === "/" ? undefined : trimmed;
}

export interface BasePathResolution {
	/**
	 * Every prefix the document publishes, in declaration order after de-duplication.
	 *
	 * Empty means the root, which is what a document with no `@server` -- or a templated one -- means.
	 * More than one is not a conflict to resolve: the document says the service answers at all of
	 * them, and Hono mounts one sub-app under several prefixes without duplicating a single route.
	 */
	readonly basePaths: readonly string[];
}

/**
 * Read the service's declared servers and return every prefix it publishes.
 *
 * - no `@server`, or a templated one, gives none, and the routes mount at the root;
 * - one static path gives that path;
 * - several give all of them, each mounted with its own `app.route()` over one shared sub-app.
 *
 * **Several servers used to be reported as ambiguous and mounted at the root.** That was wrong in
 * the one way that matters: an OpenAPI path is relative to its server, so every caller following the
 * document prefixed one of the declared paths and got a 404. The document was never ambiguous -- it
 * says the service answers at all of them -- and Hono mounts one sub-app under as many prefixes as
 * asked, so there was nothing to choose between in the first place.
 */
export function resolveBasePath(program: Program, namespace: Namespace): BasePathResolution {
	const servers = getServers(program, namespace) ?? [];
	return {
		basePaths: [...new Set(servers.map(pathOf).filter((path) => path !== undefined))],
	};
}
