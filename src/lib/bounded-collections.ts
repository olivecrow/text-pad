export class BoundedLruCache<Key, Value> {
  private readonly values = new Map<Key, Value>();

  constructor(private readonly maximumSize: number) {}

  get size(): number {
    return this.values.size;
  }

  get(key: Key): Value | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: Key, value: Value) {
    this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.maximumSize) {
      const oldestKey = this.values.keys().next().value as Key | undefined;
      if (oldestKey === undefined) break;
      this.values.delete(oldestKey);
    }
  }

  clear() {
    this.values.clear();
  }
}

export class BoundedRecentSet<Value> {
  private readonly values = new Set<Value>();

  constructor(private readonly maximumSize: number) {}

  has(value: Value): boolean {
    return this.values.has(value);
  }

  add(value: Value) {
    if (this.values.delete(value)) {
      this.values.add(value);
      return;
    }

    this.values.add(value);
    while (this.values.size > this.maximumSize) {
      const oldestValue = this.values.values().next().value as Value | undefined;
      if (oldestValue === undefined) break;
      this.values.delete(oldestValue);
    }
  }

  clear() {
    this.values.clear();
  }
}
