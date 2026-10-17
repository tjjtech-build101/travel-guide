export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  subscribe(cb: (value: T) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  emit(value: T) {
    for (const cb of this.listeners) {
      try {
        cb(value);
      } catch (e) {
        console.warn('[location] listener error', e);
      }
    }
  }
}
