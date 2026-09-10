import i18n from "@/i18n";
import { normalizeLocalProxyUrl } from "@/stores/use-config-store";

/** 用代理根路径返回的身份信息检查服务是否可达。 */
export async function testLocalProxy(proxyUrl: string) {
    const base = normalizeLocalProxyUrl(proxyUrl);
    if (!base) throw new Error(i18n.t("config.proxy.missingUrl"));
    const response = await fetch(`${base}/`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const data = response.ok ? ((await response.json().catch(() => null)) as { proxy?: string; version?: string } | null) : null;
    if (!data?.proxy) throw new Error(i18n.t("config.proxy.unreachable"));
    return `${data.proxy} v${data.version || "?"}`;
}
