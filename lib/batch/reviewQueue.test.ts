import assert from "node:assert/strict";
import test from "node:test";
import { ReviewQueue } from "./reviewQueue";

test("enqueued reviews are processed in FIFO order", async () => {
  const queue = new ReviewQueue<{ label: string }>();

  const first = queue.enqueue({ label: "first" });
  const second = queue.enqueue({ label: "second" });
  const third = queue.enqueue({ label: "third" });

  assert.equal(queue.getState().active?.payload.label, "first");
  assert.equal(queue.resolveActive("ACCEPT"), true);
  assert.equal(await first, "ACCEPT");

  assert.equal(queue.getState().active?.payload.label, "second");
  assert.equal(queue.resolveActive("REJECT"), true);
  assert.equal(await second, "REJECT");

  assert.equal(queue.getState().active?.payload.label, "third");
  assert.equal(queue.resolveActive("ACCEPT"), true);
  assert.equal(await third, "ACCEPT");

  const finalState = queue.getState();
  assert.equal(finalState.active, null);
  assert.equal(finalState.pending.length, 0);
});

test("cancelAll rejects active and queued requests", async () => {
  const queue = new ReviewQueue<{ label: string }>();

  const first = queue.enqueue({ label: "first" });
  const second = queue.enqueue({ label: "second" });
  const third = queue.enqueue({ label: "third" });

  queue.cancelAll("batch cancelled");

  await assert.rejects(first, /batch cancelled/);
  await assert.rejects(second, /batch cancelled/);
  await assert.rejects(third, /batch cancelled/);

  const finalState = queue.getState();
  assert.equal(finalState.cancelled, true);
  assert.equal(finalState.active, null);
  assert.equal(finalState.pending.length, 0);
});

test("reject and re-enqueue can continue the same anchor flow", async () => {
  const queue = new ReviewQueue<{ anchorId: string; pass: number }>();

  const firstAttempt = queue.enqueue({ anchorId: "u:0,v:0", pass: 1 });
  assert.equal(queue.resolveActive("REJECT"), true);
  assert.equal(await firstAttempt, "REJECT");

  const secondAttempt = queue.enqueue({ anchorId: "u:0,v:0", pass: 2 });
  assert.equal(queue.getState().active?.payload.pass, 2);
  assert.equal(queue.resolveActive("ACCEPT"), true);
  assert.equal(await secondAttempt, "ACCEPT");
});
