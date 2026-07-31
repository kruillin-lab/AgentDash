"use client"

import { motion } from "framer-motion"
import { Avatar, type AvatarProps } from "./Avatar"
import { useEffect, useRef } from "react"

export type ChatMessage = {
  id: string
  /** "user", "assistant" (or any agent id), "system", "tool" */
  role: string
  /** Display name shown in the bubble header. */
  author?: string
  /** Agent id used for avatar styling. Falls back to role. */
  agent?: string
  /** Rendered body — string or ReactNode. */
  content: React.ReactNode
  /** Optional timestamp (ms). */
  time?: number
  /** Optional meta line (model, tokens, cost). */
  meta?: React.ReactNode
}

export function MessageBubble({ m, align = "agent" }: { m: ChatMessage; align?: "agent" | "user" | "left" }) {
  const isUser = align === "user" || m.role === "user"
  const agentId = m.agent ?? (isUser ? "user" : m.role === "system" ? "system" : "opencode")
  const online = !isUser && m.role !== "system"
  const time = m.time ? new Date(m.time) : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={`flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"}`}
    >
      {!isUser && <Avatar agent={agentId} size={28} online={online} />}
      <div className={`max-w-[78%] flex flex-col ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && (
          <div className="px-3 text-[10px] uppercase tracking-wider text-white/45 mb-1">
            {m.author ?? agentId}
          </div>
        )}
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words shadow-glass ${
            isUser
              ? "rounded-br-md bg-gradient-to-br from-neon-cyan to-blue-500 text-void-950"
              : m.role === "system"
              ? "rounded-bl-md bg-white/5 text-white/60 border border-white/10"
              : "rounded-bl-md bg-glass text-white/90 border border-white/10"
          }`}
          style={
            isUser
              ? { boxShadow: "0 8px 24px -10px rgba(34,227,255,0.55), inset 0 1px 0 rgba(255,255,255,0.18)" }
              : m.role === "system"
              ? {}
              : { backdropFilter: "blur(14px) saturate(140%)" }
          }
        >
          {typeof m.content === "string" ? (
            <div className="whitespace-pre-wrap font-sans">{m.content}</div>
          ) : (
            m.content
          )}
        </div>
        {(time || m.meta) && (
          <div className="px-3 mt-1 text-[10px] text-white/35 flex items-center gap-2">
            {time && <span className="font-mono">{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
            {m.meta && <span>{m.meta}</span>}
          </div>
        )}
      </div>
      {isUser && <Avatar agent="user" size={28} />}
    </motion.div>
  )
}

/**
 * Scrollable list of messages with auto-scroll-to-bottom behavior.
 * The caller provides the bubble render via children.
 * An optional `footer` (e.g. the composer) is rendered as a sticky-bottom
 * element inside the scroll container, so it stays pinned to the visible
 * bottom regardless of how far messages scroll.
 */
export function MessageList({
  children,
  ref: externalRef,
  className = "",
  footer,
}: {
  children: React.ReactNode
  ref?: React.Ref<HTMLDivElement>
  className?: string
  footer?: React.ReactNode
}) {
  const localRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)

  useEffect(() => {
    const el = localRef.current
    if (!el) return
    const count = el.children.length
    if (count !== lastCount.current) {
      lastCount.current = count
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: count > lastCount.current ? "smooth" : "auto" })
      })
    }
  })

  return (
    <div
      ref={(node) => {
        (localRef as React.MutableRefObject<HTMLDivElement | null>).current = node
        if (typeof externalRef === "function") externalRef(node)
        else if (externalRef && typeof externalRef === "object") {
          try { (externalRef as React.MutableRefObject<HTMLDivElement | null>).current = node } catch { /* readonly ref */ }
        }
      }}
      className={`overflow-y-auto ${className}`}
    >
      <div className="flex flex-col gap-4 p-4">
        {children}
      </div>
      {footer && (
        <div className="sticky bottom-0 left-0 right-0 z-10 px-3 pb-3 pt-2 bg-gradient-to-t from-void-950 via-void-950/95 to-transparent">
          {footer}
        </div>
      )}
    </div>
  )
}

export function TypingIndicator({ agent = "opencode" }: { agent?: string }) {
  return (
    <div className="flex items-end gap-2">
      <Avatar agent={agent} size={28} online />
      <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-glass border border-white/10 flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block w-1.5 h-1.5 rounded-full bg-white/55"
            style={{ animation: `bounceDot 1.2s ${i * 0.18}s ease-in-out infinite` }}
          />
        ))}
        <style>{`@keyframes bounceDot { 0%, 100% { transform: translateY(0); opacity: 0.35 } 50% { transform: translateY(-3px); opacity: 1 } }`}</style>
      </div>
    </div>
  )
}