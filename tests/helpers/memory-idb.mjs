// Deterministic transaction/request adapter; no browser or user storage is touched.
export function memoryDatabase(initialVersion = 0) {
  const data = new Map([
    ['recordings', new Map()],
    ['drafts', new Map()],
  ]);
  const names = new Set(initialVersion ? ['recordings'] : []);
  const indexes = new Map([
    ['recordings', new Set(initialVersion ? ['savedOrder'] : [])],
    ['drafts', new Set()],
  ]);
  const queue = [];
  let active = null,
    version = initialVersion;
  let failStore = null;
  const schema = (name) => ({
    indexNames: { contains: (key) => indexes.get(name)?.has(key) },
    createIndex: (key) => indexes.get(name).add(key),
  });
  function pump() {
    if (!active) {
      active = queue.shift();
      if (!active) return;
      active.working = new Map(
        [...data].map(([key, rows]) => [key, structuredClone(rows)]),
      );
    }
    const tx = active;
    if (tx.aborted) {
      active = null;
      tx.onabort?.();
      queueMicrotask(pump);
      return;
    }
    const task = tx.tasks.shift();
    if (task) {
      try {
        task();
      } catch (error) {
        tx.error = error;
        tx.aborted = true;
      }
      queueMicrotask(pump);
      return;
    }
    if (tx.mode === 'readwrite')
      for (const name of tx.names) {
        const rows = data.get(name);
        rows.clear();
        for (const [id, value] of tx.working.get(name)) rows.set(id, value);
      }
    active = null;
    tx.oncomplete?.();
    queueMicrotask(pump);
  }
  const db = {
    close() {},
    objectStoreNames: { contains: (name) => names.has(name) },
    createObjectStore(name) {
      names.add(name);
      return schema(name);
    },
    transaction(scope, mode = 'readonly') {
      const tx = {
        names: [scope].flat(),
        mode,
        tasks: [],
        error: null,
        aborted: false,
        abort() {
          this.aborted = true;
          this.error ??= new Error('Transaction aborted');
        },
      };
      function request(fn) {
        const req = {};
        tx.tasks.push(() => {
          fn(req);
          req.onsuccess?.();
        });
        return req;
      }
      tx.objectStore = (name) => ({
        ...schema(name),
        get: (id) =>
          request((req) => {
            req.result = structuredClone(tx.working.get(name).get(id));
          }),
        getAll: () =>
          request((req) => {
            req.result = structuredClone([...tx.working.get(name).values()]);
          }),
        put: (row) =>
          request(() => {
            if (failStore === name) throw new Error('Simulated quota failure');
            tx.working.get(name).set(row.id, structuredClone(row));
          }),
        delete: (id) =>
          request(() => {
            tx.working.get(name).delete(id);
          }),
        index: (key) => ({
          openKeyCursor() {
            let rows,
              pos = 0;
            const req = {};
            const next = () => {
              rows ??= [...tx.working.get(name).values()]
                .filter((r) => r[key] !== undefined)
                .sort((a, b) => b[key] - a[key]);
              const row = rows[pos++];
              req.result = row
                ? {
                    key: row[key],
                    primaryKey: row.id,
                    continue: () => tx.tasks.push(next),
                  }
                : null;
              req.onsuccess?.();
            };
            tx.tasks.push(next);
            return req;
          },
        }),
      });
      queue.push(tx);
      if (!active && queue.length === 1) queueMicrotask(pump);
      return tx;
    },
  };
  return {
    rows: data.get('recordings'),
    drafts: data.get('drafts'),
    names,
    get version() {
      return version;
    },
    failWritesTo(name) {
      failStore = name;
    },
    indexedDB: {
      open(_name, nextVersion) {
        const req = {};
        queueMicrotask(() => {
          req.result = db;
          req.transaction = { objectStore: schema };
          try {
            if (version < nextVersion) {
              req.onupgradeneeded?.();
              version = nextVersion;
            }
            req.onsuccess?.();
          } catch (error) {
            req.error = error;
            req.onerror?.();
          }
        });
        return req;
      },
    },
  };
}
