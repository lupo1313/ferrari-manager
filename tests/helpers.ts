import { createAppStore } from '../src/state/store';
import { createMemoryRepository } from '../src/storage/repository';
import { demoCatalog } from '../src/data/catalog';
import { buildDemoData } from '../src/data/seed';
import type { IdFactory } from '../src/domain/ids';

export function sequentialIds(): IdFactory {
  let n = 0;
  return (prefix) => `${prefix}_${++n}`;
}

export function createTestStore(repo = createMemoryRepository()) {
  const clock = { time: new Date('2026-10-29T19:00:00') };
  const store = createAppStore({
    repo,
    catalog: demoCatalog,
    seed: buildDemoData,
    now: () => clock.time,
    newId: sequentialIds(),
  });
  const customer = (lastName: string) => {
    const c = store.getData().customers.find((x) => x.lastName === lastName);
    if (!c) throw new Error(`client ${lastName} absent`);
    return c;
  };
  return { store, repo, clock, customer };
}
