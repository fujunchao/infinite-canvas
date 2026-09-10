import { describe, expect, test } from "bun:test";

import type { CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";
import { migrateLegacyCanvasData } from "../src/lib/canvas/canvas-data-migration";
import { createImagePlacementNode, detachImagePlacementNode, getExpandedImageBatchIds, getImagePlacementConnections, isImageBatchRoot, isImagePlacementHidden, pruneImagePlacementConnections, setImageBatchExpansion, setImagePlacementAsPrimary } from "../src/lib/canvas/canvas-image-placements";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeImage } from "../src/types/canvas";

// 为语言和配置模块提供测试进程内的存储，不访问浏览器中的用户配置。
const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
} });
const { applyCanvasAgentOps } = await import("../src/lib/canvas/canvas-agent-ops");
const { getGenerationResourceNodes } = await import("../src/lib/canvas/canvas-resource-references");

function fixture(): CanvasAgentSnapshot {
    const images: CanvasNodeImage[] = ["a", "b", "c"].map((id) => ({ id, status: "success", content: `blob:${id}`, storageKey: `image:${id}`, naturalWidth: 320, naturalHeight: 180, bytes: 10, mimeType: "image/png" }));
    const root: CanvasNodeData = { id: "root", type: CanvasNodeType.Image, title: "主图", position: { x: 40, y: 80 }, width: 400, height: 225, metadata: { images, primaryImageId: "a", imageBatchExpanded: true, content: "blob:a", storageKey: "image:a", freeResize: false } };
    const nodes = [root, ...images.map((image, index) => createImagePlacementNode(root, image, index))];
    nodes[2] = { ...nodes[2], width: 210, height: 340, metadata: { ...nodes[2].metadata, freeResize: true } };
    return { projectId: "fixture", title: "回归", nodes, connections: getImagePlacementConnections(nodes, []), selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
}

function roundTrip(snapshot: CanvasAgentSnapshot) {
    const saved = JSON.parse(JSON.stringify(snapshot)) as CanvasAgentSnapshot;
    return { ...saved, ...migrateLegacyCanvasData(saved.nodes, saved.connections) };
}

describe("恢复 0.14.1 主分节点操作", () => {
    test("展开和收起写入项目，重新打开保留状态及节点几何", () => {
        const state = fixture();
        expect(getExpandedImageBatchIds(roundTrip(state).nodes).has("root")).toBe(true);
        const nodes = setImageBatchExpansion(state.nodes, new Set());
        const restored = roundTrip({ ...state, nodes });
        expect(getExpandedImageBatchIds(restored.nodes).size).toBe(0);
        expect(restored.nodes.slice(1).every((node) => isImagePlacementHidden(node, getExpandedImageBatchIds(restored.nodes)))).toBe(true);
        expect(restored.nodes[2].position).toEqual(state.nodes[2].position);
        expect(setImageBatchExpansion(nodes, new Set())).toBe(nodes);
    });

    test("设主图采用所点分图的宽高和自由比例，主节点左上位置不变", () => {
        const state = fixture();
        const next = setImagePlacementAsPrimary(state.nodes, state.nodes[2].id);
        expect(next[0].position).toEqual(state.nodes[0].position);
        expect([next[0].width, next[0].height, next[0].metadata?.freeResize]).toEqual([210, 340, true]);
        expect(next[0].metadata).toMatchObject({ primaryImageId: "b", content: "blob:b", storageKey: "image:b" });
        expect(next[2]).toBe(state.nodes[2]);
    });

    test("Agent 设主图采用相同尺寸规则，不因同步资源导致位置偏移", () => {
        const state = fixture();
        const next = applyCanvasAgentOps(state, [{ type: "update_node", id: "root", metadata: { primaryImageId: "b" } }]);
        expect(next.nodes[0].position).toEqual(state.nodes[0].position);
        expect([next.nodes[0].width, next.nodes[0].height, next.nodes[0].metadata?.freeResize]).toEqual([210, 340, true]);
    });

    test("删除主分连线不解除批次，刷新也不会自动补回", () => {
        const state = fixture();
        const next = roundTrip(applyCanvasAgentOps(state, [{ type: "delete_connections", id: state.connections[0].id }]));
        expect(next.connections).toHaveLength(2);
        expect(next.connections.some((line) => line.id === state.connections[0].id)).toBe(false);
        expect(next.nodes[1].metadata?.imageRef?.batchNodeId).toBe("root");
        const moved = applyCanvasAgentOps(next, [{ type: "update_node", id: "root", patch: { position: { x: 50, y: 100 } } }]);
        expect(moved.nodes[1].position).toEqual({ x: next.nodes[1].position.x + 10, y: next.nodes[1].position.y + 20 });
    });

    test("重新连接主分节点得到可保存的批次线，但不增加生成参考", () => {
        const state = fixture();
        const next = applyCanvasAgentOps({ ...state, connections: [] }, [{ type: "connect_nodes", fromNodeId: "root", toNodeId: state.nodes[1].id }]);
        expect(next.connections[0].kind).toBe("batch");
        expect(getGenerationResourceNodes(state.nodes[1].id, next.nodes, next.connections)).toEqual([]);
        expect(roundTrip(next).connections).toHaveLength(1);
    });

    test("删到一张仍保留父子关系、折叠状态和联动移动", () => {
        const state = fixture();
        state.nodes = setImageBatchExpansion(state.nodes, new Set());
        const next = roundTrip(applyCanvasAgentOps(state, [{ type: "delete_node", ids: [state.nodes[2].id, state.nodes[3].id] }]));
        expect(next.nodes).toHaveLength(2);
        expect(isImageBatchRoot(next.nodes[0])).toBe(true);
        expect(next.nodes[0].metadata?.images).toHaveLength(1);
        expect(next.nodes[0].metadata?.imageBatchExpanded).toBe(false);
        expect(next.nodes[1].metadata?.imageRef?.batchNodeId).toBe("root");
        expect(next.connections).toHaveLength(1);
        const moved = applyCanvasAgentOps(next, [{ type: "update_node", id: "root", patch: { position: { x: 50, y: 100 } } }]);
        expect(moved.nodes[1].position).toEqual({ x: next.nodes[1].position.x + 10, y: next.nodes[1].position.y + 20 });
        expect(applyCanvasAgentOps(next, [{ type: "delete_node", id: "root" }]).nodes).toEqual([]);
    });

    test("最后一张分图删除后，主图仍保留已显示图片", () => {
        const state = fixture();
        const next = applyCanvasAgentOps(state, [{ type: "delete_node", ids: state.nodes.slice(1).map((node) => node.id) }]);
        expect(next.nodes).toHaveLength(1);
        expect(next.nodes[0].metadata).toMatchObject({ content: "blob:a", storageKey: "image:a" });
        expect(next.nodes[0].position).toEqual(state.nodes[0].position);
        expect(next.connections).toEqual([]);
    });

    test("替换一个分图仅解除该图，剩余单图批次不会被解散", () => {
        const state = fixture();
        const two = applyCanvasAgentOps(state, [{ type: "delete_node", id: state.nodes[3].id }]);
        const next = detachImagePlacementNode(two.nodes, two.nodes[2].id);
        expect(next[2].metadata?.imageRef).toBeUndefined();
        expect(next[1].metadata?.imageRef?.batchNodeId).toBe("root");
        expect(isImageBatchRoot(next[0])).toBe(true);
        expect(pruneImagePlacementConnections(next, two.connections)).toHaveLength(1);
    });

    test("缺少持久化状态的当前批次只初始化一次连线", () => {
        const state = fixture();
        delete state.nodes[0].metadata!.imageBatchExpanded;
        const initialized = roundTrip({ ...state, connections: [] });
        expect(initialized.connections).toHaveLength(3);
        expect(initialized.nodes[0].metadata?.imageBatchExpanded).toBe(false);
        expect(roundTrip({ ...initialized, connections: [] }).connections).toEqual([]);
    });

    test("0.14.1 批次保留展开状态和剩余连线，不恢复已删除的线", () => {
        const state = fixture();
        const root = state.nodes[0];
        const children = state.nodes.slice(1).map((node, index) => ({ ...node, id: root.metadata!.images![index].id, metadata: { content: root.metadata!.images![index].content, batchRootId: root.id } }));
        const legacyRoot = { ...root, metadata: { ...root.metadata, images: undefined, isBatchRoot: true, batchChildIds: children.map((node) => node.id) } };
        const migrated = migrateLegacyCanvasData([legacyRoot, ...children], [{ id: "remaining-line", fromNodeId: root.id, toNodeId: children[1].id }]);
        expect(migrated.nodes[0].metadata?.imageBatchExpanded).toBe(true);
        expect(migrated.nodes[1].metadata?.imageRef).toEqual({ batchNodeId: root.id, imageId: "a" });
        expect(migrated.connections).toEqual([{ id: "remaining-line", fromNodeId: root.id, toNodeId: "b", kind: "batch" }]);
        expect(roundTrip({ ...state, ...migrated }).connections).toEqual(migrated.connections);
    });

    test("普通单张结果不产生分图或折叠控件", () => {
        const state = fixture();
        state.nodes = [{ ...state.nodes[0], metadata: { images: state.nodes[0].metadata!.images!.slice(0, 1), primaryImageId: "a", content: "blob:a" } }];
        const next = roundTrip({ ...state, connections: [] });
        expect(next.nodes).toHaveLength(1);
        expect(isImageBatchRoot(next.nodes[0])).toBe(false);
        expect(next.connections).toEqual([]);
    });
});
