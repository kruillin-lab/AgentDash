"use client"

import { motion } from "framer-motion"
import { Avatar, AGENT_PALETTE } from "./Avatar"
import type { ReactNode } from "react"

export type ChatHeaderProps = {
  agent: string
  title: string
  subtitle?: ReactNode
  presence?: "online" | "offline" | "busy"
  meta?: ReactNode
  actions?: ReactNode
  avatarSize?: number
}

export function ChatHeader({ agent, title, subtitle, presence = "online", meta, actions, avatarSize = 36 }: ChatHeaderProps) {
  const presenceColor = presence === "online" ? "#9dff5b" : presence === "busy" ? "#ffb454" : "#4b5575"
  return (
    <div className="flex items-center gap-3 px-4 sm:px-5 py-3 glass-strong border-b border-white/10">
      <Avatar agent={agent} size={avatarSize} online={presence === "online"} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white truncate">{title}</div>
        <div className="flex items-center gap-2 text-[11px] text-white/55 truncate">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: presenceColor }} />
          <span className="capitalize">{presence}</span>
          {subtitle && <span className="text-white/35">· {subtitle}</span>}
          {meta && <span className="text-white/35">{meta}</span>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export type ChatComposerProps = {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  placeholder?: string
  sending?: boolean
  disabled?: boolean
  hint?: string
  onAttach?: () => void
  agent?: string
}

export function ChatComposer({ value, onChange, onSend, placeholder, sending, disabled, hint, onAttach, agent }: ChatComposerProps) {
  const palette = agent ? AGENT_PALETTE[agent] : undefined
  const accent = palette?.c1 ?? "#22e3ff"
  return (
    <div className="glass-strong border-t border-white/10 px-4 sm:px-5 py-3">
      <div className="flex items-end gap-2">
        {onAttach && (
          <button
            onClick={onAttach}
            className="grid place-items-center h-11 w-11 rounded-xl text-white/55 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition focus-ring"
            aria-label="Attach"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.5l-8.5 8.5a5 5 0 0 1-7-7l9-9a3.5 3.5 0 0 1 5 5l-9 9a2 2 0 0 1-3-3l8-8" />
            </svg>
          </button>
        )}
        <div className="flex-1 relative">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!sending && !disabled && value.trim()) onSend() }
            }}
            placeholder={placeholder ?? "Type a message…"}
            rows={1}
            className="w-full resize-none rounded-2xl bg-white/5 border border-white/10 px-4 py-2.5 pr-24 text-sm text-white/90 placeholder:text-white/30 focus-ring focus:border-white/30"
            style={{ minHeight: 44, maxHeight: 220 }}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1.5 text-[10px] text-white/35">
            <span className="font-mono">⌘↵</span>
          </div>
        </div>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onSend}
          disabled={sending || disabled || !value.trim()}
          className="h-11 px-4 rounded-xl text-sm font-semibold text-void-950 disabled:opacity-40 disabled:cursor-not-allowed transition focus-ring"
          style={{ background: `linear-gradient(135deg, ${accent}, ${palette?.c2 ?? "#3b82f6"})`, boxShadow: `0 8px 24px -10px ${accent}88` }}
        >
          {sending ? (
            <span className="inline-block h-4 w-4 rounded-full border-2 border-void-950/40 animate-spin" style={{ borderTopColor: "#04060d" }} />
          ) : (
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M3 12l18-9-9 18-2-7-7-2z" />
              </svg>
              Send
            </span>
          )}
        </motion.button>
      </div>
      {hint && <div className="mt-2 text-[11px] text-white/35">{hint}</div>}
    </div>
  )
}

export type ChatShellProps = {
  header: ChatHeaderProps
  children: ReactNode
  composer?: ChatComposerProps
  className?: string
}

export function ChatShell({ header, children, composer, className = "" }: ChatShellProps) {
  // ChatShell fills its column. The composer is rendered inside the scrollable
  // message list as a sticky footer (passed by the caller via MessageList's
  // `footer` prop). This guarantees the composer stays pinned to the bottom of
  // the visible chat scroll area even when the page itself scrolls.
  return (
    <div className={`relative flex flex-col h-full min-h-0 rounded-2xl glass overflow-hidden ${className}`}>
      <ChatHeader {...header} />
      <div className="flex-1 min-h-0 relative">
        {children}
      </div>
    </div>
  )
}