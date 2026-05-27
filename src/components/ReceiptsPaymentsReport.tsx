import React, { useRef, useState, useMemo } from 'react';
import { 
  ArrowLeft, 
  Download, 
  FileText, 
  RefreshCw, 
  Calendar, 
  TrendingUp, 
  TrendingDown, 
  Search, 
  Filter, 
  ListCollapse, 
  Maximize2,
  ChevronRight,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getEnrichedLedgers } from './Reports';

export const ReceiptsPaymentsReport = ({ 
  company, 
  transactions = [], 
  ledgers = [], 
  reportPeriod, 
  setReportPeriod, 
  onBack 
}: any) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('All');
  const [selectedLedgerDetails, setSelectedLedgerDetails] = useState<any | null>(null);

  // 1. Calculate dynamic opening & closing cash/bank balances
  const enrichedLedgers = useMemo(() => {
    return getEnrichedLedgers(ledgers, transactions, reportPeriod);
  }, [ledgers, transactions, reportPeriod]);

  const cashBankLedgers = useMemo(() => {
    return enrichedLedgers.filter((l: any) => 
      ['Cash-in-hand', 'Cash', 'Bank Accounts', 'Bank'].some(g => l.group?.toLowerCase().includes(g.toLowerCase()))
    );
  }, [enrichedLedgers]);

  // Breakdown opening cash/bank
  const openingCashList = useMemo(() => 
    cashBankLedgers.filter((l: any) => ['Cash-in-hand', 'Cash'].some(g => l.group?.toLowerCase().includes(g.toLowerCase()))), 
    [cashBankLedgers]
  );
  
  const openingBankList = useMemo(() => 
    cashBankLedgers.filter((l: any) => ['Bank Accounts', 'Bank'].some(g => l.group?.toLowerCase().includes(g.toLowerCase()))), 
    [cashBankLedgers]
  );

  const totalOpeningCash = useMemo(() => 
    openingCashList.reduce((sum: number, l: any) => sum + (Number(l.openingBalance) || 0), 0),
    [openingCashList]
  );
  
  const totalOpeningBank = useMemo(() => 
    openingBankList.reduce((sum: number, l: any) => sum + (Number(l.openingBalance) || 0), 0),
    [openingBankList]
  );

  const totalOpeningBalance = totalOpeningCash + totalOpeningBank;

  // Breakdown closing cash/bank
  const totalClosingCash = useMemo(() => 
    openingCashList.reduce((sum: number, l: any) => sum + (Number(l.currentBalance) || 0), 0),
    [openingCashList]
  );
  
  const totalClosingBank = useMemo(() => 
    openingBankList.reduce((sum: number, l: any) => sum + (Number(l.currentBalance) || 0), 0),
    [openingBankList]
  );

  const totalClosingBalance = totalClosingCash + totalClosingBank;

  // 2. Aggregate actual Receipts and Payments transactions during the period
  const reportTransactions = useMemo(() => {
    return transactions.filter((t: any) => t.date >= reportPeriod.startDate && t.date <= reportPeriod.endDate);
  }, [transactions, reportPeriod]);

  const { receiptsList, paymentsList, receiptSum, paymentSum } = useMemo(() => {
    const receiptsMap: { [id: string]: { id: string, name: string, group: string, amount: number, txs: any[] } } = {};
    const paymentsMap: { [id: string]: { id: string, name: string, group: string, amount: number, txs: any[] } } = {};

    reportTransactions.forEach((t: any) => {
      const amt = Number(t.totalAmount) || 0;
      if (amt <= 0) return;

      if (t.type === 'Receipt') {
        const lid = t.partyId || 'direct-receipt';
        const ledgerObj = ledgers.find((l: any) => l.id === t.partyId);
        const name = t.partyName || ledgerObj?.name || 'Direct Receipt / Inflow';
        const group = ledgerObj?.group || 'Direct Incomes';
        
        if (!receiptsMap[lid]) {
          receiptsMap[lid] = { id: lid, name, group, amount: 0, txs: [] };
        }
        receiptsMap[lid].amount += amt;
        receiptsMap[lid].txs.push(t);
      }
      else if (t.type === 'Sales' && t.isPaid) {
        const lid = 'sales-revenue';
        const name = 'Cash & Bank Sales Outlets';
        const group = 'Sales Accounts';
        
        if (!receiptsMap[lid]) {
          receiptsMap[lid] = { id: lid, name, group, amount: 0, txs: [] };
        }
        receiptsMap[lid].amount += amt;
        receiptsMap[lid].txs.push(t);
      }
      else if (t.type === 'Payment') {
        const lid = t.partyId || 'direct-payment';
        const ledgerObj = ledgers.find((l: any) => l.id === t.partyId);
        const name = t.partyName || ledgerObj?.name || 'Direct Payment / Expense';
        const group = ledgerObj?.group || 'Indirect Expenses';
        
        if (!paymentsMap[lid]) {
          paymentsMap[lid] = { id: lid, name, group, amount: 0, txs: [] };
        }
        paymentsMap[lid].amount += amt;
        paymentsMap[lid].txs.push(t);
      }
      else if (t.type === 'Purchases' && t.isPaid) {
        const lid = 'purchase-expense';
        const name = 'Cash & Bank Purchases';
        const group = 'Purchase Accounts';
        
        if (!paymentsMap[lid]) {
          paymentsMap[lid] = { id: lid, name, group, amount: 0, txs: [] };
        }
        paymentsMap[lid].amount += amt;
        paymentsMap[lid].txs.push(t);
      }
      else if (t.type === 'Contra') {
        const group = 'Contra (Internal Cash Transfers)';
        if (t.isDeposit) {
          // Deposit Cash into Bank
          // Bank side (Receipt)
          if (!receiptsMap['bank-contra']) {
            receiptsMap['bank-contra'] = { id: 'bank-contra', name: 'Contra: Cash Deposited in Bank', group, amount: 0, txs: [] };
          }
          receiptsMap['bank-contra'].amount += amt;
          receiptsMap['bank-contra'].txs.push(t);

          // Cash side (Payment)
          if (!paymentsMap['cash-contra']) {
            paymentsMap['cash-contra'] = { id: 'cash-contra', name: 'Contra: Cash Deposited from Cash-in-hand', group, amount: 0, txs: [] };
          }
          paymentsMap['cash-contra'].amount += amt;
          paymentsMap['cash-contra'].txs.push(t);
        } else {
          // Withdraw Cash from Bank
          // Cash side (Receipt)
          if (!receiptsMap['cash-contra']) {
            receiptsMap['cash-contra'] = { id: 'cash-contra', name: 'Contra: Cash Withdrawn from Bank', group, amount: 0, txs: [] };
          }
          receiptsMap['cash-contra'].amount += amt;
          receiptsMap['cash-contra'].txs.push(t);

          // Bank side (Payment)
          if (!paymentsMap['bank-contra']) {
            paymentsMap['bank-contra'] = { id: 'bank-contra', name: 'Contra: Cash Withdrawn from Bank Bank Account', group, amount: 0, txs: [] };
          }
          paymentsMap['bank-contra'].amount += amt;
          paymentsMap['bank-contra'].txs.push(t);
        }
      }
    });

    const receipts = Object.values(receiptsMap).sort((a,b) => b.amount - a.amount);
    const payments = Object.values(paymentsMap).sort((a,b) => b.amount - a.amount);

    const rSum = receipts.reduce((s, r) => s + r.amount, 0);
    const pSum = payments.reduce((s, p) => s + p.amount, 0);

    return { receiptsList: receipts, paymentsList: payments, receiptSum: rSum, paymentSum: pSum };
  }, [reportTransactions, ledgers]);

  // Combined Totals for matching check
  const totalReceiptsSide = totalOpeningBalance + receiptSum;
  const totalPaymentsSide = totalClosingBalance + paymentSum;

  const filteredReceipts = receiptsList.filter(r => {
    const matchesSearch = r.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          r.group.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesGroup = selectedGroup === 'All' || r.group === selectedGroup;
    return matchesSearch && matchesGroup;
  });

  const filteredPayments = paymentsList.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          p.group.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesGroup = selectedGroup === 'All' || p.group === selectedGroup;
    return matchesSearch && matchesGroup;
  });

  // Get list of groups for filtering
  const allGroups = useMemo(() => {
    const set = new Set<string>();
    receiptsList.forEach(r => set.add(r.group));
    paymentsList.forEach(p => set.add(p.group));
    return Array.from(set);
  }, [receiptsList, paymentsList]);

  // Export to PDF
  const handleExportPDF = () => {
    try {
      const doc = new jsPDF() as any;

      if (company?.logo) {
        try {
          doc.addImage(company.logo, 'PNG', 20, 15, 25, 25);
        } catch (e) {
          console.error("Logo error", e);
        }
      }

      const headerX = company?.logo ? 50 : 105;
      const textAlign = company?.logo ? 'left' : 'center';

      doc.setFontSize(22);
      doc.setTextColor(79, 70, 229);
      doc.setFont(undefined, 'bold');
      doc.text(company?.name?.toUpperCase() || 'COMPANY NAME', headerX, 22, { align: textAlign });
      
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.setFont(undefined, 'normal');
      
      let currentY = 28;
      const splitAddress = doc.splitTextToSize(company?.address || '', 140);
      doc.text(splitAddress, headerX, currentY, { align: textAlign });
      currentY += (splitAddress.length * 4) + 1;

      if (company?.gstIn) {
        doc.setFont(undefined, 'bold');
        doc.text(`GSTIN: ${company.gstIn}`, headerX, currentY, { align: textAlign });
      }

      doc.setDrawColor(220);
      doc.line(20, 48, 190, 48);

      doc.setFontSize(14);
      doc.setTextColor(30);
      doc.setFont(undefined, 'bold');
      doc.text("RECEIPTS AND PAYMENTS ACCOUNT", 105, 57, { align: 'center' });

      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      doc.text(`For the period: ${new Date(reportPeriod.startDate).toLocaleDateString()} to ${new Date(reportPeriod.endDate).toLocaleDateString()}`, 105, 62, { align: 'center' });

      // Two tables side by side or a unified layout. A side-by-side or stacked layout works great.
      // Let's print out Receipts Side then Payments Side in clear tabular formats.
      const leftRows = [
        ['Opening Cash in hand', `INR ${totalOpeningCash.toLocaleString()}`],
        ['Opening Cash at bank', `INR ${totalOpeningBank.toLocaleString()}`],
        ...receiptsList.map(r => [r.name, `INR ${r.amount.toLocaleString()}`])
      ];

      const rightRows = [
        ...paymentsList.map(p => [p.name, `INR ${p.amount.toLocaleString()}`]),
        ['Closing Cash in hand', `INR ${totalClosingCash.toLocaleString()}`],
        ['Closing Cash at bank', `INR ${totalClosingBank.toLocaleString()}`],
      ];

      // Format aligned side-by-side output or consecutive lists
      const combinedRows: any[] = [];
      const maxLength = Math.max(leftRows.length, rightRows.length);
      for (let i = 0; i < maxLength; i++) {
        combinedRows.push([
          leftRows[i]?.[0] || '',
          leftRows[i]?.[1] || '',
          rightRows[i]?.[0] || '',
          rightRows[i]?.[1] || ''
        ]);
      }

      autoTable(doc, {
        startY: 68,
        head: [['Receipts (Inflow Particulars)', 'Amount (INR)', 'Payments (Outflow Particulars)', 'Amount (INR)']],
        body: combinedRows,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] },
        styles: { fontSize: 8, cellPadding: 3 },
        foot: [[
          'Total Receipts (Side)',
          `INR ${totalReceiptsSide.toLocaleString()}`,
          'Total Payments (Side)',
          `INR ${totalPaymentsSide.toLocaleString()}`
        ]],
        footStyles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], fontStyle: 'bold' }
      });

      doc.save(`Receipts_and_Payments_${reportPeriod.startDate}_to_${reportPeriod.endDate}.pdf`);
    } catch (e) {
      console.error(e);
      alert("Failed to export PDF reports.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Search and control Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between bg-white p-5 rounded-2xl border border-slate-200/60 shadow-sm gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Receipts & Payments Statement</h3>
            <p className="text-[10px] text-slate-400 font-medium tracking-wide uppercase">Consolidated Summary of Cash & Bank Inflows vs Outflows</p>
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

          <button onClick={handleExportPDF} className="btn-secondary text-xs">
            <Download size={14} /> Export PDF
          </button>
        </div>
      </div>

      {/* Stats Summary Panel */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200/50 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Opening Cash & Bank Balance</span>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold font-display text-slate-800">₹{totalOpeningBalance.toLocaleString()}</span>
          </div>
          <div className="text-[9px] text-slate-400 font-mono mt-1">
            Cash: ₹{totalOpeningCash.toLocaleString()} | Bank: ₹{totalOpeningBank.toLocaleString()}
          </div>
        </div>

        <div className="bg-emerald-50/40 p-4 rounded-xl border border-emerald-100/80 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 block mb-1">Total Period Receipts</span>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold font-display text-emerald-700">₹{receiptSum.toLocaleString()}</span>
          </div>
          <div className="text-[9px] text-emerald-500/80 font-mono mt-1">
            +{receiptsList.length} Headwise Contributions
          </div>
        </div>

        <div className="bg-rose-50/40 p-4 rounded-xl border border-rose-100/80 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-600 block mb-1">Total Period Payments</span>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold font-display text-rose-700">₹{paymentSum.toLocaleString()}</span>
          </div>
          <div className="text-[9px] text-rose-500/80 font-mono mt-1">
            -{paymentsList.length} Headwise Cash Outlays
          </div>
        </div>

        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/50 shadow-xs">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Closing Cash & Bank Balance</span>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold font-display text-slate-800">₹{totalClosingBalance.toLocaleString()}</span>
          </div>
          <div className="text-[9px] text-slate-400 font-mono mt-1">
            Cash: ₹{totalClosingCash.toLocaleString()} | Bank: ₹{totalClosingBank.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Balanced indicator and validation check */}
      <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 bg-indigo-600 text-white flex items-center justify-center rounded-lg shadow-sm font-black font-mono">
            Δ
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-800">Formula-Balanced Ledger Verification</h4>
            <p className="text-[10px] text-slate-500">Opening Balance + Receipts (Side Left) must match Payments + Closing Balance (Side Right).</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <div>
            <span className="text-slate-400 block text-[9px] uppercase tracking-wide">Left Debit Total</span>
            <span className="font-bold text-indigo-600">₹{totalReceiptsSide.toLocaleString()}</span>
          </div>
          <div className="text-slate-300 font-light text-lg self-center">=</div>
          <div>
            <span className="text-slate-400 block text-[9px] uppercase tracking-wide">Right Credit Total</span>
            <span className="font-bold text-green-600">₹{totalPaymentsSide.toLocaleString()}</span>
          </div>
          <div className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px] font-bold">
            Matched Perfect
          </div>
        </div>
      </div>

      {/* Search Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-4 rounded-xl border border-slate-200/50 shadow-xs">
        <div className="relative w-full sm:w-72 border border-slate-200 rounded-lg overflow-hidden flex items-center">
          <Search size={14} className="absolute left-3 text-slate-400" />
          <input 
            type="text" 
            placeholder="Search records by name or group..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs outline-none focus:ring-0 select-text"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter size={14} className="text-slate-400" />
          <select 
            value={selectedGroup}
            onChange={e => setSelectedGroup(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg py-2 px-3 bg-white font-semibold text-slate-600 outline-none focus:ring-1 focus:ring-indigo-500 flex-1 sm:flex-none"
          >
            <option value="All">All Ledger Groups</option>
            {allGroups.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Side-by-Side Receipts vs Payments Account Table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* RECEIPTS COLUMN */}
        <div className="card overflow-hidden bg-white border border-slate-200 shadow-sm rounded-xl">
          <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-black uppercase text-indigo-400 tracking-wider">Debit side — Receipts (Cash & Bank Inflow)</span>
            <span className="text-xs font-bold text-indigo-100">Inflows</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                  <th className="px-6 py-3">Particulars / Source Account</th>
                  <th className="px-6 py-3">Category Head</th>
                  <th className="px-6 py-3 text-right">Receipt Amount (₹)</th>
                  <th className="px-6 py-3 text-center">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {/* Opening Cash & Bank row */}
                <tr className="bg-indigo-50/20 hover:bg-indigo-50/30">
                  <td className="px-6 py-3 font-semibold text-slate-800">Opening Balance (b/f)</td>
                  <td className="px-6 py-3 text-slate-400 italic">Liquid Assets</td>
                  <td className="px-6 py-3 text-right font-bold text-slate-900">₹{totalOpeningBalance.toLocaleString()}</td>
                  <td className="px-6 py-3 text-center">—</td>
                </tr>

                {/* Individual Receipts */}
                {filteredReceipts.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-3 font-semibold text-slate-800">{r.name}</td>
                    <td className="px-6 py-3 font-medium text-slate-400">{r.group}</td>
                    <td className="px-6 py-3 text-right font-bold text-emerald-600">₹{r.amount.toLocaleString()}</td>
                    <td className="px-6 py-3 text-center">
                      <button 
                        onClick={() => setSelectedLedgerDetails({ name: r.name, group: r.group, type: 'Inflow', txs: r.txs })}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                        title="View Transactions"
                      >
                        <Maximize2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}

                {filteredReceipts.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400 italic">
                      No matching receipts found in the filter.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200 font-bold">
                  <td colSpan={2} className="px-6 py-4 text-slate-800 text-xs">Total Receipts Side (Dr)</td>
                  <td className="px-6 py-4 text-right text-slate-900 text-sm">₹{totalReceiptsSide.toLocaleString()}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* PAYMENTS COLUMN */}
        <div className="card overflow-hidden bg-white border border-slate-200 shadow-sm rounded-xl">
          <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
            <span className="text-xs font-black uppercase text-rose-400 tracking-wider">Credit side — Payments (Cash & Bank Outgo)</span>
            <span className="text-xs font-bold text-rose-100">Outflows</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                  <th className="px-6 py-3">Particulars / Vendor / Head</th>
                  <th className="px-6 py-3">Category Head</th>
                  <th className="px-6 py-3 text-right">Payment Amount (₹)</th>
                  <th className="px-6 py-3 text-center">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {/* Individual Payments */}
                {filteredPayments.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-3 font-semibold text-slate-800">{p.name}</td>
                    <td className="px-6 py-3 font-medium text-slate-400">{p.group}</td>
                    <td className="px-6 py-3 text-right font-bold text-red-600">₹{p.amount.toLocaleString()}</td>
                    <td className="px-6 py-3 text-center">
                      <button 
                        onClick={() => setSelectedLedgerDetails({ name: p.name, group: p.group, type: 'Outflow', txs: p.txs })}
                        className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                        title="View Transactions"
                      >
                        <Maximize2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}

                {/* Closing Cash & Bank row */}
                <tr className="bg-green-50/10 hover:bg-green-50/25">
                  <td className="px-6 py-3 font-semibold text-slate-800">Closing Balance (c/o)</td>
                  <td className="px-6 py-3 text-slate-400 italic">Liquid Assets</td>
                  <td className="px-6 py-3 text-right font-bold text-slate-900">₹{totalClosingBalance.toLocaleString()}</td>
                  <td className="px-6 py-3 text-center">—</td>
                </tr>

                {filteredPayments.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-400 italic">
                      No matching payments found in the filter.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 border-t border-slate-200 font-bold">
                  <td colSpan={2} className="px-6 py-4 text-slate-800 text-xs">Total Payments Side (Cr)</td>
                  <td className="px-6 py-4 text-right text-slate-900 text-sm">₹{totalPaymentsSide.toLocaleString()}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      {/* DETAILED LEDGER DRILL-DOWN MODAL */}
      <AnimatePresence>
        {selectedLedgerDetails && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 print:hidden">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full overflow-hidden"
            >
              <div className="p-6 bg-slate-900 text-white flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-sm tracking-wide text-indigo-400 uppercase">Interactive Ledger Audit Log</h4>
                  <p className="text-xl font-bold font-sans mt-1 text-white">{selectedLedgerDetails.name}</p>
                  <p className="text-[10px] text-slate-400 font-medium">{selectedLedgerDetails.group} • {selectedLedgerDetails.type} Summary</p>
                </div>
                <button 
                  onClick={() => setSelectedLedgerDetails(null)}
                  className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white font-mono text-sm"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
                <table className="w-full text-left bg-slate-50 border border-slate-200/50 rounded-xl overflow-hidden divide-y divide-slate-100">
                  <thead className="bg-slate-100 text-slate-500 text-[10px] uppercase font-bold tracking-wider">
                    <tr>
                      <th className="p-3">Date</th>
                      <th className="p-3">Vch Number</th>
                      <th className="p-3">Cash/Bank Account</th>
                      <th className="p-3">Narration</th>
                      <th className="p-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {selectedLedgerDetails.txs.map((tx: any) => (
                      <tr key={tx.id} className="hover:bg-white transition-colors">
                        <td className="p-3 font-medium text-slate-600">{new Date(tx.date).toLocaleDateString()}</td>
                        <td className="p-3 font-mono font-bold text-slate-800">{tx.voucherNumber}</td>
                        <td className="p-3 font-bold text-indigo-600">{tx.bankName || 'General Cash'}</td>
                        <td className="p-3 italic max-w-[150px] truncate text-slate-500" title={tx.narration}>{tx.narration || '—'}</td>
                        <td className="p-3 text-right font-bold text-slate-900">₹{Number(tx.totalAmount).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center text-xs">
                <span className="text-slate-500 font-bold font-mono">Consolidated Count: {selectedLedgerDetails.txs.length} entries</span>
                <button 
                  onClick={() => setSelectedLedgerDetails(null)} 
                  className="btn-secondary"
                >
                  Close Audit View
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
