export function getMentionOverlayLabels(value: string, labels: string[], hasSelection: boolean, isComposing: boolean) {
    if (!value || hasSelection || isComposing) return [];
    return labels.filter((label) => value.includes(label));
}
