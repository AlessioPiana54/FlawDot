import type { ProgressEvent } from "@flawdot/core-model";
import { runId } from "@flawdot/test-support";
import { describe, expect, it } from "vitest";
import { createEventChannel } from "../src/event-channel.js";

const started = (total: number): ProgressEvent => ({ type: "run_started", runId: runId(1), total });

async function collect(events: AsyncIterable<ProgressEvent>): Promise<ProgressEvent[]> {
  const seen: ProgressEvent[] = [];
  for await (const event of events) {
    seen.push(event);
  }
  return seen;
}

describe("event channel", () => {
  it("gives the events in the order they were emitted, and ends when it is closed", async () => {
    const channel = createEventChannel();
    channel.emit(started(1));
    channel.emit(started(2));
    channel.close();

    expect(await collect(channel.events)).toEqual([started(1), started(2)]);
  });

  it("gives a reader that comes late the whole story, from the first event", async () => {
    const channel = createEventChannel();
    channel.emit(started(1));
    channel.emit(started(2));

    const late = collect(channel.events);
    channel.emit(started(3));
    channel.close();

    expect(await late).toEqual([started(1), started(2), started(3)]);
  });

  it("gives every reader the same events, each at its own pace", async () => {
    const channel = createEventChannel();
    const first = collect(channel.events);
    channel.emit(started(1));
    const second = collect(channel.events);
    channel.emit(started(2));
    channel.close();

    expect(await first).toEqual([started(1), started(2)]);
    expect(await second).toEqual([started(1), started(2)]);
  });

  it("wakes a reader that is waiting for the next event", async () => {
    const channel = createEventChannel();
    const reader = channel.events[Symbol.asyncIterator]();
    const next = reader.next();

    channel.emit(started(7));

    expect(await next).toEqual({ done: false, value: started(7) });
  });

  it("ends a reader that is waiting when the channel is closed", async () => {
    const channel = createEventChannel();
    const next = channel.events[Symbol.asyncIterator]().next();

    channel.close();

    expect((await next).done).toBe(true);
  });

  it("gives a reader that comes after the end all the events, and then ends", async () => {
    const channel = createEventChannel();
    channel.emit(started(1));
    channel.close();

    expect(await collect(channel.events)).toEqual([started(1)]);
    expect(await collect(channel.events)).toEqual([started(1)]);
  });

  it("ignores an event emitted after the end, and closing twice", async () => {
    const channel = createEventChannel();
    channel.emit(started(1));
    channel.close();

    channel.emit(started(2));
    channel.close();

    expect(await collect(channel.events)).toEqual([started(1)]);
  });

  it("is not held up by a reader that stops early: the others still get everything", async () => {
    const channel = createEventChannel();
    for (const total of [1, 2, 3]) channel.emit(started(total));
    channel.close();

    for await (const _event of channel.events) {
      break; // this reader leaves after the first event
    }

    expect(await collect(channel.events)).toHaveLength(3);
  });

  it("does not need anybody to read: emitting never waits, and nothing is lost", async () => {
    const channel = createEventChannel();

    for (let total = 0; total < 1000; total += 1) channel.emit(started(total));
    channel.close();

    expect(await collect(channel.events)).toHaveLength(1000);
  });
});
