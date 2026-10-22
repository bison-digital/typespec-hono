import "@typespec/http";
import "@typespec/streams";
import "@typespec/events";
import "@typespec/sse";

using Http;
using Http.Streams;
using Events;
using SSE;

/**
 * Streamed responses: Server-Sent Events and JSON Lines, one of them behind a numeric path parameter
 * so a request can be refused before anything is streamed.
 */
@service(#{ title: "Feed" })
namespace Feed;

model Tick {
  at: string;
  value: int32;
}

model Closed {
  reason: string;
}

@events
union FeedEvents {
  tick: Tick,
  closed: Closed,
}

@route("/feed/{channel}") op feed(@path channel: int32): SSEStream<FeedEvents>;

@route("/lines") op lines(): JsonlStream<Tick>;
