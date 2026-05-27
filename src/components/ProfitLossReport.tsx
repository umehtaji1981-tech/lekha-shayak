import React, { useRef, useState } from 'react';
import { ArrowLeft, Download, TrendingUp, TrendingDown, IndianRupee, RefreshCw, ChevronDown, ChevronUp, Layers, Eye } from 'lucide-react';
import { motion } from 'motion/react';
import { jsPDF } from 'jspdf';
import { toCanvas } from 'html-to-image';
import { getDynamicStockValueForPeriod } from '../lib/stock-utils';

export const ProfitLossReport = ({ company, transactions, allTransactions, ledgers, items, activeFY, reportPeriod, setReportPeriod, onBack }: any) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [viewMode, setViewMode] = useState<'nature' | 'standard'>('nature');
  const [isDetailed, setIsDetailed] = useState(true);
  
  // Local toggles for specific sections in Tally mode
  const [expandOpeningStock, setExpandOpeningStock] = useState(true);
  const [expandClosingStock, setExpandClosingStock] = useState(true);
  const [expandPurchases, setExpandPurchases] = useState(true);
  const [expandSales, setExpandSales] = useState(true);
  const [expandDirectExp, setExpandDirectExp] = useState(true);
  const [expandIndirectExp, setExpandIndirectExp] = useState(true);

  const reportRef = useRef<HTMLDivElement>(null);
  
  const sales = transactions.filter((t: any) => t.type === 'Sales');
  const purchases = transactions.filter((t: any) => t.type === 'Purchases');
  
  const getTax = (t: any) => t.totalTax ?? (t.cgst + t.sgst + t.igst) ?? 0;

  const totalSales = sales.reduce((sum: number, t: any) => sum + (t.totalAmount - getTax(t)), 0);
  const totalPurchases = purchases.reduce((sum: number, t: any) => sum + (t.totalAmount - getTax(t)), 0);
  
  // Dynamic Stock Calculation for target period using system lifecycle transactions
  const { totalOpeningStockValue, totalClosingStockValue, dynamicItems } = getDynamicStockValueForPeriod(
    items,
    (allTransactions && allTransactions.length > 0) ? allTransactions : transactions,
    reportPeriod,
    company
  );

  const stockInHandLedgers = ledgers.filter((l: any) => l.group && (l.group.toLowerCase().includes('stock-in-hand') || l.group.toLowerCase() === 'stock in hand'));
  const ledgerOpeningStockValue = stockInHandLedgers.reduce((sum: number, l: any) => sum + (Number(l.openingBalance) || 0), 0);
  const ledgerClosingStockValue = stockInHandLedgers.reduce((sum: number, l: any) => sum + (Number(l.currentBalance) || 0), 0);

  const openingStock = totalOpeningStockValue > 0 ? totalOpeningStockValue : ledgerOpeningStockValue;
  
  const directExpenseLedgers = ledgers.filter((l: any) => l.group === 'Direct Expenses');
  const directIncomesLedgers = ledgers.filter((l: any) => l.group === 'Direct Incomes');
  
  const directExpenses = directExpenseLedgers.map((l: any) => {
    const txForLedger = transactions.filter((t: any) => (t.partyId === l.id || t.ledgerId === l.id) && t.type === 'Payment');
    return {
      name: l.name,
      amount: txForLedger.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0)
    };
  }).filter((e: any) => e.amount > 0);

  const directIncomes = directIncomesLedgers.map((l: any) => {
    const txForLedger = transactions.filter((t: any) => (t.partyId === l.id || t.ledgerId === l.id) && t.type === 'Receipt');
    return {
      name: l.name,
      amount: txForLedger.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0)
    };
  }).filter((i: any) => i.amount > 0);

  const totalDirectExpenses = directExpenses.reduce((sum: number, e: any) => sum + e.amount, 0);
  const totalDirectIncomes = directIncomes.reduce((sum: number, i: any) => sum + i.amount, 0);

  // Prefer dynamic item closing stock, fallback to ledger balances, or use manual stock valuation override if active
  const closingStock = company?.manualClosingStock 
    ? Number(company.manualClosingStockValue || 0) 
    : (totalClosingStockValue > 0 ? totalClosingStockValue : ledgerClosingStockValue);

  const totalTradingCredit = totalSales + closingStock + totalDirectIncomes;
  const totalTradingDebit = openingStock + totalPurchases + totalDirectExpenses;
  const grossProfit = totalTradingCredit - totalTradingDebit;

  // P&L Account items
  const indirectExpenseLedgers = ledgers.filter((l: any) => l.group === 'Indirect Expenses');
  const indirectIncomesLedgers = ledgers.filter((l: any) => l.group === 'Indirect Incomes');
  
  const indirectExpenses = indirectExpenseLedgers.map((l: any) => {
    const txForLedger = transactions.filter((t: any) => (t.partyId === l.id || t.ledgerId === l.id) && t.type === 'Payment');
    return {
      name: l.name,
      amount: txForLedger.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0)
    };
  }).filter((e: any) => e.amount > 0);

  const indirectIncomes = indirectIncomesLedgers.map((l: any) => {
    const txForLedger = transactions.filter((t: any) => (t.partyId === l.id || t.ledgerId === l.id) && t.type === 'Receipt');
    return {
      name: l.name,
      amount: txForLedger.reduce((sum: number, t: any) => sum + (t.totalAmount || 0), 0)
    };
  }).filter((i: any) => i.amount > 0);

  const totalIndirectExpenses = indirectExpenses.reduce((sum: number, e: any) => sum + e.amount, 0);
  const totalIndirectIncomes = indirectIncomes.reduce((sum: number, i: any) => sum + i.amount, 0);

  const netProfit = grossProfit + totalIndirectIncomes - totalIndirectExpenses;

  // NGO Specific Accounting Mode Values
  const isNgo = company?.accountingMode === 'NGO_Trust';
  const totalNgoIncome = totalSales + totalDirectIncomes + totalIndirectIncomes;
  const totalNgoExpenditure = totalPurchases + totalDirectExpenses + totalIndirectExpenses;
  const ngoNetResult = totalNgoIncome - totalNgoExpenditure;

  // Active sub-item calculations
  const openingStockItemsFiltered = dynamicItems.filter((item: any) => 
    (item.dynamicOpeningValue || 0) > 0
  );

  const closingStockItemsFiltered = dynamicItems.filter((item: any) => 
    (item.dynamicClosingValue || 0) > 0
  );

  const formatTallyAmount = (num: number) => {
    if (num === 0) return '0.00';
    const isNeg = num < 0;
    const absNum = Math.abs(num);
    const formatted = new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(absNum);
    
    return isNeg ? `(-) ${formatted}` : formatted;
  };

  const formatDateLabel = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${date.getDate()}-${months[date.getMonth()]}-${String(date.getFullYear()).substring(2)}`;
  };

  const periodLabelText = `${formatDateLabel(reportPeriod.startDate)} to ${formatDateLabel(reportPeriod.endDate)}`;

  const downloadPDF = async () => {
    if (!reportRef.current) return;
    setIsDownloading(true);
    setIsExporting(true);
    
    setTimeout(async () => {
      try {
        const canvas = await toCanvas(reportRef.current!, {
          quality: 0.95,
          backgroundColor: '#ffffff',
          style: {
            transform: 'scale(1)',
            transformOrigin: 'top left',
          }
        });
        
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4'
        });
        
        const imgProps = pdf.getImageProperties(imgData);
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgHeightInPdf = (imgProps.height * pdfWidth) / imgProps.width;
        
        let heightLeft = imgHeightInPdf;
        let position = 0;
        
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeightInPdf);
        heightLeft -= pageHeight;
        
        while (heightLeft > 0) {
          position = heightLeft - imgHeightInPdf;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeightInPdf);
          heightLeft -= pageHeight;
        }

        const filePrefix = viewMode === 'nature' ? 'Trading_PL_Tally_Report' : 'Trading_PL_Standard_Report';
        pdf.save(`${filePrefix}_${new Date().toISOString().split('T')[0]}.pdf`);
      } catch (error) {
        console.error('PDF Generation Error:', error);
        alert('Failed to generate PDF. Please use the Print option.');
      } finally {
        setIsDownloading(false);
        setIsExporting(false);
      }
    }, 100);
  };

  return (
    <div className="space-y-6 pb-20 print:pb-0">
      {/* Report Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-4 rounded-2xl border border-slate-100 shadow-sm print:hidden gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <span>{isNgo ? 'Income & Expenditure Statement' : 'Trading & Profit & Loss Statement'}</span>
              <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-500 border border-slate-200 uppercase font-black tracking-wider">
                Tally Prime Style
              </span>
            </h3>
            <p className="text-[10px] text-slate-400 font-medium">
              Period: {new Date(reportPeriod.startDate).toLocaleDateString()} - {new Date(reportPeriod.endDate).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setViewMode('nature')}
              className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all ${viewMode === 'nature' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Tally T-Account View
            </button>
            <button
              onClick={() => setViewMode('standard')}
              className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all ${viewMode === 'standard' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Modern Summary View
            </button>
          </div>

          {viewMode === 'nature' && (
            <button
              onClick={() => setIsDetailed(!isDetailed)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all border ${isDetailed ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              {isDetailed ? 'Condensed Mode (Alt+F1)' : 'Detailed Mode (Alt+F1)'}
            </button>
          )}

          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            <input 
              type="date" 
              value={reportPeriod.startDate}
              onChange={e => setReportPeriod({...reportPeriod, startDate: e.target.value})}
              className="bg-transparent border-none text-[10px] font-bold text-slate-600 focus:ring-0 p-1 cursor-pointer"
            />
            <span className="text-slate-300 px-1 self-center">—</span>
            <input 
              type="date" 
              value={reportPeriod.endDate}
              onChange={e => setReportPeriod({...reportPeriod, endDate: e.target.value})}
              className="bg-transparent border-none text-[10px] font-bold text-slate-600 focus:ring-0 p-1 cursor-pointer"
            />
          </div>

          <button 
            onClick={downloadPDF} 
            disabled={isDownloading}
            className="btn-secondary text-xs flex items-center gap-2"
          >
            {isDownloading ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
            {isDownloading ? 'Baking PDF...' : 'Download Statement'}
          </button>
        </div>
      </div>

      {/* Main Report Wrapper for PDF Printout */}
      <div ref={reportRef} className="bg-white p-8 border border-slate-100 shadow-sm print:p-0 print:border-none">
        
        {/* PDF Header Section */}
        <div className="text-center pb-6 border-b-2 border-slate-900">
          <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900">{company?.name || 'Goodluck Traders'}</h1>
          <div className="text-[10px] uppercase font-bold text-slate-500 mt-1 flex flex-col gap-0.5">
            <span>{company?.address || 'Near Rajpura Gate, Rastipura Burhanpur'}</span>
            <span>Contact: {company?.phone || '8871995348'} | Email: {company?.email || 'goodlucktraders@gmail.com'}</span>
            <span>GSTIN: {company?.gstIn || 'N/A'} | PAN: {company?.pan || 'N/A'}</span>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100">
            <h2 className="text-xl font-black uppercase tracking-widest text-slate-800">
              {isNgo ? 'Income & Expenditure Account' : 'Profit & Loss A/c'}
            </h2>
            <p className="text-xs font-bold text-slate-500 mt-1">
              For {periodLabelText}
            </p>
          </div>
        </div>

        {viewMode === 'nature' ? (
          isNgo ? (
            // ================== NGO T-ACCOUNT VIEW ==================
            <div className="mt-6 font-mono text-xs text-slate-900">
              {/* INCOME & EXPENDITURE ACCOUNT */}
              <h4 className="border-b border-dashed border-slate-300 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                Income & Expenditure Account
              </h4>

              {/* Table Header */}
              <div className="grid grid-cols-2 border-t border-b-2 border-slate-900 py-1.5 font-bold text-slate-800">
                <div className="grid grid-cols-12 pr-4">
                  <span className="col-span-8 uppercase text-[10px] tracking-wider">E x p e n d i t u r e (D e b i t)</span>
                  <span className="col-span-4 text-right uppercase text-[10px] tracking-wider">{periodLabelText}</span>
                </div>
                <div className="grid grid-cols-12 pl-4 border-l border-slate-300">
                  <span className="col-span-8 uppercase text-[10px] tracking-wider">I n c o m e (C r e d i t)</span>
                  <span className="col-span-4 text-right uppercase text-[10px] tracking-wider">{periodLabelText}</span>
                </div>
              </div>

              {/* Main Columns Grid Split */}
              <div className="grid grid-cols-2 min-h-[350px]">
                {/* Left Column (Debit Side - Expenditure) */}
                <div className="pr-4 py-2 space-y-4 flex flex-col justify-between">
                  <div className="space-y-3">
                    {/* Purchases / Procurement / Direct Outlays if any */}
                    {totalPurchases > 0 && (
                      <div>
                        <div className="flex justify-between font-bold text-slate-900">
                          <span>Direct Procurement / Outlays</span>
                          <span className="font-bold">{formatTallyAmount(totalPurchases)}</span>
                        </div>
                      </div>
                    )}

                    {/* Direct Expenses (Program/Operational Activities) */}
                    {totalDirectExpenses > 0 && (
                      <div>
                        <div 
                          onClick={() => setExpandDirectExp(!expandDirectExp)}
                          className="flex justify-between font-bold text-slate-900 cursor-pointer hover:bg-slate-50 p-0.5 rounded group"
                        >
                          <span className="flex items-center gap-1">
                            {isDetailed && (expandDirectExp ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />)}
                            Direct Program Expenses
                          </span>
                          <span className="font-bold">{formatTallyAmount(totalDirectExpenses)}</span>
                        </div>
                        {isDetailed && expandDirectExp && (
                          <div className="pl-4 mt-1.5 space-y-1 text-[11px] text-slate-600 border-l border-slate-100 font-sans">
                            {directExpenses.map((exp: any, idx: number) => (
                              <div key={idx} className="flex justify-between pl-2 py-0.5 italic font-mono">
                                <span>{exp.name}</span>
                                <span>{formatTallyAmount(exp.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Indirect Expenses (Administrative & Establishment Costs) */}
                    {totalIndirectExpenses > 0 && (
                      <div>
                        <div 
                          onClick={() => setExpandIndirectExp(!expandIndirectExp)}
                          className="flex justify-between font-bold text-slate-900 cursor-pointer hover:bg-slate-50 p-0.5 rounded group"
                        >
                          <span className="flex items-center gap-1">
                            {isDetailed && (expandIndirectExp ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />)}
                            Administrative & Indirect Expenses
                          </span>
                          <span className="font-bold">{formatTallyAmount(totalIndirectExpenses)}</span>
                        </div>
                        {isDetailed && expandIndirectExp && (
                          <div className="pl-4 mt-1.5 space-y-1 text-[11px] text-slate-600 border-l border-slate-100 font-sans">
                            {indirectExpenses.map((exp: any, idx: number) => (
                              <div key={idx} className="flex justify-between pl-2 py-0.5 italic font-mono">
                                <span>{exp.name}</span>
                                <span>{formatTallyAmount(exp.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Surplus (balances Left Side) */}
                  <div className="pt-2">
                    {ngoNetResult > 0 && (
                      <div className="flex justify-between font-bold text-emerald-700 bg-emerald-50/30 p-1 border-t border-dashed border-emerald-100 font-sans">
                        <span className="italic uppercase text-[10px] font-black">Excess of Income over Expenditure (Surplus)</span>
                        <span className="font-black underline decoration-double font-mono">{formatTallyAmount(ngoNetResult)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column (Credit Side - Income) */}
                <div className="pl-4 py-2 border-l border-slate-300 flex flex-col justify-between">
                  <div className="space-y-3">
                    {/* Receipts / Contributions / Collections */}
                    {totalSales > 0 && (
                      <div>
                        <div className="flex justify-between font-bold text-slate-900 border-b border-slate-100 pb-1">
                          <span>Contributions & Service Receipts</span>
                          <span className="font-bold">{formatTallyAmount(totalSales)}</span>
                        </div>
                      </div>
                    )}

                    {/* Direct Incomes (Donations, Grants, Fees) */}
                    {totalDirectIncomes > 0 && (
                      <div>
                        <div className="flex justify-between font-bold text-slate-900">
                          <span>Grants, Donations & Direct Incomes</span>
                          <span className="font-bold">{formatTallyAmount(totalDirectIncomes)}</span>
                        </div>
                        {isDetailed && (
                          <div className="pl-4 mt-1 space-y-1 text-[11px] text-slate-600 border-l border-slate-100 font-sans">
                            {directIncomes.map((inc: any, idx: number) => (
                              <div key={idx} className="flex justify-between pl-2 py-0.5 italic font-mono">
                                <span>{inc.name}</span>
                                <span>{formatTallyAmount(inc.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Indirect Incomes */}
                    {totalIndirectIncomes > 0 && (
                      <div>
                        <div className="flex justify-between font-bold text-slate-900">
                          <span>Other Incomes (Interest, Dividends)</span>
                          <span className="font-bold">{formatTallyAmount(totalIndirectIncomes)}</span>
                        </div>
                        {isDetailed && (
                          <div className="pl-4 mt-1 space-y-1 text-[11px] text-slate-600 border-l border-slate-100 font-sans font-mono">
                            {indirectIncomes.map((inc: any, idx: number) => (
                              <div key={idx} className="flex justify-between pl-2 py-0.5 italic font-mono">
                                <span>{inc.name}</span>
                                <span>{formatTallyAmount(inc.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Deficit (balances Right Side) */}
                  <div className="pt-2">
                    {ngoNetResult < 0 && (
                      <div className="flex justify-between font-bold text-rose-700 bg-rose-50/30 p-1 border-t border-dashed border-rose-100 font-sans">
                        <span className="italic uppercase text-[10px] font-black">Excess of Expenditure over Income (Deficit)</span>
                        <span className="font-black underline decoration-double font-mono">{formatTallyAmount(Math.abs(ngoNetResult))}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Totals Row */}
              <div className="grid grid-cols-2 border-t border-b-2 border-slate-900 py-2.5 font-bold text-[13px] text-slate-900 bg-slate-50/70">
                <div className="grid grid-cols-12 pr-4">
                  <span className="col-span-8 uppercase text-[11px] font-black">T o t a l</span>
                  <span className="col-span-4 text-right underline decoration-double font-sans font-bold font-mono">
                    ₹{formatTallyAmount(ngoNetResult > 0 ? totalNgoIncome : totalNgoExpenditure)}
                  </span>
                </div>
                <div className="grid grid-cols-12 pl-4 border-l border-slate-300">
                  <span className="col-span-8 uppercase text-[11px] font-black">T o t a l</span>
                  <span className="col-span-4 text-right underline decoration-double font-sans font-bold font-mono">
                    ₹{formatTallyAmount(ngoNetResult < 0 ? totalNgoExpenditure : totalNgoIncome)}
                  </span>
                </div>
              </div>

              {/* Continued footer for authentic multi-page representation */}
              <div className="mt-4 pt-4 text-right border-t border-slate-100 text-[9px] text-slate-400 uppercase tracking-widest font-black flex justify-between">
                <span>LEKHA SAHAYAK™ NGO REPORT SERVICE</span>
                <span>Statements completed</span>
              </div>
            </div>
          ) : (
            // ================== TALLY NATURE T-ACCOUNT VIEW ==================
            <div className="mt-6 font-mono text-xs text-slate-900">
              
              {/* PART 1: TRADING ACCOUNT */}
              <h4 className="border-b border-dashed border-slate-300 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                Trading Account
              </h4>

            {/* Table Header */}
            <div className="grid grid-cols-2 border-t border-b-2 border-slate-900 py-1.5 font-bold text-slate-800">
              <div className="grid grid-cols-12 pr-4">
                <span className="col-span-8 uppercase text-[10px] tracking-wider">P a r t i c u l a r s</span>
                <span className="col-span-4 text-right uppercase text-[10px] tracking-wider">{periodLabelText}</span>
              </div>
              <div className="grid grid-cols-12 pl-4 border-l border-slate-300">
                <span className="col-span-8 uppercase text-[10px] tracking-wider">P a r t i c u l a r s</span>
                <span className="col-span-4 text-right uppercase text-[10px] tracking-wider">{periodLabelText}</span>
              </div>
            </div>

            {/* Main Columns Grid Split */}
            <div className="grid grid-cols-2 min-h-[350px]">
              
              {/* Left Column (Debit Side) */}
              <div className="pr-4 py-2 space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  {/* Opening Stock Group */}
                  <div>
                    <div 
                      onClick={() => setExpandOpeningStock(!expandOpeningStock)}
                      className="flex justify-between font-bold text-slate-900 cursor-pointer hover:bg-slate-50 p-0.5 rounded group"
                    >
                      <span className="flex items-center gap-1">
                        {isDetailed && (expandOpeningStock ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />)}
                        Opening Stock
                      </span>
                      <span className="font-bold">{formatTallyAmount(openingStock)}</span>
                    </div>

                    {isDetailed && expandOpeningStock && (
                      <div className="pl-4 mt-1.5 space-y-1 text-[11px] text-slate-600 border-l border-slate-100">
                        {totalOpeningStockValue > 0 ? (
                          openingStockItemsFiltered.map((item: any, idx: number) => {
                            const val = item.dynamicOpeningValue;
                            return (
                              <div key={`item-op-${idx}`} className="flex justify-between italic pl-2 py-0.5 hover:bg-slate-50/50">
                                <span className="truncate max-w-[200px]">{item.name}</span>
                                <span>{formatTallyAmount(val)}</span>
                              </div>
                            );
                          })
                        ) : stockInHandLedgers.length > 0 ? (
                          stockInHandLedgers.map((l: any, idx: number) => {
                            return (
                              <div key={`ledger-op-${idx}`} className="flex justify-between italic pl-2 py-0.5 hover:bg-slate-50/50">
                                <span className="truncate max-w-[200px]">{l.name}</span>
                                <span>{formatTallyAmount(l.openingBalance || 0)}</span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="pl-2 text-slate-400 italic">No opening items registered</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Purchases Account */}
                  <div>
                    <div 
                      onClick={() => setExpandPurchases(!expandPurchases)}
                      className="flex justify-between font-bold text-slate-900 cursor-pointer hover:bg-slate-50 p-0.5 rounded group"
                    >
                      <span className="flex items-center gap-1">
                        {isDetailed && (expandPurchases ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />)}
                        Purchase Accounts
                      </span>
                      <span className="font-bold">{formatTallyAmount(totalPurchases)}</span>
                    </div>

                    {isDetailed && expandPurchases && (
                      <div className="pl-4 mt-1.5 space-y-1 text-[11px] text-slate-600 border-l border-slate-100">
                        <div className="flex justify-between pl-2 py-0.5 italic">
                          <span>Purchase Ledger</span>
                          <span>{formatTallyAmount(totalPurchases)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Direct Expenses */}
                  <div>
                    <div 
                      onClick={() => setExpandDirectExp(!expandDirectExp)}
                      className="flex justify-between font-bold text-slate-900 cursor-pointer hover:bg-slate-50 p-0.5 rounded group"
                    >
                      <span className="flex items-center gap-1">
                        {isDetailed && (expandDirectExp ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />)}
                        Direct Expenses
                      </span>
                      <span className="font-bold">{formatTallyAmount(totalDirectExpenses)}</span>
                    </div>

                    {isDetailed && expandDirectExp && (
                      <div className="pl-4 mt-1.5 space-y-1 text-[11px] text-slate-600 border-l border-slate-100">
                        {directExpenses.length > 0 ? (
                          directExpenses.map((exp: any, idx: number) => (
                            <div key={idx} className="flex justify-between pl-2 py-0.5 italic hover:bg-slate-50">
                              <span>{exp.name}</span>
                              <span>{formatTallyAmount(exp.amount)}</span>
                            </div>
                          ))
                        ) : (
                          <div className="pl-2 text-slate-400 italic">No direct expenses recorded</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Gross Profit Carry Down (At bottom of Trading account block) */}
                <div className="pt-2">
                  {grossProfit > 0 && (
                    <div className="flex justify-between font-bold text-emerald-700 bg-emerald-50/30 p-1 border-t border-dashed border-emerald-100">
                      <span className="italic">Gross Profit c/o</span>
                      <span className="font-black underline decoration-double">{formatTallyAmount(grossProfit)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column (Credit Side) */}
              <div className="pl-4 py-2 border-l border-slate-300 flex flex-col justify-between">
                <div className="space-y-3">
                  {/* Sales accounts */}
                  <div>
                    <div 
                      onClick={() => setExpandSales(!expandSales)}
                      className="flex justify-between font-bold text-slate-900 cursor-pointer hover:bg-slate-50 p-0.5 rounded group"
                    >
                      <span className="flex items-center gap-1">
                        {isDetailed && (expandSales ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />)}
                        Sales Accounts
                      </span>
                      <span className="font-bold">{formatTallyAmount(totalSales)}</span>
                    </div>

                    {isDetailed && expandSales && (
                      <div className="pl-4 mt-1.5 space-y-1 text-[11px] text-slate-600 border-l border-slate-100">
                        <div className="flex justify-between pl-2 py-0.5 italic">
                          <span>Sales Ledger</span>
                          <span>{formatTallyAmount(totalSales)}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Direct Incomes */}
                  {totalDirectIncomes > 0 && (
                    <div>
                      <div className="flex justify-between font-bold text-slate-900">
                        <span>Direct Incomes</span>
                        <span>{formatTallyAmount(totalDirectIncomes)}</span>
                      </div>
                      {isDetailed && (
                        <div className="pl-4 mt-1 space-y-1 text-[11px] text-slate-600 border-l border-slate-100">
                          {directIncomes.map((inc: any, idx: number) => (
                            <div key={idx} className="flex justify-between pl-2 py-0.5 italic">
                              <span>{inc.name}</span>
                              <span>{formatTallyAmount(inc.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Closing Stock Group */}
                  <div>
                    <div 
                      onClick={() => setExpandClosingStock(!expandClosingStock)}
                      className="flex justify-between font-bold text-slate-900 cursor-pointer hover:bg-slate-50 p-0.5 rounded group"
                    >
                      <span className="flex items-center gap-1">
                        {isDetailed && (expandClosingStock ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />)}
                        Closing Stock
                      </span>
                      <span className="font-bold">{formatTallyAmount(closingStock)}</span>
                    </div>

                    {isDetailed && expandClosingStock && (
                      <div className="pl-4 mt-1.5 space-y-1 text-[11px] text-slate-600 border-l border-slate-100">
                        {company?.manualClosingStock ? (
                          <div className="flex justify-between italic pl-2 py-0.5 hover:bg-slate-50/50">
                            <span className="truncate max-w-[200px]">Manual Stock Valuation Override</span>
                            <span>{formatTallyAmount(closingStock)}</span>
                          </div>
                        ) : totalClosingStockValue > 0 ? (
                          closingStockItemsFiltered.map((item: any, idx: number) => {
                            const val = item.dynamicClosingValue;
                            return (
                              <div key={`item-cl-${idx}`} className="flex justify-between italic pl-2 py-0.5 hover:bg-slate-50/50">
                                <span className="truncate max-w-[200px]">{item.name}</span>
                                <span>{formatTallyAmount(val)}</span>
                              </div>
                            );
                          })
                        ) : stockInHandLedgers.length > 0 ? (
                          stockInHandLedgers.map((l: any, idx: number) => {
                            return (
                              <div key={`ledger-cl-${idx}`} className="flex justify-between italic pl-2 py-0.5 hover:bg-slate-50/50">
                                <span className="truncate max-w-[200px]">{l.name}</span>
                                <span>{formatTallyAmount(l.currentBalance || 0)}</span>
                              </div>
                            );
                          })
                        ) : (
                          <div className="pl-2 text-slate-400 italic">No Closing Stock elements to present</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Gross Loss Carry Down */}
                <div className="pt-2">
                  {grossProfit < 0 && (
                    <div className="flex justify-between font-bold text-rose-700 bg-rose-50/30 p-1 border-t border-dashed border-rose-100">
                      <span className="italic">Gross Loss c/o</span>
                      <span className="font-black underline decoration-double">{formatTallyAmount(Math.abs(grossProfit))}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Trading Account Totals Row */}
            <div className="grid grid-cols-2 border-t border-b-2 border-slate-900 py-2.5 font-bold text-[13px] text-slate-900 bg-slate-50/70">
              <div className="grid grid-cols-12 pr-4">
                <span className="col-span-8 uppercase text-[11px] font-black">T o t a l</span>
                <span className="col-span-4 text-right underline decoration-double font-sans font-bold">
                  ₹{formatTallyAmount(grossProfit > 0 ? totalTradingCredit : totalTradingDebit)}
                </span>
              </div>
              <div className="grid grid-cols-12 pl-4 border-l border-slate-300">
                <span className="col-span-8 uppercase text-[11px] font-black">T o t a l</span>
                <span className="col-span-4 text-right underline decoration-double font-sans font-bold">
                  ₹{formatTallyAmount(grossProfit < 0 ? totalTradingDebit : totalTradingCredit)}
                </span>
              </div>
            </div>


            {/* PART 2: PROFIT & LOSS ACCOUNT */}
            <h4 className="border-b border-dashed border-slate-300 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400 mt-6 mb-2">
              Profit & Loss Account
            </h4>

            {/* Sub-Header */}
            <div className="grid grid-cols-2 border-t border-b-2 border-slate-900 py-1.5 font-bold text-slate-800">
              <div className="grid grid-cols-12 pr-4">
                <span className="col-span-8 uppercase text-[10px] tracking-wider">Particulars</span>
                <span className="col-span-4 text-right uppercase text-[10px] tracking-wider">{periodLabelText}</span>
              </div>
              <div className="grid grid-cols-12 pl-4 border-l border-slate-300">
                <span className="col-span-8 uppercase text-[10px] tracking-wider">Particulars</span>
                <span className="col-span-4 text-right uppercase text-[10px] tracking-wider">{periodLabelText}</span>
              </div>
            </div>

            {/* P&L Columns Grid Split */}
            <div className="grid grid-cols-2 min-h-[250px] pb-4">
              
              {/* Left Column (P&L Debits) */}
              <div className="pr-4 py-2 flex flex-col justify-between">
                <div className="space-y-3">
                  {/* Gross Loss b/f if applicable */}
                  {grossProfit < 0 && (
                    <div className="flex justify-between font-bold text-slate-700">
                      <span className="italic">Gross Loss b/f</span>
                      <span>{formatTallyAmount(Math.abs(grossProfit))}</span>
                    </div>
                  )}

                  {/* Indirect Expenses Group */}
                  <div>
                    <div 
                      onClick={() => setExpandIndirectExp(!expandIndirectExp)}
                      className="flex justify-between font-bold text-slate-900 cursor-pointer hover:bg-slate-50 p-0.5 rounded group"
                    >
                      <span className="flex items-center gap-1">
                        {isDetailed && (expandIndirectExp ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />)}
                        Indirect Expenses
                      </span>
                      <span className="font-bold">{formatTallyAmount(totalIndirectExpenses)}</span>
                    </div>

                    {isDetailed && expandIndirectExp && (
                      <div className="pl-4 mt-1.5 space-y-1 text-[11px] text-slate-600 border-l border-slate-100">
                        {indirectExpenses.length > 0 ? (
                          indirectExpenses.map((exp: any, idx: number) => (
                            <div key={idx} className="flex justify-between pl-2 py-0.5 italic hover:bg-slate-50">
                              <span>{exp.name}</span>
                              <span>{formatTallyAmount(exp.amount)}</span>
                            </div>
                          ))
                        ) : (
                          <div className="pl-2 text-slate-400 italic">No indirect expense ledgers found</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Net Profit (Balances Debit side to make both equal) */}
                <div className="pt-2">
                  {netProfit > 0 && (
                    <div className="flex justify-between font-bold text-indigo-700 bg-indigo-50/30 p-1 border-t border-dashed border-indigo-100">
                      <span className="uppercase text-[10px] font-black">Nett Profit</span>
                      <span className="underline decoration-double font-black font-sans">{formatTallyAmount(netProfit)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column (P&L Credits / Incomes) */}
              <div className="pl-4 py-2 border-l border-slate-300 flex flex-col justify-between">
                <div className="space-y-3">
                  {/* Gross Profit b/f */}
                  {grossProfit > 0 && (
                    <div className="flex justify-between font-bold text-slate-900 border-b border-slate-100 pb-1">
                      <span className="italic">Gross Profit b/f</span>
                      <span>{formatTallyAmount(grossProfit)}</span>
                    </div>
                  )}

                  {/* Indirect Incomes */}
                  {totalIndirectIncomes > 0 && (
                    <div>
                      <div className="flex justify-between font-bold text-slate-900">
                        <span>Indirect Incomes</span>
                        <span>{formatTallyAmount(totalIndirectIncomes)}</span>
                      </div>
                      
                      {isDetailed && (
                        <div className="pl-4 mt-1 space-y-1 text-[11px] text-slate-600 border-l border-slate-100">
                          {indirectIncomes.map((inc: any, idx: number) => (
                            <div key={idx} className="flex justify-between pl-2 py-0.5 italic">
                              <span>{inc.name}</span>
                              <span>{formatTallyAmount(inc.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Net Loss (Balances Credit side) */}
                <div className="pt-2">
                  {netProfit < 0 && (
                    <div className="flex justify-between font-bold text-rose-700 bg-rose-50/30 p-1 border-t border-dashed border-rose-100">
                      <span className="uppercase text-[10px] font-black">Nett Loss for the Year</span>
                      <span className="underline decoration-double font-black font-sans">{formatTallyAmount(Math.abs(netProfit))}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* P&L Account Totals */}
            <div className="grid grid-cols-2 border-t border-b-2 border-slate-900 py-2.5 font-bold text-[13px] text-slate-900 bg-slate-50/70">
              <div className="grid grid-cols-12 pr-4">
                <span className="col-span-8 uppercase text-[11px] font-black">T o t a l</span>
                <span className="col-span-4 text-right underline decoration-double font-sans font-bold">
                  ₹{formatTallyAmount(netProfit > 0 ? (totalIndirectIncomes + (grossProfit > 0 ? grossProfit : 0)) : (totalIndirectExpenses + (grossProfit < 0 ? Math.abs(grossProfit) : 0)))}
                </span>
              </div>
              <div className="grid grid-cols-12 pl-4 border-l border-slate-300">
                <span className="col-span-8 uppercase text-[11px] font-black">T o t a l</span>
                <span className="col-span-4 text-right underline decoration-double font-sans font-bold">
                  ₹{formatTallyAmount(netProfit < 0 ? (totalIndirectExpenses + (grossProfit < 0 ? Math.abs(grossProfit) : 0)) : (totalIndirectIncomes + (grossProfit > 0 ? grossProfit : 0)))}
                </span>
              </div>
            </div>

            {/* Continued footer for authentic multi-page representation */}
            <div className="mt-4 pt-4 text-right border-t border-slate-100 text-[9px] text-slate-400 uppercase tracking-widest font-black flex justify-between">
              <span>LEKHA SAHAYAK™ LEDGER SERVICE</span>
              <span>Continued ...</span>
            </div>
          </div>
          )
        ) : isNgo ? (
            // ================== NGO MODERN SUMMARY VIEW ==================
            <div className="space-y-6 pt-6 animate-fade-in text-slate-900">
              <div className="border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                <div className="bg-slate-900 text-white p-4 font-black text-xs uppercase tracking-widest font-mono">
                  Statement of Income & Expenditure
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x">
                  {/* Expenditure Debit side */}
                  <div className="p-4 space-y-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block border-b pb-1 font-mono">
                      Expenditures (Outlays & Expenses)
                    </span>
                    {totalPurchases > 0 && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-600">Direct Procurement / Outlays</span>
                        <span className="font-semibold text-slate-900">₹ {formatTallyAmount(totalPurchases)}</span>
                      </div>
                    )}
                    {directExpenses.map((e: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center text-xs">
                        <span className="text-slate-500">{e.name}</span>
                        <span className="text-slate-900">₹ {formatTallyAmount(e.amount)}</span>
                      </div>
                    ))}
                    {indirectExpenses.map((e: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center text-xs">
                        <span className="text-slate-500">{e.name} (Admin)</span>
                        <span className="text-slate-900 font-mono">₹ {formatTallyAmount(e.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t pt-2 border-slate-100 font-bold text-sm text-slate-900 font-sans">
                      <span>Total Expenditure</span>
                      <span className="font-mono">₹ {formatTallyAmount(totalNgoExpenditure)}</span>
                    </div>
                  </div>

                  {/* Receipts Credit side */}
                  <div className="p-4 space-y-3">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block border-b pb-1 font-mono">
                      Incomes (Contributions & Receipts)
                    </span>
                    {totalSales > 0 && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-slate-600">Contributions & Service Receipts</span>
                        <span className="font-semibold text-slate-900">₹ {formatTallyAmount(totalSales)}</span>
                      </div>
                    )}
                    {directIncomes.map((i: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center text-xs">
                        <span className="text-slate-500">{i.name}</span>
                        <span className="text-slate-905 font-medium">₹ {formatTallyAmount(i.amount)}</span>
                      </div>
                    ))}
                    {indirectIncomes.map((i: any, idx: number) => (
                      <div key={idx} className="flex justify-between items-center text-xs font-mono">
                        <span className="text-slate-500">{i.name}</span>
                        <span className="text-slate-905 font-medium font-mono">₹ {formatTallyAmount(i.amount)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t pt-2 border-slate-100 font-bold text-sm text-slate-900 font-sans">
                      <span>Total Income</span>
                      <span className="font-mono">₹ {formatTallyAmount(totalNgoIncome)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* NGO Summary Banner */}
              <div className={`p-6 rounded-2xl flex flex-col items-center text-center border ${ngoNetResult >= 0 ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-red-50 border-red-100 text-red-800'}`}>
                <span className="text-[10px] font-black uppercase tracking-widest block mb-1">Final Outcome</span>
                <span className="text-3xl font-black font-mono">
                  {ngoNetResult >= 0 ? 'Surplus: ' : 'Deficit: '} ₹ {formatTallyAmount(Math.abs(ngoNetResult))}
                </span>
                <p className="mt-2 text-[11px] text-slate-500 max-w-sm">
                  {ngoNetResult >= 0
                    ? 'Representing the excess of operational income over expenditures, which is accumulated into the Corpus/General Funds.'
                    : 'Representing the excess of expenditures over receipts for the designated period.'}
                </p>
              </div>
            </div>
          ) : (
            // ================== STANDARD MODERN SUMMARY VIEW ==================
            <div className="space-y-6 pt-6">
            
            {/* Trading Section */}
            <div className="border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
              <div className="bg-slate-900 text-white p-4 font-black text-xs uppercase tracking-widest">
                Part 1: Trading Account (Gross Profit Calculation)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x">
                <div className="p-4 space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block border-b pb-1">Debit Side (Costs)</span>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-650">Opening Stock</span>
                    <span className="font-semibold text-slate-900">₹ {formatTallyAmount(openingStock)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-650">Purchases Accounts</span>
                    <span className="font-semibold text-slate-900">₹ {formatTallyAmount(totalPurchases)}</span>
                  </div>
                  {directExpenses.map((e, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs">
                      <span className="text-slate-500">{e.name}</span>
                      <span className="text-slate-950">₹ {formatTallyAmount(e.amount)}</span>
                    </div>
                  ))}
                  {grossProfit > 0 && (
                    <div className="flex justify-between items-center text-sm pt-2 border-t border-dashed border-emerald-200 text-emerald-600 font-bold">
                      <span className="italic">Gross Profit c/o</span>
                      <span>₹ {formatTallyAmount(grossProfit)}</span>
                    </div>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block border-b pb-1">Credit Side (Revenue)</span>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-650">Sales Accounts</span>
                    <span className="font-semibold text-slate-900">₹ {formatTallyAmount(totalSales)}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-650">Closing Stock</span>
                    <span className="font-semibold text-slate-900">₹ {formatTallyAmount(closingStock)}</span>
                  </div>
                  {grossProfit < 0 && (
                    <div className="flex justify-between items-center text-sm pt-2 border-t border-dashed border-rose-200 text-rose-600 font-bold">
                      <span className="italic">Gross Loss c/o</span>
                      <span>₹ {formatTallyAmount(Math.abs(grossProfit))}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* P&L Section */}
            <div className="border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
              <div className="bg-indigo-900 text-white p-4 font-black text-xs uppercase tracking-widest">
                Part 2: Profit & Loss Account (Net Profit Calculation)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x">
                <div className="p-4 space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block border-b pb-1">Expenses (Debit)</span>
                  {grossProfit < 0 && (
                    <div className="flex justify-between text-xs text-rose-600 font-medium">
                      <span>Gross Loss b/f</span>
                      <span>₹ {formatTallyAmount(Math.abs(grossProfit))}</span>
                    </div>
                  )}
                  {indirectExpenses.map((exp, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs">
                      <span className="text-slate-500">{exp.name}</span>
                      <span className="text-slate-950">₹ {formatTallyAmount(exp.amount)}</span>
                    </div>
                  ))}
                  {netProfit > 0 && (
                    <div className="flex justify-between items-center text-sm pt-2 border-t border-dashed border-indigo-200 text-indigo-700 font-black">
                      <span className="uppercase text-[10px]">Net Profit c/f</span>
                      <span>₹ {formatTallyAmount(netProfit)}</span>
                    </div>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block border-b pb-1">Incomes & Gains (Credit)</span>
                  {grossProfit > 0 && (
                    <div className="flex justify-between text-xs text-emerald-600 font-medium">
                      <span>Gross Profit b/f</span>
                      <span>₹ {formatTallyAmount(grossProfit)}</span>
                    </div>
                  )}
                  {indirectIncomes.map((inc, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs">
                      <span className="text-slate-500">{inc.name}</span>
                      <span className="text-slate-950 font-medium">₹ {formatTallyAmount(inc.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Summary Banner */}
            <div className={`p-6 rounded-2xl flex flex-col items-center text-center border ${netProfit >= 0 ? 'bg-emerald-50 border-emerald-100 text-emerald-800' : 'bg-red-50 border-red-100 text-red-800'}`}>
              <span className="text-[10px] font-black uppercase tracking-widest block mb-1">Final Result</span>
              <span className="text-3xl font-black">₹ {formatTallyAmount(netProfit)}</span>
              <p className="mt-2 text-[11px] text-slate-500 max-w-sm">
                Financial accounts computed in accordance with standard statutory reporting schedules from {periodLabelText}.
              </p>
            </div>
          </div>
          )
        }
      </div>
    </div>
  );
};
