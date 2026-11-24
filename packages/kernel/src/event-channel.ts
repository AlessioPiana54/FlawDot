import type { ProgressEvent } from "@flawdot/core-model";

/**
 * The events of a run, kept from the first to the last. The producer never waits (an event is added to a list and the
 * readers that are waiting are woken), so a slow reader, a reader that left or no reader at all cannot hold the run up.
 * Each reader starts at the first event, so one that comes late (a browser that reconnects) misses nothing. The list
 * has about three events for each page and viewport, and it lives as long as the run, so it has no limit.
 */
export interface EventChannel {
  emit(event: ProgressEvent): void;
  /** After the last event. Emitting after this is ignored. */
  close(): void;
  readonly events: AsyncIterable<ProgressEvent>;
}

export function createEventChannel(): EventChannel {
  const buffer: ProgressEvent[] = [];
  let closed = false;
  let waiting: (() => void)[] = [];

  const wakeReaders = (): void => {
    const readers = waiting;
    waiting = [];
    for (const wake of readers) wake();
  };

  return {
    emit(event) {
      if (closed) return;
      buffer.push(event);
      wakeReaders();
    },
    close() {
      if (closed) return;
      closed = true;
      wakeReaders();
    },
    events: {
      [Symbol.asyncIterator]() {
        let next = 0;
        return {
          async next(): Promise<IteratorResult<ProgressEvent>> {
            for (;;) {
              const event = buffer[next];
              if (event !== undefined) {
                next += 1;
                return { done: false, value: event };
              }
              if (closed) return { done: true, value: undefined };
              await new Promise<void>((wake) => waiting.push(wake));
            }
          },
        };
      },
    },
  };
}
