import React, { useState } from 'react';
import { RefreshCw, ArrowRight, AlertTriangle, CheckCircle2, Calendar, Database, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/db';
import { getFinancialYears } from '../lib/date-utils';

export const FYRollover = ({ company, activeFY, onComplete }: any) => {
  const [step, setStep] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const financialYears = getFinancialYears();
  const nextFY = financialYears.find((fy, index) => {
    // Find the one that comes after the current active one in the chronological list
    // Note: getFinancialYears returns them in descending order (latest first)
    const activeIndex = financialYears.findIndex(f => f.id === activeFY.id);
    return index === activeIndex - 1;
  });

  const handleRollover = async () => {
    if (!nextFY) return;
    setIsProcessing(true);
    setError(null);

    try {
      await dbService.rolloverFinancialYear(company.id, activeFY.id, nextFY.id);
      setStep(3);
    } catch (err: any) {
      setError(err.message || 'Rollover failed');
      setStep(1);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!nextFY && step !== 3) {
    return (
      <div className="card p-8 text-center space-y-4">
        <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto">
          <Calendar size={32} />
        </div>
        <h3 className="text-xl font-bold">No Future Financial Year Found</h3>
        <p className="text-slate-500 max-w-md mx-auto">
          The system cannot find the next chronological financial year for rollover. 
          Please contact support to enable future periods.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {step === 1 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card p-8 space-y-6">
          <div className="flex items-center gap-4 border-b border-slate-100 pb-6">
            <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl">
              <RefreshCw size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Year End Rollover</h2>
              <p className="text-sm text-slate-500">Close {activeFY.label} and open {nextFY?.label}</p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl flex gap-3 text-amber-800">
            <AlertTriangle className="shrink-0" size={20} />
            <div className="text-sm">
              <p className="font-bold mb-1">Important Precautions</p>
              <ul className="list-disc list-inside space-y-1 opacity-90">
                <li>This process is irreversible. Ensure you have a backup.</li>
                <li>All ledger closing balances will become new opening balances.</li>
                <li>Nominal accounts (Revenue/Expense) will be reset to zero.</li>
                <li>Voucher numbering will restart from 1 for the new year.</li>
              </ul>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 py-4">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Closing Year</span>
              <div className="text-lg font-black text-slate-700">{activeFY.label}</div>
              <div className="text-xs text-slate-400">Ends on {activeFY.endDate}</div>
            </div>
            <div className="p-4 bg-indigo-50 rounded-xl border border-indigo-100">
              <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Opening Year</span>
              <div className="text-lg font-black text-indigo-700">{nextFY?.label}</div>
              <div className="text-xs text-indigo-400">Starts on {nextFY?.startDate}</div>
            </div>
          </div>

          <button 
            onClick={() => setStep(2)}
            className="w-full btn-primary py-4 text-lg flex items-center justify-center gap-2"
          >
            Start Rollover Process <ArrowRight size={20} />
          </button>
        </motion.div>
      )}

      {step === 2 && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="card p-8 text-center space-y-8">
          <div className="space-y-2">
            <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <ShieldCheck size={40} />
            </div>
            <h2 className="text-2xl font-bold">Final Confirmation</h2>
            <p className="text-slate-500">Are you sure you want to close the books for {activeFY.label}?</p>
          </div>

          <div className="space-y-4">
            <button 
              disabled={isProcessing}
              onClick={handleRollover}
              className="w-full btn-primary py-4 flex items-center justify-center gap-3 relative overflow-hidden"
            >
              {isProcessing && <RefreshCw size={20} className="animate-spin" />}
              {isProcessing ? 'Processing Ledger Balances...' : 'Yes, Confirm & Rollover'}
            </button>
            <button 
              disabled={isProcessing}
              onClick={() => setStep(1)}
              className="w-full text-slate-500 font-bold hover:text-slate-700 transition-colors"
            >
              Cancel and Go Back
            </button>
          </div>

          {isProcessing && (
            <div className="space-y-3">
              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-indigo-600"
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 5 }}
                />
              </div>
              <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">
                Transferring balances and resetting sequences...
              </p>
            </div>
          )}
        </motion.div>
      )}

      {step === 3 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card p-12 text-center space-y-6 border-emerald-100 bg-emerald-50/20">
          <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 size={48} />
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-black text-slate-900">Rollover Successful!</h2>
            <p className="text-slate-600">
              The financial year has been closed. Welcome to <span className="font-bold text-indigo-600">{nextFY?.label}</span>. 
              All opening balances have been synchronized.
            </p>
          </div>
          <div className="pt-6">
            <button 
              onClick={() => onComplete(nextFY)}
              className="btn-primary px-8 py-3 bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200"
            >
              Go to Dashboard
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
};
