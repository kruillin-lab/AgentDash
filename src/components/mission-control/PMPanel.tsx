"use client";

import React, { useState } from "react";

import { IntakeAckV1Schema, type CEOIntakeRequestV1, type IntakeAckV1 } from "../../lib/mission-control/intake-api";
import { createCEORequestId } from "../../lib/mission-control/request-id";
import { ChatShell } from "../ChatShell";
import { MessageBubble, MessageList, type ChatMessage } from "../MessageBubble";
import { Button } from "../ui";

const initialMessage: ChatMessage = {
  id: "pm-boundary",
  role: "system",
  content: "The PM can discuss and propose work. Only the controller can persist or activate a mandate.",
  meta: "proposal-only",
};

export function PMPanel({ onAcknowledged }: { onAcknowledged?: (ack: IntakeAckV1) => void | Promise<void> }) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<CEOIntakeRequestV1 | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([initialMessage]);

  async function send(envelope: CEOIntakeRequestV1): Promise<void> {
    setSending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/mission-control/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      });
      if (!response.ok) throw new Error("intake request failed");
      const acknowledgement = IntakeAckV1Schema.parse(await response.json());
      if (acknowledgement.request_id !== envelope.request_id) throw new Error("intake acknowledgement mismatch");
      setMessages((current) => [
        ...current,
        { id: `${envelope.request_id}:ceo`, role: "user", content: envelope.message, meta: "CEO" },
        { id: `${envelope.request_id}:pm`, role: "assistant", author: "PM", content: acknowledgement.pm.text, meta: acknowledgement.result.kind },
      ]);
      setPending(null);
      setDraft("");
      try {
        await onAcknowledged?.(acknowledgement);
      } catch {
        // The intake is already acknowledged. A downstream board refresh must
        // never turn this into a replayable intake failure.
      }
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  function submit(): void {
    if (sending || pending || !draft.trim()) return;
    const envelope = { request_id: createCEORequestId(), message: draft };
    setPending(envelope);
    void send(envelope);
  }

  function editAfterFailure(): void {
    if (!failed || sending || !pending) return;
    setDraft(pending.message);
    setPending(null);
    setFailed(false);
  }

  const composer = (
    <div className="space-y-2">
      <textarea
        aria-label="PM conversation"
        value={pending?.message ?? draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={sending || pending !== null}
        placeholder="Describe the outcome you want the PM to plan."
        className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/85 placeholder:text-white/35 disabled:cursor-not-allowed"
        rows={2}
      />
      {failed && <p role="alert" className="text-xs text-amber-100/80">The request was not acknowledged. Retry preserves the exact request identity.</p>}
      <div className="flex gap-2">
        {failed && pending ? (
          <>
            <Button onClick={() => void send(pending)} disabled={sending} className="flex-1 justify-center">Retry</Button>
            <Button onClick={editAfterFailure} disabled={sending} variant="ghost">Edit message</Button>
          </>
        ) : (
          <Button onClick={submit} disabled={sending || pending !== null || !draft.trim()} className="w-full justify-center">Send</Button>
        )}
      </div>
      <p className="text-center text-[10px] text-white/35">PM text is evidence, never approval or execution authority.</p>
    </div>
  );

  return (
    <ChatShell className="min-h-[22rem]" header={{ agent: "system", title: "PM conversation", subtitle: "proposal-only", presence: "online" }}>
      <MessageList footer={composer}>
        {messages.map((message) => <MessageBubble key={message.id} m={message} />)}
      </MessageList>
    </ChatShell>
  );
}
