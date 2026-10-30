import { afterEach, describe, expect, test } from "bun:test";

import { formatStorageBytes, readLocalStorageUsage, storageQuotaPercent } from "../src/services/local-storage-usage";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");

function stubNavigator(value: unknown) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value });
}

afterEach(() => {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (originalIndexedDb) Object.defineProperty(globalThis, "indexedDB", originalIndexedDb);
    else Reflect.deleteProperty(globalThis, "indexedDB");
});

describe("readLocalStorageUsage", () => {
    test("falls back to IndexedDB bytes when the Storage API is missing", async () => {
        stubNavigator({});
        const usage = await readLocalStorageUsage();
        expect(usage.quota).toBeNull();
        expect(usage.usage).toBe(usage.contentBytes);
    });

    test("falls back when estimate() throws", async () => {
        stubNavigator({ storage: { estimate: async () => { throw new Error("SecurityError"); } } });
        const usage = await readLocalStorageUsage();
        expect(usage.quota).toBeNull();
        expect(usage.usage).toBe(usage.contentBytes);
    });

    test("passes through estimate() values", async () => {
        stubNavigator({ storage: { estimate: async () => ({ usage: 123, quota: 456 }) } });
        const usage = await readLocalStorageUsage();
        expect(usage.usage).toBe(123);
        expect(usage.quota).toBe(456);
    });

    test("treats an empty estimate as unknown quota", async () => {
        stubNavigator({ storage: { estimate: async () => ({}) } });
        const usage = await readLocalStorageUsage();
        expect(usage.quota).toBeNull();
        expect(usage.usage).toBe(usage.contentBytes);
    });

    test("does not throw when indexedDB is unavailable", async () => {
        Reflect.deleteProperty(globalThis, "indexedDB");
        stubNavigator({});
        await expect(readLocalStorageUsage()).resolves.toBeDefined();
    });
});

describe("storage helpers", () => {
    test("formats null as unknown", () => {
        expect(formatStorageBytes(null)).toBe("—");
        expect(formatStorageBytes(0)).toBe("0 B");
        expect(formatStorageBytes(1536)).toBe("1.5 KB");
    });

    test("computes quota percent only with a usable quota", () => {
        expect(storageQuotaPercent({ usage: 50, quota: 100 })).toBe(50);
        expect(storageQuotaPercent({ usage: 50, quota: null })).toBeNull();
        expect(storageQuotaPercent({ usage: 50, quota: 0 })).toBeNull();
    });
});
