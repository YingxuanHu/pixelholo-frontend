
import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface LogPanelProps {
  logs: LogEntry[];
  title?: string;
}

const LogPanel: React.FC<LogPanelProps> = ({ logs, title = "Live Output Logs" }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="mt-4 flex flex-col h-48 bg-slate-900 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{title}</span>
        <div className="flex gap-1.5">
          <div className="w-2 h-2 rounded-full bg-red-500/50"></div>
          <div className="w-2 h-2 rounded-full bg-amber-500/50"></div>
          <div className="w-2 h-2 rounded-full bg-green-500/50"></div>
        </div>
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 p-4 font-mono text-xs overflow-y-auto scrollbar-hide space-y-1"
      >
        {logs.length === 0 ? (
          <span className="text-slate-600 italic">Waiting for process to start...</span>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex gap-2">
              <span className="text-slate-500 min-w-[70px] shrink-0">[{log.timestamp}]</span>
              <span className={`
                ${log.level === 'error' ? 'text-red-400' : ''}
                ${log.level === 'warn' ? 'text-amber-300' : ''}
                ${log.level === 'success' ? 'text-teal-400' : ''}
                ${log.level === 'info' ? 'text-slate-300' : ''}
              `}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default LogPanel;
