import { PRIORITY_META, STATUS_META, type Priority, type Status } from "@/lib/constants";

export { PRIORITY_META, STATUS_META };

export function OtterMark({ className }: { className?: string }) {
  return <img src="/brand/otter-line.png" alt="" aria-hidden draggable={false} className={className} />;
}

// Workspace avatar: the user's uploaded square image, or the otter by default.
export function WorkspaceMark({ icon, className }: { icon?: string | null; className?: string }) {
  if (!icon) return <OtterMark className={className} />;
  return <img src={icon} alt="" aria-hidden draggable={false} className={`rounded-md object-cover ${className ?? ""}`} />;
}

export function StatusIcon({ status, size = 14 }: { status: Status; size?: number }) {
  const { color } = STATUS_META[status];
  if (status === "todo") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="5.5" fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
    );
  }
  if (status === "in_progress") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
        <path d="M8 8 L8 2.5 A5.5 5.5 0 0 1 13.5 8 Z" fill={color} />
        <circle cx="8" cy="8" r="5.5" fill="none" stroke={color} strokeWidth="1.5" opacity="0.55" />
      </svg>
    );
  }
  if (status === "done") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="7" fill={color} />
        <path
          d="M4.8 8.3 L7 10.4 L11.2 5.8"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="7" fill={color} />
      <path
        d="M5.5 5.5 L10.5 10.5 M10.5 5.5 L5.5 10.5"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Isometric cube: a rounded hexagon with the three edges that meet at the near
// corner, drawn as one weight so the icon reads the same at 14px and at 40px.
export function ProjectIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <g
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6.92 2.13Q8 1.5 9.08 2.13L12.55 4.13Q13.63 4.75 13.63 6L13.63 10Q13.63 11.25 12.55 11.88L9.08 13.88Q8 14.5 6.92 13.88L3.45 11.88Q2.37 11.25 2.37 10L2.37 6Q2.37 4.75 3.45 4.12Z" />
        <path d="M2.37 4.75 8 8 13.63 4.75M8 8v6.5" />
      </g>
    </svg>
  );
}

export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  const barWidth = 2.6;
  const bars = [
    { x: 1.2, y: 8.4, h: 5.2 },
    { x: 5.7, y: 6, h: 7.6 },
    { x: 10.2, y: 3.6, h: 10 },
  ];
  if (priority === 4) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
        <rect width="14" height="14" rx="3.5" fill="#f2994a" />
        <rect x="6.2" y="2.6" width="1.6" height="6" rx="0.8" fill="#fff" />
        <circle cx="7" cy="11.1" r="0.95" fill="#fff" />
      </svg>
    );
  }
  const { color } = PRIORITY_META[priority];
  const filled = priority;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      {bars.map((bar, i) =>
        i < filled ? (
          <rect key={i} x={bar.x} y={bar.y} width={barWidth} height={bar.h} rx="1.3" fill={color} />
        ) : (
          <rect
            key={i}
            x={bar.x + 0.3}
            y={bar.y + 0.3}
            width={barWidth - 0.6}
            height={bar.h - 0.6}
            rx="1"
            fill="none"
            stroke="#c9c9c9"
            strokeWidth="1"
          />
        )
      )}
    </svg>
  );
}

export function LabelPill({
  name,
  color,
  small,
}: {
  name: string;
  color: string;
  small?: boolean;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full ${small ? "px-1.5 text-[10px]" : "px-2 text-[11px]"} font-medium leading-4`}
      style={{
        backgroundColor: `${color}1f`,
        color: `color-mix(in srgb, ${color} 62%, #1a1a1a)`,
      }}
    >
      {name}
    </span>
  );
}

export function ViaBadge({ via }: { via: "web" | "api" | "mcp" }) {
  if (via === "web") return null;
  const color = via === "mcp" ? "#7c3aed" : "#4f46e5";
  const label = via === "mcp" ? "Created by MCP agent" : "Created via API agent";
  return (
    <span
      title={label}
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
      aria-label={label}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" aria-hidden>
        <path d="M12 2 4 7v10l8 5 8-5V7l-8-5z" strokeLinejoin="round" />
        <path d="M12 8.5 8.5 10.5v4L12 16.5l3.5-2v-4L12 8.5z" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
