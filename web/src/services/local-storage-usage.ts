export type IndexedDbStoreUsage = { name: string; records: number; bytes: number };
export type IndexedDbDatabaseUsage = { name: string; version: number; bytes: number; stores: IndexedDbStoreUsage[] };
export type LocalStorageUsage = { usage: number; quota: number | null; contentBytes: number; databases: IndexedDbDatabaseUsage[] };

export async function readLocalStorageUsage(): Promise<LocalStorageUsage> {
    const [estimate, database] = await Promise.all([readStorageEstimate(), readDatabaseUsage("infinite-canvas")]);
    // 配额估算属于 SecureContext API，局域网 HTTP 或受限 WebView 下可能不可用，此时保留 IndexedDB 统计。
    return { usage: estimate?.usage ?? database.bytes, quota: estimate?.quota ?? null, contentBytes: database.bytes, databases: [database] };
}

async function readStorageEstimate() {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    try {
        return await navigator.storage.estimate();
    } catch {
        return null;
    }
}

function readDatabaseUsage(name: string) {
    if (typeof indexedDB === "undefined") return Promise.resolve<IndexedDbDatabaseUsage>({ name, version: 0, bytes: 0, stores: [] });
    return new Promise<IndexedDbDatabaseUsage>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const database = request.result;
            const names = Array.from(database.objectStoreNames);
            if (!names.length) {
                database.close();
                resolve({ name, version: database.version, bytes: 0, stores: [] });
                return;
            }
            const transaction = database.transaction(names, "readonly");
            Promise.all(names.map((storeName) => readStoreUsage(transaction.objectStore(storeName))))
                .then((stores) => resolve({ name, version: database.version, bytes: stores.reduce((total, store) => total + store.bytes, 0), stores: stores.sort((a, b) => b.bytes - a.bytes) }))
                .catch(reject)
                .finally(() => database.close());
        };
    });
}

function readStoreUsage(store: IDBObjectStore) {
    return new Promise<IndexedDbStoreUsage>((resolve, reject) => {
        let records = 0;
        let bytes = 0;
        const request = store.openCursor();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve({ name: store.name, records, bytes });
                return;
            }
            records += 1;
            bytes += valueBytes(cursor.value);
            cursor.continue();
        };
    });
}

export function formatStorageBytes(bytes: number | null) {
    if (bytes === null || !Number.isFinite(bytes)) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 配额未知（浏览器不提供或为 0）时返回 null，调用方据此隐藏进度条。 */
export function storageQuotaPercent(usage: Pick<LocalStorageUsage, "usage" | "quota">) {
    if (typeof usage.quota !== "number" || !Number.isFinite(usage.quota) || usage.quota <= 0) return null;
    return Math.min(100, (usage.usage / usage.quota) * 100);
}

function valueBytes(value: unknown) {
    if (value instanceof Blob) return value.size;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
}
