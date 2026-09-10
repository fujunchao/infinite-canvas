import { createImagePlacementNode, getImagePlacementConnections, imagePlacementConnectionKind, isImageBatchRoot, materializeImagePlacementNode, placementMetadata, pruneImagePlacementConnections } from "@/lib/canvas/canvas-image-placements";
import type { CanvasConnection, CanvasNodeData, CanvasNodeImage } from "@/types/canvas";

type LegacyBatchMetadata = CanvasNodeData["metadata"] & {
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
};

export function migrateLegacyCanvasData(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const originalById = new Map(nodes.map((node) => [node.id, node]));
    const referencedRootIds = new Set(nodes.flatMap((node) => node.metadata?.imageRef ? [node.metadata.imageRef.batchNodeId] : []));
    const legacyRoots = new Map<string, { root: CanvasNodeData; images: CanvasNodeImage[]; childIds: string[] }>();
    const legacyChildRootIds = new Map<string, string>();

    nodes.forEach((node) => {
        const metadata = node.metadata as LegacyBatchMetadata | undefined;
        const childIds = metadata?.batchChildIds || [];
        if (!metadata?.isBatchRoot || !childIds.length) return;
        const children = childIds.map((id) => originalById.get(id)).filter((child): child is CanvasNodeData => Boolean(child));
        const images = metadata.images?.length ? metadata.images : children.map((child) => legacyImage(child, child.id === metadata.primaryImageId ? node : undefined));
        legacyRoots.set(node.id, { root: node, images, childIds });
        childIds.forEach((childId) => legacyChildRootIds.set(childId, node.id));
    });

    const normalized = nodes.map((node) => {
        const legacyRoot = legacyRoots.get(node.id);
        if (legacyRoot) return normalizeBatchRoot(legacyRoot.root, legacyRoot.images, true);

        const legacyRootId = legacyChildRootIds.get(node.id);
        if (legacyRootId) {
            const image = legacyRoots.get(legacyRootId)?.images.find((item) => item.id === node.id);
            if (image) return { ...node, metadata: placementMetadata({ batchNodeId: legacyRootId, imageId: image.id }, node.metadata) };
        }

        const metadata = stripLegacyBatchMetadata(node.metadata as LegacyBatchMetadata | undefined);
        const normalizedNode = { ...node, metadata };
        return !metadata?.imageRef && metadata?.images?.length ? normalizeBatchRoot(normalizedNode, metadata.images, referencedRootIds.has(node.id) || isImageBatchRoot(normalizedNode)) : normalizedNode;
    });

    const normalizedById = new Map(normalized.map((node) => [node.id, node]));
    const recoveredOwnerByNodeId = new Map<string, CanvasNodeData>();
    connections.forEach((connection) => {
        const owner = normalizedById.get(connection.fromNodeId);
        if (owner?.metadata?.images?.some((image) => image.id === connection.toNodeId)) recoveredOwnerByNodeId.set(connection.toNodeId, owner);
    });
    const recoveredPlacements = normalized.map((node) => {
        if (node.metadata?.imageRef || node.metadata?.images?.length) return node;
        const owner = recoveredOwnerByNodeId.get(node.id);
        if (!owner) return node;
        return { ...node, metadata: placementMetadata({ batchNodeId: owner.id, imageId: node.id }, node.metadata) };
    });
    const recoveredById = new Map(recoveredPlacements.map((node) => [node.id, node]));
    const normalizedPlacements = recoveredPlacements.map((node) => {
        const imageRef = node.metadata?.imageRef;
        if (!imageRef) return node;
        const batchNode = recoveredById.get(imageRef.batchNodeId);
        if (!batchNode?.metadata?.images?.length) return materializeImagePlacementNode(node, recoveredById);
        return { ...node, metadata: placementMetadata(imageRef, node.metadata) };
    });
    const placementsByImage = new Map<string, CanvasNodeData[]>();
    normalizedPlacements.forEach((node) => {
        const imageRef = node.metadata?.imageRef;
        if (!imageRef) return;
        const key = `${imageRef.batchNodeId}\u0000${imageRef.imageId}`;
        placementsByImage.set(key, [...(placementsByImage.get(key) || []), node]);
    });

    const existingIds = new Set(normalizedPlacements.map((node) => node.id));
    const addedPlacements: CanvasNodeData[] = [];
    const validPlacementIds = new Set<string>();
    normalizedPlacements.forEach((batchNode) => {
        const images = batchNode.metadata?.images || [];
        if (!isImageBatchRoot(batchNode)) return;
        images.forEach((image, index) => {
            const key = `${batchNode.id}\u0000${image.id}`;
            const existing = placementsByImage.get(key) || [];
            if (existing.length) {
                existing.forEach((placement) => validPlacementIds.add(placement.id));
                return;
            }
            const placement = createImagePlacementNode(batchNode, image, index);
            while (existingIds.has(placement.id)) placement.id = `${placement.id}:copy`;
            existingIds.add(placement.id);
            validPlacementIds.add(placement.id);
            addedPlacements.push(placement);
        });
    });

    const migratedNodes = [...normalizedPlacements.filter((node) => !node.metadata?.imageRef || validPlacementIds.has(node.id)), ...addedPlacements];
    const migratedIds = new Set(migratedNodes.map((node) => node.id));
    const retainedConnections = pruneImagePlacementConnections(migratedNodes, connections
        .filter((connection) => migratedIds.has(connection.fromNodeId) && migratedIds.has(connection.toNodeId))
        .map((connection) => ({ ...connection, kind: imagePlacementConnectionKind(connection.fromNodeId, connection.toNodeId, migratedNodes) || connection.kind })));
    const initializeRoots = new Set(migratedNodes.filter((node) => isImageBatchRoot(node) && originalById.get(node.id)?.metadata?.imageBatchExpanded === undefined).map((node) => node.id));
    return {
        nodes: migratedNodes,
        connections: [...retainedConnections, ...getImagePlacementConnections(migratedNodes, retainedConnections).filter((connection) => initializeRoots.has(connection.fromNodeId))],
    };
}

function normalizeBatchRoot(node: CanvasNodeData, images: CanvasNodeImage[], batch: boolean) {
    const metadata = stripLegacyBatchMetadata(node.metadata as LegacyBatchMetadata | undefined);
    const primary = images.find((image) => image.id === metadata?.primaryImageId && image.content) || images.find((image) => image.content) || images[0];
    return {
        ...node,
        metadata: {
            ...metadata,
            images,
            imageBatchExpanded: batch ? metadata?.imageBatchExpanded ?? false : undefined,
            count: images.length,
            primaryImageId: primary?.id,
            content: primary?.content || undefined,
            storageKey: primary?.storageKey || undefined,
            naturalWidth: primary?.naturalWidth || undefined,
            naturalHeight: primary?.naturalHeight || undefined,
            bytes: primary?.bytes || undefined,
            mimeType: primary?.mimeType || undefined,
        },
    };
}

function legacyImage(node: CanvasNodeData, fallback?: CanvasNodeData): CanvasNodeImage {
    const metadata = node.metadata || {};
    const fallbackMetadata = fallback?.metadata || {};
    const content = metadata.content || fallbackMetadata.content || "";
    return {
        id: node.id,
        status: metadata.status || (content ? "success" : "error"),
        errorDetails: metadata.errorDetails,
        content,
        storageKey: metadata.storageKey || fallbackMetadata.storageKey || "",
        naturalWidth: metadata.naturalWidth || fallbackMetadata.naturalWidth || node.width,
        naturalHeight: metadata.naturalHeight || fallbackMetadata.naturalHeight || node.height,
        bytes: metadata.bytes || fallbackMetadata.bytes || 0,
        mimeType: metadata.mimeType || fallbackMetadata.mimeType || "image/png",
    };
}

function stripLegacyBatchMetadata(metadata?: LegacyBatchMetadata) {
    if (!metadata) return metadata;
    const { isBatchRoot: _isBatchRoot, batchRootId: _batchRootId, batchChildIds: _batchChildIds, batchUsesReferenceImages: _batchUsesReferenceImages, ...current } = metadata;
    return current;
}
