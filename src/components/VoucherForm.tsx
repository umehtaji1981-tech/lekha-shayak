import React, { useState, useEffect, useRef } from 'react';
import { Save, ArrowLeft, RefreshCw, Wallet, User, IndianRupee, Calendar, FileText, ChevronDown, Plus, Download, Printer, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { dbService } from '../lib/db';
import { where } from 'firebase/firestore';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { numberToWords } from '../lib/gst-utils';

export const VoucherForm = ({ company, type, onSave, onCancel, prefillData, activeFY }: any) => {
  const [parties, setParties] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [showAddBank, setShowAddBank] = useState(false);
  const [newBankName, setNewBankName] = useState('');
  const [newBankGroup, setNewBankGroup] = useState('Bank Accounts');
  const [newBankOpeningBal, setNewBankOpeningBal] = useState(0);
  const [selectedParty, setSelectedParty] = useState<any>(null);
  const [selectedBank, setSelectedBank] = useState<any>(null);
  const [amount, setAmount] = useState(prefillData?.totalAmount || 0);
  const [tdsRate, setTdsRate] = useState(prefillData?.tdsRate || 0);
  const [tdsAmount, setTdsAmount] = useState(prefillData?.tdsAmount || 0);
  const [isTdsEnabled, setIsTdsEnabled] = useState(!!prefillData?.tdsAmount);
  const [voucherNumber, setVoucherNumber] = useState(prefillData?.voucherNumber || '');
  const [partySearch, setPartySearch] = useState('');
  const [showPartyResults, setShowPartyResults] = useState(false);
  const partySearchRef = useRef<HTMLDivElement>(null);

  // Cheque / Reference Number Management States
  const [chequeNo, setChequeNo] = useState(prefillData?.chequeNo || '');
  const [clearanceDate, setClearanceDate] = useState(prefillData?.clearanceDate || '');

  // Cost Centre Allocation States
  const [costCentres, setCostCentres] = useState<any[]>([]);
  const [costAllocations, setCostAllocations] = useState<any[]>(prefillData?.costCentreAllocations || []);
  const [isCostAllocEnabled, setIsCostAllocEnabled] = useState(prefillData?.costCentreAllocations && prefillData.costCentreAllocations.length > 0 || false);
  const [showAddCostCentre, setShowAddCostCentre] = useState(false);
  const [newCostCentreName, setNewCostCentreName] = useState('');

  // Fetch / Listen to Cost Centres under real-time db updates
  useEffect(() => {
    if (company?.id) {
      return dbService.listenCollection(`companies/${company.id}/costCentres`, [], setCostCentres);
    }
  }, [company?.id]);

  const handleCreateCostCentre = async () => {
    if (!newCostCentreName.trim()) return;
    try {
      await dbService.add(`companies/${company.id}/costCentres`, {
        name: newCostCentreName.trim(),
        companyId: company.id,
        createdAt: new Date().toISOString()
      });
      setNewCostCentreName('');
      setShowAddCostCentre(false);
    } catch (err) {
      console.error(err);
      alert("Failed to create Cost Centre.");
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (partySearchRef.current && !partySearchRef.current.contains(event.target as Node)) {
        setShowPartyResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isTdsEnabled && tdsRate > 0) {
      setTdsAmount(Math.round((amount * tdsRate) / 100));
    } else {
      setTdsAmount(0);
    }
  }, [amount, tdsRate, isTdsEnabled]);

  const netAmount = amount - tdsAmount;
  const getDefaultDate = () => {
    if (prefillData?.date) return prefillData.date;
    const today = new Date().toISOString().split('T')[0];
    if (activeFY) {
      if (today < activeFY.startDate) return activeFY.startDate;
      if (today > activeFY.endDate) return activeFY.endDate;
    }
    return today;
  };
  const [date, setDate] = useState(getDefaultDate);
  const [isSaving, setIsSaving] = useState(false);
  const [narration, setNarration] = useState(prefillData?.narration || '');
  const [isDownloading, setIsDownloading] = useState(false);

  const [selectedCompanyBankId, setSelectedCompanyBankId] = useState<string>(() => {
    if (prefillData?.printedBankDetails?.id) return prefillData.printedBankDetails.id;
    if (company?.bankAccounts?.length > 0) {
      const defaultAcc = company.bankAccounts.find((acc: any) => acc.isDefault);
      return defaultAcc ? defaultAcc.id : company.bankAccounts[0].id;
    }
    return '';
  });
  const [selectedCompanyBank, setSelectedCompanyBank] = useState<any>(() => {
    if (prefillData?.printedBankDetails) return prefillData.printedBankDetails;
    if (company?.bankAccounts?.length > 0) {
      const defaultAcc = company.bankAccounts.find((acc: any) => acc.isDefault);
      return defaultAcc || company.bankAccounts[0];
    }
    if (company?.bankName) {
      return {
        id: 'legacy',
        bankName: company.bankName,
        accountNumber: company.accountNumber,
        ifscCode: company.ifscCode,
        branch: company.branch
      };
    }
    return null;
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = async () => {
    if (!prefillData?.id) return;

    setIsDeleting(true);
    try {
      await dbService.deleteTransactionWithStock(company.id, prefillData.id);
      alert(`${type} Voucher deleted successfully.`);
      onSave(); // Close form and refresh list
    } catch (error) {
      console.error("Delete failed:", error);
      alert("Failed to delete voucher: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    if (prefillData?.autoPreview) {
      const timer = setTimeout(() => {
        downloadPDF();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [prefillData?.autoPreview]);

  const downloadPDF = () => {
    setIsDownloading(true);
    try {
      const doc = new jsPDF() as any;
      
      const partyDisplayName = selectedParty?.name || prefillData?.partyName || 'N/A';
      const bankDisplayName = selectedBank?.name || prefillData?.bankName || 'N/A';

      // Watermark
      if (company.customBranding?.watermarkEnabled !== false && company.customBranding?.watermarkText) {
        try {
          const opacity = (company.customBranding.watermarkOpacity ?? 5) / 100;
          const angle = company.customBranding.watermarkRotation ?? -30;
          doc.saveGraphicsState();
          try {
            doc.setGState(new (doc as any).GState({ opacity }));
          } catch (gErr) {
            console.warn("GState failed, falling back to soft styling", gErr);
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
          console.error("Watermark render error", err);
        }
      }

      // Header alignment and positioning
      const hAlign = company.customBranding?.headerAlign || 'center';
      const headerX = hAlign === 'left' ? 20 : hAlign === 'right' ? 190 : 105;
      const textAlign = hAlign === 'left' ? 'left' : hAlign === 'right' ? 'right' : 'center';

      if (company.logo) {
        try {
          const logoX = hAlign === 'left' ? 20 : hAlign === 'right' ? 145 : 90;
          doc.addImage(company.logo, 'PNG', logoX, 12, 22, 22);
        } catch (e) {
          console.error("Logo error", e);
        }
      }

      const companyYStart = company.logo ? 40 : 22;

      doc.setFontSize(20);
      doc.setTextColor(79, 70, 229); // indigo-600
      doc.setFont(undefined, 'bold');
      doc.text(company.name.toUpperCase(), headerX, companyYStart, { align: textAlign });
      
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.setFont(undefined, 'normal');
      
      let currentY = companyYStart + 6;

      // Tagline subtitle
      if (company.customBranding?.headerSubtitle) {
        doc.setFont(undefined, 'italic');
        doc.setTextColor(120);
        doc.text(company.customBranding.headerSubtitle, headerX, currentY, { align: textAlign });
        currentY += 5;
        doc.setFont(undefined, 'normal');
        doc.setTextColor(100);
      }

      const splitAddress = doc.splitTextToSize(company.address || '', 140);
      doc.text(splitAddress, headerX, currentY, { align: textAlign });
      currentY += (splitAddress.length * 4) + 1;

      const contactDetails = [];
      if (company.phone) contactDetails.push(`Ph: ${company.phone}`);
      if (company.email) contactDetails.push(`Email: ${company.email}`);
      if (contactDetails.length > 0) {
        doc.text(contactDetails.join(' | '), headerX, currentY, { align: textAlign });
        currentY += 4;
      }

      const taxDetails = [];
      if (company.gstIn) taxDetails.push(`GSTIN: ${company.gstIn}`);
      const pan = company.pan || (company.gstIn ? company.gstIn.substring(2, 12) : null);
      if (pan) taxDetails.push(`PAN: ${pan}`);
      if (taxDetails.length > 0) {
        doc.setFont(undefined, 'bold');
        doc.text(taxDetails.join(' | '), headerX, currentY, { align: textAlign });
        currentY += 4;
      }
      
      const borderStyle = company.customBranding?.headerBorderSize || 'single';
      const lineYValue = Math.max(currentY + 2, 45);
      if (borderStyle !== 'none') {
        doc.setDrawColor(200);
        doc.setLineWidth(0.5);
        doc.line(20, lineYValue, 190, lineYValue);
        if (borderStyle === 'double') {
          doc.line(20, lineYValue + 1.2, 190, lineYValue + 1.2);
        }
      }
      
      // Voucher Title
      doc.setFontSize(15);
      doc.setTextColor(0);
      doc.setFont(undefined, 'bold');
      const titleY = Math.max(lineYValue + 10, 55);
      doc.text(`${type.toUpperCase()} VOUCHER`, 105, titleY, { align: 'center' });
      
      // Voucher Details
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      doc.text(`Voucher No: ${voucherNumber || 'N/A'}`, 20, titleY + 12);
      doc.text(`Date: ${new Date(date).toLocaleDateString()}`, 190, titleY + 12, { align: 'right' });
      
      // Main Table
      const tableData = [
        ['Particulars', 'Account', 'Amount (INR)'],
        [`Towards: ${type}`, partyDisplayName, `Rs. ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
      ];

      if (isTdsEnabled && tdsAmount > 0) {
        tableData.push(['TDS Deduction', `${tdsRate}%`, `Rs. -${tdsAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`]);
        tableData.push(['Net Amount', '', `Rs. ${netAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`]);
      }

      autoTable(doc, {
        startY: titleY + 18,
        head: [['Field', 'Details', 'Value']],
        body: [
          ['Party / Account', partyDisplayName, ''],
          [`${type === 'Receipt' ? 'Deposit Into' : 'Paid From'}`, bankDisplayName, ''],
          ['Gross Amount', '', `Rs. ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
          ...(isTdsEnabled ? [
            ['TDS Rate', `${tdsRate}%`, ''],
            ['TDS Amount', '', `Rs. -${tdsAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
            ['Net Payable', '', `Rs. ${netAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`]
          ] : []),
          ...(selectedCompanyBank?.bankName ? [
            ['Company Bank (Printed)', selectedCompanyBank.bankName, `A/C: ${selectedCompanyBank.accountNumber} | IFSC: ${selectedCompanyBank.ifscCode}`]
          ] : [])
        ],
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] },
        styles: { fontSize: 10, cellPadding: 5 }
      });
      
      const finalY = (doc as any).lastAutoTable.finalY || 130;
      
      // Narration
      doc.setFontSize(10);
      doc.text('Narration:', 20, finalY + 12);
      doc.setFontSize(9);
      doc.setTextColor(100);
      const splitNarration = doc.splitTextToSize(narration || 'No narration provided.', 170);
      doc.text(splitNarration, 20, finalY + 18);

      const sigHeightHeight = company.customBranding?.signatureHeight || 60;
      const sigAlignAlign = company.customBranding?.signatureAlign || 'right';
      const sigLabelLabel = company.customBranding?.signatureLabel || 'Authorised Signatory';

      // Signatures
      doc.setFontSize(10);
      doc.setTextColor(0);
      doc.setFont(undefined, 'normal');
      doc.text('Receiver\'s Signature', 20, finalY + 20 + sigHeightHeight);
      doc.setDrawColor(200);
      doc.line(20, finalY + 15 + sigHeightHeight, 65, finalY + 15 + sigHeightHeight);

      const authorityX = sigAlignAlign === 'left' ? 20 : sigAlignAlign === 'center' ? 105 : 190;
      doc.text(sigLabelLabel, authorityX, finalY + 20 + sigHeightHeight, { align: sigAlignAlign });
      doc.line(authorityX - 25, finalY + 15 + sigHeightHeight, authorityX + 25, finalY + 15 + sigHeightHeight);
      
      // Footer
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Generated on ${new Date().toLocaleString()} by Lekha Sahayak`, 105, 285, { align: 'center' });
      
      doc.save(`${type}_Voucher_${voucherNumber || 'Draft'}.pdf`);
    } catch (error) {
      console.error("PDF generation failed", error);
      alert("Failed to generate PDF");
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    // Fetch all ledgers for parties to allow more flexibility
    const unsubscribeLedgers = dbService.listenCollection(`companies/${company.id}/ledgers`, [], (data) => {
      setParties(data);
      if (prefillData?.partyId) {
        setSelectedParty(data.find(p => p.id === prefillData.partyId));
      }
    });

    // Fetch Bank/Cash ledgers
    const unsubscribeBanks = dbService.listenCollection(`companies/${company.id}/ledgers`, [
      where('group', 'in', ['Bank Accounts', 'Bank', 'Cash-in-hand', 'Cash'])
    ], (data) => {
      setBanks(data);
      if (prefillData?.bankId) {
        setSelectedBank(data.find(b => b.id === prefillData.bankId));
      }
    });

    return () => {
      unsubscribeLedgers();
      unsubscribeBanks();
    };
  }, [company.id, prefillData]);

  const fetchNextNumber = async () => {
    if (company?.id && activeFY?.id) {
      const next = await dbService.getNextSequence(company.id, type, activeFY.id);
      setVoucherNumber(next);
    }
  };

  useEffect(() => {
    if (!prefillData?.id && !voucherNumber) {
      fetchNextNumber();
    }
  }, [company.id, type, activeFY.id, prefillData?.id]);

  const [newLedgerOpeningBal, setNewLedgerOpeningBal] = useState(0);
  const [newLedgerGroup, setNewLedgerGroup] = useState(type === 'Receipt' ? 'Sundry Debtors' : 'Sundry Creditors');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setSelectedParty(null);
        setShowPartyResults(true);
        setTimeout(() => {
          const input = document.querySelector('input[placeholder="Search ledger by name..."]') as HTMLInputElement;
          if (input) {
            input.focus();
            input.select();
          }
        }, 100);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSave(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedParty, selectedBank, amount, date, voucherNumber, isSaving, partySearch, newLedgerOpeningBal, newLedgerGroup]);

  const handleCreateLedger = async () => {
    if (!partySearch) return;
    setIsSaving(true);
    try {
      const newLedger = {
        name: partySearch,
        group: newLedgerGroup,
        openingBalance: Number(newLedgerOpeningBal),
        currentBalance: Number(newLedgerOpeningBal),
        companyId: company.id,
        createdAt: new Date().toISOString()
      };
      const ref = await dbService.add(`companies/${company.id}/ledgers`, newLedger);
      setSelectedParty({ id: ref.id, ...newLedger });
      setPartySearch('');
      setNewLedgerOpeningBal(0);
      setShowPartyResults(false);
    } catch (error) {
      alert("Failed to create ledger");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async (andNew = false) => {
    // Comprehensive Validation
    const errors = [];
    if (!selectedParty) errors.push('Please search and select a Party/Ledger account.');
    if (!selectedBank) errors.push(`Please select a ${type === 'Receipt' ? 'Deposit' : 'Payment'} (Bank/Cash) account.`);
    if (!amount || amount <= 0) errors.push('Please enter a valid amount greater than zero.');
    if (!date) {
      errors.push('Please select a valid voucher date.');
    } else if (activeFY) {
      if (date < activeFY.startDate || date > activeFY.endDate) {
        errors.push(`Voucher date must be within the active financial year ${activeFY.label || ''} (${activeFY.startDate} to ${activeFY.endDate}).`);
      }
    }
    if (!voucherNumber || voucherNumber.trim() === '') errors.push('Voucher number cannot be empty.');
    
    if (isTdsEnabled) {
      if (tdsRate < 0 || tdsRate > 100) errors.push('TDS Rate must be between 0 and 100%.');
    }

    // Cost Centre Balance Allocation Validation
    if (isCostAllocEnabled) {
      if (!costAllocations || costAllocations.length === 0) {
        errors.push('Please add at least one Cost Centre allocation row if Cost Centre Allocations are enabled.');
      } else {
        const totalAllocated = costAllocations.reduce((sum, item) => sum + Number(item.amount || 0), 0);
        if (Math.abs(totalAllocated - amount) > 0.01) {
          errors.push(`Cost Centre Allocations Total (₹${totalAllocated.toLocaleString()}) must exactly match the Voucher Amount (₹${amount.toLocaleString()}). Difference: ₹${Math.abs(totalAllocated - amount).toLocaleString()}`);
        }
        if (costAllocations.some(item => !item.costCentreId)) {
          errors.push('Please select a Cost Centre for all allocation rows or remove blank rows.');
        }
      }
    }

    if (errors.length > 0) {
      alert("Missing or Incorrect Information:\n\n" + errors.map((err, i) => `${i + 1}. ${err}`).join('\n'));
      return;
    }

    if (isSaving) return;

    setIsSaving(true);
    try {
      // Duplicate check
      const isDuplicate = await dbService.checkDuplicateVoucher(
        company.id,
        type,
        activeFY.id,
        voucherNumber,
        prefillData?.id
      );

      if (isDuplicate) {
        alert(`Error: A ${type} voucher with number "${voucherNumber}" already exists in this financial year. Please use a unique number to avoid duplicates.`);
        setIsSaving(false);
        return;
      }

      const transaction = {
        type,
        date,
        voucherNumber,
        partyId: selectedParty.id,
        partyName: selectedParty.name,
        bankId: selectedBank.id,
        bankName: selectedBank.name,
        printedBankDetails: selectedCompanyBank || null,
        totalAmount: Number(amount),
        tdsAmount: Number(tdsAmount),
        tdsRate: Number(tdsRate),
        netAmount: Number(netAmount),
        narration,
        companyId: company.id,
        fy: activeFY.id,
        updatedAt: new Date().toISOString(),

        // Cheque & Reference tracking
        chequeNo: ['Bank Accounts', 'Bank'].includes(selectedBank.group) ? chequeNo : '',
        clearanceDate: ['Bank Accounts', 'Bank'].includes(selectedBank.group) ? clearanceDate : '',

        // Cost Centre Allocations
        costCentreAllocations: isCostAllocEnabled ? costAllocations : null
      };

      if (prefillData?.id) {
        await dbService.updateTransactionWithStock(company.id, prefillData.id, transaction);
      } else {
        await dbService.addTransactionWithStock(company.id, transaction);
      }

      if (andNew) {
        setSelectedParty(null);
        setAmount(0);
        setNarration('');
        setVoucherNumber('');
        setChequeNo('');
        setClearanceDate('');
        setCostAllocations([]);
        setIsCostAllocEnabled(false);
        // Fetch next number again
        const next = await dbService.getNextSequence(company.id, type, activeFY.id);
        setVoucherNumber(next);
        setPartySearch('');
        setSelectedParty(null);
        setSelectedBank(null);
        setAmount(0);
        setTdsRate(0);
        setTdsAmount(0);
        setIsTdsEnabled(false);
        setNarration('');
        alert(`${type} Saved Successfully.`);
      } else {
        alert(`${type} Saved Successfully.`);
        onSave();
      }
    } catch (error) {
      console.error("Save failed:", error);
      alert("Failed to save transaction: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div className="flex items-center gap-4">
          <button onClick={onCancel} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <div className={`p-2 rounded-lg ${type === 'Receipt' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
              <Wallet size={20} />
            </div>
            {prefillData?.id ? 'Edit' : 'New'} {type} Voucher
          </h2>
        </div>
        <div className="flex gap-3">
          {!prefillData?.id && (
            <button 
              disabled={isSaving}
              onClick={() => handleSave(true)} 
              className={`btn-secondary border-indigo-200 text-indigo-600 flex items-center gap-2 ${isSaving ? 'opacity-50' : ''}`}
            >
              {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Plus size={18} />} Save & New
            </button>
          )}
          <button 
            disabled={isSaving}
            onClick={() => handleSave(false)} 
            className={`btn-primary flex items-center gap-2 ${isSaving ? 'opacity-50' : ''}`}
          >
            {isSaving ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />} 
            {prefillData?.id ? 'Update Voucher' : 'Save & Post'}
            <span className="ml-1 bg-indigo-700 text-indigo-100 border border-indigo-500 rounded px-1 text-[9px] font-mono select-none">Ctrl+S</span>
          </button>
          {prefillData?.id && (
            <>
              <button 
                type="button"
                disabled={isDownloading}
                onClick={downloadPDF}
                className="btn-secondary border-slate-200 text-slate-600 flex items-center gap-2"
              >
                {isDownloading ? <RefreshCw size={18} className="animate-spin" /> : <Download size={18} />} PDF
              </button>
              {showDeleteConfirm ? (
                <div className="flex items-center gap-2 bg-red-50 p-1.5 rounded-lg border border-red-100">
                  <span className="text-xs text-red-700 font-medium px-2">Delete this voucher?</span>
                  <button 
                    type="button"
                    disabled={isDeleting}
                    onClick={handleDelete}
                    className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded-md shadow-sm transition-colors"
                  >
                    {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                  </button>
                  <button 
                    type="button"
                    disabled={isDeleting}
                    onClick={() => setShowDeleteConfirm(false)}
                    className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-medium px-3 py-1.5 rounded-md shadow-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button 
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setShowDeleteConfirm(true)}
                  className="btn-secondary border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <Trash2 size={18} /> Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="card p-8 space-y-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Voucher Date*</label>
              <div className="relative group">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-center text-slate-400 group-focus-within:bg-indigo-600 group-focus-within:text-white transition-all">
                  <Calendar size={14} />
                </div>
                <input 
                  type="date" 
                  value={date} 
                  onChange={e => setDate(e.target.value)} 
                  min={activeFY?.startDate}
                  max={activeFY?.endDate}
                  className="w-full bg-white border border-slate-200 rounded-xl pl-14 pr-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-50 focus:border-indigo-600 outline-none transition-all" 
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Voucher #</label>
              <div className="relative group flex gap-2">
                <div className="relative flex-1">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-center text-slate-400 group-focus-within:bg-indigo-600 group-focus-within:text-white transition-all">
                    <FileText size={14} />
                  </div>
                  <input 
                    value={voucherNumber} 
                    onChange={e => setVoucherNumber(e.target.value)} 
                    className="w-full bg-white border border-slate-200 rounded-xl pl-14 pr-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-50 focus:border-indigo-600 outline-none transition-all" 
                    placeholder="AUTO"
                  />
                </div>
                <button 
                  type="button"
                  onClick={fetchNextNumber}
                  className="p-3 bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-xl transition-all border border-slate-200"
                  title="Auto-generate next number"
                >
                  <RefreshCw size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-end px-1">
              <div className="flex items-center gap-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Party / Ledger Account*</label>
                <button 
                  onClick={() => {
                    setShowPartyResults(true);
                    setPartySearch('');
                  }} 
                  className="p-1 text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors flex items-center gap-1"
                  title="Add New Ledger [F2]"
                >
                  <Plus size={14} />
                  <span className="bg-indigo-50 border border-indigo-100 text-indigo-600 rounded px-1.5 py-0.5 text-[9px] font-mono select-none">F2</span>
                </button>
              </div>
              {selectedParty && (
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full font-display tracking-tight ${selectedParty.currentBalance >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                  BAL: ₹{Math.abs(selectedParty.currentBalance || 0).toLocaleString()} {selectedParty.currentBalance >= 0 ? 'Dr' : 'Cr'}
                </span>
              )}
            </div>
            <div className="relative group" ref={partySearchRef}>
              <div className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-center text-slate-400 group-focus-within:bg-indigo-600 group-focus-within:text-white transition-all">
                <User size={14} />
              </div>
              <input 
                type="text"
                placeholder="Search ledger by name..."
                className="w-full bg-white border border-slate-200 rounded-xl pl-14 pr-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-50 focus:border-indigo-600 outline-none transition-all"
                value={selectedParty ? selectedParty.name : partySearch}
                onChange={e => {
                  if (selectedParty) {
                    setSelectedParty(null);
                    setPartySearch(e.target.value);
                  } else {
                    setPartySearch(e.target.value);
                  }
                  setShowPartyResults(true);
                }}
                onFocus={() => setShowPartyResults(true)}
              />
              
              {showPartyResults && (
                <div className="absolute top-full left-0 right-0 z-50 mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
                   <div className="max-h-60 overflow-y-auto">
                      {parties
                        .filter(p => partySearch && p.name.toLowerCase().includes(partySearch.toLowerCase()))
                        .map(p => (
                        <button 
                          key={p.id}
                          type="button"
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between border-b border-slate-50 last:border-0"
                          onClick={() => {
                            setSelectedParty(p);
                            setPartySearch('');
                            setShowPartyResults(false);
                          }}
                        >
                          <div>
                            <p className="text-sm font-bold text-slate-900">{p.name}</p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">{p.group}</p>
                          </div>
                          <span className="text-xs font-mono text-slate-400">₹{(p.currentBalance || 0).toLocaleString()}</span>
                        </button>
                      ))}

                      {showPartyResults && (
                        <div className="p-4 bg-slate-50 border-t border-slate-100 space-y-4">
                           <div className="text-center">
                              <p className="text-xs text-slate-400 font-bold mb-1 uppercase tracking-tight">
                                {partySearch ? 'Not finding it?' : 'Create New Ledger'}
                              </p>
                              {partySearch && <p className="text-sm font-black text-slate-900 mb-3">Create "{partySearch.toUpperCase()}"?</p>}
                           </div>
                           
                           <div className="grid grid-cols-2 gap-3">
                              <div className="col-span-2 space-y-1">
                                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Ledger Name</label>
                                 <input 
                                   type="text" 
                                   value={partySearch}
                                   onChange={e => setPartySearch(e.target.value)}
                                   className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-100 outline-none"
                                   placeholder="New Ledger Name"
                                   onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleCreateLedger();
                                      }
                                   }}
                                 />
                              </div>
                              <div className="space-y-1">
                                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Opening Bal</label>
                                 <input 
                                   type="number" 
                                   value={newLedgerOpeningBal}
                                   onChange={e => setNewLedgerOpeningBal(Number(e.target.value))}
                                   className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold focus:ring-2 focus:ring-indigo-100 outline-none"
                                   placeholder="0.00"
                                 />
                              </div>
                              <div className="space-y-1">
                                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Group</label>
                                 <select 
                                   value={newLedgerGroup}
                                   onChange={e => setNewLedgerGroup(e.target.value)}
                                   className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold focus:ring-2 focus:ring-indigo-100 outline-none h-[30px]"
                                 >
                                    <option value="Sundry Debtors">Sundry Debtors</option>
                                    <option value="Sundry Creditors">Sundry Creditors</option>
                                    <option value="Direct Expenses">Direct Expenses</option>
                                    <option value="Indirect Expenses">Indirect Expenses</option>
                                    <option value="Direct Incomes">Direct Incomes</option>
                                    <option value="Indirect Incomes">Indirect Incomes</option>
                                    <option value="Purchase Accounts">Purchase Accounts</option>
                                    <option value="Sales Accounts">Sales Accounts</option>
                                    <option value="Bank Accounts">Bank Accounts</option>
                                 </select>
                              </div>
                           </div>
                           
                           <button 
                             type="button"
                             className="text-[10px] bg-indigo-600 text-white px-3 py-2.5 rounded-xl font-black hover:bg-slate-900 transition-all w-full shadow-lg shadow-indigo-100 disabled:opacity-50"
                             disabled={!partySearch || isSaving}
                             onClick={handleCreateLedger}
                           >
                             {isSaving ? 'CREATING...' : 'CREATE & SELECT LEDGER'}
                           </button>
                        </div>
                      )}
                   </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center px-1">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest">{type === 'Receipt' ? 'Deposit Into' : 'Pay From'} (Bank/Cash)*</label>
              <button 
                type="button"
                onClick={() => {
                  setShowAddBank(!showAddBank);
                  setNewBankName('');
                  setNewBankOpeningBal(0);
                }}
                className="text-[10px] text-indigo-600 font-bold hover:underline"
              >
                {showAddBank ? 'Cancel Quick Add' : '+ Add Bank/Cash'}
              </button>
            </div>

            {showAddBank ? (
              <div className="p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100 space-y-3">
                <p className="text-[10px] font-black text-indigo-700 uppercase tracking-wide">Quick Add Bank/Cash Account</p>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="e.g. State Bank of India or Cash Account"
                    value={newBankName}
                    onChange={e => setNewBankName(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-505"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1">Group</label>
                      <select
                        value={newBankGroup}
                        onChange={e => setNewBankGroup(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-bold outline-none"
                      >
                        <option value="Bank Accounts">Bank Accounts</option>
                        <option value="Cash-in-hand">Cash-in-hand</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1">Opening Bal</label>
                      <input
                        type="number"
                        placeholder="0.00"
                        value={newBankOpeningBal}
                        onChange={e => setNewBankOpeningBal(Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-bold outline-none font-mono"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newBankName.trim()) {
                        alert("Please enter a name");
                        return;
                      }
                      try {
                        const ledgerData = {
                          name: newBankName.trim(),
                          group: newBankGroup,
                          openingBalance: Number(newBankOpeningBal),
                          currentBalance: Number(newBankOpeningBal),
                          companyId: company.id,
                          createdAt: new Date().toISOString()
                        };
                        const ref = await dbService.add(`companies/${company.id}/ledgers`, ledgerData);
                        setSelectedBank({ id: ref.id, ...ledgerData });
                        setShowAddBank(false);
                        setNewBankName('');
                        setNewBankOpeningBal(0);
                      } catch (err) {
                        alert("Failed to create bank/cash ledger");
                      }
                    }}
                    className="w-full bg-indigo-600 text-white rounded-xl py-2 text-xs font-black uppercase tracking-widest hover:bg-slate-900 transition-all"
                  >
                    Create & Select
                  </button>
                </div>
              </div>
            ) : (
              <div className="relative group">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-center text-slate-400 group-focus-within:bg-indigo-600 group-focus-within:text-white transition-all">
                  <Wallet size={14} />
                </div>
                <select 
                  className="w-full bg-white border border-slate-200 rounded-xl pl-14 pr-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-50 focus:border-indigo-600 outline-none transition-all appearance-none"
                  value={selectedBank?.id || ''}
                  onChange={e => setSelectedBank(banks.find(b => b.id === e.target.value))}
                >
                  <option value="">Select account...</option>
                  {banks.map(b => <option key={b.id} value={b.id}>{b.name} (Bal: ₹{(b.currentBalance || 0).toLocaleString()})</option>)}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <ChevronDown size={18} />
                </div>
              </div>
            )}
          </div>

          {selectedBank && ['Bank Accounts', 'Bank'].includes(selectedBank.group) && (
            <div className="p-4 bg-slate-50 border border-slate-201/80 rounded-2xl space-y-3 animate-fadeIn">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Bank Transaction Ref / Cheque</span>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider block">Cheque / Ref Number</label>
                  <input
                    type="text"
                    value={chequeNo}
                    onChange={e => setChequeNo(e.target.value)}
                    placeholder="e.g. 102983, TXN-3829"
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none text-slate-800 focus:border-indigo-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-slate-400 font-extrabold uppercase tracking-wider block">Clearance Date</label>
                  <input
                    type="date"
                    value={clearanceDate}
                    onChange={e => setClearanceDate(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none text-slate-800 focus:border-indigo-600"
                  />
                </div>
              </div>
            </div>
          )}

          {company?.bankAccounts && company.bankAccounts.length > 0 && (
            <div className="space-y-2 bg-indigo-50/25 p-4 rounded-xl border border-indigo-100/40">
              <label className="text-xs font-black text-indigo-905 uppercase tracking-widest px-1">Company Bank Details Printed on Voucher</label>
              <select
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:ring-4 focus:ring-indigo-50 focus:border-indigo-600 outline-none transition-all"
                value={selectedCompanyBankId}
                onChange={(e) => {
                  setSelectedCompanyBankId(e.target.value);
                  const found = company.bankAccounts.find((acc: any) => acc.id === e.target.value);
                  setSelectedCompanyBank(found || null);
                }}
              >
                {company.bankAccounts.map((acc: any) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.bankName} - A/C: {acc.accountNumber} {acc.isDefault ? '(Default)' : ''}
                  </option>
                ))}
                <option value="">Do Not Print Bank Details on printed Voucher</option>
              </select>
            </div>
          )}
        </div>

        <div className="card p-8 flex flex-col justify-between space-y-6">
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest px-1">Amount (₹)*</label>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-indigo-600 transition-colors">
                  <IndianRupee size={28} />
                </div>
                <input 
                  type="number" 
                  step="0.01"
                  value={amount || ''} 
                  onChange={e => setAmount(Number(e.target.value) || 0)} 
                  className="w-full bg-slate-50 border-2 border-transparent rounded-2xl pl-14 pr-6 py-4 text-3xl font-black text-slate-900 focus:bg-white focus:border-indigo-600 focus:ring-4 focus:ring-indigo-50 outline-none transition-all" 
                  placeholder="0.00"
                />
              </div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest text-center">Amount in words: {amount > 0 ? numberToWords(amount) : 'Zero Rupees Only'}</p>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-4">
              <div className="flex justify-between items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                   <input 
                      type="checkbox" 
                      checked={isTdsEnabled}
                      onChange={e => setIsTdsEnabled(e.target.checked)}
                      className="w-4 h-4 rounded text-indigo-600"
                   />
                   <span className="text-sm font-bold text-slate-700">Apply TDS / TCS?</span>
                </label>
                {isTdsEnabled && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold text-slate-400">Rate</span>
                    <input 
                      type="number" 
                      value={tdsRate} 
                      onChange={e => setTdsRate(Number(e.target.value))}
                      className="w-16 input-field py-1 text-center font-bold"
                    />
                    <span className="text-xs font-bold text-slate-400">%</span>
                  </div>
                )}
              </div>
              
              {isTdsEnabled && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-2 pt-2 border-t border-slate-200 font-display">
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>Gross Amount</span>
                    <span className="font-bold">₹{amount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs text-red-600 font-bold">
                    <span>TDS Deducted (-)</span>
                    <span className="font-bold">₹{tdsAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm font-black text-indigo-600 pt-1">
                    <span>{type === 'Receipt' ? 'Net Receipt' : 'Net Payment'}</span>
                    <span className="font-extrabold text-base">₹{netAmount.toLocaleString()}</span>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Cost Centre Allocations Compliance Widget */}
            <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-200 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[10px] font-black text-slate-800 uppercase tracking-widest block">Cost Centre Allocations</span>
                  <p className="text-[10px] text-slate-400 font-medium mt-0.5 leading-tight">Allocate receipt/payment outlays to specific branches, departments, or projects</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isCostAllocEnabled}
                    onChange={e => {
                      setIsCostAllocEnabled(e.target.checked);
                      if (e.target.checked && costAllocations.length === 0) {
                        setCostAllocations([{ costCentreId: costCentres[0]?.id || '', costCentreName: costCentres[0]?.name || '', amount: amount }]);
                      }
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-focus:outline-hidden peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                  <span className="text-[9px] font-black text-slate-500 ml-2 select-none uppercase tracking-wider">Allocate</span>
                </label>
              </div>

              {isCostAllocEnabled && (
                <div className="space-y-4 border-t border-slate-200 pt-4 animate-fadeIn">
                  {/* Create Cost Centre Inline */}
                  {showAddCostCentre ? (
                    <div className="p-3 bg-white border border-indigo-100 rounded-xl space-y-2 shadow-xs">
                      <span className="text-[9px] font-black text-indigo-700 uppercase block">Quick Add Cost Centre</span>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newCostCentreName}
                          onChange={e => setNewCostCentreName(e.target.value)}
                          placeholder="e.g. Mumbai Project, Delivery Van-12"
                          className="flex-grow bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold outline-none focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-100"
                        />
                        <button
                          type="button"
                          onClick={handleCreateCostCentre}
                          className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-slate-900 transition-all"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAddCostCentre(false)}
                          className="px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg text-xs font-bold"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Allocations Checklist</span>
                      <button
                        type="button"
                        onClick={() => setShowAddCostCentre(true)}
                        className="text-[10px] text-indigo-600 font-extrabold flex items-center gap-1 hover:underline uppercase tracking-wide"
                      >
                        + Add Cost Centre
                      </button>
                    </div>
                  )}

                  {/* Allocations Table */}
                  <div className="space-y-2">
                    {costAllocations.map((alloc, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-white p-2.5 rounded-xl border border-slate-150 shadow-2xs">
                        <select
                          value={alloc.costCentreId || ''}
                          onChange={e => {
                            const selected = costCentres.find(cc => cc.id === e.target.value);
                            const updated = [...costAllocations];
                            updated[idx].costCentreId = e.target.value;
                            updated[idx].costCentreName = selected ? selected.name : '';
                            setCostAllocations(updated);
                          }}
                          className="flex-grow bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs font-bold text-slate-700 outline-none focus:bg-white focus:border-indigo-600"
                        >
                          <option value="">Select cost centre...</option>
                          {costCentres.map(cc => (
                            <option key={cc.id} value={cc.id}>{cc.name}</option>
                          ))}
                        </select>
                        <input
                          type="number"
                          value={alloc.amount || ''}
                          onChange={e => {
                            const updated = [...costAllocations];
                            updated[idx].amount = Number(e.target.value) || 0;
                            setCostAllocations(updated);
                          }}
                          placeholder="Amount"
                          className="w-28 bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs font-bold text-slate-700 outline-none text-right font-mono focus:bg-white focus:border-indigo-600"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = costAllocations.filter((_, i) => i !== idx);
                            setCostAllocations(updated);
                          }}
                          className="p-1 hover:bg-slate-100 rounded text-rose-500 hover:text-rose-700 transition"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}

                    <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => {
                          setCostAllocations([
                            ...costAllocations,
                            { costCentreId: costCentres[0]?.id || '', costCentreName: costCentres[0]?.name || '', amount: 0 }
                          ]);
                        }}
                        className="text-[10px] text-indigo-600 font-extrabold uppercase tracking-wide hover:underline"
                      >
                        + Add Allocation Row
                      </button>
                      
                      <div className="text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        <span>Total Allocated: </span>
                        <span className={`font-mono font-extrabold ${Math.abs(costAllocations.reduce((sum, cc) => sum + Number(cc.amount || 0), 0) - amount) < 0.01 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          ₹{costAllocations.reduce((sum, cc) => sum + Number(cc.amount || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span> / ₹{amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="label">Narration / Remarks</label>
              <textarea 
                value={narration}
                onChange={e => setNarration(e.target.value)}
                className="input-field h-32 resize-none"
                placeholder="Enter transaction details..."
              ></textarea>
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-slate-100">
            <button 
              disabled={isSaving}
              onClick={() => handleSave(false)} 
              className={`w-full py-4 bg-indigo-600 text-white rounded-2xl font-black flex items-center justify-center gap-3 hover:bg-slate-900 transition-all shadow-xl shadow-indigo-100 ${isSaving ? 'opacity-50' : ''}`}
            >
              {isSaving ? <RefreshCw size={24} className="animate-spin" /> : <Save size={24} />} 
              {prefillData?.id ? 'UPDATE VOUCHER' : 'CONFIRM & POST VOUCHER'}
            </button>
            <p className="text-[10px] text-center text-slate-400 font-bold uppercase tracking-widest">
              By posting, you agree to update real-time ledger balances
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
