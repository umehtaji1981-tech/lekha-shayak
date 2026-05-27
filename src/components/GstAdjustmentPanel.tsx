import React, { useState, useEffect } from 'react';
import { 
  motion, 
  AnimatePresence 
} from 'motion/react';
import { 
  CheckCircle2, 
  RefreshCw, 
  TrendingUp, 
  TrendingDown, 
  ArrowRight, 
  Sliders, 
  BadgeInfo, 
  Sparkles,
  HelpCircle,
  CornerDownRight,
  Calculator,
  Save,
  Check,
  AlertCircle
} from 'lucide-react';

interface GstAdjustmentPanelProps {
  company: any;
  allTransactions: any[];
  activeFY: any;
}

export const GstAdjustmentPanel = ({ company, allTransactions, activeFY }: GstAdjustmentPanelProps) => {
  // Ordered GST Months (April to March fiscal cycle)
  const months = [
    { name: 'Apr', label: 'April', index: 3 },
    { name: 'May', label: 'May', index: 4 },
    { name: 'Jun', label: 'June', index: 5 },
    { name: 'Jul', label: 'July', index: 6 },
    { name: 'Aug', label: 'August', index: 7 },
    { name: 'Sep', label: 'September', index: 8 },
    { name: 'Oct', label: 'October', index: 9 },
    { name: 'Nov', label: 'November', index: 10 },
    { name: 'Dec', label: 'December', index: 11 },
    { name: 'Jan', label: 'January', index: 0 },
    { name: 'Feb', label: 'February', index: 1 },
    { name: 'Mar', label: 'March', index: 2 }
  ];

  const [selectedMonthIdx, setSelectedMonthIdx] = useState<number | 'all'>(3); // Defaults to April (fiscal month index 3)
  const [calculationMode, setCalculationMode] = useState<'auto' | 'manual'>('auto');
  
  // Local state for manual ITC overrides
  const [manualIgstUsedForCgst, setManualIgstUsedForCgst] = useState<number>(0);
  const [manualIgstUsedForSgst, setManualIgstUsedForSgst] = useState<number>(0);
  const [isSaved, setIsSaved] = useState<boolean>(false);
  
  // Status feedback of adjustment state per month
  const [savedAdjustments, setSavedAdjustments] = useState<Record<string, { mode: 'auto' | 'manual', manualIgstForCgst: number, manualIgstForSgst: number }>>({});

  // Reset status feedback temporarily on month change
  useEffect(() => {
    setIsSaved(false);
  }, [selectedMonthIdx]);

  // Read transactions for the chosen month or the entire year
  const getGstData = () => {
    let targetTx = allTransactions;
    
    if (selectedMonthIdx !== 'all') {
      const year = selectedMonthIdx >= 3 
        ? new Date(activeFY.startDate).getFullYear() 
        : new Date(activeFY.endDate).getFullYear();
      const startStr = `${year}-${String(selectedMonthIdx + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(year, selectedMonthIdx + 1, 0).getDate();
      const endStr = `${year}-${String(selectedMonthIdx + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      
      targetTx = allTransactions.filter(t => t.date >= startStr && t.date <= endStr);
    } else {
      // All year
      targetTx = allTransactions.filter(t => t.date >= activeFY.startDate && t.date <= activeFY.endDate);
    }

    const sales = targetTx.filter(t => t.type === 'Sales');
    const purchases = targetTx.filter(t => t.type === 'Purchases');

    const output_igst = sales.reduce((sum, t) => sum + (Number(t.igst) || 0), 0);
    const output_cgst = sales.reduce((sum, t) => sum + (Number(t.cgst) || 0), 0);
    const output_sgst = sales.reduce((sum, t) => sum + (Number(t.sgst) || 0), 0);

    const input_igst = purchases.reduce((sum, t) => sum + (Number(t.igst) || 0), 0);
    const input_cgst = purchases.reduce((sum, t) => sum + (Number(t.cgst) || 0), 0);
    const input_sgst = purchases.reduce((sum, t) => sum + (Number(t.sgst) || 0), 0);

    return {
      output: { igst: output_igst, cgst: output_cgst, sgst: output_sgst, total: output_igst + output_cgst + output_sgst },
      itc: { igst: input_igst, cgst: input_cgst, sgst: input_sgst, total: input_igst + input_cgst + input_sgst }
    };
  };

  const gstData = getGstData();

  // Offset Engine according to real Indian GST ledger offset protocols:
  // Rules are:
  // 1. IGST ITC must be fully consumed first.
  //    - Offset IGST Liability first.
  //    - Offset CGST / SGST in any proportion. (We suggest auto allocation or manual).
  // 2. CGST ITC can offset CGST liability first, then any leftover offsets IGST liability.
  //    - CGST ITC CANNOT offset SGST.
  // 3. SGST ITC can offset SGST liability first, then any leftover offsets IGST liability.
  //    - SGST ITC CANNOT offset CGST.
  const calculateOffsets = () => {
    const { output, itc } = gstData;
    
    // Set initial buckets
    let remIgstLiab = output.igst;
    let remCgstLiab = output.cgst;
    let remSgstLiab = output.sgst;

    let remIgstItc = itc.igst;
    let remCgstItc = itc.cgst;
    let remSgstItc = itc.sgst;

    const steps: { title: string; desc: string; type: 'success' | 'info' | 'warning' }[] = [];

    // --- PHASE 1: IGST ITC Allocation against IGST liability ---
    const igstUsedForIgst = Math.min(remIgstLiab, remIgstItc);
    remIgstLiab -= igstUsedForIgst;
    remIgstItc -= igstUsedForIgst;
    if (igstUsedForIgst > 0) {
      steps.push({
        title: 'IGST ITC ➜ IGST Liability Offset',
        desc: `Allocated ₹${igstUsedForIgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })} of IGST input credit to settle IGST liability first.`,
        type: 'success'
      });
    }

    // --- PHASE 2: CGST and SGST ITC offset their respective self liabilities first (Standard bookkeeping practice) ---
    const cgstUsedForCgst = Math.min(remCgstLiab, remCgstItc);
    remCgstLiab -= cgstUsedForCgst;
    remCgstItc -= cgstUsedForCgst;
    if (cgstUsedForCgst > 0) {
      steps.push({
        title: 'CGST ITC ➜ CGST Liability Offset',
        desc: `Offset CGST liability with its own CGST credit of ₹${cgstUsedForCgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`,
        type: 'success'
      });
    }

    const sgstUsedForSgst = Math.min(remSgstLiab, remSgstItc);
    remSgstLiab -= sgstUsedForSgst;
    remSgstItc -= sgstUsedForSgst;
    if (sgstUsedForSgst > 0) {
      steps.push({
        title: 'SGST ITC ➜ SGST Liability Offset',
        desc: `Offset SGST liability with its own SGST credit of ₹${sgstUsedForSgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}.`,
        type: 'success'
      });
    }

    // --- PHASE 3: Offset Remainder of IGST Liability with remaining CGST and SGST ITC ---
    if (remIgstLiab > 0) {
      const cgstUsedForIgstLeftover = Math.min(remIgstLiab, remCgstItc);
      remIgstLiab -= cgstUsedForIgstLeftover;
      remCgstItc -= cgstUsedForIgstLeftover;
      if (cgstUsedForIgstLeftover > 0) {
        steps.push({
          title: 'Leftover CGST ITC ➜ IGST Liability',
          desc: `Used remaining CGST input credit of ₹${cgstUsedForIgstLeftover.toLocaleString('en-IN', { minimumFractionDigits: 2 })} to pay down remnant IGST liability.`,
          type: 'info'
        });
      }

      const sgstUsedForIgstLeftover = Math.min(remIgstLiab, remSgstItc);
      remIgstLiab -= sgstUsedForIgstLeftover;
      remSgstItc -= sgstUsedForIgstLeftover;
      if (sgstUsedForIgstLeftover > 0) {
        steps.push({
          title: 'Leftover SGST ITC ➜ IGST Liability',
          desc: `Used remaining SGST input credit of ₹${sgstUsedForIgstLeftover.toLocaleString('en-IN', { minimumFractionDigits: 2 })} to pay down remnant IGST liability.`,
          type: 'info'
        });
      }
    }

    // --- PHASE 4: Allocate residual IGST ITC against CGST and SGST Liabilities ---
    let igstUsedForCgst = 0;
    let igstUsedForSgst = 0;

    if (remIgstItc > 0) {
      if (calculationMode === 'auto') {
        // Auto prioritizes CGST first, then SGST
        igstUsedForCgst = Math.min(remCgstLiab, remIgstItc);
        remCgstLiab -= igstUsedForCgst;
        remIgstItc -= igstUsedForCgst;
        if (igstUsedForCgst > 0) {
          steps.push({
            title: 'Excess IGST ITC ➜ CGST Liability',
            desc: `Optimal auto-planning allocated ₹${igstUsedForCgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })} of excess IGST credit against Central GST liability.`,
            type: 'info'
          });
        }

        igstUsedForSgst = Math.min(remSgstLiab, remIgstItc);
        remSgstLiab -= igstUsedForSgst;
        remIgstItc -= igstUsedForSgst;
        if (igstUsedForSgst > 0) {
          steps.push({
            title: 'Excess IGST ITC ➜ SGST Liability',
            desc: `Optimal auto-planning allocated ₹${igstUsedForSgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })} of excess IGST credit against State GST liability.`,
            type: 'info'
          });
        }
      } else {
        // Manual override inputs
        const maxIgstForCgst = Math.min(remCgstLiab, remIgstItc);
        const actualIgstForCgst = Math.min(manualIgstUsedForCgst, maxIgstForCgst);
        
        igstUsedForCgst = actualIgstForCgst;
        remCgstLiab -= igstUsedForCgst;
        remIgstItc -= igstUsedForCgst;

        const maxIgstForSgst = Math.min(remSgstLiab, remIgstItc);
        const actualIgstForSgst = Math.min(manualIgstUsedForSgst, remIgstItc, maxIgstForSgst);

        igstUsedForSgst = actualIgstForSgst;
        remSgstLiab -= igstUsedForSgst;
        remIgstItc -= igstUsedForSgst;

        if (igstUsedForCgst > 0) {
          steps.push({
            title: 'Manual Override: IGST Credit ➜ CGST',
            desc: `Manually routed ₹${igstUsedForCgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })} of integrated credit against Central GST liability.`,
            type: 'warning'
          });
        }
        if (igstUsedForSgst > 0) {
          steps.push({
            title: 'Manual Override: IGST Credit ➜ SGST',
            desc: `Manually routed ₹${igstUsedForSgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })} of integrated credit against State GST liability.`,
            type: 'warning'
          });
        }
      }
    }

    const netPayable = remIgstLiab + remCgstLiab + remSgstLiab;
    const carryForward = remIgstItc + remCgstItc + remSgstItc;

    return {
      offsetDetails: {
        igstUsedForIgst,
        cgstUsedForCgst,
        sgstUsedForSgst,
        igstUsedForCgst,
        igstUsedForSgst
      },
      netLiabilities: {
        igst: remIgstLiab,
        cgst: remCgstLiab,
        sgst: remSgstLiab,
        total: netPayable
      },
      carryForwardCredits: {
        igst: remIgstItc,
        cgst: remCgstItc,
        sgst: remSgstItc,
        total: carryForward
      },
      steps
    };
  };

  const results = calculateOffsets();

  // Sync manual limits whenever values change or month changes
  useEffect(() => {
    // When month changes, reset manual overrides to proposed defaults first
    const { output, itc } = gstData;
    let remCgstLiab = output.cgst - Math.min(output.cgst, itc.cgst);
    let remSgstLiab = output.sgst - Math.min(output.sgst, itc.sgst);
    let remIgstItc = itc.igst - Math.min(output.igst, itc.igst);

    const defaultCgstUse = Math.min(remCgstLiab, remIgstItc);
    const defaultSgstUse = Math.min(remSgstLiab, remIgstItc - defaultCgstUse);

    setManualIgstUsedForCgst(defaultCgstUse);
    setManualIgstUsedForSgst(defaultSgstUse);
  }, [selectedMonthIdx, gstData.output.igst, gstData.output.cgst, gstData.output.sgst, gstData.itc.igst, gstData.itc.cgst, gstData.itc.sgst]);

  const handleSaveAdjustment = () => {
    const key = selectedMonthIdx.toString();
    setSavedAdjustments({
      ...savedAdjustments,
      [key]: {
        mode: calculationMode,
        manualIgstForCgst: manualIgstUsedForCgst,
        manualIgstForSgst: manualIgstUsedForSgst
      }
    });
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
    }, 3000);
  };

  // Helper calculation for the sliders
  const currentKey = selectedMonthIdx.toString();
  const maxAllocatableIgst = Math.max(0, gstData.itc.igst - Math.min(gstData.output.igst, gstData.itc.igst));

  return (
    <div className="card p-6 border border-slate-100 bg-white shadow-sm space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-4 border-b border-slate-50 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-base font-black text-slate-800 flex items-center gap-2">
              <Calculator size={18} className="text-indigo-600" /> GST Intelligent Offset & Tax Adjustment Panel
            </h4>
            <span className="bg-indigo-50 text-indigo-700 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
              <Sparkles size={10} className="text-indigo-500 animate-pulse" /> Live Calculations
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Analyze compliance matches, route excess credits, and plan cash disbursements.
          </p>
        </div>
        
        {/* Toggle between Auto proposal and Manual planner */}
        <div className="flex bg-slate-50 border border-slate-200/60 p-0.5 rounded-lg text-xs font-bold">
          <button 
            onClick={() => setCalculationMode('auto')}
            className={`px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${calculationMode === 'auto' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Sparkles size={12} /> Auto Settle
          </button>
          <button 
            onClick={() => setCalculationMode('manual')}
            className={`px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${calculationMode === 'manual' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            <Sliders size={12} /> Manual Offset
          </button>
        </div>
      </div>

      {/* Grid of Months as horizontal scrolling chip list */}
      <div className="space-y-2">
        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Select Planning Period</label>
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
          <button
            onClick={() => setSelectedMonthIdx('all')}
            className={`px-3.5 py-2 text-xs font-black rounded-lg transition-all min-w-[70px] flex-shrink-0 ${selectedMonthIdx === 'all' ? 'bg-slate-900 text-white shadow-md' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
          >
            Full Year
          </button>
          {months.map(m => {
            const hasDraft = savedAdjustments[m.index.toString()];
            return (
              <button
                key={m.index}
                onClick={() => setSelectedMonthIdx(m.index)}
                className={`relative px-3.5 py-2 text-xs font-semibold rounded-lg transition-all flex-shrink-0 flex items-center gap-1.5 ${selectedMonthIdx === m.index ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}
              >
                <span>{m.name}</span>
                {hasDraft && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title={`Adjustments saved for ${m.name}`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Numerical overview of input and outputs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Output Collected (Liabilities) */}
        <div className="bg-rose-50/20 border border-rose-100/40 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 border-b border-rose-50 pb-2">
            <span className="text-xs font-bold text-rose-800 flex items-center gap-1">
              <TrendingUp size={14} /> 1. Tax Collected on Sales (Output Liability)
            </span>
            <span className="text-xs font-black text-rose-600">
              ₹{gstData.output.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 font-medium">Integrated GST (IGST)</span>
              <span className="font-extrabold text-slate-800">₹{gstData.output.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 font-medium">Central GST (CGST)</span>
              <span className="font-extrabold text-slate-800">₹{gstData.output.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 font-medium">State GST (SGST)</span>
              <span className="font-extrabold text-slate-800">₹{gstData.output.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

        {/* Input Tax Credit (ITC Available) */}
        <div className="bg-emerald-50/20 border border-emerald-100/40 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 border-b border-emerald-50 pb-2">
            <span className="text-xs font-bold text-emerald-800 flex items-center gap-1">
              <TrendingDown size={14} /> 2. Tax Paid on Purchases (Input Credit - ITC)
            </span>
            <span className="text-xs font-black text-emerald-600">
              ₹{gstData.itc.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 font-medium">Integrated ITC (IGST)</span>
              <span className="font-extrabold text-slate-800">₹{gstData.itc.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 font-medium">Central ITC (CGST)</span>
              <span className="font-extrabold text-slate-800">₹{gstData.itc.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 font-medium">State ITC (SGST)</span>
              <span className="font-extrabold text-slate-800">₹{gstData.itc.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>

      </div>

      {calculationMode === 'manual' && maxAllocatableIgst > 0 && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="bg-indigo-50/40 border border-indigo-100 rounded-xl p-4 space-y-4"
        >
          <div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-900">
              <Sliders size={14} /> Custom IGST ITC Allocator Panel
            </div>
            <p className="text-[10px] text-indigo-600 mt-1">
              You have remaining Integrated Credit (IGST ITC) of <strong>₹{maxAllocatableIgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>. You can distribute this surplus to offset Central CGST or State SGST liabilities.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-bold text-slate-700">
                <span>IGST Credit allocated to CGST</span>
                <span className="font-mono text-indigo-600 font-semibold">₹{manualIgstUsedForCgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <input 
                type="range"
                min="0"
                max={maxAllocatableIgst}
                value={manualIgstUsedForCgst}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setManualIgstUsedForCgst(val);
                  // Ensure total doesn't exceed remainder
                  if (val + manualIgstUsedForSgst > maxAllocatableIgst) {
                    setManualIgstUsedForSgst(maxAllocatableIgst - val);
                  }
                }}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-bold text-slate-700">
                <span>IGST Credit allocated to SGST</span>
                <span className="font-mono text-indigo-600 font-semibold">₹{manualIgstUsedForSgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <input 
                type="range"
                min="0"
                max={maxAllocatableIgst}
                value={manualIgstUsedForSgst}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setManualIgstUsedForSgst(val);
                  // Ensure total doesn't exceed remainder
                  if (val + manualIgstUsedForCgst > maxAllocatableIgst) {
                    setManualIgstUsedForCgst(maxAllocatableIgst - val);
                  }
                }}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>
          </div>
          <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1 border-t border-indigo-100/60">
            <span>Allocated Surplus: <strong>₹{(manualIgstUsedForCgst + manualIgstUsedForSgst).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong> / ₹{maxAllocatableIgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            <span>Surplus Un-used: <strong>₹{(maxAllocatableIgst - (manualIgstUsedForCgst + manualIgstUsedForSgst)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></span>
          </div>
        </motion.div>
      )}

      {/* Suggested Offset Steps log summary */}
      <div className="bg-slate-50 border border-slate-200/50 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between pb-1 border-b border-slate-200/40">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Match Proposal Steps (Rule-Based Order)</span>
          <span className="text-[10px] font-semibold text-slate-500">Compliance Code: Sec 49 CGST Act</span>
        </div>
        
        {results.steps.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-2 italic">
            No GST transactions or tax liabilities recorded for this planning interval.
          </p>
        ) : (
          <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
            {results.steps.map((step, idx) => (
              <div key={idx} className="flex gap-2 text-xs">
                <CornerDownRight size={13} className="text-slate-400 flex-shrink-0 mt-0.5" />
                <div>
                  <span className={`font-bold mr-1 ${step.type === 'success' ? 'text-emerald-700' : (step.type === 'warning' ? 'text-amber-700' : 'text-blue-700')}`}>
                    {step.title}
                  </span>
                  <span className="text-slate-600 font-medium">{step.desc}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Liability Settle Matrix & Final Outcome summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
        
        {/* Net payable in Cash */}
        <div className="bg-slate-900 text-white rounded-2xl p-5 flex flex-col justify-between shadow-md relative overflow-hidden">
          {/* Subtle logo vector */}
          <div className="absolute right-0 bottom-0 translate-x-3 translate-y-3 opacity-[0.03] scale-150 pointer-events-none text-white">
            <Calculator size={140} />
          </div>

          <div>
            <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tax Payable (Cash Net)</span>
              <span className="text-[9px] bg-red-500/20 text-red-300 font-black px-2 py-0.5 rounded-full uppercase tracking-wider">Pay Outflow</span>
            </div>
            
            <div className="space-y-2 mb-4 border-b border-slate-800 pb-3">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-400">Integrated IGST Payable:</span>
                <span className="text-slate-200">₹{results.netLiabilities.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-400">Central CGST Payable:</span>
                <span className="text-slate-200">₹{results.netLiabilities.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-400">State SGST Payable:</span>
                <span className="text-slate-200">₹{results.netLiabilities.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-end">
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-400">Final Liability Payable</p>
              <h2 className="text-2xl font-black text-rose-400">
                ₹{results.netLiabilities.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </h2>
            </div>
            
            <button 
              onClick={handleSaveAdjustment}
              className={`text-xs font-bold px-4 py-2 rounded-xl border flex items-center gap-1.5 transition-all ${
                isSaved 
                ? 'bg-emerald-600 border-emerald-600 text-white shadow-emerald-950/20' 
                : 'bg-white/10 border-white/10 text-white hover:bg-white/20'
              }`}
            >
              {isSaved ? (
                <>
                  <Check size={14} /> Logged!
                </>
              ) : (
                <>
                  <Save size={14} /> Commit Draft
                </>
              )}
            </button>
          </div>
        </div>

        {/* GST ITC Carry forward (Balance Credit) */}
        <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200/40 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Credit Carried Forward</span>
              <span className="text-[9px] bg-emerald-100 text-emerald-800 font-black px-2 py-0.5 rounded-full uppercase tracking-wider">Asset Balance</span>
            </div>
            
            <div className="space-y-2 mb-4 border-b border-slate-200 pb-3">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-500">IGST ITC Surplus Balance:</span>
                <span className="text-slate-800 font-bold">₹{results.carryForwardCredits.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-500">CGST ITC Surplus Balance:</span>
                <span className="text-slate-800 font-bold">₹{results.carryForwardCredits.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-slate-500">SGST ITC Surplus Balance:</span>
                <span className="text-slate-800 font-bold">₹{results.carryForwardCredits.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase font-bold text-slate-400">Surplus ITC Carried Forward</p>
            <h2 className="text-xl font-black text-emerald-600">
              ₹{results.carryForwardCredits.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </h2>
          </div>
        </div>

      </div>

      {/* Advisory Note */}
      <div className="flex items-start gap-2 text-[10px] bg-amber-50/50 p-2.5 rounded-lg border border-amber-100/50 text-amber-800">
        <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5 animate-pulse" />
        <p className="font-semibold leading-relaxed">
          <strong>Compliance Advisory Note:</strong> These calculated balances reflect real-time billing transactions inside your active partition of {activeFY.label}. CGST input tax credit cannot be used for SGST liabilities (and vice-versa) per CGST rules Section 49. Ensure offsets are locked before entering regular tax filing records inside standard portal return utilities.
        </p>
      </div>

    </div>
  );
};
