import "@typespec/http";

using Http;

/**
 * A JSON body carrying a key that names the object prototype, in each shape that reads one.
 *
 * **The document validates `__proto__` like any other key; Zod strips it unread** (colinhacks/zod#6386,
 * deliberate). A record therefore accepted `{"__proto__": 1}` where the document refuses it, and the
 * key never reached the handler. The server closes that at the JSON parser instead, as Fastify
 * (`onProtoPoisoning`) and hapi (`payload.protoAction`) do by default: such a body is refused.
 */
@service(#{ title: "Protopoison" })
namespace Protopoison;

/** The shape the gap was measured on: a record whose value type refuses what the key carried. */
@route("/flags")
@post
op flags(@body body: Record<boolean>): void;

model Holder {
  inner: Record<string>;
}

/** The key one level down, which only a scan of the parsed value finds. */
@route("/holder")
@post
op holder(@body body: Holder): void;

/** A record admitting `null`, so a `null` under `constructor` is a value it accepts. */
@route("/maybe")
@post
op maybe(@body body: Record<boolean | null>): void;

/**
 * A record of any value, so `constructor.prototype` is refused by nothing but the parser: the
 * fixture compiles sealed, and a model would refuse the extra key on its own.
 */
@route("/bag")
@post
op bag(@body body: Record<unknown>): void;
