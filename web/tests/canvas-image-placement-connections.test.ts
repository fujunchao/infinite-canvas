import { describe, expect, test } from "bun:test";

import { createImagePlacementNode, getImagePlacementConnections, isImagePlacementHidden } from "../src/lib/canvas/canvas-image-placements";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeImage } from "../src/types/canvas";

function batchFixture() {
    const images: CanvasNodeImage[] = ["a", "b", "c"].map((id) => ({ id, status: "loading", content: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "image/png" }));
    const root: CanvasNodeData = { id: "root", type: CanvasNodeType.Image, title: "主图", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { images, primaryImageId: "a" } };
    return [root, ...images.map((image, index) => createImagePlacementNode(root, image, index))];
}

describe("多图主图与分图的归属连线", () => {
    test("三张候选生成中也有三条主图连线，包含主图镜像对应的分图", () => {
        const nodes = batchFixture();
        const before = JSON.stringify(nodes);
        const lines = getImagePlacementConnections(nodes, []);
        expect(lines.map(({ fromNodeId, toNodeId }) => [fromNodeId, toNodeId])).toEqual(nodes.slice(1).map((node) => ["root", node.id]));
        expect(new Set(lines.map((line) => line.id)).size).toBe(3);
        expect(JSON.stringify(nodes)).toBe(before);
    });

    test("沿用现有折叠过滤，收起隐藏连线、展开恢复且节点不被删除", () => {
        const nodes = batchFixture();
        const collapsed = nodes.filter((node) => !isImagePlacementHidden(node, new Set()));
        expect(getImagePlacementConnections(collapsed, [])).toEqual([]);
        const expanded = nodes.filter((node) => !isImagePlacementHidden(node, new Set(["root"])));
        expect(getImagePlacementConnections(expanded, [])).toHaveLength(3);
        expect(nodes).toHaveLength(4);
    });

    test("已有相同端点的普通连线不重复绘制，也不修改持久化连线", () => {
        const nodes = batchFixture();
        const connections: CanvasConnection[] = [{ id: "manual", fromNodeId: "root", toNodeId: nodes[1].id }];
        expect(getImagePlacementConnections(nodes, connections).map((line) => line.toNodeId)).toEqual([nodes[2].id, nodes[3].id]);
        expect(connections).toHaveLength(1);
    });

    test("普通独立副本及无效归属不生成主图连线", () => {
        const nodes = batchFixture();
        const ordinary = { ...nodes[1], id: "ordinary-copy", metadata: { content: "same-image" } };
        const orphan = { ...nodes[1], id: "orphan", metadata: { imageRef: { batchNodeId: "missing-root", imageId: "a" } } };
        expect(getImagePlacementConnections([...nodes, ordinary, orphan], [])).toHaveLength(3);
    });
});
