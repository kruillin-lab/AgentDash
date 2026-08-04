import React from "react";
import { ChatShell } from "../ChatShell";
import { MessageBubble, MessageList } from "../MessageBubble";
import { Button } from "../ui";

export function PMPanel() {
  return (
    <ChatShell className="min-h-[22rem]" header={{ agent: "system", title: "PM conversation", subtitle: "Read-only brief", presence: "offline" }}>
      <MessageList footer={<div className="space-y-2"><textarea aria-label="PM conversation" disabled placeholder="Conversation is disabled in this read-only workspace." className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/50 placeholder:text-white/35 disabled:cursor-not-allowed" rows={2} /><Button disabled className="w-full justify-center">Send disabled in read-only mission control</Button><p className="text-center text-[10px] text-white/35">No command, approval, or launch controls are available.</p></div>}>
        <MessageBubble m={{ id: "pm-read-only", role: "system", content: "This workspace reflects the Hermes board when a read bridge is configured. It never creates or changes work.", time: Date.now(), meta: "read-only" }} />
      </MessageList>
    </ChatShell>
  );
}
