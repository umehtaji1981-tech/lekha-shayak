import React, { useRef, useState, useMemo } from 'react';
import { ArrowLeft, Download, FileText, RefreshCw, Search, ChevronDown, ChevronRight, Eye, Printer, Filter } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getDynamicStockValueForPeriod } from '../lib/stock-utils';

// Helper to determine primary Trial Balance group
const getPrimaryGroup = (groupName: string) => {
  const g = (groupName || '').toLowerCase();
  if (g.includes('capital') || g === 'share capital' || g === 'reserves & surplus') return 'Capital Account';
  if (g.includes('loan') || g.includes('borrowing') || g.includes('secured') || g.includes('unsecured') || g.includes('burhani qardan')) return 'Loans (Liability)';
  if (g.includes('creditor') || g.includes('tax') || g.includes('provision') || g.includes('duty') || g.includes('current liabilit')) return 'Current Liabilities';
  if (g.includes('fixed asset') || g.includes('property') || g.includes('equipment') || g.includes('furniture') || g.includes('vehicle') || g.includes('machinery') || g.includes('block')) return 'Fixed Assets';
  if (g.includes('investment')) return 'Investments';
  if (g.includes('debtor') || g.includes('bank') || g.includes('cash') || g.includes('stock') || g.includes('inventory') || g.includes('current asset') || g.includes('advance') || g.includes('deposit')) return 'Current Assets';
  if (g.includes('sales')) return 'Sales Accounts';
  if (g.includes('purchase')) return 'Purchase Accounts';
  if (g.includes('direct income') || g.includes('operating income') || g.includes('revenue') || g.includes('off')) return 'Direct Incomes';
  if (g.includes('indirect income') || g.includes('other income') || g === 'discount received' || g === 'interest received') return 'Indirect Incomes';
  if (g.includes('direct expense')) return 'Direct Expenses';
  if (g.includes('indirect expense') || g.includes('office') || g.includes('admin') || g.includes('selling') || g.includes('finance') || g.includes('marketing') || g === 'bank charge' || g === 'rent' || g === 'salary' || g === 'printing' || g.includes('charges')) return 'Indirect Expenses';
  
  return groupName || 'Other Accounts';
};

export const TrialBalanceReport = ({ company, ledgers = [], transactions = [], allTransactions, items = [], reportPeriod, setReportPeriod, onBack }: any) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDetailed, setIsDetailed] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'Capital Account': true,
    'Loans (Liability)': true,
    'Current Liabilities': true,
    'Fixed Assets': true,
    'Investments': true,
    'Current Assets': true,
    'Sales Accounts': true,
    'Purchase Accounts': true,
    'Direct Incomes': true,
    'Indirect Expenses': true,
  });

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  const toggleAll = (expand: boolean) => {
    const next: Record<string, boolean> = {};
    trialBalanceData.forEach(g => {
      next[g.groupName] = expand;
    });
  	setExpandedGroups(next);
  };

  // 1. Precise Ledger Enrichment with Period Calculations
  const trialBalanceData = useMemo(() => {
    // Dynamic stock calculation for Trial Balance
    const { totalOpeningStockValue, totalClosingStockValue } = getDynamicStockValueForPeriod(
      items,
      (allTransactions && allTransactions.length > 0) ? allTransactions : transactions,
      reportPeriod,
      company
    );
    const closingStockValue = totalClosingStockValue;
    const itemsOpeningStockValue = totalOpeningStockValue;

    // Enrich or add Opening and Closing stock ledgers properly to prevent double-counting
    let enrichedLedgers = [...ledgers];
    
    // Find any existing stock-in-hand/stock ledgers
    const stockLedgerIndices: number[] = [];
    enrichedLedgers.forEach((l, idx) => {
      const g = l.group || '';
      const name = l.name.toLowerCase();
      if (
        g.toLowerCase().includes('stock-in-hand') || 
        g.toLowerCase() === 'stock in hand' || 
        name.includes('opening stock') || 
        name.includes('closing stock') || 
        name.includes('stock in hand')
      ) {
        stockLedgerIndices.push(idx);
      }
    });

    if (stockLedgerIndices.length > 0) {
      // Overwrite the first found stock ledger with our dynamic values
      const mainIdx = stockLedgerIndices[0];
      enrichedLedgers[mainIdx] = {
        ...enrichedLedgers[mainIdx],
        openingBalance: itemsOpeningStockValue,
        currentBalance: closingStockValue
      };
      
      // Zero out any other duplicate stock-in-hand ledgers to avoid double counting
      for (let i = 1; i < stockLedgerIndices.length; i++) {
        const dupIdx = stockLedgerIndices[i];
        enrichedLedgers[dupIdx] = {
          ...enrichedLedgers[dupIdx],
          openingBalance: 0,
          currentBalance: 0
        };
      }
    } else if (itemsOpeningStockValue > 0 || closingStockValue > 0) {
      // Fallback: create a single virtual stock ledger
      enrichedLedgers.push({
        id: 'virtual-stock-in-hand',
        name: 'Stock in Hand',
        group: 'Stock-in-hand',
        openingBalance: itemsOpeningStockValue,
        currentBalance: closingStockValue
      });
    }

    // Process each ledger to find periodic Opening, Dr/Cr Transactions, and Closing
    const processed = enrichedLedgers.map((l: any) => {
      const group = l.group || '';
      const isNominal = [
        'Sales Accounts', 'Purchase Accounts', 
        'Direct Expenses', 'Indirect Expenses', 
        'Direct Incomes', 'Indirect Incomes',
        'Direct Income', 'Indirect Income', 'Sales Account', 'Purchase Account'
      ].some(g => group.includes(g));

      let totalImpactBeforePeriod = 0;
      let periodDr = 0;
      let periodCr = 0;

      transactions.forEach((t: any) => {
        let impact = 0;
        let isDrTx = false;
        let isCrTx = false;
        const txAmount = Number(t.totalAmount || t.amount || 0);

        if (t.partyId === l.id && txAmount) {
          const isImmediatePayment = t.isPaid && t.bankId && ['Sales', 'Purchases'].includes(t.type);
          if (!isImmediatePayment) {
            const multiplier = ['Sales', 'Payment'].includes(t.type) ? 1 : -1;
            impact = txAmount * multiplier;
            if (impact > 0) isDrTx = true; else isCrTx = true;
          }
        }
        if (t.bankId === l.id && txAmount) {
          const bankMultiplier = ['Sales', 'Receipt'].includes(t.type) ? 1 : -1;
          impact = txAmount * bankMultiplier;
          if (impact > 0) isDrTx = true; else isCrTx = true;
        }
        if (t.debitLedgerId === l.id && txAmount) {
          impact = txAmount;
          isDrTx = true;
        }
        if (t.creditLedgerId === l.id && txAmount) {
          impact = -txAmount;
          isCrTx = true;
        }

        // Duties & Taxes special CGST/SGST/IGST mapping
        if (l.group === 'Duties & Taxes') {
          if (l.name === 'CGST' && (t.cgst || t.cgstAmount)) {
            const val = Number(t.cgst || t.cgstAmount || 0);
            if (t.type === 'Sales') { impact = -val; isCrTx = true; }
            if (t.type === 'Purchases') { impact = val; isDrTx = true; }
          } else if (l.name === 'SGST' && (t.sgst || t.sgstAmount)) {
            const val = Number(t.sgst || t.sgstAmount || 0);
            if (t.type === 'Sales') { impact = -val; isCrTx = true; }
            if (t.type === 'Purchases') { impact = val; isDrTx = true; }
          } else if (l.name === 'IGST' && (t.igst || t.igstAmount)) {
            const val = Number(t.igst || t.igstAmount || 0);
            if (t.type === 'Sales') { impact = -val; isCrTx = true; }
            if (t.type === 'Purchases') { impact = val; isDrTx = true; }
          }
        }

        // Chronological segmentation
        if (t.date < reportPeriod.startDate) {
          totalImpactBeforePeriod += impact;
        } else if (t.date <= reportPeriod.endDate) {
          if (isDrTx) periodDr += Math.abs(impact);
          if (isCrTx) periodCr += Math.abs(impact);
        }
      });

      // Compute opening balance
      let openingVal = Number(l.openingBalance || l.opening || 0);

      if (isNominal) {
        // Reset nominals if starting exactly at fiscal year boundary
        if (reportPeriod.startDate.endsWith('-04-01')) {
          openingVal = 0;
        }
      }

      // Closing balance
      let closingVal = openingVal + periodDr - periodCr;
      const g = l.group || '';
      const name = l.name.toLowerCase();
      const isStockInHand = g.toLowerCase().includes('stock-in-hand') || 
                            g.toLowerCase() === 'stock in hand' || 
                            l.id.includes('stock') || 
                            name.includes('stock');
      if (isStockInHand) {
        closingVal = Number(l.currentBalance || 0);
      }

      return {
        id: l.id,
        name: l.name,
        group: l.group,
        primaryGroup: getPrimaryGroup(l.group),
        opening: openingVal,
        debit: periodDr,
        credit: periodCr,
        closing: closingVal
      };
    });

    // Group the results by Primary Group
    const uniquePrimaryGroups = Array.from(new Set(processed.map(l => l.primaryGroup)));
    
    // Sort groups in typical Balance Sheet/Trial Balance arrangement
    const groupOrder = [
      'Capital Account',
      'Loans (Liability)',
      'Current Liabilities',
      'Fixed Assets',
      'Investments',
      'Current Assets',
      'Sales Accounts',
      'Purchase Accounts',
      'Direct Incomes',
      'Indirect Incomes',
      'Direct Expenses',
      'Indirect Expenses'
    ];

    const sortedPrimaryGroups = uniquePrimaryGroups.sort((a, b) => {
      const idxA = groupOrder.indexOf(a);
      const idxB = groupOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    const groupedData = sortedPrimaryGroups.map(pGroupName => {
      const itemsInGroup = processed.filter(l => l.primaryGroup === pGroupName);
      
      // Accumulate metrics for this group
      let groupOpening = 0;
      let groupDebit = 0;
      let groupCredit = 0;
      let groupClosing = 0;

      itemsInGroup.forEach(it => {
        groupOpening += it.opening;
        groupDebit += it.debit;
        groupCredit += it.credit;
        groupClosing += it.closing;
      });

      return {
        groupName: pGroupName,
        opening: groupOpening,
        debit: groupDebit,
        credit: groupCredit,
        closing: groupClosing,
        ledgers: itemsInGroup
      };
    });

    // Filter by search query if any
    if (searchQuery.trim() !== '') {
      const query = searchQuery.toLowerCase();
      return groupedData.map(group => {
        const filteredLedgers = group.ledgers.filter(l => 
          l.name.toLowerCase().includes(query) || 
          l.group.toLowerCase().includes(query) || 
          group.groupName.toLowerCase().includes(query)
        );
        
        let opening = 0;
        let debit = 0;
        let credit = 0;
        let closing = 0;

        filteredLedgers.forEach(it => {
          opening += it.opening;
          debit += it.debit;
          credit += it.credit;
          closing += it.closing;
        });

        return {
          ...group,
          opening,
          debit,
          credit,
          closing,
          ledgers: filteredLedgers
        };
      }).filter(g => g.ledgers.length > 0);
    }

    return groupedData;
  }, [ledgers, transactions, items, reportPeriod, searchQuery]);

  // Overall Totals for Footer Comparison
  const overallTotals = useMemo(() => {
    let openingDrTot = 0;
    let openingCrTot = 0;
    let transactionsDrTot = 0;
    let transactionsCrTot = 0;
    let closingDrTot = 0;
    let closingCrTot = 0;

    trialBalanceData.forEach(g => {
      g.ledgers.forEach(l => {
        // For Opening Balance: Positive is Debit, Negative is Credit
        if (l.opening >= 0) openingDrTot += l.opening;
        else openingCrTot += Math.abs(l.opening);

        transactionsDrTot += l.debit;
        transactionsCrTot += l.credit;

        // For Closing Balance: Positive is Debit, Negative is Credit
        if (l.closing >= 0) closingDrTot += l.closing;
        else closingCrTot += Math.abs(l.closing);
      });
    });

    return {
      openingDr: openingDrTot,
      openingCr: openingCrTot,
      debit: transactionsDrTot,
      credit: transactionsCrTot,
      closingDr: closingDrTot,
      closingCr: closingCrTot
    };
  }, [trialBalanceData]);

  const diffInTrialBalance = Math.abs(overallTotals.closingDr - overallTotals.closingCr);

  // Download PDF Report with Native autoTable format! Much sharper than canvas.
  const downloadPDF = () => {
    setIsDownloading(true);
    try {
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      // PDF Heading
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(18);
      doc.text(company?.name || 'Goodluck Traders', 14, 15);
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      doc.text(`${company?.address || 'Burhanpur'} | GSTIN: ${company?.gstIn || 'N/A'}`, 14, 21);
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(30, 41, 59);
      doc.text('Trial Balance Statement', 14, 30);
      
      doc.setFont('helvetica', 'medium');
      doc.setFontSize(10);
      doc.text(`Period: ${new Date(reportPeriod.startDate).toLocaleDateString()} to ${new Date(reportPeriod.endDate).toLocaleDateString()}`, 14, 35);

      const headers = [
        ['Particulars (Groups & Ledgers)', 'Opening Balance', 'Debit Transactions', 'Credit Transactions', 'Closing Balance']
      ];

      const rows: any[] = [];

      trialBalanceData.forEach(group => {
        // Group Header row
        const opVal = group.opening >= 0 ? `${Math.round(group.opening).toLocaleString()} Dr` : `${Math.round(Math.abs(group.opening)).toLocaleString()} Cr`;
        const clVal = group.closing >= 0 ? `${Math.round(group.closing).toLocaleString()} Dr` : `${Math.round(Math.abs(group.closing)).toLocaleString()} Cr`;
        
        rows.push([
          { content: group.groupName.toUpperCase(), styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
          { content: opVal, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], halign: 'right' } },
          { content: group.debit > 0 ? Math.round(group.debit).toLocaleString() : '-', styles: { fontStyle: 'bold', fillColor: [241, 245, 249], halign: 'right' } },
          { content: group.credit > 0 ? Math.round(group.credit).toLocaleString() : '-', styles: { fontStyle: 'bold', fillColor: [241, 245, 249], halign: 'right' } },
          { content: clVal, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], halign: 'right' } }
        ]);

        if (isDetailed) {
          group.ledgers.forEach(l => {
            const lop = l.opening >= 0 ? `${Math.round(l.opening).toLocaleString()} Dr` : `${Math.round(Math.abs(l.opening)).toLocaleString()} Cr`;
            const lcl = l.closing >= 0 ? `${Math.round(l.closing).toLocaleString()} Dr` : `${Math.round(Math.abs(l.closing)).toLocaleString()} Cr`;

            rows.push([
              `   ${l.name}`,
              { content: lop, styles: { halign: 'right' } },
              { content: l.debit > 0 ? Math.round(l.debit).toLocaleString() : '-', styles: { halign: 'right' } },
              { content: l.credit > 0 ? Math.round(l.credit).toLocaleString() : '-', styles: { halign: 'right' } },
              { content: lcl, styles: { halign: 'right' } }
            ]);
          });
        }
      });

      // Total row
      const opTotalTxt = `Dr: ${Math.round(overallTotals.openingDr).toLocaleString()}\nCr: ${Math.round(overallTotals.openingCr).toLocaleString()}`;
      const clTotalTxt = `Dr: ${Math.round(overallTotals.closingDr).toLocaleString()}\nCr: ${Math.round(overallTotals.closingCr).toLocaleString()}`;
      
      rows.push([
        { content: 'GRAND TOTAL', styles: { fontStyle: 'bold', fillColor: [15, 23, 42], textColor: [255, 255, 255] } },
        { content: opTotalTxt, styles: { fontStyle: 'bold', fillColor: [15, 23, 42], textColor: [255, 255, 255], halign: 'right' } },
        { content: Math.round(overallTotals.debit).toLocaleString(), styles: { fontStyle: 'bold', fillColor: [15, 23, 42], textColor: [255, 255, 255], halign: 'right' } },
        { content: Math.round(overallTotals.credit).toLocaleString(), styles: { fontStyle: 'bold', fillColor: [15, 23, 42], textColor: [255, 255, 255], halign: 'right' } },
        { content: clTotalTxt, styles: { fontStyle: 'bold', fillColor: [15, 23, 42], textColor: [255, 255, 255], halign: 'right' } }
      ]);

      autoTable(doc, {
        head: headers,
        body: rows,
        startY: 40,
        theme: 'grid',
        styles: {
          fontSize: 8,
          cellPadding: 2
        },
        columnStyles: {
          0: { cellWidth: 80 }
        }
      });

      doc.save(`Trial_Balance_${company?.name || 'Report'}_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (e) {
      console.error(e);
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 print:bg-white print:p-0 print:shadow-none">
      {/* Upper Control Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm print:hidden gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h3 className="font-bold text-slate-900 flex items-center gap-2">
              <FileText className="text-indigo-600" size={18} />
              Trial Balance Sheet
            </h3>
            <p className="text-[10px] text-slate-400 font-medium">Generate double-entry ledgers verifying equity & transaction parity</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Quick Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Search ledger or group..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs w-48 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Date Picker */}
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

          {/* Action buttons */}
          <div className="flex gap-2">
            <button 
              onClick={() => setIsDetailed(!isDetailed)}
              className="btn-secondary text-[11px] font-semibold py-1.5 px-3 flex items-center gap-1.5"
              title="Shortcut: Alt+F1"
            >
              <Filter size={13} />
              {isDetailed ? 'Condensed' : 'Detailed (Alt+F1)'}
            </button>
            <button
              onClick={handlePrint}
              className="btn-secondary text-[11px] font-semibold py-1.5 px-3 flex items-center gap-1.5"
            >
              <Printer size={13} />
              Print
            </button>
            <button 
              onClick={downloadPDF} 
              disabled={isDownloading}
              className="btn-primary text-[11px] font-semibold py-1.5 px-3 flex items-center gap-1.5"
            >
              {isDownloading ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />}
              {isDownloading ? 'Downloading...' : 'Download PDF'}
            </button>
          </div>
        </div>
      </div>

      {/* Trial Balance Main Report Display Sheet */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 md:p-8 print:p-0 print:border-none">
        
        {/* Printable Letterhead */}
        <div className="text-center mb-8 pb-6 border-b border-slate-200 print:block">
          <h1 className="text-2xl font-black uppercase tracking-tight text-slate-900">{company?.name || 'Goodluck Traders'}</h1>
          <p className="text-xs text-slate-500 font-sans tracking-wide mt-1">
            {company?.address || 'Near Rajpura Gate, Burhanpur'}
            {company?.phone && ` | Contact: ${company.phone}`}
            {company?.email && ` | Email: ${company.email}`}
          </p>
          <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col items-center">
            <h2 className="text-lg font-black uppercase tracking-widest text-slate-800">Trial Balance</h2>
            <div className="bg-slate-100 text-slate-800 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider mt-2.5">
              Period: {new Date(reportPeriod.startDate).toLocaleDateString()} to {new Date(reportPeriod.endDate).toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Tally Prime Style Grid Representation */}
        <div className="overflow-x-auto rounded-xl border border-slate-300 font-mono text-xs">
          <table className="w-full text-left min-w-[760px]">
            <thead>
              {/* Outer Headers */}
              <tr className="bg-slate-900 text-white border-b border-slate-800 divide-x divide-slate-800 text-[10px] font-bold uppercase tracking-widest text-center">
                <th rowSpan={2} className="p-3 text-left w-[35%] align-middle">Particulars</th>
                <th colSpan={1} className="p-2 text-center w-[20%] border-b border-slate-800">Opening Balance</th>
                <th colSpan={2} className="p-2 text-center w-[25%] border-b border-slate-800">Transactions</th>
                <th colSpan={1} className="p-2 text-center w-[20%] border-b border-slate-800">Closing Balance</th>
              </tr>
              <tr className="bg-slate-900 text-white divide-x divide-slate-850 text-[9px] font-black uppercase tracking-wide text-center">
                <th className="p-1 px-3 text-right">Debit / Credit</th>
                <th className="p-1 px-3 text-right">Debit</th>
                <th className="p-1 px-3 text-right">Credit</th>
                <th className="p-1 px-3 text-right">Debit / Credit</th>
              </tr>
            </thead>
            
            <tbody className="divide-y divide-slate-200">
              {trialBalanceData.map((group) => {
                const isGroupExpanded = expandedGroups[group.groupName] !== false;
                
                return (
                  <React.Fragment key={group.groupName}>
                    {/* Primary Group Header Row */}
                    <tr className="hover:bg-slate-50 font-bold bg-slate-100/50 text-slate-900 divide-x divide-slate-200">
                      <td className="p-3 pl-4 flex items-center gap-2 cursor-pointer select-none" onClick={() => toggleGroup(group.groupName)}>
                        <button className="text-slate-500 hover:text-slate-950 font-bold print:hidden">
                          {isGroupExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <span className="uppercase tracking-wider font-extrabold">{group.groupName}</span>
                      </td>
                      
                      {/* Opening Balance Sum */}
                      <td className="p-3 text-right font-semibold text-slate-800 text-[11px]">
                        {group.opening >= 0 ? (
                          <span>₹{Math.round(group.opening).toLocaleString()} <span className="text-[9px] font-black text-emerald-600">Dr</span></span>
                        ) : (
                          <span>₹{Math.round(Math.abs(group.opening)).toLocaleString()} <span className="text-[9px] font-black text-rose-600">Cr</span></span>
                        )}
                      </td>

                      {/* Transactions Debit Sum */}
                      <td className="p-3 text-right font-medium text-slate-800 text-[11px]">
                        {group.debit > 0 ? `₹${Math.round(group.debit).toLocaleString()}` : '-'}
                      </td>

                      {/* Transactions Credit Sum */}
                      <td className="p-3 text-right font-medium text-slate-800 text-[11px]">
                        {group.credit > 0 ? `₹${Math.round(group.credit).toLocaleString()}` : '-'}
                      </td>

                      {/* Closing Balance Sum */}
                      <td className="p-3 text-right font-semibold text-slate-900 text-[11px]">
                        {group.closing >= 0 ? (
                          <span>₹{Math.round(group.closing).toLocaleString()} <span className="text-[9px] font-black text-emerald-600">Dr</span></span>
                        ) : (
                          <span>₹{Math.round(Math.abs(group.closing)).toLocaleString()} <span className="text-[9px] font-black text-rose-600">Cr</span></span>
                        )}
                      </td>
                    </tr>

                    {/* Expandable Sub-Ledgers or Accounts */}
                    <AnimatePresence initial={false}>
                      {isGroupExpanded && isDetailed && group.ledgers.map((ledger) => (
                        <tr key={ledger.id} className="hover:bg-slate-50/70 text-slate-700 divide-x divide-slate-200">
                          <td className="p-2.5 pl-9 text-slate-700 font-medium truncate max-w-[260px]">
                            {ledger.name}
                          </td>

                          {/* Individual Ledger Opening */}
                          <td className="p-2.5 text-right font-mono text-slate-600 text-[11px]">
                            {ledger.opening >= 0 ? (
                              <span>{ledger.opening > 0 ? `${Math.round(ledger.opening).toLocaleString()} Dr` : '0'}</span>
                            ) : (
                              <span>{Math.round(Math.abs(ledger.opening)).toLocaleString()} Cr</span>
                            )}
                          </td>

                          {/* Individual Ledger Transactions Debit */}
                          <td className="p-2.5 text-right font-mono text-slate-500 text-[11px]">
                            {ledger.debit > 0 ? Math.round(ledger.debit).toLocaleString() : '-'}
                          </td>

                          {/* Individual Ledger Transactions Credit */}
                          <td className="p-2.5 text-right font-mono text-slate-500 text-[11px]">
                            {ledger.credit > 0 ? Math.round(ledger.credit).toLocaleString() : '-'}
                          </td>

                          {/* Individual Ledger Closing */}
                          <td className="p-2.5 text-right font-mono text-slate-800 text-[11px]">
                            {ledger.closing >= 0 ? (
                              <span>{ledger.closing > 0 ? `${Math.round(ledger.closing).toLocaleString()} Dr` : '0'}</span>
                            ) : (
                              <span className="text-rose-600">{Math.round(Math.abs(ledger.closing)).toLocaleString()} Cr</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </AnimatePresence>
                  </React.Fragment>
                );
              })}

              {/* Grand Total Footer Row */}
              <tr className="bg-slate-900 text-white font-black divide-x divide-slate-800 text-[11px]">
                <td className="p-4 uppercase tracking-widest text-left font-black">
                  GRAND TOTAL
                </td>
                <td className="p-4 text-right space-y-1">
                  <div className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">OPENING SUMMARY</div>
                  <div className="flex justify-between items-center text-[10px] font-black gap-2">
                    <span className="text-teal-400">Dr: ₹{Math.round(overallTotals.openingDr).toLocaleString()}</span>
                    <span className="text-rose-400">Cr: ₹{Math.round(overallTotals.openingCr).toLocaleString()}</span>
                  </div>
                </td>
                <td className="p-4 text-right align-middle text-indigo-400 font-black text-sm">
                  ₹{Math.round(overallTotals.debit).toLocaleString()}
                </td>
                <td className="p-4 text-right align-middle text-indigo-400 font-black text-sm">
                  ₹{Math.round(overallTotals.credit).toLocaleString()}
                </td>
                <td className="p-4 text-right space-y-1">
                  <div className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">CLOSING SUMMARY</div>
                  <div className="flex justify-between items-center text-[10px] font-black gap-2">
                    <span className="text-teal-400">Dr: ₹{Math.round(overallTotals.closingDr).toLocaleString()}</span>
                    <span className="text-rose-400">Cr: ₹{Math.round(overallTotals.closingCr).toLocaleString()}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Warning Badge for Sync Audit */}
        {diffInTrialBalance > 0.01 && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between text-red-700 font-mono text-[11px] gap-4">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping"></span>
              <span className="font-extrabold uppercase tracking-widest">Warning: Trial Balance out of sync</span>
            </div>
            <div className="text-right">
              <span className="font-bold">Parity Deficit: </span>
              <span className="text-red-900 font-black underline">₹{Math.round(diffInTrialBalance).toLocaleString()}</span>
            </div>
          </div>
        )}

        {diffInTrialBalance <= 0.01 && (
          <div className="mt-6 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-3 text-emerald-800 font-mono text-[10px] font-extrabold uppercase tracking-widest">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Debit & Credit parity is verified successfully. Books are in absolute agreement.
          </div>
        )}
      </div>
    </div>
  );
};
