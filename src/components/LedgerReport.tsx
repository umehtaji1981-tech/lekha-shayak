import React, { useState, useMemo, useRef } from 'react';
import { 
  Download, 
  ArrowLeft, 
  Search, 
  Calendar, 
  RefreshCw, 
  FileText,
  Printer
} from 'lucide-react';
import { motion } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export const LedgerReport = ({ company, transactions, ledgers, reportPeriod, setReportPeriod, onBack }: any) => {
  const [selectedLedgerId, setSelectedLedgerId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const selectedLedger = useMemo(() => {
    return ledgers.find((l: any) => l.id === selectedLedgerId);
  }, [ledgers, selectedLedgerId]);

  const filteredTransactions = useMemo(() => {
    let txs = transactions;

    // Filter by ledger
    if (selectedLedgerId !== 'all') {
      txs = txs.filter((t: any) => 
        t.partyId === selectedLedgerId || 
        t.ledgerId === selectedLedgerId ||
        t.bankId === selectedLedgerId
      );
    }

    // Filter by search term
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      txs = txs.filter((t: any) => 
        (t.partyName || '').toLowerCase().includes(lowerSearch) ||
        (t.voucherNumber || '').toLowerCase().includes(lowerSearch) ||
        (t.description || '').toLowerCase().includes(lowerSearch)
      );
    }

    return txs.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [transactions, selectedLedgerId, searchTerm]);

  const downloadPDF = () => {
    try {
      setIsDownloading(true);
      const doc = new jsPDF() as any;
      
      // Dynamic Watermark Background
      if (company?.customBranding?.watermarkEnabled !== false && company?.customBranding?.watermarkText) {
        try {
          const opacity = (company.customBranding.watermarkOpacity ?? 5) / 100;
          const angle = company.customBranding.watermarkRotation ?? -30;
          doc.saveGraphicsState();
          try {
            doc.setGState(new (doc as any).GState({ opacity }));
          } catch (gErr) {
            console.warn("GState failed inside LedgerReport PDF, fallback applied", gErr);
          }
          doc.setFont("Helvetica", "bold");
          doc.setFontSize(50);
          doc.setTextColor(company.customBranding.watermarkColor || '#6366f1');
          doc.text(company.customBranding.watermarkText, 105, 145, {
            align: 'center',
            angle: angle
          });
          doc.restoreGraphicsState();
        } catch (err) {
          console.error("Watermark fail", err);
        }
      }

      // Company Header alignment and positioning
      const hAlign = company?.customBranding?.headerAlign || 'center';
      const headerX = hAlign === 'left' ? 20 : hAlign === 'right' ? 190 : 105;
      const textAlign = hAlign === 'left' ? 'left' : hAlign === 'right' ? 'right' : 'center';

      if (company?.logo) {
        try {
          const logoX = hAlign === 'left' ? 20 : hAlign === 'right' ? 145 : 90;
          doc.addImage(company.logo, 'PNG', logoX, 12, 22, 22);
        } catch (e) {
          console.error("Logo error", e);
        }
      }

      const companyYStart = company?.logo ? 40 : 20;

      doc.setFontSize(22);
      doc.setTextColor(79, 70, 229);
      doc.setFont(undefined, 'bold');
      doc.text(company?.name?.toUpperCase() || 'COMPANY NAME', headerX, companyYStart, { align: textAlign });
      
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.setFont(undefined, 'normal');

      let currentY = companyYStart + 6;

      // Tagline subtitle
      if (company?.customBranding?.headerSubtitle) {
        doc.setFont(undefined, 'italic');
        doc.setTextColor(120);
        doc.text(company.customBranding.headerSubtitle, headerX, currentY, { align: textAlign });
        currentY += 5;
        doc.setFont(undefined, 'normal');
        doc.setTextColor(100);
      }

      const address = company?.address || '';
      const splitAddress = doc.splitTextToSize(address, 150);
      doc.text(splitAddress, headerX, currentY, { align: textAlign });
      currentY += (splitAddress.length * 4) + 1;
      
      const contactInfo = [
        company?.phone && `Ph: ${company.phone}`,
        company?.email && `Email: ${company.email}`,
        company?.gstIn && `GSTIN: ${company.gstIn}`
      ].filter(Boolean).join(' | ');
      doc.text(contactInfo, headerX, currentY, { align: textAlign });
      currentY += 4;

      const borderStyle = company?.customBranding?.headerBorderSize || 'single';
      const lineYValue = Math.max(currentY + 2, 45);
      if (borderStyle !== 'none') {
        doc.setDrawColor(220);
        doc.setLineWidth(0.5);
        doc.line(20, lineYValue, 190, lineYValue);
        if (borderStyle === 'double') {
          doc.line(20, lineYValue + 1.2, 190, lineYValue + 1.2);
        }
      }

      // Report Title
      doc.setFontSize(14);
      doc.setTextColor(0);
      doc.setFont(undefined, 'bold');
      const titleY = lineYValue + 10;
      const title = selectedLedger ? `LEDGER: ${selectedLedger.name.toUpperCase()}` : 'ALL LEDGERS REPORT';
      doc.text(title, 105, titleY, { align: 'center' });
      
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(`Period: ${new Date(reportPeriod.startDate).toLocaleDateString()} to ${new Date(reportPeriod.endDate).toLocaleDateString()}`, 105, titleY + 7, { align: 'center' });

      // Account Details (if selected)
      if (selectedLedger && selectedLedger.group === 'Bank Accounts') {
        currentY = titleY + 14;
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text(`A/c No: ${selectedLedger.accountNumber || 'N/A'}`, 20, currentY);
        doc.text(`IFSC: ${selectedLedger.ifscCode || 'N/A'}`, 105, currentY, { align: 'center' });
        doc.text(`Bank: ${selectedLedger.bankName || 'N/A'}`, 190, currentY, { align: 'right' });
        currentY += 6;
      } else {
        currentY = titleY + 14;
      }

      // Ledger Table
      const tableData: any[] = [];
      if (selectedLedger && selectedLedgerId !== 'all') {
        const opVal = Number(selectedLedger.openingBalance) || 0;
        tableData.push([
          new Date(reportPeriod.startDate).toLocaleDateString(),
          'Opening Balance',
          '—',
          '—',
          Math.abs(opVal).toLocaleString('en-IN', { minimumFractionDigits: 2 }) + (opVal >= 0 ? ' Dr' : ' Cr')
        ]);
      }

      let runningBal = selectedLedger ? (Number(selectedLedger.openingBalance) || 0) : 0;
      filteredTransactions.forEach((t: any) => {
        let debit = 0;
        let credit = 0;

        if (selectedLedgerId !== 'all') {
          if (t.type === 'Sales') {
            if (t.partyId === selectedLedgerId) debit = t.totalAmount;
          } else if (t.type === 'Purchases') {
            if (t.partyId === selectedLedgerId) credit = t.totalAmount;
          } else if (t.type === 'Receipt') {
            if (t.bankId === selectedLedgerId) debit = t.totalAmount;
            if (t.partyId === selectedLedgerId) credit = t.totalAmount;
          } else if (t.type === 'Payment') {
            if (t.partyId === selectedLedgerId) debit = t.totalAmount;
            if (t.bankId === selectedLedgerId) credit = t.totalAmount;
          } else if (t.type === 'Journal') {
            if (t.debitLedgerId === selectedLedgerId) debit = t.totalAmount;
            if (t.creditLedgerId === selectedLedgerId) credit = t.totalAmount;
          }
        } else {
           if (t.type === 'Sales' || t.type === 'Receipt') credit = t.totalAmount;
           if (t.type === 'Purchases' || t.type === 'Payment') debit = t.totalAmount;
        }
        
        runningBal += (debit - credit);

        tableData.push([
          new Date(t.date).toLocaleDateString(),
          `${t.type} - ${t.partyName || 'Self'}\n${t.voucherNumber}`,
          debit > 0 ? debit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '',
          credit > 0 ? credit.toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '',
          Math.abs(runningBal).toLocaleString('en-IN', { minimumFractionDigits: 2 }) + (runningBal >= 0 ? ' Dr' : ' Cr')
        ]);
      });

      autoTable(doc, {
        startY: currentY,
        head: [['Date', 'Particulars / Vch No', 'Debit (Dr)', 'Credit (Cr)', 'Balance']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229], halign: 'center' },
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: 'auto' },
          2: { halign: 'right', cellWidth: 30 },
          3: { halign: 'right', cellWidth: 30 },
          4: { halign: 'right', cellWidth: 35 }
        },
        styles: { fontSize: 8, cellPadding: 3 }
      });

      const finalY = (doc as any).lastAutoTable.finalY || 180;
      const sigHeightHeight = company?.customBranding?.signatureHeight || 60;
      const sigAlignAlign = company?.customBranding?.signatureAlign || 'right';
      const sigLabelLabel = company?.customBranding?.signatureLabel || 'Authorized Signatory';

      // Custom terms conditions if configured
      if (company?.customBranding?.termsOfSale && company.customBranding.termsOfSale.length > 0) {
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(100);
        doc.text('Terms & Conditions:', 20, finalY + 12);
        doc.setFontSize(8);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(120);
        let termY = finalY + 17;
        company.customBranding.termsOfSale.slice(0, 3).forEach((term: string, idx: number) => {
          doc.text(`${idx + 1}. ${term}`, 20, termY);
          termY += 4;
        });
      }

      // Add Signature Block
      const authorityX = sigAlignAlign === 'left' ? 20 : sigAlignAlign === 'center' ? 105 : 190;
      doc.setFontSize(9);
      doc.setTextColor(50);
      doc.setFont(undefined, 'bold');
      doc.text(sigLabelLabel, authorityX, finalY + 18 + sigHeightHeight, { align: sigAlignAlign });
      doc.setDrawColor(200);
      doc.setLineWidth(0.5);
      doc.line(authorityX - 25, finalY + 12 + sigHeightHeight, authorityX + 25, finalY + 12 + sigHeightHeight);
      
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.setFont(undefined, 'normal');
      doc.text(company?.name || '', authorityX, finalY + 22 + sigHeightHeight, { align: sigAlignAlign });

      doc.save(`Ledger_Report_${selectedLedger?.name || 'All'}_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error('PDF Export Error:', error);
      alert('Failed to export PDF');
    } finally {
      setIsDownloading(false);
    }
  };

  let currentRunningBalance = selectedLedger && selectedLedgerId !== 'all' ? (Number(selectedLedger.openingBalance) || 0) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h3 className="font-bold font-display text-slate-900 text-lg">Ledger Report</h3>
            <p className="text-[10px] text-slate-400 font-medium">Detailed statement of accounts</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            <Calendar size={14} className="text-slate-400 ml-2 self-center" />
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
            value={selectedLedgerId}
            onChange={e => setSelectedLedgerId(e.target.value)}
            className="text-xs font-bold text-slate-600 border border-slate-200 rounded-lg bg-white px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 outline-none min-w-[200px]"
          >
            <option value="all">All Ledgers</option>
            {ledgers.map((l: any) => (
              <option key={l.id} value={l.id}>{l.name} ({l.group})</option>
            ))}
          </select>

          <button onClick={downloadPDF} disabled={isDownloading} className="btn-primary text-xs flex items-center gap-2">
            {isDownloading ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
            Export PDF
          </button>
        </div>
      </div>

      {selectedLedger && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-white to-slate-50 p-6 rounded-2xl border border-slate-200 shadow-sm"
        >
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="col-span-2">
              <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1">Account Header</h4>
              <p className="text-xl font-black text-slate-900">{selectedLedger.name}</p>
              <p className="text-xs text-slate-500 font-medium">{selectedLedger.group}</p>
              {selectedLedger.address && <p className="text-[10px] text-slate-400 mt-2 max-w-xs">{selectedLedger.address}</p>}
            </div>
            {selectedLedger.group === 'Bank Accounts' ? (
              <>
                <div>
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Bank Details</h4>
                  <p className="text-sm font-bold text-slate-800">{selectedLedger.bankName || 'N/A'}</p>
                  <p className="text-sm font-mono text-slate-500">{selectedLedger.accountNumber || 'N/A'}</p>
                </div>
                <div>
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">GSTIN / Tax</h4>
                  <p className="text-sm font-bold text-slate-800">{selectedLedger.gstIn || 'N/A'}</p>
                  <p className="text-sm font-mono text-slate-500">IFSC: {selectedLedger.ifscCode || 'N/A'}</p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tax Info</h4>
                  <p className="text-sm font-bold text-slate-800">{selectedLedger.gstIn || 'N/A'}</p>
                  <p className="text-sm font-mono text-slate-500">PAN: {selectedLedger.pan || 'N/A'}</p>
                </div>
                <div>
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Contact</h4>
                  <p className="text-sm font-bold text-slate-800">{selectedLedger.phone || 'N/A'}</p>
                  <p className="text-xs text-slate-500">{selectedLedger.email || 'N/A'}</p>
                </div>
              </>
            )}
          </div>
        </motion.div>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text"
              placeholder="Search by voucher, party or description..."
              className="w-full pl-10 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
            Showing {filteredTransactions.length} Transactions
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-white border-b border-slate-100">
              <tr className="text-left">
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Date</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Particulars / Details</th>
                <th className="px-6 py-4 text-right text-xs font-bold text-slate-400 uppercase tracking-wider">Debit (Dr)</th>
                <th className="px-6 py-4 text-right text-xs font-bold text-slate-400 uppercase tracking-wider">Credit (Cr)</th>
                <th className="px-6 py-4 text-right text-xs font-bold text-slate-400 uppercase tracking-wider">Running Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {selectedLedger && selectedLedgerId !== 'all' && (
                <tr className="bg-slate-50/45 text-slate-500 font-medium italic">
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-slate-500">{new Date(reportPeriod.startDate).toLocaleDateString()}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm rounded font-semibold text-slate-500">Opening Balance</div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-bold text-slate-300">—</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-bold text-slate-300">—</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <p className="text-sm font-black font-display text-slate-700 tracking-tight">
                      ₹{Math.abs(Number(selectedLedger.openingBalance) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      {(Number(selectedLedger.openingBalance) || 0) >= 0 ? 'Debit' : 'Credit'}
                    </p>
                  </td>
                </tr>
              )}
              {filteredTransactions.map((t: any) => {
                let debit = 0;
                let credit = 0;

                if (selectedLedgerId !== 'all') {
                  if (t.type === 'Sales') {
                    if (t.partyId === selectedLedgerId) debit = t.totalAmount;
                  } else if (t.type === 'Purchases') {
                    if (t.partyId === selectedLedgerId) credit = t.totalAmount;
                  } else if (t.type === 'Receipt') {
                    if (t.bankId === selectedLedgerId) debit = t.totalAmount;
                    if (t.partyId === selectedLedgerId) credit = t.totalAmount;
                  } else if (t.type === 'Payment') {
                    if (t.partyId === selectedLedgerId) debit = t.totalAmount;
                    if (t.bankId === selectedLedgerId) credit = t.totalAmount;
                  } else if (t.type === 'Journal') {
                    if (t.debitLedgerId === selectedLedgerId) debit = t.totalAmount;
                    if (t.creditLedgerId === selectedLedgerId) credit = t.totalAmount;
                  }
                } else {
                   // For "All Ledgers", we just show the magnitude based on type (simplification)
                   if (t.type === 'Sales' || t.type === 'Receipt') credit = t.totalAmount;
                   if (t.type === 'Purchases' || t.type === 'Payment') debit = t.totalAmount;
                }
                
                currentRunningBalance += (debit - credit);

                return (
                  <tr key={t.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-slate-700">{new Date(t.date).toLocaleDateString()}</div>
                      <div className="text-[10px] text-slate-400 font-display font-medium">{t.voucherNumber}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-semibold text-indigo-600">{t.type}</div>
                      <div className="text-xs text-slate-500">{t.partyName || 'Account Entry'}</div>
                      {t.description && <p className="text-[10px] text-slate-400 italic mt-1">{t.description}</p>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={`text-sm font-bold font-display ${debit > 0 ? 'text-slate-900' : 'text-slate-200'}`}>
                        {debit > 0 ? `₹${debit.toLocaleString()}` : '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={`text-sm font-bold font-display ${credit > 0 ? 'text-slate-900' : 'text-slate-200'}`}>
                        {credit > 0 ? `₹${credit.toLocaleString()}` : '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <p className="text-sm font-black font-display text-slate-900 tracking-tight">
                        ₹{Math.abs(currentRunningBalance).toLocaleString()}
                      </p>
                      <p className={`text-[10px] font-black uppercase tracking-widest ${currentRunningBalance >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {currentRunningBalance >= 0 ? 'Debit' : 'Credit'}
                      </p>
                    </td>
                  </tr>
                );
              })}
              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-20 text-center text-slate-400 italic text-sm">
                    No transactions found for the selected period and ledger.
                  </td>
                </tr>
              )}
            </tbody>
            {filteredTransactions.length > 0 && (
              <tfoot className="bg-slate-900 text-white">
                <tr>
                   <td colSpan={2} className="px-6 py-5 font-bold tracking-widest uppercase text-[10px] text-slate-400">Net Period Summary</td>
                   <td colSpan={3} className="px-6 py-5 text-right">
                      <div className="flex flex-col items-end">
                        <span className="text-2xl font-black font-display tracking-tight">
                          ₹{Math.abs(currentRunningBalance).toLocaleString()}
                          <span className="text-sm ml-2 font-bold text-indigo-400 font-sans">
                            {currentRunningBalance >= 0 ? 'Dr (Debit)' : 'Cr (Credit)'}
                          </span>
                        </span>
                        <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mt-1 font-sans">Closing Balance for Selected Period</span>
                      </div>
                   </td>
                </tr>
              </tfoot>
            )}
           </table>
        </div>
      </div>
    </div>
  );
};
