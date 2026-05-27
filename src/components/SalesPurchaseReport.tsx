import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Download, 
  ArrowLeft, 
  Search, 
  Calendar, 
  RefreshCw, 
  FileText,
  Filter,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowDownRight,
  Wallet,
  ClipboardList,
  Layers,
  Keyboard,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export const SalesPurchaseReport = ({ 
  company, 
  transactions = [], 
  reportPeriod, 
  setReportPeriod, 
  type, 
  activeFY, 
  onBack,
  onSwitchReport
}: any) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [periodMode, setPeriodMode] = useState<'custom' | 'monthly' | 'quarterly'>('custom');
  const [showMobileShortcuts, setShowMobileShortcuts] = useState(false);
  const [lastKeyPressed, setLastKeyPressed] = useState<string | null>(null);

  const typeMap: Record<string, string> = {
    'sales': 'Sales',
    'purchase': 'Purchases',
    'sales_reg': 'Sales',
    'pur_reg': 'Purchases',
    'credit-note': 'Credit Note',
    'cn_reg': 'Credit Note',
    'debit-note': 'Debit Note',
    'dn_reg': 'Debit Note',
    'contra': 'Contra',
    'contra_reg': 'Contra',
    'journal': 'Journal',
    'journal_reg': 'Journal',
    'receipt': 'Receipt',
    'receipt_reg': 'Receipt',
    'payment': 'Payment',
    'payment_reg': 'Payment'
  };

  const titleMap: Record<string, string> = {
    'sales': 'Sales Register',
    'purchase': 'Purchase Register',
    'sales_reg': 'Sales Register',
    'pur_reg': 'Purchase Register',
    'credit-note': 'Credit Note Register',
    'cn_reg': 'Credit Note Register',
    'debit-note': 'Debit Note Register',
    'dn_reg': 'Debit Note Register',
    'contra_reg': 'Contra Register',
    'journal_reg': 'Journal Register',
    'receipt_reg': 'Receipts Register',
    'payment_reg': 'Payments Register'
  };

  const descMap: Record<string, string> = {
    'sales': 'Summary of all outward supplies',
    'purchase': 'Summary of all inward supplies',
    'sales_reg': 'Summary of all outward supplies',
    'pur_reg': 'Summary of all inward supplies',
    'credit-note': 'Summary of all credit notes issued',
    'debit-note': 'Summary of all debit notes issued',
    'cn_reg': 'Summary of all credit notes issued',
    'dn_reg': 'Summary of all debit notes issued',
    'contra_reg': 'Summary of internal transfers (Cash/Bank)',
    'journal_reg': 'Summary of double-entry ledger adjustment diaries',
    'receipt_reg': 'Summary of all cash and bank inflows',
    'payment_reg': 'Summary of all cash and bank outflows'
  };

  const targetTxType = typeMap[type] || 'Sales';
  const registerTitle = titleMap[type] || `${targetTxType} Register`;
  const registerDesc = descMap[type] || `Chronological statement record of ${targetTxType} entries`;

  const hasGst = ['sales', 'purchase', 'sales_reg', 'pur_reg', 'credit-note', 'cn_reg', 'debit-note', 'dn_reg'].includes(type);

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

  const filteredTransactions = useMemo(() => {
    return (transactions || []).filter((t: any) => {
      const isCorrectType = t.type === targetTxType;
      if (!isCorrectType) return false;
      
      const lowerSearch = searchTerm.toLowerCase();
      const party = (t.partyName || t.ledgerName || '').toLowerCase();
      const vch = (t.voucherNumber || '').toLowerCase();
      const desc = (t.narration || t.description || '').toLowerCase();
      
      return party.includes(lowerSearch) || vch.includes(lowerSearch) || desc.includes(lowerSearch);
    }).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [transactions, targetTxType, searchTerm]);

  const totals = useMemo(() => {
    return filteredTransactions.reduce((acc: any, t: any) => {
      const amtVal = Number(t.totalAmount || t.amount || 0);
      const cgstVal = Number(t.cgst || t.cgstAmount || 0);
      const sgstVal = Number(t.sgst || t.sgstAmount || 0);
      const igstVal = Number(t.igst || t.igstAmount || 0);
      const subVal = Number(t.subTotal || (amtVal - (cgstVal + sgstVal + igstVal)) || amtVal);

      return {
        taxable: acc.taxable + (hasGst ? subVal : amtVal),
        cgst: acc.cgst + cgstVal,
        sgst: acc.sgst + sgstVal,
        igst: acc.igst + igstVal,
        gst: acc.gst + (cgstVal + sgstVal + igstVal),
        total: acc.total + amtVal
      };
    }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0, total: 0 });
  }, [filteredTransactions, hasGst]);

  const downloadPDF = () => {
    try {
      setIsDownloading(true);
      const doc = new jsPDF('landscape') as any;
      const headerX = 148.5; // Center of landscape
      
      // Company Header
      doc.setFontSize(22);
      doc.setTextColor(79, 70, 229);
      doc.setFont(undefined, 'bold');
      doc.text(company?.name?.toUpperCase() || 'COMPANY NAME', headerX, 20, { align: 'center' });
      
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.setFont(undefined, 'normal');
      const address = company?.address || '';
      const splitAddress = doc.splitTextToSize(address, 200);
      doc.text(splitAddress, headerX, 28, { align: 'center' });
      
      let currentY = 28 + (splitAddress.length * 4) + 2;
      const contactInfo = [
        company?.phone && `Ph: ${company.phone}`,
        company?.email && `Email: ${company.email}`,
        company?.gstIn && `GSTIN: ${company.gstIn}`
      ].filter(Boolean).join(' | ');
      doc.text(contactInfo, headerX, currentY, { align: 'center' });

      doc.setDrawColor(200);
      doc.line(20, currentY + 5, 277, currentY + 5);

      // Report Title
      doc.setFontSize(16);
      doc.setTextColor(0);
      doc.setFont(undefined, 'bold');
      doc.text(registerTitle.toUpperCase(), headerX, currentY + 15, { align: 'center' });
      
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(`Period: ${new Date(reportPeriod.startDate).toLocaleDateString()} to ${new Date(reportPeriod.endDate).toLocaleDateString()}`, headerX, currentY + 22, { align: 'center' });

      let headers: string[][];
      let tableData: any[];

      if (hasGst) {
        headers = [['Date', 'Vch No', 'Party Name', 'GSTIN', 'Dest.', 'Vehicle', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total']];
        tableData = filteredTransactions.map((t: any) => [
          new Date(t.date).toLocaleDateString(),
          t.voucherNumber || '-',
          t.partyName || 'Cash Sale',
          t.partyGstin || '-',
          t.destination || '-',
          t.motorVehicleNo || '-',
          (Number(t.subTotal || t.totalAmount || 0) - (Number(t.cgst || 0) + Number(t.sgst || 0) + Number(t.igst || 0))).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
          (Number(t.cgst || t.cgstAmount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
          (Number(t.sgst || t.sgstAmount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
          (Number(t.igst || t.igstAmount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 }),
          (Number(t.totalAmount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })
        ]);
        
        tableData.push([
          '', '', 'TOTALS', '', '', '',
          totals.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
          totals.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
          totals.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
          totals.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
          totals.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })
        ]);
      } else {
        headers = [['Date', 'Vch No', 'Particulars (A/c Name)', 'Payment Mode/Ref', 'Narration / Description', 'Amount']];
        tableData = filteredTransactions.map((t: any) => {
          let refDetails = t.bankName || t.cashAccountName || '-';
          if (t.type === 'Contra') {
            refDetails = t.isDeposit ? 'Deposited in Bank' : 'Withdrawn from Bank';
          }
          return [
            new Date(t.date).toLocaleDateString(),
            t.voucherNumber || '-',
            t.partyName || 'Multi-accounts details',
            refDetails,
            t.narration || t.description || '-',
            (Number(t.totalAmount || t.amount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })
          ];
        });

        tableData.push([
          '', '', 'TOTALS', '', '',
          totals.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })
        ]);
      }

      const columnStyles: any = hasGst ? {
        6: { halign: 'right' },
        7: { halign: 'right' },
        8: { halign: 'right' },
        9: { halign: 'right' },
        10: { halign: 'right', fontStyle: 'bold' }
      } : {
        5: { halign: 'right', fontStyle: 'bold' }
      };

      autoTable(doc, {
        startY: currentY + 30,
        head: headers,
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229], halign: 'center' },
        columnStyles,
        didParseCell: (data) => {
          if (data.row.index === tableData.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [240, 240, 240];
          }
        },
        styles: { fontSize: 8 }
      });

      doc.save(`${registerTitle.replace(/\s+/g, '_')}_${reportPeriod.endDate}.pdf`);
    } catch (error) {
      console.error('PDF Export Error:', error);
    } finally {
      setIsDownloading(false);
    }
  };

  // Keyboard events listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input, textarea or select
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.tagName === 'SELECT' || 
        target.isContentEditable
      ) {
        return;
      }

      const triggerKeyVisual = (key: string) => {
        setLastKeyPressed(key);
        setTimeout(() => setLastKeyPressed(null), 850);
      };

      if (e.key === 'F2') {
        e.preventDefault();
        triggerKeyVisual('F2 (Period Toggle)');
        setPeriodMode(p => p === 'custom' ? 'monthly' : p === 'monthly' ? 'quarterly' : 'custom');
      } else if (e.key === 'F5') {
        e.preventDefault();
        triggerKeyVisual('F5 (Sales Register)');
        onSwitchReport?.('sales_reg');
      } else if (e.key === 'F6') {
        e.preventDefault();
        triggerKeyVisual('F6 (Purchase Register)');
        onSwitchReport?.('pur_reg');
      } else if (e.key === 'F7') {
        e.preventDefault();
        triggerKeyVisual('F7 (Journal Register)');
        onSwitchReport?.('journal_reg');
      } else if (e.key === 'F8') {
        e.preventDefault();
        triggerKeyVisual('F8 (Receipts Register)');
        onSwitchReport?.('receipt_reg');
      } else if (e.key === 'F9') {
        e.preventDefault();
        triggerKeyVisual('F9 (Payments Register)');
        onSwitchReport?.('payment_reg');
      } else if (e.key === 'F10') {
        e.preventDefault();
        triggerKeyVisual('F10 (Contra Register)');
        onSwitchReport?.('contra_reg');
      } else if (e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        triggerKeyVisual('Alt+C (Credit Note Register)');
        onSwitchReport?.('cn_reg');
      } else if (e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        triggerKeyVisual('Alt+D (Debit Note Register)');
        onSwitchReport?.('dn_reg');
      } else if (e.altKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        triggerKeyVisual('Alt+E (Export PDF)');
        downloadPDF();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onBack();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [type, onSwitchReport, onBack, periodMode]);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Keyboard Press Notification Toast */}
      <AnimatePresence>
        {lastKeyPressed && (
          <motion.div 
            initial={{ opacity: 0, y: 15, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            className="fixed bottom-6 right-6 z-[100] flex items-center gap-3 bg-slate-900 text-white font-mono text-[11px] font-black tracking-wider uppercase px-4 py-3 rounded-xl border border-slate-700/55 shadow-2xl shadow-indigo-950/40"
          >
            <Keyboard size={14} className="text-indigo-400 animate-pulse" />
            <span>Shortcut Triggered: <span className="text-indigo-400 font-bold">{lastKeyPressed}</span></span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Register UI Section */}
      <div className="flex-1 space-y-6 min-w-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm gap-4">
          <div className="flex items-center gap-4">
            <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
              <ArrowLeft size={20} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900">{registerTitle}</h3>
                <span className="hidden sm:inline-flex items-center gap-1 bg-indigo-50 border border-indigo-100/55 text-[9px] font-black font-mono tracking-widest text-[#4f46e5] px-2 py-0.5 rounded-lg leading-none">
                  <Keyboard size={10} /> KEYBOARD CONTROL ENABLED
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-medium tracking-tight">{registerDesc}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Quick Mobile Shortcuts Trigger */}
            <button 
              onClick={() => setShowMobileShortcuts(s => !s)}
              className="lg:hidden flex items-center gap-2 border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-semibold"
            >
              <Keyboard size={14} className="text-indigo-500" />
              <span>Register Short-keys</span>
            </button>

            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
              <select 
                value={periodMode}
                onChange={(e: any) => setPeriodMode(e.target.value)}
                className="bg-transparent border-none text-[10px] font-bold text-indigo-600 focus:ring-0 p-1 cursor-pointer border-r border-slate-200 mr-1"
              >
                <option value="custom">Custom (F2)</option>
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

            <button onClick={downloadPDF} disabled={isDownloading} className="btn-primary text-xs flex items-center gap-2">
              {isDownloading ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
              Download Register (Alt+E)
            </button>
          </div>
        </div>

        {/* Informative alert explaining hotkeys */}
        <div className="bg-amber-50/50 border border-amber-200/50 rounded-xl p-3 px-4 flex items-center gap-3 text-amber-800 text-[11px] font-medium">
          <Info size={14} className="text-amber-600 shrink-0" />
          <span>💡 <span className="font-bold">Pro Accountant Power Features:</span> This register responds to true-to-life keyboard buttons. Press function keys (<span className="font-mono bg-amber-100/80 px-1 py-0.5 rounded border border-amber-200">F5</span> to <span className="font-mono bg-amber-100/80 px-1 py-0.5 rounded border border-amber-200">F10</span>) on your physical keyboard to swap registers instantly, just like in premium Indian ERP systems.</span>
        </div>

        {/* Mobile keyboard shortcuts drawer overlay */}
        <AnimatePresence>
          {showMobileShortcuts && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="lg:hidden bg-slate-50 border border-slate-200/80 rounded-xl p-4 space-y-3 overflow-hidden text-slate-700"
            >
              <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <Keyboard size={12} className="text-indigo-500" />
                Tap to Switch Registers
              </h4>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { onSwitchReport?.('sales_reg'); setShowMobileShortcuts(false); }} className={`p-2 rounded-lg border text-left text-xs font-bold transition-all ${type === 'sales_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white border-slate-200 text-slate-700'}`}>
                  Sales Register (F5)
                </button>
                <button onClick={() => { onSwitchReport?.('pur_reg'); setShowMobileShortcuts(false); }} className={`p-2 rounded-lg border text-left text-xs font-bold transition-all ${type === 'pur_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white border-slate-200 text-slate-700'}`}>
                  Purchase Register (F6)
                </button>
                <button onClick={() => { onSwitchReport?.('journal_reg'); setShowMobileShortcuts(false); }} className={`p-2 rounded-lg border text-left text-xs font-bold transition-all ${type === 'journal_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white border-slate-200 text-slate-700'}`}>
                  Journal Register (F7)
                </button>
                <button onClick={() => { onSwitchReport?.('receipt_reg'); setShowMobileShortcuts(false); }} className={`p-2 rounded-lg border text-left text-xs font-bold transition-all ${type === 'receipt_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white border-slate-200 text-slate-700'}`}>
                  Receipts Register (F8)
                </button>
                <button onClick={() => { onSwitchReport?.('payment_reg'); setShowMobileShortcuts(false); }} className={`p-2 rounded-lg border text-left text-xs font-bold transition-all ${type === 'payment_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white border-slate-200 text-slate-700'}`}>
                  Payments Register (F9)
                </button>
                <button onClick={() => { onSwitchReport?.('contra_reg'); setShowMobileShortcuts(false); }} className={`p-2 rounded-lg border text-left text-xs font-bold transition-all ${type === 'contra_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white border-slate-200 text-slate-700'}`}>
                  Contra Register (F10)
                </button>
                <button onClick={() => { onSwitchReport?.('cn_reg'); setShowMobileShortcuts(false); }} className={`p-2 rounded-lg border text-left text-xs font-bold transition-all ${type === 'cn_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white border-slate-200 text-slate-700'}`}>
                  Credit Note (Alt+C)
                </button>
                <button onClick={() => { onSwitchReport?.('dn_reg'); setShowMobileShortcuts(false); }} className={`p-2 rounded-lg border text-left text-xs font-bold transition-all ${type === 'dn_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white border-slate-200 text-slate-700'}`}>
                  Debit Note (Alt+D)
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {hasGst ? (
          <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                  <FileText size={16} />
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Taxable</span>
              </div>
              <p className="text-xl font-black text-slate-900">₹{totals.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                  <Filter size={16} />
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">CGST</span>
              </div>
              <p className="text-xl font-black text-slate-900">₹{totals.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                  <Filter size={16} />
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">SGST</span>
              </div>
              <p className="text-xl font-black text-slate-900">₹{totals.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
                  <Filter size={16} />
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">IGST</span>
              </div>
              <p className="text-xl font-black text-slate-900">₹{totals.igst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <Filter size={16} />
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total GST</span>
              </div>
              <p className="text-xl font-black text-slate-900">₹{totals.gst.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-slate-900 text-white rounded-lg">
                  <ArrowUpRight size={16} />
                </div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Net Value</span>
              </div>
              <p className="text-xl font-black text-slate-900">₹{totals.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                  <Layers size={20} />
                </div>
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Voucher Count</span>
                  <p className="text-2xl font-black text-slate-900 mt-0.5">{filteredTransactions.length}</p>
                </div>
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                  <Wallet size={20} />
                </div>
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Total Turn-Volume</span>
                  <p className="text-2xl font-black text-slate-950 mt-0.5">₹{totals.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
              </div>
            </div>
            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
                  <ClipboardList size={20} />
                </div>
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Average Transaction Size</span>
                  <p className="text-2xl font-black text-slate-900 mt-0.5">
                    ₹{filteredTransactions.length > 0 ? (totals.total / filteredTransactions.length).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="card overflow-hidden bg-white rounded-xl border border-slate-100 shadow-sm">
          <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
             <div className="relative flex-1 w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input 
                  type="text" 
                  placeholder="Search party, details or narration..."
                  className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
             </div>
             <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-lg">
                {filteredTransactions.length} {registerTitle} Records
             </div>
          </div>
          <div className="overflow-x-auto">
            {hasGst ? (
              <table className="w-full min-w-[800px]">
                <thead className="bg-slate-50/50 border-b border-slate-100 text-left">
                  <tr>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[15%]">Date / Vch</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[35%]">Party Name / GSTIN</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest w-[12%]">Taxable</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest w-[10%]">CGST</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest w-[10%]">SGST</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest w-[10%]">IGST</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest w-[15%]">Total Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTransactions.map((t: any) => (
                    <tr key={t.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-6 py-4">
                        <div className="text-sm font-bold text-slate-700">{new Date(t.date).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}</div>
                        <div className="text-[10px] text-slate-400 font-mono tracking-tighter mt-0.5">{t.voucherNumber || 'No Vch'}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-black text-slate-800">{t.partyName || 'Cash Sale/Purchase'}</div>
                        <div className="text-[10px] text-slate-400 font-mono tracking-tighter mt-0.5">{t.partyGstin ? `GSTIN: ${t.partyGstin}` : 'No GSTIN registered'}</div>
                        {(t.destination || t.motorVehicleNo) && (
                          <div className="text-[9px] text-indigo-500 font-extrabold uppercase mt-1 inline-flex gap-2 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100/50">
                            {t.destination && `To: ${t.destination}`} {t.motorVehicleNo && `| Vehicle: ${t.motorVehicleNo}`}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm font-bold text-slate-600">₹{(Number(t.subTotal || t.totalAmount || 0) - (Number(t.cgst || 0) + Number(t.sgst || 0) + Number(t.igst || 0))).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm font-semibold text-slate-500">₹{(Number(t.cgst || t.cgstAmount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm font-semibold text-slate-500">₹{(Number(t.sgst || t.sgstAmount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm font-semibold text-slate-500">₹{(Number(t.igst || t.igstAmount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm font-black text-slate-900">₹{(Number(t.totalAmount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </td>
                    </tr>
                  ))}
                  {filteredTransactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-20 text-center text-slate-400 italic text-xs">
                        No records found for the selected period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[700px]">
                <thead className="bg-slate-50/50 border-b border-slate-100 text-left">
                  <tr>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[15%]">Date / Vch</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[25%]">Particulars (A/c Name)</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[20%]">Payment Mode/Ref</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest w-[25%]">Narration / Description</th>
                    <th className="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest w-[15%]">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTransactions.map((t: any) => {
                    let refDetails = t.bankName || t.cashAccountName || '-';
                    if (t.type === 'Contra') {
                      refDetails = t.isDeposit ? 'Cash Deposit' : 'Cash Withdrawal';
                    }
                    
                    return (
                      <tr key={t.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-6 py-4">
                          <div className="text-sm font-bold text-slate-700">{new Date(t.date).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}</div>
                          <div className="text-[10px] text-slate-400 font-mono tracking-tighter mt-0.5">{t.voucherNumber || 'No Vch'}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm font-black text-slate-800">{t.partyName || 'Multi-accounts ledger'}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded">
                            {refDetails}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-500 text-xs">
                          {t.narration || t.description || <span className="italic text-slate-350">No Narration entered</span>}
                        </td>
                        <td className="px-6 py-4 text-right text-sm font-black text-slate-800">
                          ₹{(Number(t.totalAmount || t.amount || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredTransactions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-20 text-center text-slate-400 italic text-xs">
                        No records found for the selected period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Elegant Tally-style Desktop Hotkey Button Panel on the strict Right Side */}
      <div className="hidden lg:flex flex-col gap-2 w-52 shrink-0 bg-slate-50/80 border border-slate-200/80 p-3 rounded-xl shadow-xs h-fit self-start sticky top-24">
        <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-2 mb-1 border-b border-slate-200 pb-1.5 flex items-center justify-between">
          <span>KEYBOARD KEYS</span>
          <Keyboard size={10} className="text-indigo-400" />
        </div>
        
        <button 
          onClick={() => setPeriodMode(p => p === 'custom' ? 'monthly' : p === 'monthly' ? 'quarterly' : 'custom')} 
          className="flex items-center justify-between text-left px-3 py-2 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-lg text-[11px] font-bold text-slate-700 transition-all shadow-xs group"
        >
          <span className="group-hover:text-indigo-600">Period Toggle</span>
          <kbd className="bg-slate-100 px-1.5 py-0.5 rounded text-[9px] font-mono text-indigo-600 font-extrabold group-hover:bg-indigo-100">F2</kbd>
        </button>
        
        <button 
          onClick={() => onSwitchReport?.('sales_reg')} 
          className={`flex items-center justify-between text-left px-3 py-2 border rounded-lg text-[11px] font-bold transition-all shadow-xs group ${type === 'sales_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white hover:bg-indigo-50 border-slate-200 hover:border-indigo-200 text-slate-700'}`}
        >
          <span className={type === 'sales_reg' ? '' : 'group-hover:text-indigo-600'}>Sales Register</span>
          <kbd className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-extrabold ${type === 'sales_reg' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-[#4f46e5] group-hover:bg-indigo-100'}`}>F5</kbd>
        </button>

        <button 
          onClick={() => onSwitchReport?.('pur_reg')} 
          className={`flex items-center justify-between text-left px-3 py-2 border rounded-lg text-[11px] font-bold transition-all shadow-xs group ${type === 'pur_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white hover:bg-indigo-50 border-slate-200 hover:border-indigo-200 text-slate-700'}`}
        >
          <span className={type === 'pur_reg' ? '' : 'group-hover:text-indigo-600'}>Purchase Reg</span>
          <kbd className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-extrabold ${type === 'pur_reg' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-[#4f46e5] group-hover:bg-indigo-100'}`}>F6</kbd>
        </button>

        <button 
          onClick={() => onSwitchReport?.('journal_reg')} 
          className={`flex items-center justify-between text-left px-3 py-2 border rounded-lg text-[11px] font-bold transition-all shadow-xs group ${type === 'journal_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white hover:bg-indigo-50 border-slate-200 hover:border-indigo-200 text-slate-700'}`}
        >
          <span className={type === 'journal_reg' ? '' : 'group-hover:text-indigo-600'}>Journal Reg</span>
          <kbd className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-extrabold ${type === 'journal_reg' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-[#4f46e5] group-hover:bg-indigo-100'}`}>F7</kbd>
        </button>

        <button 
          onClick={() => onSwitchReport?.('receipt_reg')} 
          className={`flex items-center justify-between text-left px-3 py-2 border rounded-lg text-[11px] font-bold transition-all shadow-xs group ${type === 'receipt_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white hover:bg-indigo-50 border-slate-200 hover:border-indigo-200 text-slate-700'}`}
        >
          <span className={type === 'receipt_reg' ? '' : 'group-hover:text-indigo-600'}>Receipts Reg</span>
          <kbd className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-extrabold ${type === 'receipt_reg' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-[#4f46e5] group-hover:bg-indigo-100'}`}>F8</kbd>
        </button>

        <button 
          onClick={() => onSwitchReport?.('payment_reg')} 
          className={`flex items-center justify-between text-left px-3 py-2 border rounded-lg text-[11px] font-bold transition-all shadow-xs group ${type === 'payment_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white hover:bg-indigo-50 border-slate-200 hover:border-indigo-200 text-slate-700'}`}
        >
          <span className={type === 'payment_reg' ? '' : 'group-hover:text-indigo-600'}>Payments Reg</span>
          <kbd className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-extrabold ${type === 'payment_reg' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-[#4f46e5] group-hover:bg-indigo-100'}`}>F9</kbd>
        </button>

        <button 
          onClick={() => onSwitchReport?.('contra_reg')} 
          className={`flex items-center justify-between text-left px-3 py-2 border rounded-lg text-[11px] font-bold transition-all shadow-xs group ${type === 'contra_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white hover:bg-indigo-50 border-slate-200 hover:border-indigo-200 text-slate-700'}`}
        >
          <span className={type === 'contra_reg' ? '' : 'group-hover:text-indigo-600'}>Contra Reg</span>
          <kbd className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-extrabold ${type === 'contra_reg' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-[#4f46e5] group-hover:bg-indigo-100'}`}>F10</kbd>
        </button>

        <button 
          onClick={() => onSwitchReport?.('cn_reg')} 
          className={`flex items-center justify-between text-left px-3 py-2 border rounded-lg text-[11px] font-bold transition-all shadow-xs group ${type === 'cn_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white hover:bg-indigo-50 border-slate-200 hover:border-indigo-200 text-slate-700'}`}
        >
          <span className={type === 'cn_reg' ? '' : 'group-hover:text-indigo-600'}>Credit Note</span>
          <kbd className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-extrabold ${type === 'cn_reg' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-[#4f46e5] group-hover:bg-indigo-100'}`}>Alt+C</kbd>
        </button>

        <button 
          onClick={() => onSwitchReport?.('dn_reg')} 
          className={`flex items-center justify-between text-left px-3 py-2 border rounded-lg text-[11px] font-bold transition-all shadow-xs group ${type === 'dn_reg' ? 'bg-[#4f46e5] text-white border-[#4f46e5]' : 'bg-white hover:bg-indigo-50 border-slate-200 hover:border-indigo-200 text-slate-700'}`}
        >
          <span className={type === 'dn_reg' ? '' : 'group-hover:text-indigo-600'}>Debit Note</span>
          <kbd className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-extrabold ${type === 'dn_reg' ? 'bg-indigo-700 text-white' : 'bg-slate-100 text-[#4f46e5] group-hover:bg-indigo-100'}`}>Alt+D</kbd>
        </button>

        <div className="border-t border-slate-200 my-1"></div>

        <button 
          onClick={downloadPDF} 
          className="flex items-center justify-between text-left px-3 py-2 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-lg text-[11px] font-bold text-slate-700 transition-all shadow-xs group"
        >
          <span className="group-hover:text-indigo-600">Export PDF</span>
          <kbd className="bg-slate-100 px-1.5 py-0.5 rounded text-[9px] font-mono text-indigo-600 font-extrabold group-hover:bg-indigo-100">Alt+E</kbd>
        </button>
        
        <button 
          onClick={onBack} 
          className="flex items-center justify-between text-left px-3 py-2 bg-white hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-lg text-[11px] font-bold text-[#e11d48] transition-all shadow-xs group"
        >
          <span className="group-hover:text-rose-600">Exit Register</span>
          <kbd className="bg-slate-100 px-1.5 py-0.5 rounded text-[9px] font-mono text-rose-600 font-extrabold group-hover:bg-rose-100/50">Esc</kbd>
        </button>
      </div>
    </div>
  );
};
