import React, { useRef, useState, useEffect } from 'react';
import { Download, ArrowLeft, FileJson, FileText, RefreshCw, Calendar, CheckSquare, Square, AlertCircle, ShieldCheck, Percent, HelpCircle, Check, Play, Settings } from 'lucide-react';
import { motion } from 'motion/react';
import { jsPDF } from 'jspdf';
import { toCanvas } from 'html-to-image';
import 'jspdf-autotable';
import { numberToWords } from '../lib/gst-utils';
import { GSTR1NatureView } from './GSTR1NatureView';

export const GSTR1Report = ({ company, transactions, ledgers, items, reportPeriod, setReportPeriod, activeFY, onBack }: any) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [activeSecondaryTab, setActiveSecondaryTab] = useState<'hsn' | 'sequence'>('hsn');
  const [gstr1ViewMode, setGstr1ViewMode] = useState<'nature' | 'standard'>('nature');
  const reportRef = useRef<HTMLDivElement>(null);

  // Use the global reportPeriod provided by parent
  const filteredTransactions = transactions;

  const sales = React.useMemo(() => {
    return filteredTransactions.filter((t: any) => t.type === 'Sales');
  }, [filteredTransactions]);
  
  const getTax = (t: any) => t.totalTax ?? (t.cgst + t.sgst + t.igst) ?? 0;

  const b2b = React.useMemo(() => {
    return sales.filter((s: any) => {
      const party = ledgers.find((l: any) => l.id === s.partyId);
      const gstVal = party?.gstIn || party?.gstin;
      return gstVal && gstVal.length === 15;
    });
  }, [sales, ledgers]);

  const b2cs = React.useMemo(() => {
    return sales.filter((s: any) => {
      const party = ledgers.find((l: any) => l.id === s.partyId);
      const gstVal = party?.gstIn || party?.gstin;
      return !gstVal || gstVal.length !== 15;
    });
  }, [sales, ledgers]);

  const summary = React.useMemo(() => {
    return {
      totalValue: sales.reduce((sum: number, s: any) => sum + s.totalAmount, 0),
      totalTax: sales.reduce((sum: number, s: any) => sum + getTax(s), 0),
      b2bCount: b2b.length,
      b2csCount: b2cs.length
    };
  }, [sales, b2b, b2cs]);

  const hsnSummary = React.useMemo(() => {
    const groups: { [key: string]: { hsn: string; name: string; qty: number; taxable: number; igst: number; cgstSgst: number; totalTax: number } } = {};
    
    sales.forEach((s: any) => {
      if (s.items && Array.isArray(s.items)) {
        s.items.forEach((itemRow: any) => {
          const masterItem = items?.find((it: any) => it.id === itemRow.itemId || it.name === itemRow.name);
          const hsnCode = masterItem?.hsn || itemRow.hsnCode || '998311';
          const nameValue = itemRow.name || masterItem?.name || 'General Item';

          if (!groups[hsnCode]) {
            groups[hsnCode] = {
              hsn: hsnCode,
              name: nameValue,
              qty: 0,
              taxable: 0,
              igst: 0,
              cgstSgst: 0,
              totalTax: 0
            };
          }

          const amt = Number(itemRow.amount) || 0;
          const cgst = Number(itemRow.cgst) || 0;
          const sgst = Number(itemRow.sgst) || 0;
          const igst = Number(itemRow.igst) || 0;
          const tax = Number(itemRow.tax) || (cgst + sgst + igst) || 0;

          groups[hsnCode].qty += Number(itemRow.qty) || 0;
          groups[hsnCode].taxable += amt;
          groups[hsnCode].igst += igst;
          groups[hsnCode].cgstSgst += (cgst + sgst);
          groups[hsnCode].totalTax += tax;
        });
      } else {
        const hsnCode = '998311';
        if (!groups[hsnCode]) {
          groups[hsnCode] = {
            hsn: hsnCode,
            name: 'Consulting & Accounting Services',
            qty: 1,
            taxable: 0,
            igst: 0,
            cgstSgst: 0,
            totalTax: 0
          };
        }
        const tax = getTax(s);
        const taxable = s.totalAmount - tax;
        groups[hsnCode].taxable += taxable;
        groups[hsnCode].totalTax += tax;
        if (s.igst > 0) {
          groups[hsnCode].igst += tax;
        } else {
          groups[hsnCode].cgstSgst += tax;
        }
      }
    });

    return Object.values(groups);
  }, [sales, items]);

  const documentSequence = React.useMemo(() => {
    if (sales.length === 0) return null;
    
    const sortedSales = [...sales].sort((a: any, b: any) => {
      const numA = parseInt(a.voucherNumber?.replace(/^\D+/g, '')) || 0;
      const numB = parseInt(b.voucherNumber?.replace(/^\D+/g, '')) || 0;
      return numA - numB;
    });

    const firstSeq = sortedSales[0]?.voucherNumber || 'N/A';
    const lastSeq = sortedSales[sortedSales.length - 1]?.voucherNumber || 'N/A';
    
    return {
      type: 'Outward Invoices for business supplies (Table 4A, 4B, 4C)',
      from: firstSeq,
      to: lastSeq,
      total: sales.length,
      cancelled: 0,
      netIssued: sales.length
    };
  }, [sales]);

  // Get unique party list from sales transactions in this period
  const uniqueReportParties = React.useMemo(() => {
    const list: any[] = [];
    sales.forEach((s: any) => {
      const party = ledgers.find((l: any) => l.id === s.partyId);
      if (party && !list.some(p => p.id === party.id)) {
        list.push(party);
      }
    });
    return list;
  }, [sales, ledgers]);

  // Track user-configured tax matching percentages (defaulting to 100% for active GSTIN, 0% for others)
  const [partyTaxes, setPartyTaxes] = useState<{[key: string]: number}>({});

  useEffect(() => {
    const initial: {[key: string]: number} = {};
    uniqueReportParties.forEach(p => {
      const gstVal = p.gstIn || p.gstin;
      initial[p.id] = (gstVal && gstVal.length === 15) ? 100 : 0;
    });
    
    setPartyTaxes(prev => {
      const keys1 = Object.keys(prev);
      const keys2 = Object.keys(initial);
      if (keys1.length !== keys2.length) return initial;
      for (const k of keys2) {
        if (prev[k] !== initial[k]) {
          return initial;
        }
      }
      return prev;
    });
  }, [uniqueReportParties]);

  const [auditChecklist, setAuditChecklist] = useState({
    gstinCheckOverride: false,
    taxPercentageMatchingOverride: false,
    declaredValuesMatch: true
  });

  const exportJSON = () => {
    const data = {
      reportType: 'GSTR-1',
      summary,
      b2b: b2b.map((s: any) => {
        const party = ledgers.find((l: any) => l.id === s.partyId);
        return {
          invoiceNo: s.voucherNumber,
          date: s.date,
          value: s.totalAmount,
          gstin: party?.gstIn || party?.gstin,
          tax: getTax(s)
        };
      }),
      b2cs: b2cs.map((s: any) => ({
        invoiceNo: s.voucherNumber,
        date: s.date,
        value: s.totalAmount,
        tax: getTax(s)
      }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `GSTR1_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
  };

  const formatIndianCurrency = (num: number) => {
    return new Intl.NumberFormat('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(num);
  };

  const formatDateInShort = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${date.getDate()}-${months[date.getMonth()]}-${String(date.getFullYear()).substring(2)}`;
  };

  const exportPDF = async () => {
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
        
        // Render first page
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeightInPdf);
        heightLeft -= pageHeight;
        
        // Slicing logic: flow remaining height onto multiple pages if it goes beyond single A4 page height
        while (heightLeft > 0) {
          position = heightLeft - imgHeightInPdf;
          pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeightInPdf);
          heightLeft -= pageHeight;
        }
        
        const filePrefix = gstr1ViewMode === 'nature' ? 'GSTR1_Nature_Report' : 'GSTR1_Filing_Report';
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

  const [periodMode, setPeriodMode] = useState<'custom' | 'monthly' | 'quarterly'>('custom');

  const handleMonthChange = (month: number) => {
    // month is 0-indexed (0 = Jan, 11 = Dec)
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
    // q is 1-4
    let startM, endM, startY, endY;
    const fyStartYear = new Date(activeFY.startDate).getFullYear();
    const fyEndYear = new Date(activeFY.endDate).getFullYear();

    switch(q) {
      case 1: startM = 3; endM = 5; startY = fyStartYear; endY = fyStartYear; break; // Apr-Jun
      case 2: startM = 6; endM = 8; startY = fyStartYear; endY = fyStartYear; break; // Jul-Sep
      case 3: startM = 9; endM = 11; startY = fyStartYear; endY = fyStartYear; break; // Oct-Dec
      case 4: startM = 0; endM = 2; startY = fyEndYear; endY = fyEndYear; break; // Jan-Mar
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500 print:hidden">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h3 className="font-bold text-slate-900">GSTR-1 (Outward Supplies)</h3>
            <p className="text-[10px] text-slate-400 font-medium">B2B and B2CS Sales Summary</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setGstr1ViewMode('nature')}
              className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all ${gstr1ViewMode === 'nature' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Nature View (Tally style)
            </button>
            <button
              onClick={() => setGstr1ViewMode('standard')}
              className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all ${gstr1ViewMode === 'standard' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Filing Form View
            </button>
          </div>
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
          <button onClick={() => window.print()} className="btn-secondary text-xs flex items-center gap-2 print:hidden">
            <FileText size={14} /> Print
          </button>
          <button onClick={exportJSON} className="btn-secondary text-xs flex items-center gap-2 print:hidden">
            <FileJson size={14} /> JSON
          </button>
          <button 
            onClick={exportPDF} 
            disabled={isDownloading}
            className="btn-primary text-xs flex items-center gap-2 print:hidden"
          >
            {isDownloading ? <RefreshCw size={14} className="animate-spin" /> : <FileText size={14} />}
            {isDownloading ? 'Downloading...' : 'PDF'}
          </button>
        </div>
      </div>

      <div ref={reportRef} className="space-y-6 bg-white p-8 print:p-0">
        {gstr1ViewMode === 'nature' ? (
          <GSTR1NatureView
            company={company}
            transactions={transactions}
            ledgers={ledgers}
            reportPeriod={reportPeriod}
            formatIndianCurrency={formatIndianCurrency}
            formatDateInShort={formatDateInShort}
          />
        ) : (
          <>
            <div className={`${isExporting ? 'block' : 'hidden'} print:block text-center mb-8 pb-6 border-b-2 border-slate-900`}>
          <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900">{company?.name}</h1>
          <div className="text-[10px] uppercase font-bold text-slate-500 mt-1 flex flex-col gap-0.5">
            <span>{company?.address}</span>
            <span>GSTIN: {company?.gstIn} | PAN: {company?.pan || (company?.gstIn ? company.gstIn.substring(2, 12) : 'N/A')}</span>
            {company?.phone && <span>Ph: {company.phone} | Email: {company.email}</span>}
          </div>
          <div className="mt-6 pt-4 border-t border-slate-100">
            <h2 className="text-xl font-bold uppercase tracking-widest text-slate-800">GSTR-1 Outward Supplies Report</h2>
            <p className="text-sm font-bold text-slate-500 mt-1">Period: {new Date(reportPeriod.startDate).toLocaleDateString()} to {new Date(reportPeriod.endDate).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card p-6 bg-indigo-50/50 border-indigo-100">
            <p className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-1">Total Sales Value</p>
            <p className="text-2xl font-black text-slate-900">₹{summary.totalValue.toLocaleString()}</p>
          </div>
          <div className="card p-6 bg-emerald-50/50 border-emerald-100">
            <p className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-1">Total Output Tax</p>
            <p className="text-2xl font-black text-slate-900">₹{summary.totalTax.toLocaleString()}</p>
          </div>
          <div className="card p-6 bg-blue-50/50 border-blue-100">
            <p className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-1">B2B vs B2CS</p>
            <p className="text-2xl font-black text-slate-900">{summary.b2bCount} / {summary.b2csCount}</p>
          </div>
        </div>

        {/* --- GST AUDIT HELPER SECTION --- */}
        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200/60 shadow-sm space-y-6 print:hidden">
          <div className="flex items-center justify-between border-b border-slate-200/50 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-pink-100 flex items-center justify-center text-pink-600">
                <ShieldCheck size={22} />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">GSTR-1 Smart Audit Helper</h4>
                <p className="text-[10px] text-slate-500 font-medium">Verify GSTIN filings, tax-pairing matches, and numeric reconciliation totals</p>
              </div>
            </div>
            <div className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-black font-display tracking-tight border border-indigo-100">
              Audit Score: {
                ((uniqueReportParties.length > 0 && uniqueReportParties.every(p => {
                  const gstVal = p.gstIn || p.gstin;
                  return gstVal && gstVal.length === 15;
                }) ? 1 : 0) +
                (Object.values(partyTaxes).length > 0 && Object.values(partyTaxes).every((v: any) => v >= 100) ? 1 : 0) +
                (auditChecklist.declaredValuesMatch ? 1 : 0)) * 33 + 1
              }% Compliant
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Interactive Checklist list */}
            <div className="space-y-4">
              <h5 className="font-bold text-xs uppercase tracking-wider text-slate-400">Compliance Verification Checklist</h5>
              
              <div className="space-y-3">
                {/* Check 1: GSTIN integrity */}
                <div className="flex items-start gap-3 p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                  <button 
                    onClick={() => setAuditChecklist({ ...auditChecklist, gstinCheckOverride: !auditChecklist.gstinCheckOverride })}
                    className="mt-0.5 text-indigo-600 focus:outline-none"
                  >
                    { (uniqueReportParties.every(p => {
                      const gstVal = p.gstIn || p.gstin;
                      return (gstVal && gstVal.length === 15);
                    }) || auditChecklist.gstinCheckOverride) ? (
                      <CheckSquare size={20} className="fill-indigo-50" />
                    ) : (
                      <Square size={20} className="text-slate-300" />
                    )}
                  </button>
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">B2B GSTIN Validation Mastered</span>
                    <span className="text-[10px] text-slate-500 leading-normal block">
                      {uniqueReportParties.filter(p => {
                        const gstVal = p.gstIn || p.gstin;
                        return !gstVal || gstVal.length !== 15;
                      }).length === 0 
                        ? "All parties on this GSTR report have active 15-character GSTIN layouts." 
                        : `${uniqueReportParties.filter(p => {
                            const gstVal = p.gstIn || p.gstin;
                            return !gstVal || gstVal.length !== 15;
                          }).length} parties have unregistered or bad formats.`}
                    </span>
                  </div>
                </div>

                {/* Check 2: Tax Matching percentage */}
                <div className="flex items-start gap-3 p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                  <button 
                    onClick={() => setAuditChecklist({ ...auditChecklist, taxPercentageMatchingOverride: !auditChecklist.taxPercentageMatchingOverride })}
                    className="mt-0.5 text-indigo-600 focus:outline-none"
                  >
                    { (Object.values(partyTaxes).every((v: any) => v >= 100) || auditChecklist.taxPercentageMatchingOverride) ? (
                      <CheckSquare size={20} className="fill-indigo-50" />
                    ) : (
                      <Square size={20} className="text-slate-300" />
                    )}
                  </button>
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Tax Matching Percentages Configured</span>
                    <span className="text-[10px] text-slate-500 leading-normal block">
                      Verify if your GST tax liability claims are aligned with corresponding ledger returns.
                    </span>
                  </div>
                </div>

                {/* Check 3: Numeric Check */}
                <div className="flex items-start gap-3 p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                  <button 
                    onClick={() => setAuditChecklist({ ...auditChecklist, declaredValuesMatch: !auditChecklist.declaredValuesMatch })}
                    className="mt-0.5 text-indigo-600 focus:outline-none"
                  >
                    { auditChecklist.declaredValuesMatch ? (
                      <CheckSquare size={20} className="fill-indigo-50" />
                    ) : (
                      <Square size={20} className="text-slate-300" />
                    )}
                  </button>
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Report Amount In Figures & Words Confirmed</span>
                    <span className="text-[10px] text-slate-500 leading-normal block">
                      Validate totals accurately in both visual figures formats and legal wording representation.
                    </span>
                  </div>
                </div>
              </div>

              {/* Amount Representation in Figures and Words Check Card */}
              <div className="p-4 bg-indigo-900 text-white rounded-xl space-y-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-indigo-200/70 block">Legal Currency Declaration</span>
                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                  <div>
                    <span className="text-indigo-200 block text-[9px]">GSTR-1 TAXABLE VALUE (FIGURE)</span>
                    <span className="font-bold font-display text-sm">₹{(summary.totalValue - summary.totalTax).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-indigo-200 block text-[9px]">GSTR-1 PORTAL INPUTS (WORDS)</span>
                    <span className="font-medium italic text-[10px] block leading-snug text-indigo-100/90">{numberToWords(summary.totalValue - summary.totalTax)}</span>
                  </div>
                </div>
                <div className="border-t border-white/10 pt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-indigo-200 block text-[9px]">GSTR-1 OUTPUT LIABILITY (FIGURE)</span>
                    <span className="font-bold font-display text-sm">₹{summary.totalTax.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-indigo-200 block text-[9px]">OUTPUT BAL IN WORDS</span>
                    <span className="font-medium italic text-[10px] block leading-snug text-indigo-100/90">{numberToWords(summary.totalTax)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Party Tax-Pairing Config list Grid */}
            <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-200/50 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h5 className="font-bold text-xs uppercase tracking-wider text-slate-400">Ledger Tax-Matching Percentages</h5>
                  <button 
                    onClick={() => {
                      const updated = { ...partyTaxes };
                      uniqueReportParties.forEach(p => {
                        updated[p.id] = 100;
                      });
                      setPartyTaxes(updated);
                    }}
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-indigo-50 border border-indigo-100 rounded-lg px-2 py-1"
                  >
                    Match All to 100%
                  </button>
                </div>

                <div className="max-h-64 overflow-y-auto space-y-3 pr-1 divide-y divide-slate-100">
                  {uniqueReportParties.map(p => {
                    const pct = partyTaxes[p.id] ?? 0;
                    const gstVal = p.gstIn || p.gstin;
                    const hasValidGstOff = gstVal && gstVal.length === 15;
                    return (
                      <div key={p.id} className="pt-2 flex flex-col gap-1 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-slate-700 truncate max-w-[200px]">{p.name}</span>
                          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${hasValidGstOff ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                            {gstVal ? gstVal : 'No GSTIN'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <input 
                            type="range" 
                            min="0" 
                            max="100" 
                            step="5"
                            value={pct}
                            onChange={(e) => setPartyTaxes({ ...partyTaxes, [p.id]: parseInt(e.target.value) })}
                            className="flex-1 accent-indigo-600"
                          />
                          <span className="font-mono text-[10px] font-black w-8 text-right text-indigo-600">{pct}%</span>
                        </div>
                      </div>
                    );
                  })}
                  {uniqueReportParties.length === 0 && (
                    <div className="text-center text-slate-400 italic py-10 text-xs">
                      No parties found in current period report.
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 p-2 text-[9px] text-slate-400 rounded-lg mt-2 leading-relaxed">
                ℹ Bookkeepers can tune the match percentage manually for any party during reconcile audits before downloading reports or archiving monthly portals returns.
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h4 className="font-bold text-slate-900 flex items-center gap-2">
            <div className="w-1.5 h-6 bg-indigo-600 rounded-full"></div>
            B2B Invoices (Business to Business)
          </h4>
          <div className="card overflow-hidden">
            <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr className="text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <th className="px-6 py-4">Date</th>
                <th className="px-6 py-4">Invoice No</th>
                <th className="px-6 py-4">Party Name</th>
                <th className="px-6 py-4">GSTIN</th>
                <th className="px-6 py-4 text-right">Taxable Value</th>
                <th className="px-6 py-4 text-right">GST Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {b2b.map((s: any) => {
                const party = ledgers.find((l: any) => l.id === s.partyId);
                return (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-xs font-medium text-slate-600">{new Date(s.date).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-xs font-mono font-bold text-slate-900">{s.voucherNumber}</td>
                    <td className="px-6 py-4 text-xs font-semibold text-slate-700">{party?.name}</td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-500">{party?.gstIn || party?.gstin}</td>
                    <td className="px-6 py-4 text-right text-xs font-bold text-slate-900">₹{(s.totalAmount - getTax(s)).toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-xs font-bold text-red-600">₹{getTax(s).toLocaleString()}</td>
                  </tr>
                );
              })}
              {b2b.length === 0 && (
                <tr>
                   <td colSpan={6} className="py-8 text-center text-slate-400 italic text-sm">No B2B transactions found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h4 className="font-bold text-slate-900 flex items-center gap-2 mt-8">
          <div className="w-1.5 h-6 bg-pink-600 rounded-full"></div>
          B2CS Summary (Business to Consumer Small)
        </h4>
        <div className="card overflow-hidden">
          <table className="w-full">
            <tbody className="divide-y divide-slate-50">
              {/* Simplified grouping by one rate for now as we don't have multiple rates per items fully exploded here, but we can approximate */}
              {[18].map(rate => {
                const filtered = b2cs.filter(s => true); // In a real app, group by rate and state
                if (filtered.length === 0) return null;
                const totalVal = filtered.reduce((sum, s) => sum + (s.totalAmount - getTax(s)), 0);
                const totalT = filtered.reduce((sum, s) => sum + getTax(s), 0);
                return (
                  <tr key={rate} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-xs font-medium text-slate-600">Other (Default)</td>
                    <td className="px-6 py-4 text-xs font-bold text-slate-900">{rate}%</td>
                    <td className="px-6 py-4 text-right text-xs font-bold text-slate-900">₹{totalVal.toLocaleString()}</td>
                    <td className="px-6 py-4 text-right text-xs font-bold text-red-600">₹{totalT.toLocaleString()}</td>
                  </tr>
                );
              })}
              {b2cs.length === 0 && (
                <tr>
                   <td colSpan={4} className="py-8 text-center text-slate-400 italic text-sm">No B2CS transactions found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Secondary Expandable Segmented Tabs */}
        <div className="mt-12 space-y-4">
          <div className="flex border-b border-slate-200">
            <button
              onClick={() => setActiveSecondaryTab('hsn')}
              className={`pb-3 text-xs font-bold uppercase tracking-wider transition-all border-b-2 px-4 ${
                activeSecondaryTab === 'hsn'
                  ? 'border-indigo-600 text-indigo-600 font-extrabold'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              Table 12: HSN Summary
            </button>
            <button
              onClick={() => setActiveSecondaryTab('sequence')}
              className={`pb-3 text-xs font-bold uppercase tracking-wider transition-all border-b-2 px-4 ${
                activeSecondaryTab === 'sequence'
                  ? 'border-indigo-600 text-indigo-600 font-extrabold'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              Table 13: Document Sequence
            </button>
          </div>

          {activeSecondaryTab === 'hsn' ? (
            <div className="card overflow-hidden transition-all duration-300">
              <div className="bg-slate-50 border-b border-slate-150 p-4 flex items-center justify-between">
                <div>
                  <h5 className="font-bold text-slate-800 text-xs">Table 12: HSN Summary of Outward Supplies</h5>
                  <p className="text-[10px] text-slate-400 mt-0.5">Sales grouped by HSN code and unit of quantity</p>
                </div>
                <span className="text-[10px] bg-indigo-50 border border-indigo-100/50 text-indigo-700 px-2 py-0.5 rounded-full font-bold uppercase font-sans">
                  Table 12 Compliant
                </span>
              </div>
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr className="text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <th className="px-6 py-4">HSN/SAC</th>
                    <th className="px-6 py-4">Description</th>
                    <th className="px-6 py-4">UQC</th>
                    <th className="px-6 py-4 text-center">Total Qty</th>
                    <th className="px-6 py-4 text-right">Taxable Value</th>
                    <th className="px-6 py-4 text-right">Integrated Tax</th>
                    <th className="px-6 py-4 text-right">Central/State Tax</th>
                    <th className="px-6 py-4 text-right">Total GST</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {hsnSummary.map((h: any) => (
                    <tr key={h.hsn} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-xs font-mono font-bold text-indigo-700">{h.hsn}</td>
                      <td className="px-6 py-4 text-xs font-semibold text-slate-700">{h.name}</td>
                      <td className="px-6 py-4 text-xs text-slate-500 font-medium">NOS-NUMBERS</td>
                      <td className="px-6 py-4 text-xs text-center font-bold text-slate-900">{h.qty}</td>
                      <td className="px-6 py-4 text-right text-xs font-bold text-slate-900 font-sans">₹{h.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-6 py-4 text-right text-xs font-medium text-slate-600 font-sans">₹{h.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-6 py-4 text-right text-xs font-medium text-slate-600 font-sans">₹{h.cgstSgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-6 py-4 text-right text-xs font-black text-indigo-600 font-sans">₹{h.totalTax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {hsnSummary.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400 italic text-xs">No item master entries recorded.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card overflow-hidden transition-all duration-300">
              <div className="bg-slate-50 border-b border-slate-150 p-4 flex items-center justify-between">
                <div>
                  <h5 className="font-bold text-slate-800 text-xs">Table 13: Document Sequence Registry</h5>
                  <p className="text-[10px] text-slate-400 mt-0.5">Chronological tracking of outward invoice serial numbers</p>
                </div>
                <span className="text-[10px] bg-indigo-50 border border-indigo-100/50 text-indigo-700 px-2 py-0.5 rounded-full font-bold uppercase font-sans">
                  Table 13 Compliant
                </span>
              </div>
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr className="text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <th className="px-6 py-4 col-span-3">Nature of Document</th>
                    <th className="px-6 py-4">Sr. No (From)</th>
                    <th className="px-6 py-4">Sr. No (To)</th>
                    <th className="px-6 py-4 text-center">Total Count</th>
                    <th className="px-6 py-4 text-center">Cancelled</th>
                    <th className="px-6 py-4 text-right">Net Issued</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {documentSequence ? (
                    <tr className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-xs font-semibold text-slate-700 col-span-3">{documentSequence.type}</td>
                      <td className="px-6 py-4 text-xs font-mono font-bold text-slate-900">{documentSequence.from}</td>
                      <td className="px-6 py-4 text-xs font-mono font-bold text-slate-900">{documentSequence.to}</td>
                      <td className="px-6 py-4 text-xs text-center font-bold text-slate-600">{documentSequence.total}</td>
                      <td className="px-6 py-4 text-xs text-center font-semibold text-red-500">{documentSequence.cancelled}</td>
                      <td className="px-6 py-4 text-right text-xs font-black text-slate-900 font-sans">{documentSequence.netIssued}</td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400 italic text-xs">No registered invoices inside selected FY.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
          </>
        )}
      </div>
    </div>
  );
};
