"use client"

import { motion } from "framer-motion"

export type AvatarProps = {
  /** Agent id (opencode, hermes, claude, kimi, agy, codex, openclaw, user, system). */
  agent: string
  /** Optional override color hex. Falls back to the agent's palette color. */
  color?: string
  /** Visual size in px. */
  size?: number
  /** When true, show a presence ring (online pulse). */
  online?: boolean
  className?: string
}

const PALETTE: Record<string, { c1: string; c2: string; glyph: string; initials: string }> = {
  opencode:  { c1: "#22e3ff", c2: "#3b82f6", glyph: "⌬", initials: "OC" },
  hermes:    { c1: "#ff6b8b", c2: "#fb923c", glyph: "✶", initials: "HM" },
  claude:    { c1: "#f59e0b", c2: "#a78bfa", glyph: "✦", initials: "CL" },
  kimi:      { c1: "#9dff5b", c2: "#14b8a6", glyph: "◐", initials: "KM" },
  agy:       { c1: "#ffb454", c2: "#facc15", glyph: "◆", initials: "AG" },
  codex:     { c1: "#34d399", c2: "#0ea5e9", glyph: "▣", initials: "CX" },
  openclaw:  { c1: "#a78bfa", c2: "#22e3ff", glyph: "⬡", initials: "OW" },
  user:      { c1: "#475569", c2: "#94a3b8", glyph: "◉", initials: "YOU" },
  system:    { c1: "#475569", c2: "#334155", glyph: "◌", initials: "SYS" },
}

export function Avatar({ agent, color, size = 36, online, className = "" }: AvatarProps) {
  const p = PALETTE[agent] ?? { c1: color ?? "#64748b", c2: color ?? "#475569", glyph: "?", initials: (agent ?? "?").slice(0, 2).toUpperCase() }
  const c1 = color ?? p.c1
  const c2 = color ?? p.c2
  const ringSize = online ? size + 4 : size
  return (
    <div className={`relative inline-block shrink-0 ${className}`} style={{ width: ringSize, height: ringSize }} aria-label={`${agent} avatar`}>
      {online && (
        <span
          className="absolute inset-0 rounded-full animate-pulseGlow"
          style={{ background: `radial-gradient(closest-side, ${c1}aa, transparent 70%)`, filter: "blur(6px)" }}
        />
      )}
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="absolute inset-0 rounded-full grid place-items-center font-semibold text-white select-none"
        style={{
          width: size,
          height: size,
          background: `linear-gradient(135deg, ${c1}, ${c2})`,
          boxShadow: `0 4px 14px -4px ${c1}66, inset 0 1px 0 rgba(255,255,255,0.18)`,
          left: online ? 2 : 0,
          top: online ? 2 : 0,
        }}
      >
        <span style={{ fontSize: size * 0.42, lineHeight: 1, textShadow: "0 1px 2px rgba(0,0,0,0.35)" }}>{p.glyph}</span>
      </motion.div>
      {online && (
        <span
          className="absolute bottom-0 right-0 rounded-full"
          style={{
            width: Math.max(8, size * 0.26),
            height: Math.max(8, size * 0.26),
            background: "#9dff5b",
            border: "2px solid #04060d",
          }}
        />
      )}
    </div>
  )
}

export const AGENT_PALETTE = PALETTE