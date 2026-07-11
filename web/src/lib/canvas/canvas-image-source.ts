import type { UploadedImage } from "@/services/image-storage";

export type CanvasImageSourceInput = {
    dataUrl?: string;
    url?: string;
    coverUrl?: string;
    storageKey?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
};

export type CanvasImageSourceDeps = {
    resolveImageUrl: (storageKey?: string, fallback?: string) => Promise<string>;
    uploadImage: (input: string | Blob) => Promise<UploadedImage>;
    readImageMeta: (url: string) => Promise<{ width: number; height: number; mimeType: string }>;
};

export async function resolveCanvasImageSource(source: CanvasImageSourceInput, deps: CanvasImageSourceDeps): Promise<UploadedImage> {
    const sourceUrl = source.dataUrl || source.url || source.coverUrl || "";
    if (source.storageKey) {
        const url = await deps.resolveImageUrl(source.storageKey, "");
        if (!url) {
            if (sourceUrl) return deps.uploadImage(sourceUrl);
            throw new Error("图片素材文件缺失，请重新导入或重新添加素材");
        }
        const hasSize = Number(source.width) > 0 && Number(source.height) > 0;
        const meta = hasSize ? { width: source.width!, height: source.height!, mimeType: source.mimeType || "image/png" } : await deps.readImageMeta(url);
        return { url, storageKey: source.storageKey, width: meta.width, height: meta.height, bytes: source.bytes || 0, mimeType: source.mimeType || meta.mimeType || "image/png" };
    }

    if (!sourceUrl) throw new Error("图片素材文件缺失，请重新导入或重新添加素材");
    return deps.uploadImage(sourceUrl);
}
