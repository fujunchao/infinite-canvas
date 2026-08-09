import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, CanvasNodeImage } from "@/types/canvas";

type LegacyBatchMetadata = CanvasNodeData["metadata"] & {
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    imageBatchExpanded?: boolean;
};

export function migrateLegacyCanvasData(nodes: CanvasNodeData[], connections: CanvasConnection[], sessions: CanvasAssistantSession[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const referencedIds = new Set(sessions.flatMap((session) => session.messages.flatMap((message) => (message.references || []).map((reference) => reference.id))));
    const removedIds = new Set<string>();
    const migrated = nodes.map((node) => {
        const metadata = node.metadata as LegacyBatchMetadata | undefined;
        const childIds = metadata?.batchChildIds || [];
        if (!metadata?.isBatchRoot || !childIds.length || metadata.images?.length) return node;
        const children = childIds.map((id) => nodeById.get(id)).filter((child): child is CanvasNodeData => Boolean(child));
        const images = children.map((child) => legacyImage(child, child.id === metadata.primaryImageId ? node : undefined));
        const primary = images.find((image) => image.id === metadata.primaryImageId && image.content) || images.find((image) => image.content);
        const preservedIds = new Set(
            children
                .filter((child) => referencedIds.has(child.id) || child.metadata?.groupId || connections.some((connection) => (connection.fromNodeId === child.id || connection.toNodeId === child.id) && !(connection.fromNodeId === node.id && connection.toNodeId === child.id)))
                .map((child) => child.id),
        );
        childIds.forEach((id) => {
            if (!preservedIds.has(id)) removedIds.add(id);
        });
        const cleanMetadata = stripLegacyBatchMetadata(metadata);
        return {
            ...node,
            metadata: {
                ...cleanMetadata,
                images,
                count: images.length,
                primaryImageId: primary?.id,
                ...(primary
                    ? {
                          content: primary.content,
                          storageKey: primary.storageKey,
                          naturalWidth: primary.naturalWidth,
                          naturalHeight: primary.naturalHeight,
                          bytes: primary.bytes,
                          mimeType: primary.mimeType,
                      }
                    : {}),
            },
        };
    });
    return {
        nodes: migrated.filter((node) => !removedIds.has(node.id)).map((node) => ({ ...node, metadata: stripLegacyBatchMetadata(node.metadata as LegacyBatchMetadata | undefined) })),
        connections: connections.filter((connection) => !removedIds.has(connection.fromNodeId) && !removedIds.has(connection.toNodeId)),
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
    const { isBatchRoot: _isBatchRoot, batchRootId: _batchRootId, batchChildIds: _batchChildIds, batchUsesReferenceImages: _batchUsesReferenceImages, imageBatchExpanded: _imageBatchExpanded, ...current } = metadata;
    return current;
}
