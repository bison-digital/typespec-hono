import type {
	EmittedPathSegment,
	EmittedRoute,
	EmittedService,
	RouteSchemaNames,
} from "typespec-http-zod";
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
/**
 * The segments `typespec-http-zod` reads out of a plain template, for a fixture that states only a
 * path: each `/` segment is literal text or one `{name}` expression with no operator. A fixture that
 * needs an operator states `pathSegments` itself.
 */
function segmentsOf(path: string): EmittedPathSegment[] {
	return path
		.split("/")
		.filter((piece) => piece !== "")
		.map((piece) => {
			const match = /^\{([^}]*)\}$/.exec(piece);
			return match === null
				? { kind: "literal", text: piece }
				: {
						kind: "expression",
						parameter: match[1] ?? "",
						prefix: "",
						suffix: "",
						operator: "",
						explode: false,
						optional: false,
						reserved: false,
					};
		});
}

export function serviceWith(
	route: Partial<EmittedRoute> & { operationId: string; verb: string },
): EmittedService {
	const path = route.path ?? "/thing";
	const full = {
		bodyProperty: undefined,
		optionalBody: false,
		reservedPathParameters: [],
		pathSegments: segmentsOf(path),
		literalQuery: [],
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
		queryFieldsSchema: undefined,
		headerSchema: undefined,
		negotiatedHeaderSchema: undefined,
		accept: undefined,
		rawBodyProperty: undefined,
		authentication: "none",
		scopes: [],
		security: [],
		path,
		...route,
	} satisfies EmittedRoute;
	const names = {
		operationId: full.operationId,
		path: undefined,
		query: undefined,
		queryFields: undefined,
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
