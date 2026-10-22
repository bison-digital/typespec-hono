import "@typespec/http";

using Http;

/**
 * Operation summaries carrying text that is not safe inside a `/** ... *\/` block.
 *
 * **A summary is spec-authored text, and it was interpolated into emitted source unescaped.** The
 * emitted `Operations` interface carries each summary as a JSDoc comment, so a summary containing a
 * comment terminator closed the comment early and the rest of it became code: a file that does not
 * parse, from one operation, exactly like a model named `as` or `yield`.
 *
 * A `/** ... *\/` doc comment cannot carry that text, because it would terminate itself. `@summary`
 * and `@doc` take ordinary string literals, which can.
 */
@service(#{ title: "Summary text" })
namespace SummaryText;

@route("/terminator")
@get
@summary("Returns a */ b, which used to close the comment")
op terminator(): void;

@route("/multiline")
@get
@doc("""
  First line of the description.
  Second line, which used to sit outside the comment.
  """)
op multiline(): void;

@route("/plain")
@get
@summary("An ordinary summary, so the arms below compare something")
op plain(): void;
