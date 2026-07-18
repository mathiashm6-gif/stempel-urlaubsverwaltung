import { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v4.7l3 1.8" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
    </>
  ),
  chart: (
    <>
      <rect x="3.5" y="12" width="4" height="8" rx="1.2" />
      <rect x="10" y="7" width="4" height="13" rx="1.2" />
      <rect x="16.5" y="4" width="4" height="16" rx="1.2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a4 4 0 0 0-5.5 5.2l-6 6 2.8 2.8 6-6a4 4 0 0 0 5.2-5.5l-2.5 2.5-2-.5-.5-2 2.5-2.5z" />
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.3" />
      <path d="M2.8 20c0-3.4 2.8-5.2 6.2-5.2s6.2 1.8 6.2 5.2" />
      <path d="M16.2 5.1a3.1 3.1 0 0 1 0 5.9M21.2 20c0-2.5-1.4-4.1-3.6-4.8" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h7M15 18h5" />
      <circle cx="15.5" cy="6" r="2.1" />
      <circle cx="9" cy="12" r="2.1" />
      <circle cx="13" cy="18" r="2.1" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  check: <path d="M20 6.5 9.5 17 4 11.5" />,
  x: <path d="M17.5 6.5 6.5 17.5M6.5 6.5l11 11" />,
  plus: <path d="M12 5v14M5 12h14" />,
  download: (
    <>
      <path d="M12 3.5v11M7.5 10l4.5 4.5L16.5 10" />
      <path d="M4.5 20.5h15" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.6h.01" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H17a2 2 0 0 1 2 2v.5" />
      <path d="M3 7.5V17a2.5 2.5 0 0 0 2.5 2.5H19a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H5.5A2.5 2.5 0 0 1 3 7.5z" />
      <circle cx="16.5" cy="13.5" r="1.2" />
    </>
  ),
  play: (
    <path d="M7 5.2v13.6a1 1 0 0 0 1.5.85l11-6.8a1 1 0 0 0 0-1.7l-11-6.8A1 1 0 0 0 7 5.2z" />
  ),
  pause: (
    <>
      <rect x="6.5" y="5" width="4" height="14" rx="1.3" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.3" />
    </>
  ),
  stop: <rect x="5.5" y="5.5" width="13" height="13" rx="2.6" />,
};

const FILLED = new Set(["play", "pause", "stop"]);

export function Icon({
  name,
  className = "h-5 w-5",
  strokeWidth = 1.8,
}: {
  name: string;
  className?: string;
  strokeWidth?: number;
}) {
  const filled = FILLED.has(name);
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
