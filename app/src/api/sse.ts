/** One Server-Sent Event: its type (`message` when the stream names none), its data and its ID. */
export type ServerEvent = { event: string; data: string; id?: string };

/**
 * Reads Server-Sent Events from a response body, as the browser's EventSource would, but over any
 * stream: the API's live updates need an `Authorization` header, which EventSource cannot send.
 * Ends when the stream ends, dropping an event the stream did not finish. Stopping early, by
 * aborting `signal` or by leaving the loop, cancels the stream.
 */
export async function* readEvents(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<ServerEvent> {
  const reader = stream.getReader();
  const cancel = () => void reader.cancel(signal?.reason).catch(() => {});
  signal?.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let id: string | undefined;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      for (;;) {
        const end = buffer.search(/[\r\n]/);
        // A carriage return at the end may be the first half of CRLF; wait for the next chunk.
        if (end < 0 || (end === buffer.length - 1 && buffer[end] === '\r' && !done)) break;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(buffer.startsWith('\r\n', end) ? end + 2 : end + 1);
        if (line === '') {
          if (data.length) yield { event: event || 'message', data: data.join('\n'), id };
          event = '';
          data = [];
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const raw = colon < 0 ? '' : line.slice(colon + 1);
        const fieldValue = raw.startsWith(' ') ? raw.slice(1) : raw;
        if (field === 'event') event = fieldValue;
        else if (field === 'data') data.push(fieldValue);
        else if (field === 'id' && !fieldValue.includes('\0')) id = fieldValue;
      }
      if (done) return;
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
  }
}
