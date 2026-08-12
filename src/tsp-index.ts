/**
 * What TypeSpec's compiler loads for this library.
 *
 * ⚠️ **There is deliberately no `$decorators` export**, here or in `typespec-http-zod`. Four once
 * existed and every one let a spec state something `@typespec/openapi3` could not publish, so the
 * emitted validator enforced a rule no caller reading the contract could see. A decorator is not a
 * convenience; it is a second contract.
 */
export { $lib } from "./lib.js";
