import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileText, 
  TrendingUp, 
  TrendingDown, 
  IndianRupee, 
  Download, 
  PieChart, 
  BarChart3, 
  ShoppingBag, 
  Layers, 
  Wallet, 
  ArrowRight,
  ArrowLeft,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowDownRight,
  ClipboardList,
  Search,
  Calendar,
  Pencil,
  Trash2,
  Clock,
  RefreshCw,
  Truck,
  ShieldCheck
} from 'lucide-react';
import { dbService } from '../lib/db';
import { where, orderBy } from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell 
} from 'recharts';
import { GSTR1Report } from './GSTR1Report';
import { GSTR3BReport } from './GSTR3BReport';
import { EWayBillValidator } from './EWayBillValidator';
import { ItcReconciliation } from './ItcReconciliation';
import { TrialBalanceReport } from './TrialBalanceReport';
import { ProfitLossReport } from './ProfitLossReport';
import { BalanceSheetReport } from './BalanceSheetReport';
import { ItemProfitabilityReport } from './ItemProfitabilityReport';
import { LedgerReport } from './LedgerReport';
import { StockSummaryReport } from './StockSummaryReport';
import { SalesPurchaseReport } from './SalesPurchaseReport';
import { GstAdjustmentPanel } from './GstAdjustmentPanel';
import { DayBookReport } from './DayBookReport';
import { ReceiptsPaymentsReport } from './ReceiptsPaymentsReport';
import { DebtorsAgeing } from './DebtorsAgeing';

// --- Dynamic Ledger Enrichment Utility ---
export const getEnrichedLedgers = (rawLedgers: any[], allTransactions: any[], targetPeriod: { startDate: string, endDate: string }) => {
  return rawLedgers.map(l => {
    const group = l.group || '';
    const isNominal = [
      'Sales Accounts', 'Purchase Accounts', 
      'Direct Expenses', 'Indirect Expenses', 
      'Direct Incomes', 'Indirect Incomes'
    ].some(g => group.includes(g));

    let totalImpactAllYears = 0;
    let impactBeforePeriod = 0;
    let impactInPeriod = 0;

    allTransactions.forEach((t: any) => {
      let impact = 0;
      if (t.partyId === l.id && t.totalAmount) {
        const isImmediatePayment = t.isPaid && t.bankId && ['Sales', 'Purchases'].includes(t.type);
        if (!isImmediatePayment) {
          let multiplier = ['Sales', 'Payment'].includes(t.type) ? 1 : -1;
          if (t.type === 'Contra') {
            multiplier = t.isDeposit ? -1 : 1;
          }
          impact = Number(t.totalAmount) * multiplier;
        }
      }
      if (t.bankId === l.id && t.totalAmount) {
        let bankMultiplier = ['Sales', 'Receipt'].includes(t.type) ? 1 : -1;
        if (t.type === 'Contra') {
          bankMultiplier = t.isDeposit ? 1 : -1;
        }
        impact = Number(t.totalAmount) * bankMultiplier;
      }
      if (t.debitLedgerId === l.id && t.totalAmount) {
        impact = Number(t.totalAmount);
      }
      if (t.creditLedgerId === l.id && t.totalAmount) {
        impact = -Number(t.totalAmount);
      }

      totalImpactAllYears += impact;
      if (t.date < targetPeriod.startDate) {
        impactBeforePeriod += impact;
      } else if (t.date <= targetPeriod.endDate) {
        impactInPeriod += impact;
      }
    });

    const currentVal = (l.currentBalance !== undefined && l.currentBalance !== null && !isNaN(Number(l.currentBalance))) ? Number(l.currentBalance) : null;
    const openingVal = (l.openingBalance !== undefined && l.openingBalance !== null && !isNaN(Number(l.openingBalance))) ? Number(l.openingBalance) : 0;
    const staticCurrent = currentVal !== null ? currentVal : openingVal;
    const initialOpening = staticCurrent - totalImpactAllYears;

    let activeYearBalance = 0;
    if (isNominal) {
      activeYearBalance = impactInPeriod;
    } else {
      activeYearBalance = initialOpening + impactBeforePeriod + impactInPeriod;
    }

    // Special CGST/SGST/IGST logic
    if (l.group === 'Duties & Taxes') {
      const sales = allTransactions.filter((t: any) => t.type === 'Sales' && t.date >= targetPeriod.startDate && t.date <= targetPeriod.endDate);
      const purchases = allTransactions.filter((t: any) => t.type === 'Purchases' && t.date >= targetPeriod.startDate && t.date <= targetPeriod.endDate);
      const op = initialOpening + impactBeforePeriod;
      if (l.name === 'CGST') {
        const cgstSales = sales.reduce((sum, t) => sum + (Number(t.cgst) || 0), 0);
        const cgstPurchases = purchases.reduce((sum, t) => sum + (Number(t.cgst) || 0), 0);
        activeYearBalance = op + (cgstSales - cgstPurchases);
      } else if (l.name === 'SGST') {
        const sgstSales = sales.reduce((sum, t) => sum + (Number(t.sgst) || 0), 0);
        const sgstPurchases = purchases.reduce((sum, t) => sum + (Number(t.sgst) || 0), 0);
        activeYearBalance = op + (sgstSales - sgstPurchases);
      } else if (l.name === 'IGST') {
        const igstSales = sales.reduce((sum, t) => sum + (Number(t.igst) || 0), 0);
        const igstPurchases = purchases.reduce((sum, t) => sum + (Number(t.igst) || 0), 0);
        activeYearBalance = op + (igstSales - igstPurchases);
      }
    }

    return {
      ...l,
      openingBalance: isNominal ? 0 : initialOpening + impactBeforePeriod,
      currentBalance: activeYearBalance
    };
  });
};

const CashBankBook = ({ company, type, transactions, ledgers, reportPeriod, setReportPeriod, onBack, onEditTransaction }: any) => {
  const isCash = type === 'cashbook';
  const accounts = ledgers.filter((l: any) => 
    isCash 
      ? (l.group === 'Cash-in-hand' || l.group === 'Cash') 
      : (l.group === 'Bank Accounts' || l.group === 'Bank')
  );
  
  const [selectedAccountId, setSelectedAccountId] = useState('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  
  const activeAccount = accounts.find((a: any) => a.id === selectedAccountId);
  
  // Filter transactions where bankId is in targetLedgerIds or specific account
  const filteredTx = transactions.filter((t: any) => {
    if (selectedAccountId === 'all') {
      const targetIds = accounts.map((a: any) => a.id);
      return targetIds.includes(t.bankId);
    }
    return t.bankId === selectedAccountId;
  });

  // Calculate opening balance
  const getOpeningBalance = () => {
    if (selectedAccountId === 'all') {
      return accounts.reduce((sum: number, acc: any) => sum + (Number(acc.openingBalance) || 0), 0);
    }
    return Number(activeAccount?.openingBalance) || 0;
  };

  const currentOpeningBalance = getOpeningBalance();

  const downloadPDF = () => {
    try {
      const doc = new jsPDF() as any;
      
      // Header
      if (company?.logo) {
        try {
          doc.addImage(company.logo, 'PNG', 20, 15, 25, 25);
        } catch (e) {
          console.error("Logo error", e);
        }
      }

      const headerX = company?.logo ? 50 : 105;
      const textAlign = company?.logo ? 'left' : 'center';

      doc.setFontSize(20);
      doc.setTextColor(79, 70, 229); // indigo-600
      doc.setFont(undefined, 'bold');
      doc.text(company?.name?.toUpperCase() || 'COMPANY NAME', headerX, 22, { align: textAlign });
      
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.setFont(undefined, 'normal');
      
      let currentY = 28;
      const splitAddress = doc.splitTextToSize(company?.address || '', 140);
      doc.text(splitAddress, headerX, currentY, { align: textAlign });
      currentY += (splitAddress.length * 4) + 1;

      const contactDetails = [];
      if (company?.phone) contactDetails.push(`Ph: ${company.phone}`);
      if (company?.email) contactDetails.push(`Email: ${company.email}`);
      if (contactDetails.length > 0) {
        doc.text(contactDetails.join(' | '), headerX, currentY, { align: textAlign });
        currentY += 4;
      }

      const taxDetails = [];
      if (company?.gstIn) taxDetails.push(`GSTIN: ${company.gstIn}`);
      const pan = company?.pan || (company?.gstIn ? company.gstIn.substring(2, 12) : null);
      if (pan) taxDetails.push(`PAN: ${pan}`);
      if (taxDetails.length > 0) {
        doc.setFont(undefined, 'bold');
        doc.text(taxDetails.join(' | '), headerX, currentY, { align: textAlign });
      }
      
      doc.setDrawColor(200);
      doc.line(20, 45, 190, 45);

      // Report Title
      doc.setFontSize(16);
      doc.setTextColor(0);
      doc.setFont(undefined, 'bold');
      doc.text(`${isCash ? 'CASH' : 'BANK'} BOOK`, 105, 55, { align: 'center' });

      // Build Table rows starting with Opening Balance
      let runningBal = currentOpeningBalance;
      const tableData = [
        [
          reportPeriod.startDate ? new Date(reportPeriod.startDate).toLocaleDateString() : '—',
          'Opening Balance (b/f)',
          '—',
          '—',
          '—',
          '—',
          `₹${runningBal.toLocaleString()}`
        ],
        ...filteredTx.map((row: any) => {
          const income = row.type === 'Receipt' ? row.totalAmount : 0;
          const expense = row.type === 'Payment' ? row.totalAmount : 0;
          runningBal += (income - expense);
          return [
            new Date(row.date).toLocaleDateString(),
            `${row.partyName}\n(${row.bankName})${row.narration ? `\n[Narration: ${row.narration}]` : ''}`,
            row.type === 'Receipt' ? 'RCT' : 'PYMT',
            row.voucherNumber,
            income > 0 ? `₹${income.toLocaleString()}` : '—',
            expense > 0 ? `₹${expense.toLocaleString()}` : '—',
            `₹${runningBal.toLocaleString()}`
          ];
        })
      ];

      autoTable(doc, {
        startY: 65,
        head: [['Date', 'Particulars', 'Type', 'Vch No', 'Receipt', 'Payment', 'Balance']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] },
        styles: { fontSize: 8, cellPadding: 3 }
      });

      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(10);
      doc.text(`Generated on: ${new Date().toLocaleString()}`, 20, finalY);

      doc.save(`${isCash ? 'Cash' : 'Bank'}_Book_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error("PDF Fail", error);
      alert("Failed to generate PDF");
    }
  };

  let runningBalance = currentOpeningBalance;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h3 className="font-bold text-slate-900">{isCash ? 'Cash Book' : 'Bank Book'}</h3>
            <p className="text-[10px] text-slate-400 font-medium">
               {activeAccount ? activeAccount.name : `All ${isCash ? 'Cash' : 'Bank'} Accounts`}
            </p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
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

          <select 
            value={selectedAccountId}
            onChange={e => setSelectedAccountId(e.target.value)}
            className="text-xs font-bold text-slate-600 border border-slate-200 rounded-lg bg-white px-2 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="all">All {isCash ? 'Cash' : 'Bank'} Accounts</option>
            {accounts.map((acc: any) => (
              <option key={acc.id} value={acc.id}>{acc.name}</option>
            ))}
          </select>

          <button onClick={downloadPDF} className="btn-secondary text-xs">
            <Download size={14} /> Export PDF
          </button>
        </div>
      </div>

      {!isCash && activeAccount && (
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 p-4 rounded-xl border border-indigo-100 flex flex-wrap gap-8">
           <div>
              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Bank Name</p>
              <p className="text-sm font-bold text-slate-800">{activeAccount.bankName || activeAccount.name}</p>
           </div>
           <div>
              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Account Number</p>
              <p className="text-sm font-bold text-slate-800 font-mono italic">{activeAccount.accountNumber || 'N/A'}</p>
           </div>
           <div>
              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">IFSC Code</p>
              <p className="text-sm font-bold text-slate-800 font-mono">{activeAccount.ifscCode || 'N/A'}</p>
           </div>
           <div>
              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Branch</p>
              <p className="text-sm font-bold text-slate-800">{activeAccount.branchName || 'N/A'}</p>
           </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr className="text-left">
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Date</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Particulars</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Type</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Vch No</th>
              <th className="px-6 py-4 text-right text-xs font-bold text-slate-400 uppercase tracking-wider">Receipt (In)</th>
              <th className="px-6 py-4 text-right text-xs font-bold text-slate-400 uppercase tracking-wider">Payment (Out)</th>
              <th className="px-6 py-4 text-right text-xs font-bold text-slate-400 uppercase tracking-wider">Balance</th>
              <th className="px-6 py-4 text-center text-xs font-bold text-slate-400 uppercase tracking-wider print:hidden">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {/* Opening Balance Row */}
            <tr className="bg-slate-50/40 hover:bg-slate-50/60 font-medium">
              <td className="px-6 py-4 text-sm text-slate-500">{reportPeriod.startDate ? new Date(reportPeriod.startDate).toLocaleDateString() : '—'}</td>
              <td className="px-6 py-4">
                <div className="text-sm font-black text-indigo-700">Opening Balance (b/f)</div>
                <div className="text-[10px] text-slate-400">Broad Forward Account Balance</div>
              </td>
              <td className="px-6 py-4">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-600">
                  OPENING
                </span>
              </td>
              <td className="px-6 py-4 text-sm font-mono text-slate-400">—</td>
              <td className="px-6 py-4 text-right text-sm font-semibold text-slate-400">—</td>
              <td className="px-6 py-4 text-right text-sm font-semibold text-slate-400">—</td>
              <td className="px-6 py-4 text-right text-sm font-black text-slate-900">
                ₹{currentOpeningBalance.toLocaleString()}
              </td>
              <td className="px-6 py-4 text-center text-xs font-bold text-slate-400 uppercase tracking-wider print:hidden">—</td>
            </tr>

            {filteredTx.map((row: any, i: number) => {
              const income = row.type === 'Receipt' ? row.totalAmount : 0;
              const expense = row.type === 'Payment' ? row.totalAmount : 0;
              runningBalance += (income - expense);
              
              return (
                <tr key={row.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 text-sm text-slate-600">{new Date(row.date).toLocaleDateString()}</td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-semibold text-slate-700">{row.partyName}</div>
                    <div className="text-[10px] text-slate-400 font-medium mb-1">{row.bankName}</div>
                    {row.narration && (
                      <div className="text-[10px] text-slate-500 bg-slate-100/50 border border-slate-200/50 rounded-lg p-2 max-w-sm leading-relaxed whitespace-pre-wrap break-words">
                        {row.narration}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${row.type === 'Receipt' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                      {row.type === 'Receipt' ? 'RCT' : 'PYMT'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-mono text-slate-500">{row.voucherNumber}</td>
                  <td className="px-6 py-4 text-right text-sm font-bold text-emerald-600">
                    {income > 0 ? `₹${income.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-bold text-red-600">
                    {expense > 0 ? `₹${expense.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-black text-slate-900">
                    ₹{runningBalance.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-center print:hidden">
                    <div className="flex items-center justify-center gap-2">
                      <button 
                        onClick={() => onEditTransaction?.(row)}
                        className="p-1 hover:bg-indigo-50 hover:text-indigo-600 text-slate-400 rounded transition-colors"
                        title="Edit entry"
                      >
                        <Pencil size={15} />
                      </button>
                      
                      {confirmDeleteId === row.id ? (
                        <div className="flex items-center gap-1 bg-red-50 p-1 rounded-md border border-red-200">
                          <button
                            onClick={async () => {
                              try {
                                await dbService.deleteTransactionWithStock(company.id, row.id);
                                setConfirmDeleteId(null);
                              } catch (err) {
                                alert("Failed to delete entry: " + (err instanceof Error ? err.message : String(err)));
                              }
                            }}
                            className="bg-red-600 hover:bg-red-700 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 text-[9px] font-semibold px-1.5 py-0.5 rounded"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => setConfirmDeleteId(row.id)}
                          className="p-1 hover:bg-rose-50 hover:text-rose-600 text-slate-400 rounded transition-colors"
                          title="Delete entry"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredTx.length === 0 && (
              <tr>
                <td colSpan={8} className="py-12 text-center text-slate-400 italic text-sm">
                  No {isCash ? 'cash' : 'bank'} transactions found for this period.
                </td>
              </tr>
            )}
          </tbody>
          {filteredTx.length > 0 && (
            <tfoot className="bg-slate-50">
               <tr>
                 <td colSpan={4} className="px-6 py-4 font-bold text-slate-900">Closing Balance</td>
                 <td colSpan={3} className="px-6 py-4 text-right text-lg font-black text-slate-900">
                   ₹{runningBalance.toLocaleString()}
                 </td>
                 <td className="print:hidden"></td>
               </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

const CustomBarTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const entry = payload[0];
    const isProfit = entry.value >= 0;
    return (
      <div className="bg-white/95 backdrop-blur-sm border border-slate-200/60 p-3 rounded-2xl shadow-xl shadow-slate-100 font-sans text-xs animate-in fade-in duration-200">
        <p className="font-bold text-slate-900 mb-2 font-display text-xs uppercase tracking-wider">{label}</p>
        <div className="flex items-center gap-4 justify-between">
          <span className="flex items-center gap-1.5 text-slate-500 font-medium">
            <span className={`w-2 h-2 rounded-full ${isProfit ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            Net Income
          </span>
          <span className={`font-bold ${isProfit ? 'text-emerald-600' : 'text-rose-600'}`}>
            ₹{entry.value.toLocaleString()}
          </span>
        </div>
      </div>
    );
  }
  return null;
};

export const Reports = ({ company, companyId, activeFY, category, preSelectedReport, onReportOpen, role, onEditTransaction }: { 
  company: any, 
  companyId: string, 
  activeFY: any, 
  category: 'gst' | 'financial' | 'all',
  preSelectedReport?: string | null,
  onReportOpen?: () => void,
  role?: string,
  onEditTransaction?: (transaction: any) => void
}) => {
  const [loading, setLoading] = useState(true);
  const [activeReport, setActiveReport] = useState<string | null>(null);

  useEffect(() => {
    if (preSelectedReport) {
      setActiveReport(preSelectedReport);
      onReportOpen?.();
    }
  }, [preSelectedReport]);
  const [reportPeriod, setReportPeriod] = useState({
    startDate: activeFY.startDate,
    endDate: activeFY.endDate
  });
  const [transactions, setTransactions] = useState<any[]>([]);
  const [allTransactions, setAllTransactions] = useState<any[]>([]);
  const [ledgers, setLedgers] = useState<any[]>([]);
  const [rawLedgers, setRawLedgers] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [plData, setPlData] = useState<any[]>([]);
  const [gstSummary, setGstSummary] = useState({ output: 0, input: 0 });

  const [periodMode, setPeriodMode] = useState<'custom' | 'monthly' | 'quarterly'>('custom');

  const handleMonthChange = (month: number) => {
    const year = month >= 3 ? new Date(activeFY.startDate).getFullYear() : new Date(activeFY.endDate).getFullYear();
    const formatDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const r_d = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${r_d}`;
    };
    const startDate = formatDate(new Date(year, month, 1));
    const endDate = formatDate(new Date(year, month + 1, 0));
    setReportPeriod({ startDate, endDate });
  };

  const handleQuarterChange = (q: number) => {
    let startM, endM, startY, endY;
    const fyStartYear = new Date(activeFY.startDate).getFullYear();
    const fyEndYear = new Date(activeFY.endDate).getFullYear();

    switch(q) {
      case 1: startM = 3; endM = 5; startY = fyStartYear; endY = fyStartYear; break;
      case 2: startM = 6; endM = 8; startY = fyStartYear; endY = fyStartYear; break;
      case 3: startM = 9; endM = 11; startY = fyStartYear; endY = fyStartYear; break;
      case 4: startM = 0; endM = 2; startY = fyEndYear; endY = fyEndYear; break;
      default: return;
    }

    const formatDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const r_d = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${r_d}`;
    };
    const startDate = formatDate(new Date(startY, startM, 1));
    const endDate = formatDate(new Date(endY, endM + 1, 0));
    setReportPeriod({ startDate, endDate });
  };

  const prevCategory = useRef(category);
  const prevCompanyId = useRef(companyId);
  const prevFY = useRef(activeFY);

  useEffect(() => {
    const categoryChanged = prevCategory.current !== category;
    const companyChanged = prevCompanyId.current !== companyId;
    const fyChanged = JSON.stringify(prevFY.current) !== JSON.stringify(activeFY);

    if (categoryChanged || companyChanged || fyChanged) {
      if (!preSelectedReport) {
        setActiveReport(null);
      }
      setReportPeriod({
        startDate: activeFY.startDate,
        endDate: activeFY.endDate
      });
      setPeriodMode('custom');
      
      prevCategory.current = category;
      prevCompanyId.current = companyId;
      prevFY.current = activeFY;
    }
  }, [category, companyId, activeFY, preSelectedReport]);

  useEffect(() => {
    if (!reportPeriod.startDate || !reportPeriod.endDate) return;
    const enriched = getEnrichedLedgers(rawLedgers, allTransactions, reportPeriod);
    setLedgers(enriched);
  }, [rawLedgers, allTransactions, reportPeriod]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);

    const unsubLedgers = dbService.listenCollection(`companies/${companyId}/ledgers`, [], (data) => {
      setRawLedgers(data);
    });

    const unsubItems = dbService.listenCollection(`companies/${companyId}/items`, [], (data) => {
      setItems(data);
    });
    
    const unsubTx = dbService.listenCollection(`companies/${companyId}/transactions`, [
      orderBy('date', 'asc')
    ], (data) => {
      setAllTransactions(data);
      const periodTx = data.filter((t: any) => t.date >= reportPeriod.startDate && t.date <= reportPeriod.endDate);
      setTransactions(periodTx);
      
      const getTax = (t: any) => t.totalTax ?? ((t.cgst || 0) + (t.sgst || 0) + (t.igst || 0)) ?? 0;

      // Calculate GST Summary
      const sales = periodTx.filter((t: any) => t.type === 'Sales');
      const purchases = periodTx.filter((t: any) => t.type === 'Purchases');
      
      setGstSummary({
        output: sales.reduce((sum, t) => sum + (getTax(t) || 0), 0),
        input: purchases.reduce((sum, t) => sum + (getTax(t) || 0), 0)
      });

      // Calculate Monthly P&L
      const months: any = {};
      periodTx.forEach(t => {
        const month = new Date(t.date).toLocaleString('default', { month: 'short' });
        if (!months[month]) months[month] = { name: month, income: 0, expense: 0, profit: 0 };
        const tax = getTax(t) || 0;
        const netAmount = (t.totalAmount || 0) - tax;
        if (t.type === 'Sales') months[month].income += netAmount;
        if (t.type === 'Purchases') months[month].expense += netAmount;
      });

      const processedData = Object.values(months).map((m: any) => ({
        ...m,
        profit: m.income - m.expense
      }));
      setPlData(processedData);
      setLoading(false);
    });

    return () => {
      unsubLedgers();
      unsubItems();
      unsubTx();
    };
  }, [companyId, reportPeriod]);

  const financialReports = [
    { id: 'daybook', label: 'Day Book', desc: 'Detailed chronological record of daily entries', icon: Clock, color: 'text-indigo-600' },
    { id: 'receipts-payments', label: 'Receipts & Payments Account', desc: 'Summary of all cash and bank receipts and payments', icon: Wallet, color: 'text-indigo-600' },
    { id: 'pl', label: 'Profit & Loss', desc: 'Income vs Expense statement', icon: TrendingUp, color: 'text-emerald-600' },
    { id: 'bs', label: 'Balance Sheet', desc: 'Assets & Liabilities snapshot', icon: Layers, color: 'text-indigo-600' },
    { id: 'tb', label: 'Trial Balance', desc: 'Check debit/credit equality', icon: FileText, color: 'text-blue-600' },
    { id: 'cashbook', label: 'Cash Book', desc: 'Daily cash inflow/outflow', icon: Wallet, color: 'text-emerald-600' },
    { id: 'bankbook', label: 'Bank Book', desc: 'Bank account transaction history', icon: Wallet, color: 'text-blue-600' },
    { id: 'ledger', label: 'Ledger Report', desc: 'Detailed individual account statement', icon: FileText, color: 'text-indigo-600' },
    { id: 'sales_reg', label: 'Sales Register', desc: 'Detailed sales transaction summary', icon: ArrowUpRight, color: 'text-emerald-500' },
    { id: 'pur_reg', label: 'Purchase Register', desc: 'Detailed purchase transaction summary', icon: ArrowDownLeft, color: 'text-rose-500' },
    { id: 'cn_reg', label: 'Credit Note Register', desc: 'Detailed credit note transaction summary', icon: FileText, color: 'text-purple-500' },
    { id: 'dn_reg', label: 'Debit Note Register', desc: 'Detailed debit note transaction summary', icon: FileText, color: 'text-amber-500' },
    { id: 'contra_reg', label: 'Contra Register', desc: 'Detailed bank and cash transfers', icon: Wallet, color: 'text-indigo-500' },
    { id: 'journal_reg', label: 'Journal Register', desc: 'Detailed double-entry adjustment logs', icon: ClipboardList, color: 'text-slate-500' },
    { id: 'receipt_reg', label: 'Receipts Register', desc: 'Detailed account inflows history', icon: ArrowDownRight, color: 'text-teal-500' },
    { id: 'payment_reg', label: 'Payments Register', desc: 'Detailed account outflows history', icon: ArrowUpRight, color: 'text-orange-500' },
    { id: 'stock', label: 'Stock Summary', desc: 'Inventory levels and movement', icon: ShoppingBag, color: 'text-emerald-600' },
    { id: 'itemprof', label: 'Item Profitability', desc: 'Profit margin per item sold', icon: BarChart3, color: 'text-orange-600' },
    { id: 'debtor-ageing', label: 'Debtors Ageing Analysis', desc: 'FIFO ageing schedule of Sundry Debtors & templates', icon: Calendar, color: 'text-rose-600' },
  ];

  const gstReports = [
    { id: 'gstr1', label: 'GSTR-1 (B2B/B2C)', desc: 'Sales report for GST portal', icon: ShoppingBag, color: 'text-pink-600' },
    { id: 'gstr3b', label: 'GSTR-3B with ITC', desc: 'GST filing overview', icon: FileText, color: 'text-orange-600' },
    { id: 'itc-reconcile', label: 'ITC Reconciliation', desc: 'GSTR-2B vs purchase ledgers match', icon: RefreshCw, color: 'text-indigo-600' },
    { id: 'eway-bill-validator', label: 'e-Way Bill Validator', desc: 'E-Way bill requirements & regulatory checks (> ₹50k)', icon: Truck, color: 'text-indigo-600' },
  ];

  let reportsList = category === 'gst' ? gstReports : (category === 'financial' ? financialReports : [...gstReports, ...financialReports]);

  if (role === 'Sales') {
    reportsList = reportsList.filter(r => ['sales_reg', 'pur_reg', 'stock', 'gstr1', 'eway-bill-validator'].includes(r.id));
  }

  if (loading) return <div className="h-64 flex items-center justify-center text-slate-400">Analyzing financial data...</div>;

  const renderReport = () => {
    const reportProps = {
      company,
      transactions,
      allTransactions,
      ledgers,
      items,
      activeFY,
      reportPeriod, // Pass the selected period
      setReportPeriod, // Pass the setter
      onBack: () => setActiveReport(null),
      onEditTransaction,
      onSwitchReport: (id: string) => setActiveReport(id)
    };

    switch (activeReport) {
      case 'daybook':
        return <DayBookReport {...reportProps} />;
      case 'receipts-payments':
        return <ReceiptsPaymentsReport {...reportProps} />;
      case 'cashbook':
      case 'bankbook':
        return <CashBankBook {...reportProps} type={activeReport} setReportPeriod={setReportPeriod} />;
      case 'gstr1':
        return <GSTR1Report {...reportProps} />;
      case 'gstr3b':
        return <GSTR3BReport {...reportProps} />;
      case 'itc-reconcile':
        return <ItcReconciliation {...reportProps} />;
      case 'eway-bill-validator':
        return <EWayBillValidator {...reportProps} onBack={() => setActiveReport(null)} />;
      case 'tb':
        return <TrialBalanceReport {...reportProps} />;
      case 'pl':
        return <ProfitLossReport {...reportProps} />;
      case 'bs':
        return <BalanceSheetReport {...reportProps} />;
      case 'debtor-ageing':
        return <DebtorsAgeing {...reportProps} onBack={() => setActiveReport(null)} />;
      case 'ledger':
        return <LedgerReport {...reportProps} />;
      case 'stock':
        return <StockSummaryReport {...reportProps} companyId={companyId} />;
      case 'itemprof':
        return <ItemProfitabilityReport {...reportProps} companyId={companyId} />;
      case 'sales_reg':
        return <SalesPurchaseReport {...reportProps} type="sales_reg" />;
      case 'pur_reg':
        return <SalesPurchaseReport {...reportProps} type="pur_reg" />;
      case 'cn_reg':
        return <SalesPurchaseReport {...reportProps} type="cn_reg" />;
      case 'dn_reg':
        return <SalesPurchaseReport {...reportProps} type="dn_reg" />;
      case 'contra_reg':
        return <SalesPurchaseReport {...reportProps} type="contra_reg" />;
      case 'journal_reg':
        return <SalesPurchaseReport {...reportProps} type="journal_reg" />;
      case 'receipt_reg':
        return <SalesPurchaseReport {...reportProps} type="receipt_reg" />;
      case 'payment_reg':
        return <SalesPurchaseReport {...reportProps} type="payment_reg" />;
      default:
        return null;
    }
  };

  if (activeReport) {
    return renderReport();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
            {category === 'gst' ? <ShoppingBag size={20} /> : <PieChart size={20} />}
          </div>
          <div>
            <h3 className="font-bold text-slate-900">
              {category === 'gst' ? 'GST Filing Reports' : (category === 'financial' ? 'Financial Statements' : 'All Accounting Reports')}
            </h3>
            <div className="flex items-center gap-2 mt-1">
               <Calendar size={12} className="text-slate-400" />
               <p className="text-xs text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded cursor-default">
                  {new Date(reportPeriod.startDate).toLocaleDateString()} - {new Date(reportPeriod.endDate).toLocaleDateString()}
               </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
           <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
              <select 
                value={periodMode}
                onChange={(e: any) => setPeriodMode(e.target.value)}
                className="bg-transparent border-none text-[10px] font-bold text-indigo-600 focus:ring-0 p-1 cursor-pointer border-r border-slate-200 mr-1"
              >
                <option value="custom">Custom</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>

              {periodMode === 'custom' ? (
                <div className="flex items-center">
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
              ) : periodMode === 'monthly' ? (
                <select 
                  onChange={(e) => handleMonthChange(parseInt(e.target.value))}
                  className="bg-transparent border-none text-[10px] font-bold text-slate-600 focus:ring-0 p-1 cursor-pointer"
                  defaultValue=""
                >
                  <option value="" disabled>Select Month</option>
                  {[3,4,5,6,7,8,9,10,11,0,1,2].map(m => (
                    <option key={m} value={m}>
                      {new Date(2000, m).toLocaleString('default', { month: 'long' })} {m >= 3 ? new Date(activeFY.startDate).getFullYear() : new Date(activeFY.endDate).getFullYear()}
                    </option>
                  ))}
                </select>
              ) : (
                <select 
                  onChange={(e) => handleQuarterChange(parseInt(e.target.value))}
                  className="bg-transparent border-none text-[10px] font-bold text-slate-600 focus:ring-0 p-1 cursor-pointer"
                  defaultValue=""
                >
                  <option value="" disabled>Select Quarter</option>
                  <option value="1">Q1 (Apr - Jun)</option>
                  <option value="2">Q2 (Jul - Sep)</option>
                  <option value="3">Q3 (Oct - Dec)</option>
                  <option value="4">Q4 (Jan - Mar)</option>
                </select>
              )}
           </div>
           <button className="btn-secondary text-xs">
              <Download size={14} /> Export Summary
           </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reportsList.map((report) => (
          <motion.div 
            whileHover={{ y: -4 }}
            key={report.id} 
            onClick={() => setActiveReport(report.id)}
            className="card p-6 flex items-start gap-4 cursor-pointer hover:shadow-lg transition-all group border-slate-100 shadow-sm"
          >
            <div className={`p-3 rounded-xl bg-slate-50 ${report.color} group-hover:scale-110 transition-transform`}>
               <report.icon size={24} />
            </div>
            <div className="flex-1">
               <h3 className="font-bold mb-1 text-slate-900">{report.label}</h3>
               <p className="text-xs text-slate-500 mb-4">{report.desc}</p>
               <button className="text-sm font-bold text-indigo-600 hover:underline flex items-center gap-1 group">
                  Generate <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
               </button>
            </div>
          </motion.div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div 
          key={category}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-6"
        >
          {category === 'gst' ? (
            <>
              <div className="card p-6 shadow-sm border-slate-100 col-span-2">
                 <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="font-bold text-slate-900">GST Liability Analysis</h3>
                      <p className="text-[10px] text-slate-400 font-medium">Auto-calculated from sales and purchase bills</p>
                    </div>
                    <PieChart className="text-slate-400" size={18} />
                 </div>
                 <div className="space-y-4">
                    <div className="flex justify-between items-center p-3 bg-red-50/50 rounded-xl border border-red-50">
                       <div className="flex items-center gap-3">
                         <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                           <TrendingUp size={14} />
                         </div>
                         <span className="text-sm font-medium text-slate-700">Output GST Total</span>
                       </div>
                       <span className="font-bold text-red-600">₹{gstSummary.output.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-emerald-50/50 rounded-xl border border-emerald-50">
                       <div className="flex items-center gap-3">
                         <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                           <TrendingDown size={14} />
                         </div>
                         <span className="text-sm font-medium text-slate-700">Available ITC</span>
                       </div>
                       <span className="font-bold text-emerald-600">₹{gstSummary.input.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center p-5 mt-4 bg-slate-900 rounded-2xl text-white shadow-lg">
                       <div>
                         <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Net Payable Liability</p>
                         <span className="text-2xl font-black">₹{(gstSummary.output - gstSummary.input).toLocaleString()}</span>
                       </div>
                       <div className="text-right">
                         <button className="text-[10px] font-bold bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1">
                            Pay via GST Portal <ArrowRight size={10} />
                         </button>
                       </div>
                    </div>
                 </div>
              </div>
              <div className="col-span-2">
                <GstAdjustmentPanel 
                  company={company} 
                  allTransactions={allTransactions} 
                  activeFY={activeFY} 
                />
              </div>
            </>
          ) : (
            <>
              <div className="card p-6 shadow-sm border-slate-100">
                 <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="font-bold text-slate-900">Monthly Profitability Trend</h3>
                      <p className="text-[10px] text-slate-400 font-medium">Net profit margin across the financial year</p>
                    </div>
                    <BarChart3 className="text-slate-400" size={18} />
                 </div>
                 <div className="h-64 w-full">
                    <ResponsiveContainer width="99.9%" height="100%" minWidth={0}>
                       <BarChart data={plData}>
                          <CartesianGrid strokeDasharray="4" vertical={false} stroke="#64748b" strokeOpacity={0.08} />
                          <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                          <YAxis fontSize={10} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v/1000}k`} />
                          <Tooltip 
                            cursor={{fill: 'rgba(100, 116, 139, 0.04)'}}
                            content={<CustomBarTooltip />}
                          />
                          <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                             {plData.map((entry, index) => (
                               <Cell key={`cell-${index}`} fill={entry.profit >= 0 ? '#10b981' : '#ef4444'} />
                             ))}
                          </Bar>
                       </BarChart>
                    </ResponsiveContainer>
                 </div>
              </div>

              <div className="card p-6 shadow-sm border-slate-100">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-bold text-slate-900">Receivables Analytics</h3>
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                     <Search size={18} />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left border-b border-slate-100">
                        <th className="pb-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Party Name</th>
                        <th className="pb-3 text-xs font-bold text-slate-400 uppercase tracking-wider">Tx</th>
                        <th className="pb-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wider">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {[...new Set(transactions.map(t => t.partyName as string))].filter(Boolean).slice(0, 5).map((name: string, i) => {
                        const partyLines = transactions.filter(t => t.partyName === name);
                        const total = partyLines.reduce((sum, t) => sum + (t.totalAmount || 0), 0);
                        return (
                          <tr key={i} className="group hover:bg-slate-50 transition-colors">
                            <td className="py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold text-xs uppercase">
                                  {name?.substring(0, 1)}
                                </div>
                                <span className="text-sm font-semibold text-slate-700">{name || 'Cash Sales'}</span>
                              </div>
                            </td>
                            <td className="py-4 text-sm text-slate-500">{partyLines.length}</td>
                            <td className="py-4 text-right">
                              <span className="text-sm font-bold text-slate-900">₹{total.toLocaleString()}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
