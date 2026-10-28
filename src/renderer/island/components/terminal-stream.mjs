// Subscribe before fetching history, then deduplicate the overlapping IPC data.
export function createTerminalStream({ id, generation, write, maxPending = 512 * 1024 }) {
  let pending = [], pendingSize = 0, ready = false, disposed = false, sequence = 0, newestPendingSequence = 0;
  const matches = frame => frame?.id === id && frame.generation === generation;
  return {
    accept(frame) {
      if (disposed || !matches(frame) || typeof frame.data !== 'string') return;
      if (!ready) {
        newestPendingSequence = Math.max(newestPendingSequence, frame.sequence);
        pending.push(frame); pendingSize += frame.data.length;
        while (pendingSize > maxPending && pending.length) pendingSize -= pending.shift().data.length;
      } else if (frame.sequence > sequence) {
        sequence = frame.sequence;
        write(frame.data);
      }
    },
    restore(snapshot) {
      if (disposed || ready || !matches(snapshot)) return false;
      // A long IPC delay can exceed the queue bound. Ask for a newer snapshot
      // rather than painting history with a silent gap.
      if (pending.length && pending[0].sequence > snapshot.sequence + 1) return false;
      if (!pending.length && newestPendingSequence > snapshot.sequence) return false;
      write(snapshot.recentOutput || '');
      sequence = snapshot.sequence;
      ready = true;
      for (const frame of pending) this.accept(frame);
      pending = []; pendingSize = 0;
      return true;
    },
    dispose() { disposed = true; pending = []; pendingSize = 0; }
  };
}
