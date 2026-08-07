import { describe, expect, test } from "bun:test";

import { CANVAS_IMAGE_SOURCE_MISSING, resolveCanvasImageSource } from "../src/lib/canvas/canvas-image-source";

describe("resolveCanvasImageSource", () => {
    test("storageKey 存在且 dataUrl 为空时解析出可显示 URL", async () => {
        const image = await resolveCanvasImageSource(
            { dataUrl: "", storageKey: "image:test", width: 640, height: 480, bytes: 1234, mimeType: "image/png" },
            {
                resolveImageUrl: async (storageKey, fallback) => (storageKey === "image:test" && fallback === "" ? "blob:resolved" : ""),
                uploadImage: async () => {
                    throw new Error("不应该重新上传已有 storageKey 的图片");
                },
                readImageMeta: async () => {
                    throw new Error("已有尺寸时不应该重新读取图片尺寸");
                },
            },
        );

        expect(image).toEqual({ url: "blob:resolved", storageKey: "image:test", width: 640, height: 480, bytes: 1234, mimeType: "image/png" });
    });

    test("没有 storageKey 时上传来源图片", async () => {
        const image = await resolveCanvasImageSource(
            { dataUrl: "https://example.com/image.png" },
            {
                resolveImageUrl: async () => "",
                uploadImage: async (input) => ({ url: "blob:new", storageKey: "image:new", width: 1024, height: 1024, bytes: 2048, mimeType: "image/png", input }),
                readImageMeta: async () => ({ width: 1, height: 1, mimeType: "image/png" }),
            },
        );

        expect(image).toMatchObject({ url: "blob:new", storageKey: "image:new", width: 1024, height: 1024, bytes: 2048, mimeType: "image/png" });
    });

    test("storageKey 失效时使用备用封面地址重新存储", async () => {
        const image = await resolveCanvasImageSource(
            { dataUrl: "", coverUrl: "https://example.com/cover.png", storageKey: "image:missing" },
            {
                resolveImageUrl: async () => "",
                uploadImage: async (input) => ({ url: "blob:restored", storageKey: "image:restored", width: 800, height: 600, bytes: 1024, mimeType: "image/png", input }),
                readImageMeta: async () => ({ width: 1, height: 1, mimeType: "image/png" }),
            },
        );

        expect(image).toMatchObject({ url: "blob:restored", storageKey: "image:restored", width: 800, height: 600 });
    });

    test("缺少图片来源时给出明确错误", async () => {
        await expect(
            resolveCanvasImageSource(
                {},
                {
                    resolveImageUrl: async () => "",
                    uploadImage: async () => {
                        throw new Error("不应该上传空来源");
                    },
                    readImageMeta: async () => ({ width: 1, height: 1, mimeType: "image/png" }),
                },
            ),
        ).rejects.toThrow(CANVAS_IMAGE_SOURCE_MISSING);
    });
});
