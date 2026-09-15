import type { EmittedRoute, EmittedService, RouteSchemaNames } from "typespec-http-zod";
import type { RenderRefusals } from "../../src/app.js";

/**
 * The narrowest `EmittedService` the renderer will accept, everything else defaulted away.
 *
 * **`satisfies`, never `as`, and the difference is a whole direction of drift.** `render.test.ts`
 * used `as EmittedRoute`, an assertion, so excess-property checking never ran and the fixture kept a
 * field the interface had lost. `path-template.test.ts` used `as unknown as EmittedService`, and a
 * field added later was read while rendering and never supplied: eight path arms failed with
 * `Cannot read properties of undefined` rather than with anything about paths. Shared, and checked
 * with `satisfies` in both directions, so a field added to or removed from `EmittedRoute` fails HERE,
 * naming the fixture.
 */
export function serviceWith(
	route: Partial<EmittedRoute> & { operationId: string; verb: string },
): EmittedService {
	const full = {
		bodyProperty: undefined,
		optionalBody: false,
		reservedPathParameters: [],
		// One bodyless success, the smallest response set a document can declare.
		responses: [
			{
				status: 204,
				schema: undefined,
				contentTypes: [],
				headers: [],
				binary: false,
				streamed: false,
				textual: false,
			},
		],
		responseContentTypes: [],
		requestContentTypes: ["application/json"],
		summary: undefined,
		requestSchema: undefined,
		pathSchema: undefined,
		querySchema: undefined,
		headerSchema: undefined,
		negotiatedHeaderSchema: undefined,
		accept: undefined,
		rawBodyProperty: undefined,
		noAuth: true,
		scopes: [],
		security: [],
		path: "/thing",
		...route,
	} satisfies EmittedRoute;
	const names = {
		operationId: full.operationId,
		path: undefined,
		query: undefined,
		header: undefined,
		body: undefined,
		arms: full.responses.map((response) => ({ status: response.status, schema: undefined })),
		responses: `${full.operationId}Responses`,
	} satisfies RouteSchemaNames;
	return {
		service: { operations: [], namespace: {} } as unknown as EmittedService["service"],
		routes: [full],
		schemaNames: new Map([[full.operationId, names]]),
		outputDir: "/nowhere",
		options: {
			contractsOutputDir: undefined,
			contractsPackage: undefined,
			sealObjectSchemas: false,
			compileSchemas: false,
			keyVocabularies: [],
			runtimeModule: "./runtime.gen.js",
			regenerateHint: undefined,
		},
	};
}

/** Refusals that fail the arm, for a render that must refuse nothing. */
export const noRefusals: RenderRefusals = {
	unsupportedPathTemplate: (): void => {
		throw new Error("unexpected path refusal");
	},
	unvalidatableMediaType: (): void => {
		throw new Error("unexpected media-type refusal");
	},
	unvalidatedResponseMediaType: (): void => {
		throw new Error("unexpected response media-type refusal");
	},
};

/** Refusals that are recorded nowhere, for an arm about something else. */
export const ignoreRefusals: RenderRefusals = {
	unsupportedPathTemplate: () => undefined,
	unvalidatableMediaType: () => undefined,
	unvalidatedResponseMediaType: () => undefined,
};
