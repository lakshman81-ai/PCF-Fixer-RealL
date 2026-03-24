import React, { useState, useRef } from 'react';

/**
 * Lightweight hover tooltip.
 * Usage:  <Tooltip text="Explanation here"><label>...</label></Tooltip>
 */
export function Tooltip({ text, children, position = 'top' }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);

  const show = () => {
    timerRef.current = setTimeout(() => setVisible(true), 300);
  };
  const hide = () => {
    clearTimeout(timerRef.current);
    setVisible(false);
  };

  const posClasses = {
    top:    'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left:   'right-full mr-2 top-1/2 -translate-y-1/2',
    right:  'left-full ml-2 top-1/2 -translate-y-1/2',
  }[position] ?? 'bottom-full mb-2 left-1/2 -translate-x-1/2';

  return (
    <span className="relative inline-flex items-center gap-1" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {/* Info icon */}
      <svg
        className="w-3.5 h-3.5 text-slate-400 cursor-help shrink-0"
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
      {visible && (
        <span
          className={`absolute z-50 w-64 p-2.5 text-xs leading-relaxed bg-slate-900 text-slate-200 rounded-lg shadow-xl border border-slate-700 pointer-events-none ${posClasses}`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
