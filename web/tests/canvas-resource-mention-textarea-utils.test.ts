import { describe, expect, test } from "bun:test";

import { getMentionOverlayLabels } from "../src/app/(user)/canvas/components/canvas-resource-mention-textarea-utils";

describe("getMentionOverlayLabels", () => {
    test("空输入和普通文本不启用覆盖层", () => {
        expect(getMentionOverlayLabels("", ["图片1"], false, false)).toEqual([]);
        expect(getMentionOverlayLabels("调整画面光线", ["图片1"], false, false)).toEqual([]);
    });

    test("只有内容包含资源标签时才启用覆盖层", () => {
        expect(getMentionOverlayLabels("参考图片1调整姿态", ["图片1", "文本1"], false, false)).toEqual(["图片1"]);
    });

    test("选中文字或中文输入法组合输入时关闭覆盖层", () => {
        expect(getMentionOverlayLabels("参考图片1", ["图片1"], true, false)).toEqual([]);
        expect(getMentionOverlayLabels("参考图片1", ["图片1"], false, true)).toEqual([]);
    });
});
