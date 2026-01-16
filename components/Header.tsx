import React from 'react';
import { Profile } from '../types';

interface HeaderProps {
  profile: Profile;
  apiBase: string;
  apiStatus: 'online' | 'offline' | 'checking';
  onApiChange: (value: string) => void;
}

const Header: React.FC<HeaderProps> = ({ profile, apiBase, apiStatus, onApiChange }) => {
  const statusLabel = apiStatus === 'online' ? 'Connected' : apiStatus === 'offline' ? 'Offline' : 'Checking';
  const statusColor =
    apiStatus === 'online' ? 'bg-teal-500' : apiStatus === 'offline' ? 'bg-rose-500' : 'bg-amber-400';
  return (
    <header className="sticky top-0 z-50 bg-[#FDFCF8]/90 backdrop-blur-md border-b border-teal-600/10 px-6 py-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-teal-600/20">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 leading-none">PixelHolo Voice Studio</h1>
            <span className="text-[10px] text-teal-600 font-bold uppercase tracking-widest">Realtime Clone Panel</span>
          </div>
        </div>

        <div className="flex items-center gap-8">
          <div className="hidden md:flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
            <span className={`w-2.5 h-2.5 rounded-full ${statusColor} animate-pulse-soft`}></span>
            {statusLabel}
          </div>
          <div className="hidden md:flex flex-col items-end">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Active Profile</span>
            <span className="text-sm font-bold text-slate-800">{profile.name || 'None'}</span>
          </div>

          <div className="hidden md:flex flex-col items-end border-l border-slate-200 pl-8">
            <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Last Input</span>
            <span className="text-sm font-bold text-slate-800 truncate max-w-[150px]">
              {profile.lastUploadedFile || 'No files uploaded'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">API Base</span>
        <input
          value={apiBase}
          onChange={(e) => onApiChange(e.target.value)}
          className="flex-1 bg-white border border-slate-200 rounded-lg px-4 py-2 text-sm font-semibold"
        />
        <span className="text-[10px] text-slate-400">Example: http://127.0.0.1:8000</span>
      </div>
    </header>
  );
};

export default Header;
