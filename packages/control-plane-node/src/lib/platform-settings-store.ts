import type { KvStore, KvListOptions } from "@open-managed-agents/kv-store";
import type { NodeDatabase } from "@open-managed-agents/node-database";

/** Strong settings documents in the existing table. SqlClient owns dialect
 * translation, including MySQL INSERT IGNORE and affected-row receipts. */
export function createPlatformSettingsStore(database: NodeDatabase, namespace: string): KvStore & Required<Pick<KvStore, "compareAndSwap">> {
  const sql = database.sql;
  const store = {
    async get(key: string) {
      const row = await sql.prepare('SELECT value FROM kv_entries WHERE tenant_id = ? AND "key" = ?').bind(namespace, key).first<{ value: string }>();
      return row?.value ?? null;
    },
    async compareAndSwap(key: string, expected: string | null, value: string | null) {
      if (expected === null && value === null) return await store.get(key) === null;
      const result = expected === null
        ? await sql.prepare('INSERT INTO kv_entries (tenant_id, "key", value, expires_at) VALUES (?, ?, ?, NULL) ON CONFLICT (tenant_id, "key") DO NOTHING').bind(namespace, key, value).run()
        : value === null
          ? await sql.prepare('DELETE FROM kv_entries WHERE tenant_id = ? AND "key" = ? AND value = ?').bind(namespace, key, expected).run()
          : await sql.prepare('UPDATE kv_entries SET value = ?, expires_at = NULL WHERE tenant_id = ? AND "key" = ? AND value = ?').bind(value, namespace, key, expected).run();
      return result.meta.changes === 1;
    },
    async put(key: string, value: string) {
      for (let attempt = 0; attempt < 8; attempt++) if (await store.compareAndSwap(key, await store.get(key), value)) return;
      throw new Error("平台配置写入冲突，请重试");
    },
    async delete(key: string) {
      await sql.prepare('DELETE FROM kv_entries WHERE tenant_id = ? AND "key" = ?').bind(namespace, key).run();
    },
    async list(options: KvListOptions = {}) {
      // These operator-owned documents are few; filtering exact prefixes here
      // also prevents SQL wildcard characters in workspace IDs widening scope.
      const rows = await sql.prepare('SELECT "key" FROM kv_entries WHERE tenant_id = ? ORDER BY "key"').bind(namespace).all<{ key: string }>();
      const keys = (rows.results ?? []).filter(row => row.key.startsWith(options.prefix ?? "")).map(row => ({ name: row.key }));
      const offset = Number(options.cursor ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("分页参数不正确");
      const limit = Math.max(1, Math.min(options.limit ?? 1000, 1000));
      const complete = offset + limit >= keys.length;
      return { keys: keys.slice(offset, offset + limit), list_complete: complete, ...(complete ? {} : { cursor: String(offset + limit) }) };
    },
  };
  return store;
}
