import { describe, expect, it, beforeEach } from 'vitest';
import { mirrorPendingBroadcasts, mirrorPendingForContact } from './mirror';

/**
 * Minimal in-memory fake of the supabase-js query builder — just enough
 * to exercise mirror.ts's exact call chains. Tables are plain arrays; the
 * builder is thenable so `await` resolves it.
 */
type Row = Record<string, unknown>;
type Filter =
  | { kind: 'is'; col: string; val: null }
  | { kind: 'in'; col: string; vals: unknown[] }
  | { kind: 'notNull'; col: string }
  | { kind: 'eq'; col: string; val: unknown };

function makeFake() {
  const store: Record<string, Row[]> = {
    broadcast_recipients: [],
    conversations: [],
    messages: [],
  };
  let idSeq = 1;

  class Builder {
    op: 'select' | 'update' | 'insert' | null = null;
    filters: Filter[] = [];
    updateVals: Row | null = null;
    insertRows: Row[] = [];
    returnRows = false;
    orderCol: string | null = null;
    limitN: number | null = null;

    constructor(public table: string) {}

    select(cols?: string) {
      void cols;
      if (!this.op) this.op = 'select';
      this.returnRows = true;
      return this;
    }
    update(vals: Row) {
      this.op = 'update';
      this.updateVals = vals;
      return this;
    }
    insert(rows: Row[] | Row) {
      this.op = 'insert';
      this.insertRows = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    is(col: string, _val: null) {
      this.filters.push({ kind: 'is', col, val: null });
      return this;
    }
    in(col: string, vals: unknown[]) {
      this.filters.push({ kind: 'in', col, vals });
      return this;
    }
    not(col: string, _op: string, _val: null) {
      this.filters.push({ kind: 'notNull', col });
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push({ kind: 'eq', col, val });
      return this;
    }
    order(col: string) {
      this.orderCol = col;
      return this;
    }
    limit(n: number) {
      this.limitN = n;
      return this;
    }

    private match(rows: Row[]): Row[] {
      return rows.filter((r) =>
        this.filters.every((f) => {
          if (f.kind === 'is') return r[f.col] == null;
          if (f.kind === 'notNull') return r[f.col] != null;
          if (f.kind === 'in') return f.vals.includes(r[f.col]);
          if (f.kind === 'eq') return r[f.col] === f.val;
          return true;
        }),
      );
    }

    private run(): { data: Row[] | null; error: null } {
      const rows = store[this.table];
      if (this.op === 'select') {
        let out = this.match(rows);
        if (this.orderCol) {
          const c = this.orderCol;
          out = [...out].sort((a, b) =>
            String(a[c] ?? '').localeCompare(String(b[c] ?? '')),
          );
        }
        if (this.limitN != null) out = out.slice(0, this.limitN);
        return { data: out, error: null };
      }
      if (this.op === 'update') {
        const matched = this.match(rows);
        for (const r of matched) Object.assign(r, this.updateVals);
        return { data: this.returnRows ? matched : null, error: null };
      }
      if (this.op === 'insert') {
        const inserted = this.insertRows.map((r) => ({
          id: `gen-${idSeq++}`,
          ...r,
        }));
        store[this.table].push(...inserted);
        return { data: this.returnRows ? inserted : null, error: null };
      }
      return { data: null, error: null };
    }

    then<T>(resolve: (v: { data: Row[] | null; error: null }) => T): T {
      return resolve(this.run());
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = {
    from: (table: string) => new Builder(table),
  };

  return { admin, store };
}

function seedRecipient(store: Record<string, Row[]>, over: Partial<Row> = {}) {
  store.broadcast_recipients.push({
    id: `r${store.broadcast_recipients.length + 1}`,
    contact_id: `c${store.broadcast_recipients.length + 1}`,
    whatsapp_message_id: `wamid${store.broadcast_recipients.length + 1}`,
    rendered_body: 'Hi there',
    sent_at: '2026-06-29T10:00:00.000Z',
    status: 'sent',
    mirrored_at: null,
    broadcast: { account_id: 'acc1', user_id: 'u1', template_name: 'promo' },
    ...over,
  });
}

describe('mirrorPendingBroadcasts', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any;
  let store: Record<string, Row[]>;

  beforeEach(() => {
    const fake = makeFake();
    admin = fake.admin;
    store = fake.store;
  });

  it('mirrors pending recipients into hidden conversations + messages', async () => {
    seedRecipient(store);
    seedRecipient(store);

    const res = await mirrorPendingBroadcasts(admin);
    expect(res.mirrored).toBe(2);

    // Two hidden conversations created.
    expect(store.conversations).toHaveLength(2);
    expect(store.conversations.every((c) => c.visible_in_inbox === false)).toBe(
      true,
    );

    // Two broadcast messages, stamped with the original send time + origin.
    expect(store.messages).toHaveLength(2);
    expect(store.messages.every((m) => m.source === 'broadcast')).toBe(true);
    expect(store.messages.every((m) => m.created_at === '2026-06-29T10:00:00.000Z')).toBe(true);
    expect(store.messages.every((m) => m.content_text === 'Hi there')).toBe(true);

    // Recipients stamped mirrored.
    expect(store.broadcast_recipients.every((r) => r.mirrored_at != null)).toBe(
      true,
    );
  });

  it('is idempotent — a second run inserts nothing (requirement 5)', async () => {
    seedRecipient(store);
    seedRecipient(store);

    await mirrorPendingBroadcasts(admin);
    const res2 = await mirrorPendingBroadcasts(admin);

    expect(res2.mirrored).toBe(0);
    expect(res2.scanned).toBe(0);
    expect(store.messages).toHaveLength(2); // not 4
  });

  it('reuses an existing conversation instead of creating a duplicate', async () => {
    seedRecipient(store, { contact_id: 'c1' });
    store.conversations.push({
      id: 'existing-conv',
      account_id: 'acc1',
      contact_id: 'c1',
      visible_in_inbox: true,
    });

    await mirrorPendingBroadcasts(admin);

    expect(store.conversations).toHaveLength(1); // no new conversation
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].conversation_id).toBe('existing-conv');
  });

  it('skips recipients already mirrored', async () => {
    seedRecipient(store, { mirrored_at: '2026-06-29T09:00:00.000Z' });
    seedRecipient(store); // pending

    const res = await mirrorPendingBroadcasts(admin);
    expect(res.mirrored).toBe(1);
    expect(store.messages).toHaveLength(1);
  });
});

describe('mirrorPendingForContact (webhook safety-net)', () => {
  it('mirrors only the given contact and never double-inserts vs the cron', async () => {
    const { admin, store } = makeFake();
    seedRecipient(store, { contact_id: 'c1' });
    seedRecipient(store, { contact_id: 'c2' });

    // Safety-net runs first for c1 (reply beat the cron).
    const safety = await mirrorPendingForContact(admin, 'c1');
    expect(safety).toBe(1);
    expect(store.messages).toHaveLength(1);

    // Cron then runs — c1 already claimed, only c2 left.
    const cron = await mirrorPendingBroadcasts(admin);
    expect(cron.mirrored).toBe(1);
    expect(store.messages).toHaveLength(2); // c1 not duplicated
  });
});
