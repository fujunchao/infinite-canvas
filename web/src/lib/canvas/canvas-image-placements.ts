import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeImage, type CanvasNodeMetadata } from "@/types/canvas";

const PLACEMENT_GAP = 36;
const PLACEMENT_OFFSET = 120;
const PLACEMENT_COLUMNS = 2;

export function createImagePlacementNode(batchNode: CanvasNodeData, image: CanvasNodeImage, index: number): CanvasNodeData {
    const column = index % PLACEMENT_COLUMNS;
    const row = Math.floor(index / PLACEMENT_COLUMNS);
    const size = placementSize(batchNode, image);
    return {
        id: imagePlacementNodeId(batchNode.id, image.id),
        type: CanvasNodeType.Image,
        title: `${batchNode.title} ${index + 1}`,
        position: {
            x: batchNode.position.x + batchNode.width + PLACEMENT_OFFSET + column * (batchNode.width + PLACEMENT_GAP),
            y: batchNode.position.y + row * (batchNode.height + PLACEMENT_GAP),
        },
        ...size,
        metadata: { imageRef: { batchNodeId: batchNode.id, imageId: image.id } },
    };
}

export function imagePlacementNodeId(batchNodeId: string, imageId: string) {
    return `image-placement:${batchNodeId}:${imageId}`;
}

export function getImagePlacementResource(node: CanvasNodeData, nodeById: ReadonlyMap<string, CanvasNodeData>) {
    const imageRef = node.metadata?.imageRef;
    if (!imageRef) return null;
    const batchNode = nodeById.get(imageRef.batchNodeId);
    const image = batchNode?.metadata?.images?.find((item) => item.id === imageRef.imageId);
    return batchNode && image ? { batchNode, image } : null;
}

export function resolveImagePlacementNode(node: CanvasNodeData, nodeById: ReadonlyMap<string, CanvasNodeData>) {
    const resource = getImagePlacementResource(node, nodeById);
    if (!resource) return node;
    const { batchNode, image } = resource;
    return {
        ...node,
        metadata: {
            ...node.metadata,
            prompt: node.metadata?.prompt ?? batchNode.metadata?.prompt,
            generationType: node.metadata?.generationType ?? batchNode.metadata?.generationType,
            model: node.metadata?.model ?? batchNode.metadata?.model,
            size: node.metadata?.size ?? batchNode.metadata?.size,
            quality: node.metadata?.quality ?? batchNode.metadata?.quality,
            background: node.metadata?.background ?? batchNode.metadata?.background,
            count: node.metadata?.count ?? batchNode.metadata?.count,
            references: node.metadata?.references ?? batchNode.metadata?.references,
            content: image.content,
            storageKey: image.storageKey,
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            bytes: image.bytes,
            mimeType: image.mimeType,
            status: image.status,
            errorDetails: image.errorDetails,
        },
    };
}

export function resolveImagePlacementNodes(nodes: CanvasNodeData[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return nodes.map((node) => resolveImagePlacementNode(node, nodeById));
}

export function isImageBatchRoot(node: CanvasNodeData) {
    const count = node.metadata?.images?.length || 0;
    return node.type === CanvasNodeType.Image && (count > 1 || (count > 0 && node.metadata?.imageBatchExpanded !== undefined));
}

export function getExpandedImageBatchIds(nodes: CanvasNodeData[]) {
    return new Set(nodes.filter((node) => isImageBatchRoot(node) && node.metadata?.imageBatchExpanded).map((node) => node.id));
}

export function setImageBatchExpansion(nodes: CanvasNodeData[], expandedIds: ReadonlySet<string>) {
    let changed = false;
    const next = nodes.map((node) => {
        if (!isImageBatchRoot(node) || Boolean(node.metadata?.imageBatchExpanded) === expandedIds.has(node.id)) return node;
        changed = true;
        return { ...node, metadata: { ...node.metadata, imageBatchExpanded: expandedIds.has(node.id) } };
    });
    return changed ? next : nodes;
}

export function imagePlacementConnectionKind(fromNodeId: string, toNodeId: string, nodes: CanvasNodeData[]) {
    return nodes.find((node) => node.id === toNodeId)?.metadata?.imageRef?.batchNodeId === fromNodeId ? "batch" as const : undefined;
}

// 仅在创建新分图或首次补齐批次时调用；已删除的持久化连线不能在渲染时重建。
export function getImagePlacementConnections(nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasConnection[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const existing = new Set(connections.map((connection) => `${connection.fromNodeId}\u0000${connection.toNodeId}`));
    return nodes.flatMap((node) => {
        const resource = getImagePlacementResource(node, nodeById);
        if (!resource || existing.has(`${resource.batchNode.id}\u0000${node.id}`)) return [];
        return [{ id: `batch-link:${node.id}`, fromNodeId: resource.batchNode.id, toNodeId: node.id, kind: "batch" as const }];
    });
}

export function pruneImagePlacementConnections(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return connections.filter((connection) => {
        if (connection.kind !== "batch") return true;
        const target = nodeById.get(connection.toNodeId);
        return target && getImagePlacementResource(target, nodeById)?.batchNode.id === connection.fromNodeId;
    });
}

export function setImagePlacementAsPrimary(nodes: CanvasNodeData[], placementId: string) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const placement = nodeById.get(placementId);
    const resource = placement && getImagePlacementResource(placement, nodeById);
    if (!placement || !resource?.image.content) return nodes;
    return nodes.map((node) => {
        if (node.id !== resource.batchNode.id) return node;
        const synced = syncBatchNodeImages(node, node.metadata!.images!, resource.image.id);
        return { ...synced, position: node.position, width: placement.width, height: placement.height, metadata: { ...synced.metadata, freeResize: placement.metadata?.freeResize } };
    });
}

export function materializeImagePlacementNode(node: CanvasNodeData, nodeById: ReadonlyMap<string, CanvasNodeData>) {
    const resolved = resolveImagePlacementNode(node, nodeById);
    if (!resolved.metadata?.imageRef) return resolved;
    const { imageRef: _imageRef, ...metadata } = resolved.metadata;
    const status = metadata.status === "loading" ? (metadata.content ? "success" : "idle") : metadata.status;
    return { ...resolved, metadata: { ...metadata, count: 1, status, errorDetails: metadata.status === "loading" ? undefined : metadata.errorDetails } };
}

export function syncBatchNodeImages(node: CanvasNodeData, images: CanvasNodeImage[], primaryImageId = node.metadata?.primaryImageId, resizePrimary = false) {
    const primary = images.find((image) => image.id === primaryImageId && image.content) || images.find((image) => image.content) || images.find((image) => image.id === primaryImageId) || images[0];
    const primaryChanged = primary?.id !== node.metadata?.primaryImageId || !node.metadata?.content;
    const status = batchNodeStatus(images);
    const metadata: CanvasNodeMetadata = {
        ...node.metadata,
        images,
        imageBatchExpanded: isImageBatchRoot(node) ? node.metadata?.imageBatchExpanded ?? false : undefined,
        count: images.length,
        status,
        errorDetails: status === "error" ? primary?.errorDetails || images.find((image) => image.errorDetails)?.errorDetails : undefined,
        primaryImageId: primary?.id,
        content: primary?.content || undefined,
        storageKey: primary?.storageKey || undefined,
        naturalWidth: primary?.naturalWidth || undefined,
        naturalHeight: primary?.naturalHeight || undefined,
        bytes: primary?.bytes || undefined,
        mimeType: primary?.mimeType || undefined,
    };
    if (!primary?.content || (!primaryChanged && !resizePrimary) || node.metadata?.freeResize) return { ...node, metadata };
    const edge = Math.max(node.width, node.height);
    const size = fitNodeSize(primary.naturalWidth, primary.naturalHeight, edge, edge);
    return {
        ...node,
        position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 },
        ...size,
        metadata,
    };
}

export function dissolveBatchNode(node: CanvasNodeData, image?: CanvasNodeImage) {
    const synced = syncBatchNodeImages(node, image ? [image] : [], image?.id, true);
    const status = image?.status === "loading" ? (image.content ? "success" : "idle") : image?.status || "idle";
    return {
        ...synced,
        metadata: {
            ...synced.metadata,
            images: undefined,
            primaryImageId: undefined,
            imageBatchExpanded: undefined,
            count: image ? 1 : undefined,
            status,
            errorDetails: image?.status === "loading" ? undefined : image?.errorDetails,
        },
    };
}

export function planImagePlacementRemoval(nodes: CanvasNodeData[], ids: ReadonlySet<string>) {
    const removedNodeIds = new Set(ids);
    const removedImagesByBatchId = new Map<string, Set<string>>();
    nodes.forEach((node) => {
        if (!ids.has(node.id)) return;
        nodes.forEach((placement) => {
            if (placement.metadata?.imageRef?.batchNodeId === node.id) removedNodeIds.add(placement.id);
        });
    });
    nodes.forEach((node) => {
        if (!removedNodeIds.has(node.id) || !node.metadata?.imageRef || removedNodeIds.has(node.metadata.imageRef.batchNodeId)) return;
        const { batchNodeId, imageId } = node.metadata.imageRef;
        const hasRemainingPlacement = nodes.some((placement) => !removedNodeIds.has(placement.id) && placement.metadata?.imageRef?.batchNodeId === batchNodeId && placement.metadata.imageRef.imageId === imageId);
        if (hasRemainingPlacement) return;
        const imageIds = removedImagesByBatchId.get(batchNodeId) || new Set<string>();
        imageIds.add(imageId);
        removedImagesByBatchId.set(batchNodeId, imageIds);
    });
    return { removedNodeIds, removedImagesByBatchId };
}

export function removeCanvasNodes(nodes: CanvasNodeData[], removedNodeIds: ReadonlySet<string>, removedImagesByBatchId: ReadonlyMap<string, ReadonlySet<string>>) {
    const updated = nodes.flatMap((node) => {
        if (removedNodeIds.has(node.id)) return [];
        const removedImageIds = removedImagesByBatchId.get(node.id);
        if (!removedImageIds) return [node];
        const images = (node.metadata?.images || []).filter((image) => !removedImageIds.has(image.id));
        return [retainBatchImages(node, images)];
    });
    return updated
        .map((node) => {
            const groupId = node.metadata?.groupId;
            return groupId && removedNodeIds.has(groupId) ? { ...node, metadata: { ...node.metadata, groupId: undefined } } : node;
        });
}

export function detachImagePlacementNode(nodes: CanvasNodeData[], nodeId: string) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const placement = nodeById.get(nodeId);
    const resource = placement ? getImagePlacementResource(placement, nodeById) : null;
    if (!placement || !resource) return nodes;
    const { batchNode, image } = resource;
    const hasOtherPlacement = nodes.some((node) => node.id !== placement.id && node.metadata?.imageRef?.batchNodeId === batchNode.id && node.metadata.imageRef.imageId === image.id);
    if (hasOtherPlacement) return nodes.map((node) => (node.id === placement.id ? materializeImagePlacementNode(node, nodeById) : node));
    const remainingImages = (batchNode.metadata?.images || []).filter((item) => item.id !== image.id);
    return nodes.map((node) => {
        if (node.id === placement.id) return materializeImagePlacementNode(node, nodeById);
        if (node.id === batchNode.id) return retainBatchImages(node, remainingImages);
        return node;
    });
}

function retainBatchImages(node: CanvasNodeData, images: CanvasNodeImage[]) {
    const primary = node.metadata?.images?.find((image) => image.id === node.metadata?.primaryImageId) || node.metadata?.images?.[0];
    const next = images.length ? syncBatchNodeImages(node, images) : dissolveBatchNode(node, primary);
    return { ...next, position: node.position, width: node.width, height: node.height };
}

export function placementMetadata(imageRef: NonNullable<CanvasNodeMetadata["imageRef"]>, metadata?: CanvasNodeMetadata): CanvasNodeMetadata {
    // 图片资源由根管理，当前节点的提示词、配置覆盖和几何交互独立保留。
    const { content, storageKey, naturalWidth, naturalHeight, bytes, mimeType, status, errorDetails, images, primaryImageId, ...overrides } = metadata || {};
    return { ...overrides, imageRef };
}

export function isImagePlacementHidden(node: CanvasNodeData, expandedBatchIds: ReadonlySet<string>) {
    const batchNodeId = node.metadata?.imageRef?.batchNodeId;
    return Boolean(batchNodeId && !expandedBatchIds.has(batchNodeId));
}

function placementSize(batchNode: CanvasNodeData, image: CanvasNodeImage) {
    if (!image.naturalWidth || !image.naturalHeight) return { width: batchNode.width, height: batchNode.height };
    return fitNodeSize(image.naturalWidth, image.naturalHeight, batchNode.width, batchNode.height);
}

export function batchNodeStatus(images: CanvasNodeImage[]) {
    if (images.some((image) => image.status === "loading")) return "loading";
    return images.some((image) => image.content) ? "success" : "error";
}
