import "@typespec/http";

using Http;

/**
 * **Names TypeSpec permits that a regular expression reads as something else.**
 *
 * `$` is a valid identifier character in both TypeSpec and JavaScript, and an anchor in a regular
 * expression. The emitter decides which validator identifiers to import by looking at what the
 * rendered file references, and that check used to be `new RegExp("\\b" + name + "\\b")` per name.
 * For `list$Items` it asked whether `\blist$ItemsQuery\b` matched, which it cannot: `$` anchors the
 * end of the string. Escaping alone does not fix it either, because `\b` is a WORD boundary and `$`
 * is not a word character, so `\b\$select\b` never matches anything.
 *
 * Measured before the fix: every identifier reported absent, the whole `./schemas.gen.js` import
 * dropped, and the emitted file failed with four `TS2304: Cannot find name`. `tsp compile` reported
 * success and wrote the file.
 *
 * The wire behaviour of these operations is not the point and is graded elsewhere. What this fixture
 * exists for is the NAMES, so `compiles.test.ts` puts a file carrying them through `tsc`.
 */
@service(#{ title: "Identifiers" })
namespace Identifiers;

model Item$Ref {
  id: string;

  /** A property whose name is a bare `$` prefix, which OData-style APIs use throughout. */
  $type: string;
}

@route("/items")
@get
op list$Items(@query $select?: string): Item$Ref[];

/** A name that is a PREFIX of the one above, so equality is doing the work and not a substring. */
@route("/items/one")
@get
op list$Item(@query $select?: string): Item$Ref;
