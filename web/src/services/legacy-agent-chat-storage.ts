import localforage from "localforage";

import type { AgentChatItem, AgentMessageAttachment } from "@/stores/use-agent-store";

type LegacyAgentUserMessage = Pick<AgentChatItem, "id" | "text"> & { role: "user"; attachments?: AgentMessageAttachment[]; threadId?: string; turnId?: string };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "agent_chat_messages" });

export async function restoreLegacyAgentAttachments(threadId: string, messages: AgentChatItem[]) {
    const ids = (await store.getItem<string[]>(`thread:${threadId}`)) || [];
    if (!ids.length) return messages;
    const legacyMessages = (await Promise.all(ids.map((id) => store.getItem<LegacyAgentUserMessage>(`message:${threadId}:${id}`)))).filter((item): item is LegacyAgentUserMessage => Boolean(item?.attachments?.length));
    if (!legacyMessages.length) return messages;
    return messages.map((message) => {
        if (message.role !== "user" || message.attachments?.length) return message;
        const legacy = legacyMessages.find((item) => (message.turnId && item.turnId === message.turnId) || item.id === message.clientMessageId || item.id === message.id);
        return legacy?.attachments?.length ? { ...message, attachments: legacy.attachments } : message;
    });
}
