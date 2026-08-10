"use client"

import { motion, type HTMLMotionProps } from "framer-motion"

export function Panel({
  className = "",
  strong = false,
  hover = false,
  ...rest
}: HTMLMotionProps<"div"> & { strong?: boolean; hover?: boolean }) {
  const base = strong ? "glass-strong" : "glass"
  const hoverCls = hover ? "glass-hover" : ""
  return (
    <motion.div
      className={`rounded-2xl ${base} ${hoverCls} ${className}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      {...rest}
    />
  )
}

export function PanelHeader({ title, subtitle, accent = "#22e3ff", glyph = "◈", right }: { title: string; subtitle?: string; accent?: string; glyph?: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-5 pt-5">
      <span className="grid place-items-center h-9 w-9 rounded-xl text-base shrink-0" style={{ color: accent, background: `${accent}14`, boxShadow: `inset 0 0 18px -8px ${accent}` }}>
        {glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white/90 truncate">{title}</div>
        {subtitle && <div className="text-xs text-white/45 truncate">{subtitle}</div>}
      </div>
      {right}
    </div>
  )
}

export function Stat({ label, value, accent = "#22e3ff", sub }: { label: string; value: React.ReactNode; accent?: string; sub?: string }) {
  return (
    <Panel className="p-4" hover>
      <div className="text-[10px] uppercase tracking-[0.25em] text-white/40">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: accent }}>{value}</div>
      {sub && <div className="text-[11px] text-white/40 mt-0.5">{sub}</div>}
    </Panel>
  )
}

export function Button({ children, onClick, disabled, variant = "primary", className = "", type = "button" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "ghost" | "danger"; className?: string; type?: "button" | "submit" }) {
  const styles: Record<string, string> = {
    primary: "text-void-950 bg-neon-cyan hover:bg-white shadow-neon",
    ghost: "text-white/80 bg-white/5 hover:bg-white/10 border border-white/10",
    danger: "text-white bg-rose-500/80 hover:bg-rose-500",
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all focus-ring disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function StatusPill({ on, label, color = "#22e3ff" }: { on: boolean; label: string; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
      style={{ background: on ? `${color}1a` : "rgba(75,85,117,0.15)", color: on ? color : "#8892b0", border: `1px solid ${on ? color + "55" : "rgba(120,140,180,0.18)"}` }}
    >
      <span className="status-dot" style={{ background: on ? color : "#4b5575" }} />
      {label}
    </span>
  )
}

export function Spinner({ color = "#22e3ff" }: { color?: string }) {
  return (
    <span className="inline-block h-4 w-4 rounded-full border-2 border-white/15 animate-spin" style={{ borderTopColor: color }} />
  )
}

export function Empty({ glyph = "✶", title, sub }: { glyph?: string; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="text-3xl text-white/20 mb-2">{glyph}</div>
      <div className="text-sm text-white/55">{title}</div>
      {sub && <div className="text-xs text-white/30 mt-1 max-w-sm">{sub}</div>}
    </div>
  )
}

export const SpinnerExport = Spinner