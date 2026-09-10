import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { detachImagePlacementNode, planImagePlacementRemoval, removeCanvasNodes, syncBatchNodeImages } from "@/lib/canvas/canvas-image-placements";
import { getNodeSpec, isRegisteredNodeType } from "@/lib/canvas/node-registry";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeMetadata, type CanvasNodeTypeId, type ViewportTransform } from "@/types/canvas";

export type CanvasAgentOp =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeTypeId; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeTypeId }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string };

export type CanvasAgentSnapshot = {
    projectId: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
};

export function summarizeCanvasAgentOps(ops?: CanvasAgentOp[]) {
    const counts = (Array.isArray(ops) ? ops : []).reduce<Record<string, number>>((acc, op) => {
        if (!op?.type) return acc;
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .map(([type, count]) => `${opLabel(type)} ${count}`)
        .join("，");
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops?: CanvasAgentOp[]) {
    let nodes = snapshot.nodes;
    let connections = snapshot.connections;
    let selectedNodeIds = snapshot.selectedNodeIds;
    let viewport = snapshot.viewport;
    const safeOps = Array.isArray(ops) ? ops : [];
    const explicitlyMovedNodeIds = new Set(safeOps.flatMap((op) => (op?.type === "update_node" && op.patch?.position ? [op.id] : [])));

    safeOps.forEach((op, index) => {
        if (!op?.type) return;
        if (op.type === "add_node") {
            const nodeType = op.nodeType && isRegisteredNodeType(op.nodeType) ? op.nodeType : CanvasNodeType.Text;
            const spec = getNodeSpec(nodeType);
            const node: CanvasNodeData = {
                id: op.id || `${nodeType}-${Date.now()}-${index}`,
                type: nodeType,
                title: op.title || spec.title,
                position: op.position || { x: op.x ?? index * 36, y: op.y ?? index * 36 },
                width: op.width || spec.width,
                height: op.height || spec.height,
                metadata: { ...spec.metadata, ...op.metadata },
            };
            nodes = [...nodes, node];
            selectedNodeIds = [node.id];
        }
        if (op.type === "update_node") {
            if (!op.id) return;
            const metadataPatch = { ...op.patch?.metadata, ...op.metadata };
            const currentNode = nodes.find((node) => node.id === op.id);
            const shouldDetach = Boolean(currentNode?.metadata?.imageRef && ((op.patch?.type && op.patch.type !== currentNode.type) || Object.keys(metadataPatch).some((key) => ["content", "storageKey", "images"].includes(key))));
            if (shouldDetach) nodes = detachImagePlacementNode(nodes, op.id);
            else if (currentNode?.metadata?.imageRef) {
                const ref = currentNode.metadata.imageRef;
                const resourceKeys = ["status", "errorDetails", "naturalWidth", "naturalHeight", "bytes", "mimeType"] as const;
                const resourcePatch = Object.fromEntries(resourceKeys.filter((key) => key in metadataPatch).map((key) => [key, metadataPatch[key]])) as Partial<CanvasNodeImage>;
                if (Object.keys(resourcePatch).length) nodes = nodes.map((node) => node.id === ref.batchNodeId && node.metadata?.images ? syncBatchNodeImages(node, node.metadata.images.map((image) => image.id === ref.imageId ? { ...image, ...resourcePatch } : image)) : node);
                resourceKeys.forEach((key) => delete metadataPatch[key]);
            }
            const current = nodes.find((node) => node.id === op.id);
            if (!current) return;
            let updated: CanvasNodeData = { ...current, ...op.patch, metadata: { ...current.metadata, ...metadataPatch } };
            if (updated.metadata?.images?.length) updated = syncBatchNodeImages(updated, updated.metadata.images, updated.metadata.primaryImageId, Object.prototype.hasOwnProperty.call(metadataPatch, "primaryImageId"));
            const dx = op.patch?.position ? op.patch.position.x - current.position.x : 0;
            const dy = op.patch?.position ? op.patch.position.y - current.position.y : 0;
            nodes = nodes.map((node) => {
                if (node.id === op.id) return updated;
                return (dx || dy) && !explicitlyMovedNodeIds.has(node.id) && node.metadata?.imageRef?.batchNodeId === op.id ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } } : node;
            });
        }
        if (op.type === "delete_node") {
            const ids = new Set(op.ids || (op.id ? [op.id] : op.nodeType ? nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []));
            const removal = planImagePlacementRemoval(nodes, ids);
            nodes = removeCanvasNodes(nodes, removal.removedNodeIds, removal.removedImagesByBatchId);
            connections = connections.filter((conn) => !removal.removedNodeIds.has(conn.fromNodeId) && !removal.removedNodeIds.has(conn.toNodeId));
            selectedNodeIds = selectedNodeIds.filter((id) => !removal.removedNodeIds.has(id));
        }
        if (op.type === "delete_connections") {
            const ids = new Set(op.ids || (op.id ? [op.id] : []));
            connections = op.all ? [] : connections.filter((conn) => !ids.has(conn.id));
        }
        if (op.type === "connect_nodes") {
            if (!op.fromNodeId || !op.toNodeId) return;
            const exists = connections.some((conn) => conn.fromNodeId === op.fromNodeId && conn.toNodeId === op.toNodeId);
            const hasNodes = nodes.some((node) => node.id === op.fromNodeId) && nodes.some((node) => node.id === op.toNodeId);
            if (!exists && hasNodes) connections = [...connections, { id: op.id || nanoid(), fromNodeId: op.fromNodeId, toNodeId: op.toNodeId }];
        }
        if (op.type === "set_viewport" && op.viewport) viewport = op.viewport;
        if (op.type === "select_nodes") selectedNodeIds = (op.ids || []).filter((id) => nodes.some((node) => node.id === id));
    });

    return { ...snapshot, nodes, connections, selectedNodeIds, viewport };
}

function opLabel(type: string) {
    return i18n.t(`canvas.agentOps.${type}`, { defaultValue: type });
}
