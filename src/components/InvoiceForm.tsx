import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Save, Printer, Send, Calculator, Search, ShoppingBag, ArrowLeft, RefreshCw, Eye, ChevronDown, Download, FileCode } from 'lucide-react';
import { motion } from 'motion/react';
import { dbService } from '../lib/db';
import { calculateGST, validateGSTIN, GST_STATES, numberToWords } from '../lib/gst-utils';
import { where } from 'firebase/firestore';
import { toCanvas } from 'html-to-image';
import { jsPDF } from 'jspdf';

export const InvoiceForm = ({ company, type, onSave, onCancel, prefillData, activeFY, autoPreview = false }: any) => {
  const isAccountsOnly = company?.accountingMode === 'AccountsOnly';
  const [parties, setParties] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [banks, setBanks] = useState<any[]>([]);
  const [selectedParty, setSelectedParty] = useState<any>(null);
  const [paymentMode, setPaymentMode] = useState(prefillData?.isPaid ? (prefillData.bankId ? 'Bank' : 'Cash') : 'Credit');
  const [selectedBankId, setSelectedBankId] = useState(prefillData?.bankId || '');
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
  const [rows, setRows] = useState<any[]>(prefillData?.items ? prefillData.items.map((i: any, idx: number) => ({
    id: i.id || idx,
    itemId: i.itemId || '',
    name: i.name || '',
    qty: i.qty || 1,
    rate: i.rate || 0,
    gstRate: i.gstRate || 0,
    amount: (i.qty || 1) * (i.rate || 0),
    cgst: i.cgst || 0,
    sgst: i.sgst || 0,
    igst: i.igst || 0,
    tax: i.tax || 0
  })) : [{ id: 1, itemId: '', name: '', qty: 1, rate: 0, gstRate: 18, amount: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 }]);
  const [voucherNumber, setVoucherNumber] = useState(prefillData?.voucherNumber || '');
  const [seqSettings, setSeqSettings] = useState<any>({ prefix: '', suffix: '', padding: 1, lastNumber: 0 });
  const [showSeqSettings, setShowSeqSettings] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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
  const [itcEligible, setItcEligible] = useState(prefillData?.itcEligible !== undefined ? prefillData.itcEligible : true);
  const [reverseCharge, setReverseCharge] = useState(prefillData?.reverseCharge || false);
  
  // e-Invoice & e-Way Bill Readiness States
  const [isEInvoiceEligible, setIsEInvoiceEligible] = useState(prefillData?.isEInvoiceEligible || false);
  const [fivCrTurnoverConfirmed, setFivCrTurnoverConfirmed] = useState(prefillData?.fivCrTurnoverConfirmed || false);
  const [eInvoiceIRN, setEInvoiceIRN] = useState(prefillData?.eInvoiceIRN || '');
  const [eInvoiceAckNo, setEInvoiceAckNo] = useState(prefillData?.eInvoiceAckNo || '');
  const [eInvoiceAckDate, setEInvoiceAckDate] = useState(prefillData?.eInvoiceAckDate || '');
  const [eWayBillNo, setEWayBillNo] = useState(prefillData?.eWayBillNo || '');
  const [eWayBillDate, setEWayBillDate] = useState(prefillData?.eWayBillDate || '');
  const [eWayBillStatus, setEWayBillStatus] = useState(prefillData?.eWayBillStatus || 'Pending');

  // Auto-detect RCM from selected party ledger
  useEffect(() => {
    if (type === 'Purchases' && selectedParty) {
      if (selectedParty.subjectToRCM) {
        setReverseCharge(true);
      } else {
        setReverseCharge(false);
      }
    }
  }, [selectedParty, type]);

  const [dispatchDetails, setDispatchDetails] = useState({
    dispatchedThrough: prefillData?.dispatchedThrough || '',
    destination: prefillData?.destination || '',
    billOfLading: prefillData?.billOfLading || '', // LR No/RR No
    motorVehicleNo: prefillData?.motorVehicleNo || ''
  });
  const [showAddParty, setShowAddParty] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [triggerPrint, setTriggerPrint] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const invoiceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefillData?.autoPreview) {
      // Wait for data to load before showing preview
      const timer = setTimeout(() => {
        setShowPreview(true);
        setTriggerPrint(true);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [prefillData?.autoPreview]);

  useEffect(() => {
    if (showPreview && triggerPrint) {
      const timer = setTimeout(() => {
        window.print();
        setTriggerPrint(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [showPreview, triggerPrint]);

  useEffect(() => {
    const fetchNextNumber = async () => {
      if (company?.id && activeFY?.id) {
        setIsGenerating(true);
        const seqId = `${type}_${activeFY.id}`;
        const seq = await dbService.get(`companies/${company.id}/sequences`, seqId) as any;
        
        if (seq) {
          setSeqSettings(seq);
          if (!prefillData?.id && !voucherNumber) {
            const next = seq.lastNumber + 1;
            const formatted = next.toString().padStart(seq.padding || 1, '0');
            setVoucherNumber(`${seq.prefix || ''}${formatted}${seq.suffix || ''}`);
          }
        } else if (!prefillData?.id && !voucherNumber) {
          setVoucherNumber('1');
        }
        setIsGenerating(false);
      }
    };
    fetchNextNumber();
  }, [company.id, type, activeFY.id, prefillData?.id]);

  const downloadPDF = async () => {
    if (!invoiceRef.current) return;
    setIsDownloading(true);
    try {
      // Small delay to ensure styles are applied
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const canvas = await toCanvas(invoiceRef.current, {
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
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${type}_${voucherNumber || 'Invoice'}.pdf`);
    } catch (error) {
      console.error('PDF Generation Error:', error);
      alert('Failed to generate PDF. Please try again or use the Print option.');
    } finally {
      setIsDownloading(false);
    }
  };

  const shareOnWhatsApp = () => {
    if (!selectedParty) return alert('Select a party first');
    const text = `*Invoice from ${company.name}*%0A%0A` +
      `*Bill Type:* ${type}%0A` +
      `*Invoice No:* ${voucherNumber}%0A` +
      `*Date:* ${date}%0A` +
      `*Total Amount:* ₹${roundedTotal.toLocaleString()}%0A%0A` +
      `Please find your invoice attached or view it on our portal.%0A%0A` +
      `_Generated via Lekha Sahayak_`;
    
    const phone = selectedParty.phone ? selectedParty.phone.replace(/\D/g, '') : '';
    const url = `https://api.whatsapp.com/send?${phone ? `phone=91${phone}&` : ''}text=${text}`;
    window.open(url, '_blank');
  };

  const exportEWayBillJSON = () => {
    if (!selectedParty?.gstIn) return alert('E-Way Bill requires Party GSTIN');
    if (!company.gstIn) return alert('E-Way Bill requires Company GSTIN');

    const ewayData = {
      version: "1.0.0",
      billLists: [{
        userGstin: company.gstIn,
        supplyType: type === 'Sales' ? "O" : "I",
        subSupplyType: "1",
        docType: "INV",
        docNo: voucherNumber,
        docDate: date.split('-').reverse().join('/'),
        fromGstin: type === 'Sales' ? company.gstIn : selectedParty.gstIn,
        fromTrdName: type === 'Sales' ? company.name : selectedParty.name,
        fromAddr1: type === 'Sales' ? company.address.substring(0, 50) : (selectedParty.address?.substring(0, 50) || "N/A"),
        fromPlace: company.state,
        fromPincode: 400001, // Mock or add to settings
        fromStateCode: parseInt(company.stateCode),
        toGstin: type === 'Sales' ? selectedParty.gstIn : company.gstIn,
        toTrdName: type === 'Sales' ? selectedParty.name : company.name,
        toAddr1: type === 'Sales' ? (selectedParty.address?.substring(0, 50) || "N/A") : company.address.substring(0, 50),
        toPlace: selectedParty.state,
        toPincode: 400001,
        toStateCode: parseInt(selectedParty.stateCode),
        totalValue: subTotal,
        cgstValue: cgst,
        sgstValue: sgst,
        igstValue: igst,
        totInvValue: roundedTotal,
        itemList: rows.map((r, i) => ({
          itemNo: i + 1,
          productName: r.name,
          productDesc: r.name,
          hsnCode: parseInt(items.find(it => it.id === r.itemId)?.hsn || "0"),
          quantity: r.qty,
          qtyUnit: "PCS",
          taxableAmount: r.amount,
          sgstRate: !isInterState ? r.gstRate / 2 : 0,
          cgstRate: !isInterState ? r.gstRate / 2 : 0,
          igstRate: isInterState ? r.gstRate : 0,
        }))
      }]
    };

    const blob = new Blob([JSON.stringify(ewayData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `EWayBill_${voucherNumber}.json`;
    a.click();
  };

  useEffect(() => {
    // Fetch parties (debtors for sales, creditors for purchases)
    const partyGroup = ['Sales', 'sales'].includes(type) ? ['Sundry Debtors', 'Cash-in-hand'] : ['Sundry Creditors', 'Cash-in-hand'];
    dbService.listenCollection(`companies/${company.id}/ledgers`, [where('group', 'in', partyGroup)], (data) => {
      setParties(data);
      if (prefillData?.partyId) {
        const matched = data.find(p => p.id === prefillData.partyId);
        if (matched) setSelectedParty(matched);
      } else if (prefillData?.vendorName) {
        const matched = data.find(p => (p.name || '').toLowerCase().includes((prefillData.vendorName || '').toLowerCase()) || (p.gstIn && prefillData.gstin && p.gstIn === prefillData.gstin));
        if (matched) setSelectedParty(matched);
      }
    });
    dbService.listenCollection(`companies/${company.id}/items`, [], (data) => {
      setItems(data);
      if (prefillData?.items && prefillData.items.length > 0) {
        setRows(prevRows => prevRows.map(row => {
          if (!row.itemId && row.name) {
            const matchedItem = data.find(it => 
              (it.name || '').toLowerCase() === (row.name || '').toLowerCase() || 
              (row.name || '').toLowerCase().includes((it.name || '').toLowerCase()) || 
              (it.name || '').toLowerCase().includes((row.name || '').toLowerCase())
            );
            if (matchedItem) {
              const itemRate = row.rate || (['Sales', 'sales'].includes(type) ? matchedItem.salesPrice : matchedItem.purchasePrice) || 0;
              const itemGstRate = row.gstRate !== undefined && row.gstRate !== null && row.gstRate !== 0 ? row.gstRate : (matchedItem.gstRate || 18);
              const itemAmt = (row.qty || 1) * itemRate;
              const isInter = selectedParty?.stateCode && selectedParty.stateCode !== company.stateCode;
              const taxes = calculateGST(itemAmt, itemGstRate, isInter);
              return {
                ...row,
                itemId: matchedItem.id,
                name: matchedItem.name,
                rate: itemRate,
                gstRate: itemGstRate,
                amount: itemAmt,
                cgst: taxes.cgst,
                sgst: taxes.sgst,
                igst: taxes.igst,
                tax: taxes.cgst + taxes.sgst + taxes.igst
              };
            }
          }
          return row;
        }));
      }
    });
    dbService.listenCollection(`companies/${company.id}/ledgers`, [where('group', 'in', ['Bank Accounts', 'Bank', 'Cash-in-hand', 'Cash'])], (data) => {
      setBanks(data);
      if (!selectedBankId && data.length > 0) {
        setSelectedBankId(data[0].id);
      }
    });
  }, [company.id, type, prefillData]);

  const handleAddParty = async (e: any) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const gstIn = data.get('gstIn') as string;
    const registrationType = data.get('registrationType') as string;
    const stateCode = data.get('stateCode') as string;
    const validation = validateGSTIN(gstIn);
    
    const ledger = {
      name: data.get('name'),
      group: ['Sales', 'sales'].includes(type) ? 'Sundry Debtors' : 'Sundry Creditors',
      registrationType,
      gstIn: registrationType === 'Unregistered' ? '' : gstIn,
      state: GST_STATES[stateCode] || (validation.valid ? validation.stateName : ''),
      stateCode: stateCode || (validation.valid ? validation.stateCode : ''),
      openingBalance: 0,
      currentBalance: 0,
      companyId: company.id
    };
    const newParty = await dbService.add(`companies/${company.id}/ledgers`, ledger);
    setSelectedParty({ id: newParty.id, ...ledger });
    setShowAddParty(false);
  };

  const handleAddItem = async (e: any) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const item = {
      name: data.get('name'),
      hsn: data.get('hsn'),
      unit: data.get('unit'),
      gstRate: Number(data.get('gstRate')),
      salesPrice: Number(data.get('salesPrice')),
      purchasePrice: Number(data.get('purchasePrice')),
      stockLevel: Number(data.get('stockLevel')),
      companyId: company.id
    };
    const newItem = await dbService.add(`companies/${company.id}/items`, item);
    // Find the last row and update it
    setRows(prev => prev.map((r, i) => i === prev.length - 1 ? { 
      ...r, 
      itemId: newItem.id, 
      name: item.name, 
      rate: ['Sales', 'sales'].includes(type) ? item.salesPrice : item.purchasePrice,
      gstRate: item.gstRate,
      amount: (['Sales', 'sales'].includes(type) ? item.salesPrice : item.purchasePrice) * r.qty
    } : r));
    setShowAddItem(false);
  };

  const addRow = () => {
    setRows([...rows, { id: Date.now(), itemId: '', name: '', qty: 1, rate: 0, gstRate: 18, amount: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 }]);
  };

  const removeRow = (id: number) => {
    if (rows.length > 1) setRows(rows.filter(r => r.id !== id));
  };

  const updateRow = (id: number, field: string, value: any) => {
    const newRows = rows.map(row => {
      if (row.id === id) {
        const updatedRow = { ...row, [field]: value };
        if (isAccountsOnly) {
          if (field === 'name') {
            updatedRow.name = value;
            updatedRow.itemId = 'none';
            updatedRow.qty = 1;
            updatedRow.rate = updatedRow.amount;
          } else if (field === 'amount') {
            updatedRow.amount = value;
            updatedRow.qty = 1;
            updatedRow.rate = value;
          } else if (field === 'gstRate') {
            updatedRow.gstRate = value;
          }
        } else {
          if (field === 'itemId') {
            const item = items.find(i => i.id === value);
            if (item) {
              updatedRow.name = item.name;
              updatedRow.rate = ['Sales', 'sales'].includes(type) ? item.salesPrice : item.purchasePrice;
              updatedRow.gstRate = item.gstRate;
            }
            updatedRow.amount = updatedRow.qty * updatedRow.rate;
          } else if (field === 'amount') {
            // If editing subtotal directly, adjust rate
            updatedRow.rate = updatedRow.qty > 0 ? value / updatedRow.qty : 0;
            updatedRow.amount = value;
          } else {
            // Normal case: update amount based on qty/rate
            updatedRow.amount = updatedRow.qty * updatedRow.rate;
          }
        }
        
        // Per-row GST calculation
        const taxes = calculateGST(updatedRow.amount, updatedRow.gstRate, isInterState);
        updatedRow.cgst = taxes.cgst;
        updatedRow.sgst = taxes.sgst;
        updatedRow.igst = taxes.igst;
        updatedRow.tax = taxes.cgst + taxes.sgst + taxes.igst;

        return updatedRow;
      }
      return row;
    });
    setRows(newRows);
  };

  const subTotal = rows.reduce((acc, r) => acc + r.amount, 0);
  
  // Resilient dual-tax auto-classification (State selection-based + GSTIN prefix fallback)
  const getGstStateCode = (gst: string) => {
    if (!gst || gst.length < 2) return '';
    const code = gst.substring(0, 2);
    return /^\d{2}$/.test(code) ? code : '';
  };
  
  const compStateCode = company?.stateCode || getGstStateCode(company?.gstIn) || '07'; 
  const partyStateCode = selectedParty?.stateCode || getGstStateCode(selectedParty?.gstIn) || compStateCode;
  const isInterState = compStateCode && partyStateCode && compStateCode !== partyStateCode;
  
  useEffect(() => {
    setRows(prevRows => prevRows.map(row => {
      const taxes = calculateGST(row.amount, row.gstRate, !!isInterState);
      return {
        ...row,
        cgst: taxes.cgst,
        sgst: taxes.sgst,
        igst: taxes.igst,
        tax: taxes.cgst + taxes.sgst + taxes.igst
      };
    }));
  }, [isInterState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        setShowAddParty(true);
      } else if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        addRow();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSave(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rows, selectedParty, paymentMode, selectedBankId, date, voucherNumber, seqSettings, isSaving]);
  
  // Calculate Taxes
  let cgst = 0, sgst = 0, igst = 0;

  rows.forEach(row => {
    const taxes = calculateGST(row.amount, row.gstRate, isInterState);
    cgst += taxes.cgst;
    sgst += taxes.sgst;
    igst += taxes.igst;
  });

  const totalTax = cgst + sgst + igst;
  const totalAmount = subTotal + totalTax;
  const roundedTotal = Math.round(totalAmount);
  const roundOff = (roundedTotal - totalAmount).toFixed(2);

  const handleSave = async (andNew = false) => {
    // Comprehensive Validation
    const errors = [];
    if (!selectedParty) errors.push(`Please select a ${['Sales', 'sales'].includes(type) ? 'Customer' : 'Vendor'}.`);
    
    const validRows = rows.filter(r => isAccountsOnly ? (r.name && r.amount > 0) : (r.itemId && r.qty > 0 && r.rate > 0));
    if (validRows.length === 0) {
      errors.push(isAccountsOnly ? 'Please add at least one item with description and amount.' : 'Please add at least one item with quantity and rate.');
    }

    if (paymentMode !== 'Credit' && !selectedBankId) {
      errors.push('Please select a Bank or Cash account for this paid bill.');
    }

    if (!date) {
      errors.push('Please select a valid invoice date.');
    } else if (activeFY) {
      if (date < activeFY.startDate || date > activeFY.endDate) {
        errors.push(`Invoice date must be within the active financial year ${activeFY.label || ''} (${activeFY.startDate} to ${activeFY.endDate}).`);
      }
    }
    if (!voucherNumber || voucherNumber.trim() === '') errors.push('Invoice/Voucher number cannot be empty.');

    // 1. Client-Side Checksum Validation of Party GSTIN
    if (selectedParty && selectedParty.gstIn && selectedParty.registrationType !== 'Unregistered') {
      const gstinToValidate = selectedParty.gstIn.trim().toUpperCase();
      const gstCheck = validateGSTIN(gstinToValidate);
      if (!gstCheck.valid) {
        errors.push(`Party GSTIN Checksum Verification Failure: ${gstCheck.message}. Please correct the Ledger record.`);
      }
    }

    // 2. e-Invoice Checklist Validation
    if (isEInvoiceEligible) {
      if (!fivCrTurnoverConfirmed) {
        errors.push("e-Invoice Checklist: Please confirm that your aggregate turnover is above ₹5 Crore (technical prerequisite).");
      }
      if (!selectedParty?.gstIn || selectedParty.registrationType === 'Unregistered') {
        errors.push("e-Invoice Requirement: Recipient must be a GST-registered business with a valid GSTIN.");
      }
    }

    if (errors.length > 0) {
      alert("Please Correct the Following Errors:\n\n" + errors.map((err, i) => `${i + 1}. ${err}`).join('\n'));
      return;
    }

    if (isSaving) return;
    
    setIsSaving(true);
    try {
      // Final check for voucher number
      let finalVoucherNumber = voucherNumber;
      
      // Check for duplicate voucher number
      const isDuplicate = await dbService.checkDuplicateVoucher(
          company.id, 
          type, 
          activeFY.id, 
          finalVoucherNumber, 
          prefillData?.id
      );
      if (isDuplicate) {
        alert(`Error: A ${type} document with number "${finalVoucherNumber}" already exists in this financial year. Please use a unique number to avoid duplicates.`);
        setIsSaving(false);
        return;
      }
      
      const transaction = {
        type: type || '',
        date: date || new Date().toISOString().split('T')[0],
        voucherNumber: finalVoucherNumber || '',
        partyId: selectedParty?.id || null,
        partyName: selectedParty?.name || null,
        isPaid: paymentMode !== 'Credit',
        bankId: paymentMode !== 'Credit' ? (selectedBankId || null) : null,
        bankName: paymentMode !== 'Credit' ? (banks.find(b => b.id === selectedBankId)?.name || null) : null,
        printedBankDetails: selectedCompanyBank || null,
        itcEligible: type === 'Purchases' ? !!itcEligible : false,
        reverseCharge: !!reverseCharge,
        
        // e-Invoice & e-Way Bill Fields on Schema
        isEInvoiceEligible: !!isEInvoiceEligible,
        fivCrTurnoverConfirmed: !!fivCrTurnoverConfirmed,
        eInvoiceIRN: eInvoiceIRN || '',
        eInvoiceAckNo: eInvoiceAckNo || '',
        eInvoiceAckDate: eInvoiceAckDate || '',
        eWayBillNo: eWayBillNo || '',
        eWayBillDate: eWayBillDate || '',
        eWayBillStatus: eWayBillStatus || 'Pending',

        dispatchedThrough: dispatchDetails.dispatchedThrough || '',
        destination: dispatchDetails.destination || '',
        billOfLading: dispatchDetails.billOfLading || '',
        motorVehicleNo: dispatchDetails.motorVehicleNo || '',
        items: validRows.map(({ id, ...rest }) => ({
          itemId: rest.itemId || '',
          name: rest.name || '',
          qty: Number(rest.qty) || 0,
          rate: Number(rest.rate) || 0,
          gstRate: Number(rest.gstRate) || 0,
          amount: Number(rest.amount) || 0,
          cgst: Number(rest.cgst) || 0,
          sgst: Number(rest.sgst) || 0,
          igst: Number(rest.igst) || 0,
          tax: Number(rest.tax) || 0
        })),
        subTotal: Number(subTotal) || 0,
        cgst: Number(cgst) || 0,
        sgst: Number(sgst) || 0,
        igst: Number(igst) || 0,
        totalTax: Number(totalTax) || 0,
        totalAmount: Number(roundedTotal) || 0,
        roundOff: Number(roundOff) || 0,
        companyId: company?.id || '',
        fy: activeFY?.id || '',
        updatedAt: new Date().toISOString()
      };

      if (prefillData?.id) {
        await dbService.updateTransactionWithStock(company.id, prefillData.id, transaction);
      } else {
        await dbService.addTransactionWithStock(company.id, transaction);
        
        // Update sequence tracking
        const seqId = `${type}_${activeFY.id}`;
        let numToStore = seqSettings.lastNumber + 1;
        
        await dbService.set(`companies/${company.id}/sequences`, seqId, {
          ...seqSettings,
          type,
          fy: activeFY.id,
          lastNumber: numToStore,
          companyId: company.id
        });
      }

      if (andNew) {
        setRows([{ id: Date.now(), itemId: '', name: '', qty: 1, rate: 0, gstRate: 18, amount: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 }]);
        setSelectedParty(null);
        setVoucherNumber('');
        alert('Invoice Saved Successfully. You can create the next one.');
      } else {
        onSave();
      }
    } catch (error) {
      console.error("Save failed:", error);
      alert("Failed to save transaction. Please check your internet connection or valid data.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div className="flex items-center gap-4">
          <button onClick={onCancel} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500" title="Go Back">
            <ArrowLeft size={20} />
          </button>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <div className={`p-2 rounded-lg ${type === 'Sales' ? 'bg-emerald-100 text-emerald-600' : 'bg-orange-100 text-orange-600'}`}>
              <ShoppingBag size={20} />
            </div>
            {prefillData?.id ? 'Edit' : 'New'} {type} Invoice
          </h2>
        </div>
        <div className="flex gap-3">
          {prefillData?.id && (
            <div className="flex items-center gap-2">
              {showDeleteConfirm ? (
                <div className="flex items-center gap-2 bg-red-50 p-1.5 rounded-lg border border-red-100">
                  <span className="text-xs text-red-700 font-medium px-2">Are you sure?</span>
                  <button 
                    disabled={isSaving}
                    onClick={async () => {
                      try {
                        await dbService.deleteTransactionWithStock(company.id, prefillData.id);
                        onSave(); // Exit form
                      } catch (err) {
                        console.error("Error deleting invoice:", err);
                        alert("Failed to delete invoice: " + (err instanceof Error ? err.message : String(err)));
                      }
                    }}
                    className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-3 py-1.5 rounded-md shadow-sm transition-colors"
                  >
                    Yes, Delete
                  </button>
                  <button 
                    disabled={isSaving}
                    onClick={() => setShowDeleteConfirm(false)}
                    className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-medium px-3 py-1.5 rounded-md shadow-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button 
                  disabled={isSaving}
                  onClick={() => setShowDeleteConfirm(true)}
                  className="btn-secondary text-red-600 border-red-100 hover:bg-red-50"
                >
                  <Trash2 size={18} /> Delete
                </button>
              )}
            </div>
          )}
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
            {prefillData?.id ? 'Update Bill' : 'Save & Post'}
            <span className="ml-1 bg-indigo-700 text-indigo-100 border border-indigo-500 rounded px-1.5 py-0.5 text-[9px] font-mono select-none">Ctrl+S</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 card p-6 space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="label flex justify-between items-center">
                <span>{['Sales', 'sales'].includes(type) ? 'Customer' : 'Vendor'} Name*</span>
                <button onClick={() => setShowAddParty(true)} className="text-indigo-600 hover:bg-slate-100 p-1 rounded-lg flex items-center gap-1">
                  <Plus size={14} className="inline mr-1" /> New
                  <span className="bg-slate-100 border border-slate-200 text-slate-600 rounded px-1.5 py-0.5 text-[9px] font-mono select-none">F2</span>
                </button>
              </label>
              <select 
                className="input-field"
                value={selectedParty?.id || ''}
                onChange={e => {
                  const party = parties.find(p => p.id === e.target.value);
                  setSelectedParty(party);
                  if (party?.group === 'Cash-in-hand') {
                    setPaymentMode('Cash');
                    setSelectedBankId(party.id);
                  }
                }}
              >
                <option value="">Select party...</option>
                {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Invoice Date*</label>
              <input 
                type="date" 
                value={date} 
                onChange={e => setDate(e.target.value)} 
                min={activeFY?.startDate}
                max={activeFY?.endDate}
                className="input-field" 
              />
            </div>
            <div>
              <label className="label">Payment Mode</label>
              <select 
                className="input-field" 
                value={paymentMode} 
                onChange={e => setPaymentMode(e.target.value)}
              >
                <option value="Credit">Credit (Unpaid)</option>
                <option value="Cash">Cash Sale</option>
                <option value="Bank">Bank Payment</option>
              </select>
            </div>
            {company?.bankAccounts && company.bankAccounts.length > 0 && (
              <div className="col-span-2 bg-indigo-55/35 p-3 rounded-xl border border-indigo-50 space-y-1">
                <label className="label text-[10px] font-black uppercase tracking-wider text-indigo-900 flex items-center justify-between">
                  <span>Remittance Bank Details Printed On Invoice</span>
                  <span className="text-[9px] text-slate-400 font-normal normal-case">Switch if billing to multiple accounts</span>
                </label>
                <select
                  className="input-field bg-white"
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
                  <option value="">Do Not Display Bank Details on printed Invoice</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex items-center gap-6">
             {type === 'Purchases' && (
               <label className="flex items-center gap-2 cursor-pointer group">
                 <input 
                   type="checkbox" 
                   checked={itcEligible} 
                   onChange={e => setItcEligible(e.target.checked)}
                   className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                 />
                 <span className="text-xs font-bold text-slate-600 group-hover:text-slate-900 transition-colors">ITC ELIGIBLE</span>
               </label>
             )}
             <label className="flex items-center gap-2 cursor-pointer group">
               <input 
                 type="checkbox" 
                 checked={reverseCharge} 
                 onChange={e => setReverseCharge(e.target.checked)}
                 className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
               />
               <span className="text-xs font-bold text-slate-600 group-hover:text-slate-900 transition-colors">REVERSE CHARGE</span>
             </label>
          </div>

           {/* e-Invoice & e-Way Bill Compliance Panel */}
           <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-4">
             <div className="flex justify-between items-start">
               <div>
                 <span className="text-[10px] font-black text-slate-800 uppercase tracking-widest block">e-Invoice & e-Way Bill Readiness</span>
                 <p className="text-[10px] text-slate-400 font-medium mt-0.5 leading-tight">Configure real-time compliance schema for businesses with aggregate turnover ₹5Cr+</p>
               </div>
               <label className="relative inline-flex items-center cursor-pointer">
                 <input 
                   type="checkbox" 
                   checked={isEInvoiceEligible} 
                   onChange={e => {
                     setIsEInvoiceEligible(e.target.checked);
                     if (e.target.checked) setFivCrTurnoverConfirmed(true);
                   }}
                   className="sr-only peer" 
                 />
                 <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-focus:outline-hidden peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                 <span className="text-[9px] font-black text-slate-500 ml-2 select-none uppercase tracking-wider">Eligible</span>
               </label>
             </div>

             {isEInvoiceEligible && (
               <div className="space-y-4 border-t border-slate-200/60 pt-4 animate-fadeIn">
                 <div className="bg-white p-3 rounded-xl border border-slate-200 flex items-start gap-2.5 shadow-2xs">
                   <input 
                     type="checkbox" 
                     id="fivCrTurnover" 
                     checked={fivCrTurnoverConfirmed} 
                     onChange={e => setFivCrTurnoverConfirmed(e.target.checked)}
                     className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 mt-0.5"
                   />
                   <label htmlFor="fivCrTurnover" className="text-[10px] text-slate-500 font-medium cursor-pointer leading-relaxed">
                     <strong>Annual Turnover Threshold Exceeds ₹5 Crore</strong>: Confirm aggregate turnover of the vendor/company is above ₹5 Crore in any preceding FY for statutory compliance.
                   </label>
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                   <div className="col-span-2">
                     <label className="label text-[9px] flex justify-between select-none">
                       <span>Invoice Reference Number (IRN)</span>
                       <span className="text-slate-400 font-mono text-[8px]">{eInvoiceIRN ? `${eInvoiceIRN.length}/64 Characters` : '64-Character Hex Code'}</span>
                     </label>
                     <input 
                       type="text" 
                       value={eInvoiceIRN} 
                       onChange={e => setEInvoiceIRN(e.target.value.substring(0, 64))} 
                       className="input-field bg-white uppercase font-mono text-[10px] tracking-wider" 
                       placeholder="Enter or generate 64-character Invoice unique hash ID"
                     />
                   </div>

                   <div>
                     <label className="label text-[9px]">Acknowledgement No.</label>
                     <input 
                       type="text" 
                       value={eInvoiceAckNo} 
                       onChange={e => setEInvoiceAckNo(e.target.value)} 
                       className="input-field bg-white font-mono text-[10px]" 
                       placeholder="15-digit Ack Number"
                     />
                   </div>

                   <div>
                     <label className="label text-[9px]">Acknowledgement Date</label>
                     <input 
                       type="date" 
                       value={eInvoiceAckDate} 
                       onChange={e => setEInvoiceAckDate(e.target.value)} 
                       className="input-field bg-white font-mono text-[10px]" 
                     />
                   </div>

                   <div>
                     <label className="label text-[9px]">e-Way Bill No.</label>
                     <input 
                       type="text" 
                       value={eWayBillNo} 
                       onChange={e => setEWayBillNo(e.target.value)} 
                       className="input-field bg-white font-mono text-[10px]" 
                       placeholder="12-digit e-way bill number"
                     />
                   </div>

                   <div>
                     <label className="label text-[9px]">e-Way Bill Date</label>
                     <input 
                       type="date" 
                       value={eWayBillDate} 
                       onChange={e => setEWayBillDate(e.target.value)} 
                       className="input-field bg-white font-mono text-[10px]" 
                     />
                   </div>
                 </div>

                 <div className="flex justify-between items-center bg-indigo-50/70 p-3.5 rounded-xl border border-indigo-100/65 mt-2">
                   <div className="flex flex-col">
                     <span className="text-[10px] font-bold text-indigo-900 block font-display">Automatic Compliance Sandbox</span>
                     <span className="text-[9px] text-slate-400 block mt-0.5">Generate valid-structured compliant IRN, Ack and e-Way Bill credentials</span>
                   </div>
                   <button 
                     type="button"
                     onClick={() => {
                       const genHex = () => Array.from({length:64}, () => Math.floor(Math.random()*16).toString(16)).join('').toUpperCase();
                       const genAckNo = () => {
                         const prefix = "12" + Math.floor(20 + Math.random() * 6).toString();
                         return prefix + Math.floor(10000000000 + Math.random() * 90000000000).toString();
                       };
                       const genEWayNo = () => Math.floor(100000000000 + Math.random() * 900000000000).toString();
                       
                       setEInvoiceIRN(genHex());
                       setEInvoiceAckNo(genAckNo());
                       setEInvoiceAckDate(new Date().toISOString().split('T')[0]);
                       setEWayBillNo(genEWayNo());
                       setEWayBillDate(new Date().toISOString().split('T')[0]);
                       setEWayBillStatus('Generated');
                     }}
                     className="bg-indigo-600 hover:bg-indigo-700 font-bold text-[9px] text-white px-3 py-1.5 rounded-lg shadow-sm transition-all flex items-center gap-1 uppercase tracking-wider"
                   >
                     ⚡ Sandbox Fill
                   </button>
                 </div>
               </div>
             )}
           </div>

          <div className="grid grid-cols-2 gap-6 bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div className="col-span-2">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Transport & Dispatch Details</h4>
            </div>
            <div>
              <label className="label">Dispatched Through</label>
              <input 
                type="text" 
                value={dispatchDetails.dispatchedThrough} 
                onChange={e => setDispatchDetails({...dispatchDetails, dispatchedThrough: e.target.value})} 
                className="input-field bg-white" 
                placeholder="e.g. DTDC, Road, etc."
              />
            </div>
            <div>
              <label className="label">Destination</label>
              <input 
                type="text" 
                value={dispatchDetails.destination} 
                onChange={e => setDispatchDetails({...dispatchDetails, destination: e.target.value})} 
                className="input-field bg-white" 
                placeholder="e.g. Mumbai, Surat, etc."
              />
            </div>
            <div>
              <label className="label">Bill of Lading / LR No</label>
              <input 
                type="text" 
                value={dispatchDetails.billOfLading} 
                onChange={e => setDispatchDetails({...dispatchDetails, billOfLading: e.target.value})} 
                className="input-field bg-white" 
                placeholder="LR No / RR No"
              />
            </div>
            <div>
              <label className="label">Motor Vehicle No</label>
              <input 
                type="text" 
                value={dispatchDetails.motorVehicleNo} 
                onChange={e => setDispatchDetails({...dispatchDetails, motorVehicleNo: e.target.value})} 
                className="input-field bg-white" 
                placeholder="MH-01-AB-1234"
              />
            </div>
          </div>

          {paymentMode !== 'Credit' && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 gap-6 bg-indigo-50 p-4 rounded-xl border border-indigo-100">
               <div>
                  <label className="label">Paid To/From Account</label>
                  <select 
                    className="input-field bg-white" 
                    value={selectedBankId}
                    onChange={e => setSelectedBankId(e.target.value)}
                  >
                    {banks.map(b => <option key={b.id} value={b.id}>{b.name} ({b.group})</option>)}
                  </select>
               </div>
               <div className="flex items-end pb-2">
                 <div className="text-xs text-indigo-600 font-medium">
                   This bill will be marked as <span className="font-bold">PAID</span> and correctly update {banks.find(b => b.id === selectedBankId)?.name || 'Account'} balance.
                 </div>
               </div>
            </motion.div>
          )}

          <div className="grid grid-cols-2 gap-6">
            <div className="flex items-center gap-4">
              <label className="label flex items-center gap-2 mb-0">
                <span>Invoice #</span>
                <button 
                  onClick={() => setShowSeqSettings(true)} 
                  className="text-[10px] uppercase font-bold text-slate-400 hover:text-indigo-600 flex items-center gap-1"
                >
                  Settings
                </button>
              </label>
              <input value={voucherNumber} onChange={e => setVoucherNumber(e.target.value)} className="input-field flex-1" placeholder="e.g. INV/001" />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6">
            <div className="overflow-x-auto w-full border border-slate-200/60 rounded-xl shadow-inner-sm">
              <table className="w-full text-left text-sm min-w-[1050px] table-fixed">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="px-4 py-3 w-12 text-center">#</th>
                    <th className={`px-4 py-3 ${isAccountsOnly ? 'w-[450px]' : 'w-72'}`}>
                      {isAccountsOnly ? 'Particulars / Service Description' : 'Item Name'}
                    </th>
                    {!isAccountsOnly && (
                      <>
                        <th className="px-4 py-3 w-24 text-center">Qty</th>
                        <th className="px-4 py-3 w-32">Rate</th>
                      </>
                    )}
                    <th className="px-4 py-3 w-32">{isAccountsOnly ? 'Amount' : 'Subtotal'}</th>
                    <th className="px-4 py-3 w-28 text-center">GST %</th>
                    {!isInterState ? (
                      <>
                        <th className="px-4 py-3 w-28 text-right">CGST</th>
                        <th className="px-4 py-3 w-28 text-right">SGST</th>
                      </>
                    ) : (
                      <th className="px-4 py-3 w-28 text-right">IGST</th>
                    )}
                    <th className="px-4 py-3 w-32 text-right">Total</th>
                    <th className="px-4 py-3 w-14 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row, index) => {
                    const taxes = calculateGST(row.amount, row.gstRate, isInterState);
                    const rowTotal = row.amount + taxes.cgst + taxes.sgst + taxes.igst;
                    
                    return (
                      <tr key={row.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}>
                        <td className="px-4 py-4 text-center text-slate-400 font-mono text-xs">{index + 1}</td>
                        <td className="px-4 py-6">
                          {isAccountsOnly ? (
                            <input 
                              type="text"
                              className="input-field py-2.5 px-3 bg-white font-semibold text-slate-700 border-slate-200 focus:border-indigo-500"
                              placeholder="e.g. Consultancy Services, Maintenance, etc."
                              value={row.name || ''}
                              onChange={e => updateRow(row.id, 'name', e.target.value)}
                            />
                          ) : (
                            <div className="flex gap-2">
                              <div className="flex-1 relative">
                                <select 
                                  className="input-field py-2.5 px-3 bg-white border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all appearance-none pr-10"
                                  value={row.itemId}
                                  onChange={e => updateRow(row.id, 'itemId', e.target.value)}
                                >
                                  <option value="">Select Item</option>
                                  {items.map(i => <option key={i.id} value={i.id}>{i.name} (Stk: {i.stockLevel})</option>)}
                                </select>
                                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                  <ChevronDown size={14} />
                                </div>
                              </div>
                              <button 
                                onClick={() => setShowAddItem(true)} 
                                className="flex-shrink-0 p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 h-11 w-11 flex items-center justify-center transition-all hover:scale-105"
                                title="Add New Item"
                              >
                                <Plus size={18} />
                              </button>
                            </div>
                          )}
                        </td>
                        {!isAccountsOnly && (
                          <>
                            <td className="px-4 py-6">
                              <input 
                                type="number" 
                                className="input-field py-2.5 text-center bg-white font-medium border-slate-200 focus:border-indigo-500" 
                                value={row.qty || 0} 
                                onChange={e => updateRow(row.id, 'qty', Number(e.target.value) || 0)}
                              />
                            </td>
                            <td className="px-4 py-6">
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-semibold">₹</span>
                                <input 
                                  type="number" 
                                  className="input-field py-2.5 pl-7 bg-white font-medium border-slate-200 focus:border-indigo-500" 
                                  value={row.rate || 0} 
                                  onChange={e => updateRow(row.id, 'rate', Number(e.target.value) || 0)}
                                />
                              </div>
                            </td>
                          </>
                        )}
                        <td className="px-4 py-6">
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400 text-xs font-bold">₹</span>
                            <input 
                              type="number" 
                              className="input-field py-2.5 pl-7 font-bold text-indigo-700 bg-indigo-50/50 border-indigo-100 focus:border-indigo-500 focus:bg-white transition-colors" 
                              value={row.amount || 0} 
                              onChange={e => updateRow(row.id, 'amount', Number(e.target.value) || 0)}
                              title={isAccountsOnly ? "Amount (Editable)" : "Subtotal (Editable)"}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-6">
                          <div className="relative">
                            <select 
                              className="input-field py-2.5 text-center bg-white border-slate-200" 
                              value={row.gstRate} 
                              onChange={e => updateRow(row.id, 'gstRate', Number(e.target.value))}
                            >
                              {[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}
                            </select>
                          </div>
                        </td>
                        {!isInterState ? (
                          <>
                            <td className="px-4 py-6 text-right font-mono">
                              <div className="text-[11px] font-semibold text-slate-600">₹{taxes.cgst.toFixed(2)}</div>
                            </td>
                            <td className="px-4 py-6 text-right font-mono">
                              <div className="text-[11px] font-semibold text-slate-600">₹{taxes.sgst.toFixed(2)}</div>
                            </td>
                          </>
                        ) : (
                          <td className="px-4 py-6 text-right font-mono">
                            <div className="text-[11px] font-semibold text-slate-600">₹{taxes.igst.toFixed(2)}</div>
                          </td>
                        )}
                        <td className="px-4 py-6 text-right font-mono">
                          <div className="text-sm font-black text-slate-900">₹{rowTotal.toFixed(2)}</div>
                        </td>
                        <td className="px-4 py-6 text-center">
                          <button 
                            onClick={() => removeRow(row.id)} 
                            className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                            title="Remove Line"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button onClick={addRow} className="mt-4 flex items-center gap-2 text-indigo-600 font-bold text-sm hover:underline">
              <Plus size={16} /> Add Line Item
              <span className="bg-indigo-50 border border-indigo-100 text-indigo-600 rounded px-1.5 py-0.5 text-[9px] font-mono select-none">Alt+A</span>
            </button>
          </div>
        </div>

        <div className="card p-6 h-fit bg-slate-900 text-white">
          <h3 className="font-bold mb-6 text-indigo-300 uppercase text-xs tracking-widest">Summary</h3>
          
          <div className="bg-white/5 border border-white/10 p-3.5 rounded-xl mb-4 space-y-1">
            <span className="text-[9px] font-black text-indigo-350 uppercase tracking-widest block">Tax Jurisdiction</span>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isInterState ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`}></span>
              <span className="text-xs font-bold font-mono">
                {isInterState ? 'INTER-STATE (IGST Applies)' : 'INTRA-STATE (CGST + SGST)'}
              </span>
            </div>
            <span className="text-[10px] text-slate-400 block font-medium leading-tight">
              Business State Code: <strong className="text-white font-mono">{compStateCode}</strong> ↔ Partner State Code: <strong className="text-white font-mono">{partyStateCode}</strong>
            </span>
          </div>

          <div className="space-y-4 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>₹{subTotal.toFixed(2)}</span>
            </div>
            {cgst > 0 && (
              <div className="flex justify-between text-slate-400">
                <span>CGST</span>
                <span>₹{cgst.toFixed(2)}</span>
              </div>
            )}
            {sgst > 0 && (
              <div className="flex justify-between text-slate-400">
                <span>SGST</span>
                <span>₹{sgst.toFixed(2)}</span>
              </div>
            )}
            {igst > 0 && (
              <div className="flex justify-between text-slate-400">
                <span>IGST</span>
                <span>₹{igst.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-400">
              <span>Round Off</span>
              <span>₹{roundOff}</span>
            </div>
            <div className="border-t border-white/10 pt-4 mt-4">
              <div className="flex justify-between text-2xl font-bold">
                <span>Total</span>
                <span className="text-indigo-400">₹{roundedTotal.toLocaleString()}</span>
              </div>
              <p className="text-[10px] text-indigo-200/70 font-bold uppercase tracking-wider text-right mt-2 break-all leading-normal">
                Amount in words: {roundedTotal > 0 ? numberToWords(roundedTotal) : 'Zero Rupees Only'}
              </p>
            </div>
          </div>
          
          <div className="mt-8 space-y-3">
             <button 
                onClick={() => setShowPreview(true)}
                className="w-full btn-secondary bg-white/5 border-white/10 text-white hover:bg-white/10"
             >
                <Eye size={18} /> Preview Invoice
             </button>
             <button 
                onClick={() => {
                  setShowPreview(true);
                  setTriggerPrint(true);
                }}
                className="w-full btn-secondary bg-white/5 border-white/10 text-white hover:bg-white/10"
             >
                <Printer size={18} /> Print Invoice
             </button>
             <button 
                onClick={shareOnWhatsApp}
                className="w-full btn-secondary bg-white/5 border-white/10 text-white hover:bg-white/10"
             >
                <Send size={18} /> Send on WhatsApp
             </button>
             <button 
                onClick={exportEWayBillJSON}
                className="w-full btn-secondary bg-white/5 border-white/10 text-white hover:bg-white/10"
             >
                <FileCode size={18} /> E-Way Bill JSON
             </button>
          </div>
        </div>
      </div>

      {/* Sequence Settings Modal */}
      {showSeqSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-[110]">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="card w-full max-w-sm p-8">
            <h3 className="text-xl font-bold mb-6">Sequence Settings</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Prefix</label>
                  <input 
                    value={seqSettings.prefix || ''} 
                    onChange={e => setSeqSettings({...seqSettings, prefix: e.target.value})} 
                    className="input-field" 
                    placeholder="e.g. INV/" 
                  />
                </div>
                <div>
                  <label className="label">Suffix</label>
                  <input 
                    value={seqSettings.suffix || ''} 
                    onChange={e => setSeqSettings({...seqSettings, suffix: e.target.value})} 
                    className="input-field" 
                    placeholder="e.g. /26" 
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Padding</label>
                  <input 
                    type="number"
                    value={seqSettings.padding || 1} 
                    onChange={e => setSeqSettings({...seqSettings, padding: Number(e.target.value)})} 
                    className="input-field" 
                  />
                </div>
                <div>
                  <label className="label">Last Number</label>
                  <input 
                    type="number"
                    value={seqSettings.lastNumber || 0} 
                    onChange={e => setSeqSettings({...seqSettings, lastNumber: Number(e.target.value)})} 
                    className="input-field" 
                  />
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Preview Next Number</p>
                <p className="font-mono text-sm">
                  {seqSettings.prefix || ''}
                  {(seqSettings.lastNumber + 1).toString().padStart(seqSettings.padding || 1, '0')}
                  {seqSettings.suffix || ''}
                </p>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button 
                  onClick={() => {
                    const next = seqSettings.lastNumber + 1;
                    const formatted = next.toString().padStart(seqSettings.padding || 1, '0');
                    setVoucherNumber(`${seqSettings.prefix || ''}${formatted}${seqSettings.suffix || ''}`);
                    setShowSeqSettings(false);
                  }} 
                  className="btn-primary w-full"
                >
                  Apply & Close
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      {showAddParty && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-[110]">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="card w-full max-w-lg p-8">
            <h3 className="text-xl font-bold mb-6">Create New {['Sales', 'sales'].includes(type) ? 'Customer' : 'Vendor'}</h3>
            <form onSubmit={handleAddParty} className="space-y-4">
              <div>
                <label className="label">Legal Name*</label>
                <input name="name" className="input-field" placeholder="Party Name" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Registration Type</label>
                  <select name="registrationType" className="input-field">
                    <option value="Regular">Regular</option>
                    <option value="Composition">Composition</option>
                    <option value="Unregistered">Unregistered</option>
                  </select>
                </div>
                <div>
                  <label className="label">GSTIN (Optional)</label>
                  <input name="gstIn" className="input-field" placeholder="15-digit GSTIN" />
                </div>
              </div>
              <div>
                <label className="label">State*</label>
                <select name="stateCode" className="input-field" required>
                  <option value="">Select State</option>
                  {Object.entries(GST_STATES).map(([code, name]) => (
                    <option key={code} value={code}>{name} ({code})</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-4 mt-6">
                <button type="button" onClick={() => setShowAddParty(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary px-8">Save Party</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* New Item Modal */}
      {showAddItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-[110]">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="card w-full max-w-lg p-8">
            <h3 className="text-xl font-bold mb-6">Create New Item</h3>
            <form onSubmit={handleAddItem} className="space-y-4">
              <div>
                <label className="label">Item Name*</label>
                <input name="name" className="input-field" placeholder="Product Name" required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">HSN/SAC</label>
                  <input name="hsn" className="input-field" />
                </div>
                <div>
                  <label className="label">GST %</label>
                  <select name="gstRate" className="input-field">
                    {[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Sale Price</label>
                  <input name="salesPrice" type="number" className="input-field" defaultValue="0" />
                </div>
                <div>
                  <label className="label">Purchase Price</label>
                  <input name="purchasePrice" type="number" className="input-field" defaultValue="0" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                   <label className="label">Unit</label>
                   <input name="unit" className="input-field" defaultValue="PCS" />
                </div>
                <div>
                   <label className="label">Initial Stock</label>
                   <input name="stockLevel" type="number" className="input-field" defaultValue="0" />
                </div>
              </div>
              <div className="flex justify-end gap-4 mt-6">
                <button type="button" onClick={() => setShowAddItem(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary px-8">Save Item</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-[120] print:static print:bg-white print:p-0">
          <motion.div 
            initial={{ opacity: 0, y: 20 }} 
            animate={{ opacity: 1, y: 0 }} 
            className="bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl print:shadow-none print:max-h-none print:max-w-none print:m-0"
          >
            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 sticky top-0 z-10 print:hidden">
              <h3 className="font-bold text-slate-800">Invoice Preview</h3>
              <div className="flex gap-2">
                <button 
                  onClick={downloadPDF} 
                  disabled={isDownloading}
                  className="btn-secondary py-2 px-4 text-xs flex items-center gap-2"
                >
                  {isDownloading ? <RefreshCw size={14} className="animate-spin" /> : <Download size={16} />}
                  {isDownloading ? 'Generating...' : 'Download PDF'}
                </button>
                <button onClick={() => window.print()} className="btn-primary py-2 px-4 text-xs flex items-center gap-2">
                  <Printer size={16} /> Print
                </button>
                <button onClick={() => setShowPreview(false)} className="btn-secondary py-2 px-4 text-xs">Close</button>
              </div>
            </div>

            <div id="printable-invoice" ref={invoiceRef} className="p-12 text-slate-800 relative overflow-hidden">
              {/* Dynamic Watermark Background */}
              {company.customBranding?.watermarkEnabled !== false && company.customBranding?.watermarkText && (
                <div 
                  style={{
                    transform: `translate(-50%, -50%) rotate(${company.customBranding.watermarkRotation ?? -30}deg)`,
                    color: company.customBranding.watermarkColor || '#6366f1',
                    opacity: (company.customBranding.watermarkOpacity ?? 5) / 100
                  }}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-7xl font-sans font-black tracking-widest pointer-events-none uppercase whitespace-nowrap z-0 select-none font-mono"
                >
                  {company.customBranding.watermarkText}
                </div>
              )}

              <div className={`relative z-10 flex ${company.customBranding?.headerAlign === 'center' ? 'flex-col items-center text-center gap-6' : company.customBranding?.headerAlign === 'right' ? 'flex-row-reverse text-right' : 'flex-row text-left'} justify-between items-start mb-12 border-b ${company.customBranding?.headerBorderSize === 'double' ? 'border-double border-b-4 pb-6 border-indigo-100' : company.customBranding?.headerBorderSize === 'none' ? 'border-none pb-0' : 'border-slate-100 border-b pb-6'}`}>
                <div className={`flex ${company.customBranding?.headerAlign === 'center' ? 'flex-col items-center' : company.customBranding?.headerAlign === 'right' ? 'flex-row-reverse text-right' : 'flex-row'} items-start gap-6`}>
                  {company.logo && (
                    <div className="w-20 h-20 bg-slate-50 rounded-xl overflow-hidden border border-slate-100 flex-shrink-0">
                      <img src={company.logo} alt="Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                    </div>
                  )}
                  <div className={`${company.customBranding?.headerAlign === 'center' ? 'text-center' : company.customBranding?.headerAlign === 'right' ? 'text-right' : 'text-left'}`}>
                    <h1 className="text-3xl font-black text-indigo-600 mb-1">{company.name}</h1>
                    {company.customBranding?.headerSubtitle && (
                      <p className="text-sm font-bold text-slate-500 italic mb-1.5">{company.customBranding.headerSubtitle}</p>
                    )}
                    <p className="text-sm text-slate-500 whitespace-pre-wrap max-w-md">{company.address}</p>
                    <p className="text-sm font-bold mt-2">GSTIN: {company.gstIn}</p>
                  </div>
                </div>
                <div className={`${company.customBranding?.headerAlign === 'center' ? 'text-center mt-4' : 'text-right'}`}>
                  <h2 className="text-4xl font-bold font-display text-slate-900 uppercase tracking-tighter mb-4">{type} INVOICE</h2>
                  <div className="space-y-1 text-sm">
                    <p><span className="text-slate-400">Invoice No:</span> <span className="font-bold font-display text-base tracking-tight text-slate-900">{voucherNumber}</span></p>
                    <p><span className="text-slate-400">Date:</span> <span className="font-bold">{date}</span></p>
                  </div>
                </div>
              </div>

               {isEInvoiceEligible && eInvoiceIRN && (
                 <div className="bg-slate-50 border border-slate-200/80 p-5 rounded-2xl mb-8 grid grid-cols-12 gap-6 items-center animate-fadeIn no-print-break relative z-10">
                   {/* Simulated Official Government QR Code */}
                   <div className="col-span-3 flex justify-center">
                     <div className="w-24 h-24 bg-white p-2 border border-slate-200 rounded-xl shadow-2xs flex flex-col justify-between relative overflow-hidden select-none">
                       {/* SVG simulated QR Code with elegant structure */}
                       <svg className="w-full h-full text-slate-950" viewBox="0 0 100 100" fill="currentColor">
                         <rect x="0" y="0" width="25" height="25" />
                         <rect x="3" y="3" width="19" height="19" fill="white" />
                         <rect x="6" y="6" width="13" height="13" />
                         
                         <rect x="75" y="0" width="25" height="25" />
                         <rect x="78" y="3" width="19" height="19" fill="white" />
                         <rect x="81" y="6" width="13" height="13" />

                         <rect x="0" y="75" width="25" height="25" />
                         <rect x="3" y="78" width="19" height="19" fill="white" />
                         <rect x="6" y="81" width="13" height="13" />
                         
                         <rect x="35" y="5" width="10" height="5" />
                         <rect x="50" y="0" width="5" height="15" />
                         <rect x="60" y="8" width="8" height="8" />
                         <rect x="30" y="25" width="40" height="5" />
                         <rect x="35" y="35" width="5" height="25" />
                         <rect x="50" y="45" width="20" height="10" />
                         <rect x="75" y="40" width="15" height="15" />
                         <rect x="15" y="40" width="10" height="10" />
                         <rect x="40" y="75" width="25" height="5" />
                         <rect x="45" y="85" width="5" height="10" />
                         <rect x="75" y="75" width="10" height="10" />
                         <rect x="90" y="85" width="10" height="15" />
                       </svg>
                       <div className="absolute inset-0 bg-transparent flex items-center justify-center pointer-events-none">
                         <div className="bg-indigo-650 text-[6px] text-white font-black px-1 py-0.5 rounded-xs shadow-xs uppercase tracking-tight scale-105">
                           NIC GST
                         </div>
                       </div>
                     </div>
                   </div>

                   <div className="col-span-9 space-y-1 text-slate-700">
                     <div className="flex items-center gap-1.5 mb-1.5">
                       <span className="bg-emerald-100 text-emerald-800 text-[9px] font-black tracking-wider px-2 py-0.5 rounded-md uppercase border border-emerald-200">
                         Government e-Invoice Compliant
                       </span>
                       {eWayBillNo && (
                         <span className="bg-indigo-100 text-indigo-800 text-[9px] font-black tracking-wider px-2 py-0.5 rounded-md uppercase border border-indigo-200">
                           e-Way Bill Enabled
                         </span>
                       )}
                     </div>
                     <p className="leading-snug text-[11px] text-slate-500"><strong className="text-slate-800 uppercase font-black block text-[8px] tracking-wider text-slate-400">Invoice Reference Number (IRN):</strong> <span className="font-mono text-[9.5px] break-all select-all font-bold text-slate-900">{eInvoiceIRN}</span></p>
                     
                     <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-1 text-[11px] border-t border-slate-200/50 pt-2">
                       <p className="text-slate-500 font-medium">Ack No: <span className="font-mono text-slate-900 font-bold ml-1">{eInvoiceAckNo}</span></p>
                       <p className="text-slate-500 font-medium">Ack Date: <span className="font-mono text-slate-900 font-bold ml-1">{eInvoiceAckDate}</span></p>
                       {eWayBillNo && (
                         <>
                           <p className="text-slate-500 font-medium">e-Way Bill No: <span className="font-mono text-slate-900 font-bold ml-1">{eWayBillNo}</span></p>
                           <p className="text-slate-500 font-medium">e-Way Bill Date: <span className="font-mono text-slate-900 font-bold ml-1">{eWayBillDate}</span></p>
                         </>
                       )}
                     </div>
                   </div>
                 </div>
               )}

              <div className="grid grid-cols-2 gap-12 mb-12 border-y border-slate-100 py-8">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Bill To</p>
                  <h3 className="font-bold text-lg mb-1">{selectedParty?.name || 'Walk-in Customer'}</h3>
                  <p className="text-sm text-slate-500 max-w-xs">{selectedParty?.address || '-'}</p>
                  <p className="text-sm font-medium mt-2 text-slate-700">GSTIN: {selectedParty?.gstIn || 'N/A'}</p>
                  <p className="text-sm text-slate-500">State: {selectedParty?.state} ({selectedParty?.stateCode})</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Transport Details</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    <span className="text-slate-400">Dispatched Via:</span> <span className="font-bold">{dispatchDetails.dispatchedThrough || '-'}</span>
                    <span className="text-slate-400">Destination:</span> <span className="font-bold">{dispatchDetails.destination || '-'}</span>
                    <span className="text-slate-400">LR / Bill No:</span> <span className="font-bold">{dispatchDetails.billOfLading || '-'}</span>
                    <span className="text-slate-400">Vehicle No:</span> <span className="font-bold font-mono uppercase">{dispatchDetails.motorVehicleNo || '-'}</span>
                  </div>
                </div>
              </div>

              <table className="w-full text-left mb-12">
                <thead>
                  <tr className="border-b-2 border-slate-900 text-[11px] font-black uppercase">
                    <th className="py-3 px-2">Description / Particulars</th>
                    {!isAccountsOnly && (
                      <>
                        <th className="py-3 px-2 text-right">Qty</th>
                        <th className="py-3 px-2 text-right">Price</th>
                      </>
                    )}
                    <th className="py-3 px-2 text-right">Tax %</th>
                    <th className="py-3 px-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 italic">
                  {rows.map((row, i) => (
                    <tr key={i}>
                      <td className="py-4 px-2">
                        <p className="font-bold text-slate-900 not-italic">{row.name}</p>
                        {!isAccountsOnly && (
                          <p className="text-[10px] text-slate-400">HSN: {items.find(it => it.id === row.itemId)?.hsn || 'N/A'}</p>
                        )}
                      </td>
                      {!isAccountsOnly && (
                        <>
                          <td className="py-4 px-2 text-right not-italic font-display font-medium text-slate-800">{Math.abs(Number(row.qty) || 0)}</td>
                          <td className="py-4 px-2 text-right not-italic font-display text-slate-700">₹{Math.abs(Number(row.rate) || 0).toFixed(2)}</td>
                        </>
                      )}
                      <td className="py-4 px-2 text-right not-italic font-display text-slate-500">{row.gstRate}%</td>
                      <td className="py-4 px-2 text-right font-bold not-italic font-display text-slate-900">₹{Math.abs(Number(row.amount) + Number(row.tax)).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end">
                <div className="w-full max-w-xs space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Taxable Value</span>
                    <span className="font-bold font-display text-slate-900">₹{Math.abs(subTotal).toFixed(2)}</span>
                  </div>
                  {cgst > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">CGST Total</span>
                      <span className="font-semibold font-display text-slate-800">₹{Math.abs(cgst).toFixed(2)}</span>
                    </div>
                  )}
                  {sgst > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">SGST Total</span>
                      <span className="font-semibold font-display text-slate-800">₹{Math.abs(sgst).toFixed(2)}</span>
                    </div>
                  )}
                  {igst > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">IGST Total</span>
                      <span className="font-semibold font-display text-slate-800">₹{Math.abs(igst).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm border-b border-slate-100 pb-3">
                    <span className="text-slate-400">Round Off</span>
                    <span className="font-medium font-display text-slate-700">₹{roundOff}</span>
                  </div>
                  <div className="flex justify-between text-xl font-black pt-2">
                    <span>Total Amount</span>
                    <span className="text-indigo-600 font-display font-black text-2xl tracking-tight">₹{Math.abs(roundedTotal).toLocaleString()}</span>
                  </div>
                  <div className="text-right mt-3 border-t border-slate-100/50 pt-3">
                    <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest leading-none">Amount in Words</p>
                    <p className="text-[11px] font-bold text-slate-700 italic mt-1 leading-normal">{numberToWords(roundedTotal)}</p>
                  </div>
                </div>
              </div>

              <div className="relative z-10 mt-20 border-t border-slate-100 pt-8 flex justify-between items-start gap-8">
                <div className="space-y-6 flex-1">
                  {selectedCompanyBank && selectedCompanyBank.bankName && (
                    <div className="text-[11px] text-slate-500 bg-slate-50 p-4 rounded-xl border border-slate-100 w-fit">
                      <p className="font-bold text-slate-700 mb-2 uppercase tracking-wider">Bank Account Details</p>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                        <span className="text-slate-400">Bank Name:</span> <span className="font-bold text-slate-700">{selectedCompanyBank.bankName}</span>
                        <span className="text-slate-400">A/c Number:</span> <span className="font-bold text-slate-700">{selectedCompanyBank.accountNumber}</span>
                        <span className="text-slate-400">IFSC Code:</span> <span className="font-bold text-slate-705">{selectedCompanyBank.ifscCode}</span>
                        {selectedCompanyBank.branch && (
                          <React.Fragment>
                            <span className="text-slate-400">Branch:</span> <span className="font-bold text-slate-707">{selectedCompanyBank.branch}</span>
                          </React.Fragment>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="text-[10px] text-slate-400 max-w-md">
                     <p className="font-bold text-slate-500 mb-2 uppercase">Terms & Conditions</p>
                     <ol className="list-decimal pl-4 space-y-1 bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                        {(company.customBranding?.termsOfSale || [
                          'Goods once sold will not be taken back or exchanged.',
                          'Our responsibility ceases as soon as goods leave our premises.',
                          'Subject to local jurisdiction only.'
                        ]).map((term: string, idx: number) => (
                          <li key={idx} className="leading-relaxed">{term}</li>
                        ))}
                     </ol>
                  </div>
                </div>
                
                <div className="w-52" style={{ alignSelf: company.customBranding?.signatureAlign === 'left' ? 'flex-start' : company.customBranding?.signatureAlign === 'center' ? 'center' : 'flex-end' }}>
                  <div style={{ height: `${company.customBranding?.signatureHeight || 60}px` }} className="flex items-center justify-center text-[9px] italic text-indigo-400 border border-dashed border-slate-200 rounded-xl mb-3 bg-slate-50/20 print:border-none">
                    (Stamp & Sign Area)
                  </div>
                  <div className="border-t border-slate-200 pt-2 text-center">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{company.customBranding?.signatureLabel || 'Authorized Signatory'}</p>
                    <p className="font-bold text-slate-900 border-t-2 border-slate-100 pt-2 truncate">{company.name}</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
