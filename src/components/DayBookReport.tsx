import React, { useRef, useState } from 'react';
import { 
  ArrowLeft, 
  Download, 
  FileText, 
  RefreshCw, 
  Calendar, 
  Pencil, 
  Trash2, 
  Search, 
  Filter, 
  TrendingUp, 
  TrendingDown, 
  Clock 
} from 'lucide-react';
import { motion } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { dbService } from '../lib/db';

export const DayBookReport = ({ 
  company, 
  transactions, 
  reportPeriod, 
  setReportPeriod, 
  onBack, 
  onEditTransaction 
}: any) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [filterType, setFilterType] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Group or Filter Transactions for currently selected period
  const filteredTx = transactions.filter((t: any) => {
    // Note: Transactions are pre-filtered in search by reportPeriod in App/Reports.tsx
    const matchesSearch = 
      t.voucherNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.partyName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.narration?.toLowerCase().includes(searchTerm.toLowerCase());
      
    if (filterType === 'All') return matchesSearch;
    return t.type === filterType && matchesSearch;
  });

  // Calculate stats
  const stats = filteredTx.reduce((acc: any, t: any) => {
    const amt = Number(t.totalAmount) || 0;
    if (['Sales', 'Receipt'].includes(t.type)) {
      acc.inflow += amt;
    } else if (['Purchases', 'Payment'].includes(t.type)) {
      acc.outflow += amt;
    }
    return acc;
  }, { inflow: 0, outflow: 0, count: filteredTx.length });

  const getVchLabel = (type: string) => {
    switch (type) {
      case 'Sales': return 'SALES';
      case 'Purchases': return 'PURCH';
      case 'Receipt': return 'RCT';
      case 'Payment': return 'PYMT';
      case 'Contra': return 'CONT';
      case 'Journal': return 'JRNL';
      case 'Credit Note': return 'CRNT';
      case 'Debit Note': return 'DRNT';
      default: return type.toUpperCase();
    }
  };

  const getVchColor = (type: string) => {
    switch (type) {
      case 'Sales': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Purchases': return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'Receipt': return 'bg-teal-50 text-teal-700 border-teal-200';
      case 'Payment': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'Contra': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
      case 'Journal': return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'Credit Note': return 'bg-sky-50 text-sky-700 border-sky-200';
      case 'Debit Note': return 'bg-orange-50 text-orange-700 border-orange-200';
      default: return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  const exportPDF = () => {
    try {
      const doc = new jsPDF() as any;
      
      // Header
      if (company?.logo) {
        try {
          doc.addImage(company.logo, 'PNG', 20, 15, 25, 25);
        } catch (e) {
          console.error("Logo loading error", e);
        }
      }

      const headerX = company?.logo ? 50 : 105;
      const textAlign = company?.logo ? 'left' : 'center';

      doc.setFontSize(22);
      doc.setTextColor(79, 70, 229); // Indigo-600
      doc.setFont(undefined, 'bold');
      doc.text(company?.name?.toUpperCase() || 'COMPANY NAME', headerX, 22, { align: textAlign });
      
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.setFont(undefined, 'normal');
      
      let currentY = 28;
      const splitAddress = doc.splitTextToSize(company?.address || '', 140);
      doc.text(splitAddress, headerX, currentY, { align: textAlign });
      currentY += (splitAddress.length * 4) + 1;

      const contacts = [];
      if (company?.phone) contacts.push(`Ph: ${company.phone}`);
      if (company?.email) contacts.push(`Email: ${company.email}`);
      if (contacts.length > 0) {
        doc.text(contacts.join(' | '), headerX, currentY, { align: textAlign });
        currentY += 4;
      }

      if (company?.gstIn) {
        doc.setFont(undefined, 'bold');
        doc.text(`GSTIN: ${company.gstIn}`, headerX, currentY, { align: textAlign });
      }

      doc.setDrawColor(220);
      doc.line(20, 48, 190, 48);

      // Report metadata
      doc.setFontSize(14);
      doc.setTextColor(30);
      doc.setFont(undefined, 'bold');
      doc.text("DAY BOOK JOURNAL REPORT", 105, 57, { align: 'center' });

      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(100);
      doc.text(`Period: ${new Date(reportPeriod.startDate).toLocaleDateString()} to ${new Date(reportPeriod.endDate).toLocaleDateString()}`, 105, 62, { align: 'center' });

      // Table preparation
      const tableRows = filteredTx.map((t: any) => [
        new Date(t.date).toLocaleDateString(),
        t.voucherNumber || '—',
        t.type,
        t.partyName || '—',
        t.narration ? t.narration : '—',
        ['Sales', 'Receipt'].includes(t.type) ? `INR ${Number(t.totalAmount).toLocaleString()}` : '—',
        ['Purchases', 'Payment'].includes(t.type) ? `INR ${Number(t.totalAmount).toLocaleString()}` : '—'
      ]);

      autoTable(doc, {
        startY: 68,
        head: [['Date', 'Vch No', 'Vch type', 'Particulars', 'Narration', 'Debit (Inflow)', 'Credit (Outflow)']],
        body: tableRows,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] },
        styles: { fontSize: 8, cellPadding: 3 },
        foot: [[
          'Total',
          '',
          '',
          `${stats.count} Transacted Items`,
          '',
          `INR ${stats.inflow.toLocaleString()}`,
          `INR ${stats.outflow.toLocaleString()}`
        ]],
        footStyles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], fontStyle: 'bold' }
      });

      doc.save(`DayBook_${reportPeriod.startDate}_to_${reportPeriod.endDate}.pdf`);
    } catch (err) {
      console.error(err);
      alert("Error printing Day Book journal report");
    }
  };

  const setFastDate = (daysAgo: number) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const dateStr = date.toISOString().split('T')[0];
    setReportPeriod({ startDate: dateStr, endDate: dateStr });
  };

  return (
    <div className="space-y-6">
      {/* Search and control bar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between bg-white p-5 rounded-xl border border-slate-100 shadow-sm gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Day Book Journal</h3>
            <p className="text-[10px] text-slate-400 font-medium tracking-wide prose uppercase">Chronological record of daily operations</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Fast Date Presets */}
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 gap-1 text-[10px] font-bold">
            <button 
              onClick={() => setFastDate(0)} 
              className="px-2.5 py-1 rounded bg-white text-slate-800 shadow-xs hover:bg-slate-50 border border-slate-200/50"
            >
              Today
            </button>
            <button 
              onClick={() => setFastDate(1)} 
              className="px-2.5 py-1 rounded bg-white text-slate-800 shadow-xs hover:bg-slate-50 border border-slate-200/50"
            >
              Yesterday
            </button>
          </div>

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

          <button onClick={exportPDF} className="btn-secondary text-xs font-semibold py-2">
            <Download size={14} /> Export PDF
          </button>
        </div>
      </div>

      {/* Stats Summary Panel */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Entries In Period</span>
            <p className="text-xl font-black text-indigo-600">{stats.count}</p>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg">
            <Clock size={20} />
          </div>
        </div>

        <div className="bg-emerald-50/50 border border-emerald-100/60 p-4 rounded-xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600/80">Total Inflow (Dr)</span>
            <p className="text-xl font-black text-emerald-600">₹{stats.inflow.toLocaleString()}</p>
          </div>
          <div className="p-3 bg-emerald-100/70 text-emerald-600 rounded-lg">
            <TrendingUp size={20} />
          </div>
        </div>

        <div className="bg-rose-50/50 border border-rose-100/60 p-4 rounded-xl shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600/80">Total Outflow (Cr)</span>
            <p className="text-xl font-black text-rose-600">₹{stats.outflow.toLocaleString()}</p>
          </div>
          <div className="p-3 bg-rose-100/70 text-rose-600 rounded-lg">
            <TrendingDown size={20} />
          </div>
        </div>
      </div>

      {/* Search Filters bar within reports list */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-xs">
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            placeholder="Search date, vch, party, narration..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter size={14} className="text-slate-400" />
          <select 
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg py-1.5 px-3 bg-white font-semibold text-slate-600 outline-none focus:ring-1 focus:ring-indigo-500 flex-1 sm:flex-none"
          >
            <option value="All">All Voucher Types</option>
            <option value="Sales">Sales</option>
            <option value="Purchases">Purchases</option>
            <option value="Receipt">Receipt</option>
            <option value="Payment">Payment</option>
            <option value="Contra">Contra</option>
            <option value="Journal">Journal</option>
            <option value="Credit Note">Credit Note</option>
            <option value="Debit Note">Debit Note</option>
          </select>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-slate-500">
                <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider">Date</th>
                <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider">Vch No</th>
                <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider">Type</th>
                <th className="px-6 py-4 text-[11px] font-bold uppercase tracking-wider">Particulars & Narration</th>
                <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-wider">Inflow Debit (₹)</th>
                <th className="px-6 py-4 text-right text-[11px] font-bold uppercase tracking-wider">Outflow Credit (₹)</th>
                <th className="px-6 py-4 text-center text-[11px] font-bold uppercase tracking-wider print:hidden">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTx.map((t: any) => {
                const isInflow = ['Sales', 'Receipt'].includes(t.type);
                const isOutflow = ['Purchases', 'Payment'].includes(t.type);
                const isContra = t.type === 'Contra';
                const isContraDeposit = isContra && t.isDeposit;

                return (
                  <tr key={t.id} className="hover:bg-slate-50/50 group transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-slate-600">
                      {new Date(t.date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm font-semibold text-slate-800 font-mono">
                      {t.voucherNumber || '—'}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[9px] font-bold border rounded-md px-2 py-0.5 tracking-wide ${getVchColor(t.type)}`}>
                        {getVchLabel(t.type)}
                      </span>
                    </td>
                    <td className="px-6 py-4 max-w-sm">
                      <div className="text-sm font-semibold text-slate-800">{t.partyName || 'Multi-accounts details'}</div>
                      <div className="text-[10px] text-indigo-600 font-bold mb-1">{t.bankName || t.cashAccountName || ''}</div>
                      {t.narration && (
                        <p className="text-[10px] text-slate-500 italic leading-snug break-words max-w-xs bg-slate-50 p-1.5 border border-slate-100/80 rounded mt-1">
                          {t.narration}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-emerald-600">
                      {isInflow ? `₹${Number(t.totalAmount).toLocaleString()}` : isContra && !isContraDeposit ? `₹${Number(t.totalAmount).toLocaleString()}` : '—'}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-bold text-red-600">
                      {isOutflow ? `₹${Number(t.totalAmount).toLocaleString()}` : isContra && isContraDeposit ? `₹${Number(t.totalAmount).toLocaleString()}` : '—'}
                    </td>
                    <td className="px-6 py-4 text-center print:hidden">
                      <div className="flex items-center justify-center gap-2">
                        <button 
                          onClick={() => onEditTransaction?.(t)}
                          className="p-1 hover:bg-indigo-50 hover:text-indigo-600 text-slate-400 rounded transition-colors"
                          title="Edit transaction"
                        >
                          <Pencil size={15} />
                        </button>
                        
                        {confirmDeleteId === t.id ? (
                          <div className="flex items-center gap-1 bg-red-50 py-0.5 px-1 rounded-md border border-red-200">
                            <button
                              onClick={async () => {
                                try {
                                  await dbService.deleteTransactionWithStock(company.id, t.id);
                                  setConfirmDeleteId(null);
                                } catch (err) {
                                  alert("Failed to delete Day Book entry: " + (err instanceof Error ? err.message : String(err)));
                                }
                              }}
                              className="bg-red-600 hover:bg-red-700 text-white text-[9px] font-extrabold px-2 py-1 rounded"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 text-[9px] font-semibold px-2 py-1 rounded"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button 
                            onClick={() => setConfirmDeleteId(t.id)}
                            className="p-1 hover:bg-rose-50 hover:text-rose-600 text-slate-400 rounded transition-colors"
                            title="Delete transaction"
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
                  <td colSpan={7} className="py-12 text-center text-slate-400 italic text-sm">
                    No transactions recorded on this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
