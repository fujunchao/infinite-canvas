import type { UploadedImage } from "@/services/image-storage";

export const CANVAS_IMAGE_SOURCE_MISSING = "canvas-image-source-missing";

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
            throw new Error(CANVAS_IMAGE_SOURCE_MISSING);
        }
        const hasSize = Number(source.width) > 0 && Number(source.height) > 0;
        const meta = hasSize ? { width: source.width!, height: source.height!, mimeType: source.mimeType || "image/png" } : await deps.readImageMeta(url);
        return { url, storageKey: source.storageKey, width: meta.width, height: meta.height, bytes: source.bytes || 0, mimeType: source.mimeType || meta.mimeType || "image/png" };
    }

    if (!sourceUrl) throw new Error(CANVAS_IMAGE_SOURCE_MISSING);
    return deps.uploadImage(sourceUrl);
}
