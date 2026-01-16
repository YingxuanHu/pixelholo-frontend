
import React from 'react';
import { StepStatus } from '../types';

interface StepCardProps {
  stepNumber: number;
  title: string;
  description: string;
  status: StepStatus;
  children: React.ReactNode;
  isActive?: boolean;
}

const StepCard: React.FC<StepCardProps> = ({ 
  stepNumber, 
  title, 
  description, 
  status, 
  children,
  isActive = false
}) => {
  const getStatusColor = () => {
    switch (status) {
      case 'running': return 'bg-amber-500';
      case 'done': return 'bg-teal-600';
      case 'error': return 'bg-red-600';
      default: return 'bg-slate-300';
    }
  };

  const getBadgeText = () => {
    switch (status) {
      case 'running': return 'Active Process';
      case 'done': return 'Phase Complete';
      case 'error': return 'Issue Detected';
      default: return 'Waiting...';
    }
  };

  return (
    <div className={`relative bg-white border-2 rounded-[28px] overflow-hidden transition-all duration-500 min-h-[620px] ${isActive ? 'border-teal-600/20 shadow-2xl shadow-teal-600/5' : 'border-slate-100 opacity-60 pointer-events-none'}`}>
      <div className="px-10 pt-12 pb-14">
        <div className="flex items-start justify-between mb-8">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest text-white ${getStatusColor()}`}>
                {getBadgeText()}
              </span>
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Step 0{stepNumber}</span>
            </div>
            <h2 className="text-5xl font-bold text-slate-900 mb-4">{title}</h2>
            <p className="text-slate-500 text-xl font-medium leading-relaxed max-w-2xl">
              {description}
            </p>
          </div>
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center text-white font-black text-3xl shadow-xl ${getStatusColor()}`}>
            {stepNumber}
          </div>
        </div>
        
        <div className="bg-white rounded-2xl">
          {children}
        </div>
      </div>
      
      {status === 'running' && (
        <div className="absolute top-0 left-0 w-full h-1 bg-slate-100">
          <div className="h-full bg-amber-500 animate-[loading_2s_infinite]"></div>
        </div>
      )}

      <style>{`
        @keyframes loading {
          0% { width: 0; left: 0; }
          50% { width: 40%; left: 30%; }
          100% { width: 0; left: 100%; }
        }
      `}</style>
    </div>
  );
};

export default StepCard;
