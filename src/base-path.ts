import { getServers, type HttpServer } from "@typespec/http";
import type { Namespace, Program } from "@typespec/compiler";

/**
 * The path prefix the DOCUMENT says this service is served under.
 *
 * ⚠️ **Without this the two artefacts from one spec disagree, which is the thing this project exists
 * to prevent.** `@server("/api/v1")` reaches OpenAPI as `servers: [{ url: "/api/v1" }]`, and an
 * OpenAPI path is relative to its server — so the document says `/api/v1/accounts` while the
 * generated router answered `/accounts`. Measured: every client generated from the document, and
 * every "try it" button in a rendered document, 404s.
 *
 * ⚠️ **A prefix is only taken where the document is unambiguous about it.** Guessing wrong is worse
 * than not applying one: a route mounted under the wrong prefix still matches, still answers, and
 * answers the wrong URL.
 */

/** The static path of a server URL, or `undefined` when it has none this can rely on. */
function pathOf(server: HttpServer): string | undefined {
	const url = server.url;
	/**
	 * ⚠️ **A templated URL is not a mismatch and must not warn.** `@server("{endpoint}")` — which most
	 * of `@typespec/http-specs` uses — means the whole origin is supplied by the caller, so the paths
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
	/** The prefix to mount every route under, or `undefined` to mount at the root. */
	readonly basePath: string | undefined;
	/** The distinct paths found, when the document declares more than one and they disagree. */
	readonly ambiguous: readonly string[];
}

/**
 * Read the service's declared servers and decide what to mount under.
 *
 * - no `@server`, or a templated one → the root, which is what the document means;
 * - one static path, or several that agree → that path;
 * - several that DISAGREE → the root, and the caller reports it. There is no answer that serves all
 *   of them, and picking one would silently serve the wrong URLs for the others.
 */
export function resolveBasePath(program: Program, namespace: Namespace): BasePathResolution {
	const servers = getServers(program, namespace) ?? [];
	const paths = [...new Set(servers.map(pathOf).filter((path) => path !== undefined))];
	if (paths.length === 0) return { basePath: undefined, ambiguous: [] };
	if (paths.length === 1) return { basePath: paths[0], ambiguous: [] };
	return { basePath: undefined, ambiguous: paths.toSorted() };
}
