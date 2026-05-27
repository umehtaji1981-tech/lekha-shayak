import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, 
  Upload, 
  FileSpreadsheet, 
  Download, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2, 
  Plus, 
  Settings, 
  Briefcase, 
  ShoppingBag, 
  ChevronRight, 
  ArrowRight, 
  RefreshCw, 
  Info,
  Check,
  Search,
  UserPlus,
  Layers,
  FileDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { dbService } from '../lib/db';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { GST_STATES } from '../lib/gst-utils';

interface BulkEntryModalProps {
  ledgers: any[];
  items: any[];
  activeCompany: any;
  activeFY: any;
  onClose: () => void;
  onRefreshData?: () => void;
}

const ACCOUNT_GROUPS = [
  "Sundry Debtors", "Sundry Creditors", "Bank Accounts", "Cash-in-hand", 
  "Sales Accounts", "Purchase Accounts", "Direct Expenses", "Indirect Expenses",
  "Direct Incomes", "Indirect Incomes", "Stock-in-hand",
  "Fixed Assets", "Current Assets", "Current Liabilities",
  "Loans & Advances (Asset)", "Loans (Liability)", "Capital Account", "Investments", "Duties & Taxes"
];

interface ParsedRow {
  tempId: string;
  date: string;
  voucherNumber: string;
  partyName: string;
  gstin: string;
  itemName: string;
  qty: number;
  rate: number;
  gstRate: number;
  paymentMode: 'Cash' | 'Bank' | 'Credit';
  
  // Mapped entities
  resolvedPartyId?: string | null;
  resolvedItemId?: string | null;
  resolvedItemUnit?: string;
  
  status: 'valid' | 'warning' | 'error';
  warnings: string[];
  errors: string[];
}

export const BulkEntryModal = ({ 
  ledgers, 
  items, 
  activeCompany, 
  activeFY, 
  onClose,
  onRefreshData 
}: BulkEntryModalProps) => {
  const [entryType, setEntryType] = useState<'sales' | 'purchases'>('sales');
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [validationSummary, setValidationSummary] = useState({ total: 0, valid: 0, warning: 0, error: 0 });
  
  // Local state copy of ledgers and items in case user adds them inline
  const [localLedgers, setLocalLedgers] = useState<any[]>(ledgers);
  const [localItems, setLocalItems] = useState<any[]>(items);

  // Sync props when they change
  useEffect(() => {
    setLocalLedgers(ledgers);
  }, [ledgers]);

  useEffect(() => {
    setLocalItems(items);
  }, [items]);

  // Quick Add ledger/item states
  const [showQuickLedger, setShowQuickLedger] = useState(false);
  const [quickRowId, setQuickRowId] = useState<string | null>(null);
  const [quickLedgerName, setQuickLedgerName] = useState('');
  const [quickLedgerGroup, setQuickLedgerGroup] = useState('Sundry Debtors');
  const [quickLedgerState, setQuickLedgerState] = useState(activeCompany?.stateCode || '27');

  const [showQuickItem, setShowQuickItem] = useState(false);
  const [quickItemName, setQuickItemName] = useState('');
  const [quickItemPrice, setQuickItemPrice] = useState(0);
  const [quickItemUnit, setQuickItemUnit] = useState('PCS');

  // Manual Remapping states
  const [mappingRowId, setMappingRowId] = useState<string | null>(null);
  const [mappingType, setMappingType] = useState<'party' | 'item' | null>(null);
  const [mappingSearch, setMappingSearch] = useState('');

  // Dowload template handler
  const handleDownloadTemplate = (format: 'xlsx' | 'csv') => {
    const isSales = entryType === 'sales';
    const headers = [
      'Date (YYYY-MM-DD)',
      isSales ? 'Invoice Number' : 'Voucher Number',
      isSales ? 'Customer Name' : 'Supplier Name',
      'GSTIN (Optional)',
      'Item Name',
      'Quantity',
      'Rate',
      'GST Rate %',
      'Payment Mode (Cash/Bank/Credit)'
    ];

    const sampleRows = isSales ? [
      ['2026-05-21', 'INV-2026-001', 'Acme Trading Corporates', '27AAACA1234A1Z1', 'Laptop Dell Base', '2', '45000', '18', 'Bank'],
      ['2026-05-21', 'INV-2026-002', 'Global Traders Hub', '', 'Ergonomic Office Chair', '5', '3200', '12', 'Credit']
    ] : [
      ['2026-05-21', 'PUR-2026-101', 'Bharat Mega Distributors', '27BBBBB2222B2Z2', 'Laptop Dell Base', '10', '40000', '18', 'Credit'],
      ['2026-05-21', 'PUR-2026-102', 'Apex Corporate Stationery', '', 'Premium A4 Paper Reams', '20', '250', '12', 'Cash']
    ];

    if (format === 'xlsx') {
      const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
      
      // Auto-fit column widths
      ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 3, 16) }));
      
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, isSales ? 'Sales Bulk Upload' : 'Purchases Bulk Upload');
      XLSX.writeFile(wb, isSales ? 'sales_bulk_template.xlsx' : 'purchases_bulk_template.xlsx');
    } else {
      const csvContent = [headers, ...sampleRows]
        .map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
        .join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", isSales ? 'sales_bulk_template.csv' : 'purchases_bulk_template.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // Re-run validation on rows when mapping or databases change
  const validateRows = (rowsToValidate: ParsedRow[], currentLeds = localLedgers, currentIts = localItems) => {
    const isSales = entryType === 'sales';
    const cashLedger = currentLeds.find(l => l.group === 'Cash-in-hand' || (l.name || '').toLowerCase().includes('cash'));
    const bankLedger = currentLeds.find(l => l.group === 'Bank Accounts' || (l.name || '').toLowerCase().includes('bank'));

    const validated = rowsToValidate.map(row => {
      const errors: string[] = [];
      const warnings: string[] = [];

      // 1. Validate Date
      let cleanDate = row.date;
      if (!cleanDate || cleanDate === 'undefined' || cleanDate === 'null') {
        errors.push("Date is missing or empty.");
      } else {
        const d = new Date(cleanDate);
        if (isNaN(d.getTime())) {
          errors.push(`Invalid date format: "${cleanDate}". Use YYYY-MM-DD.`);
        } else if (activeFY) {
          if (cleanDate < activeFY.startDate || cleanDate > activeFY.endDate) {
            errors.push(`Date must be within active financial year ${activeFY.label || ''} (${activeFY.startDate} to ${activeFY.endDate}).`);
          }
        }
      }

      // 2. Validate Voucher Number
      if (!row.voucherNumber) {
        errors.push("Invoice/Voucher Number is required.");
      }

      // 3. Resolve Party Ledger
      let resolvedPartyId = row.resolvedPartyId || null;
      if (!resolvedPartyId) {
        // Automatic lookup by exact name
        const match = currentLeds.find(l => 
          (l.name || '').toLowerCase().trim() === (row.partyName || '').toLowerCase().trim()
        );
        if (match) {
          resolvedPartyId = match.id;
        } else if (!row.partyName) {
          errors.push(`${isSales ? 'Customer' : 'Supplier'} Name is missing.`);
        } else {
          warnings.push(`Party ledger "${row.partyName}" was not found. We will help you quick-add or map it.`);
        }
      }

      // 4. Resolve Item
      let resolvedItemId = row.resolvedItemId || null;
      let resolvedItemUnit = row.resolvedItemUnit || 'PCS';
      if (!resolvedItemId) {
        const match = currentIts.find(i => 
          (i.name || '').toLowerCase().trim() === (row.itemName || '').toLowerCase().trim()
        );
        if (match) {
          resolvedItemId = match.id;
          resolvedItemUnit = match.unit || 'PCS';
        } else if (!row.itemName) {
          errors.push(`Item name is missing.`);
        } else {
          warnings.push(`Item "${row.itemName}" was not found in Stock Master.`);
        }
      }

      // 5. Validate Numeric values
      if (isNaN(row.qty) || row.qty <= 0) {
        errors.push("Quantity must be a positive number.");
      }
      if (isNaN(row.rate) || row.rate < 0) {
        errors.push("Rate cannot be negative.");
      }

      // 6. Validate Payment Mode resolution
      if (row.paymentMode !== 'Credit') {
        const bankOrCashId = row.paymentMode === 'Cash' ? cashLedger?.id : bankLedger?.id;
        if (!bankOrCashId) {
          warnings.push(`No active ${row.paymentMode} account ledger found in settings. Standard accounts will be checked.`);
        }
      }

      let status: 'valid' | 'warning' | 'error' = 'valid';
      if (errors.length > 0) status = 'error';
      else if (warnings.length > 0) status = 'warning';

      return {
        ...row,
        resolvedPartyId,
        resolvedItemId,
        resolvedItemUnit,
        errors,
        warnings,
        status
      };
    });

    setParsedRows(validated);

    // Calculate Summary Stats
    const summary = validated.reduce((acc, current) => {
      acc.total++;
      if (current.status === 'error') acc.error++;
      else if (current.status === 'warning') acc.warning++;
      else acc.valid++;
      return acc;
    }, { total: 0, valid: 0, warning: 0, error: 0 });

    setValidationSummary(summary);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setIsParsing(true);

    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const data = new Uint8Array(evt.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) as any[][];

          if (rows.length < 2) {
            alert("Empty template or insufficient columns found!");
            setIsParsing(false);
            setFile(null);
            return;
          }

          // Fetch Headers Row & map column positions dynamically
          const headers = rows[0].map(h => String(h || '').toLowerCase().trim());
          const dateIdx = headers.findIndex(h => h.includes('date'));
          const voucherIdx = headers.findIndex(h => h.includes('number') || h.includes('invoice') || h.includes('voucher') || h.includes('bill'));
          const partyIdx = headers.findIndex(h => (h.includes('customer') || h.includes('supplier') || h.includes('party') || h.includes('name')) && !h.includes('item') && !h.includes('product'));
          const gstinIdx = headers.findIndex(h => h.includes('gstin') || h.includes('gst in'));
          const itemIdx = headers.findIndex(h => h.includes('item') || h.includes('product'));
          const qtyIdx = headers.findIndex(h => h.includes('qty') || h.includes('quantity'));
          const rateIdx = headers.findIndex(h => (h.includes('rate') || h.includes('price')) && !h.includes('gst') && !h.includes('tax') && !h.includes('cgst') && !h.includes('sgst') && !h.includes('igst'));
          const gstIdx = headers.findIndex(h => (h.includes('gst %') || h.includes('gst rate') || h.includes('gst') || h.includes('tax %') || h.includes('tax rate') || h.includes('tax')) && !h.includes('gstin') && !h.includes('cgst') && !h.includes('sgst') && !h.includes('igst') && !h.includes('gst in'));
          const payIdx = headers.findIndex(h => h.includes('mode') || h.includes('payment') || h.includes('cash/bank'));

          // Fallbacks if headers are slightly altered
          const dPos = dateIdx !== -1 ? dateIdx : 0;
          const vPos = voucherIdx !== -1 ? voucherIdx : 1;
          const pPos = partyIdx !== -1 ? partyIdx : 2;
          const gPos = gstinIdx !== -1 ? gstinIdx : 3;
          const iPos = itemIdx !== -1 ? itemIdx : 4;
          const qPos = qtyIdx !== -1 ? qtyIdx : 5;
          const rPos = rateIdx !== -1 ? rateIdx : 6;
          const tPos = gstIdx !== -1 ? gstIdx : 7;
          const mPos = payIdx !== -1 ? payIdx : 8;

          const loadedRows: ParsedRow[] = [];

          for (let i = 1; i < rows.length; i++) {
            const rawRow = rows[i];
            if (!rawRow || rawRow.length === 0) continue;
            
            // Skip rows where the invoice number and party names are both blank (empty Excel lines)
            if (!rawRow[vPos] && !rawRow[pPos]) continue;

            // Date parser
            let dateStr = String(rawRow[dPos] || '').trim();
            if (typeof rawRow[dPos] === 'number' && rawRow[dPos] > 30000) {
              const dateObj = new Date(Math.round((rawRow[dPos] - 25569) * 86400 * 1000));
              dateStr = dateObj.toISOString().split('T')[0];
            } else if (dateStr.includes('/')) {
              const parts = dateStr.split('/');
              if (parts.length === 3) {
                if (parts[2].length === 4) dateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                else if (parts[0].length === 4) dateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
              }
            }

            const rawQty = parseFloat(String(rawRow[qPos] || '0').replace(/[^0-9.-]/g, '')) || 0;
            const rawRate = parseFloat(String(rawRow[rPos] || '0').replace(/[^0-9.-]/g, '')) || 0;
            const rawGstRate = parseFloat(String(rawRow[tPos] || '0').replace(/[^0-9.-]/g, '')) || 0;

            let resolvedPayMode: 'Cash' | 'Bank' | 'Credit' = 'Credit';
            const payStr = String(rawRow[mPos] || '').toLowerCase().trim();
            if (payStr.includes('cash')) resolvedPayMode = 'Cash';
            else if (payStr.includes('bank') || payStr.includes('upi') || payStr.includes('card')) resolvedPayMode = 'Bank';

            loadedRows.push({
              tempId: `row-${i}-${Date.now()}`,
              date: dateStr,
              voucherNumber: String(rawRow[vPos] || '').trim(),
              partyName: String(rawRow[pPos] || '').trim(),
              gstin: String(rawRow[gPos] || '').trim(),
              itemName: String(rawRow[iPos] || '').trim(),
              qty: rawQty,
              rate: rawRate,
              gstRate: rawGstRate,
              paymentMode: resolvedPayMode,
              warnings: [],
              errors: [],
              status: 'valid'
            });
          }

          validateRows(loadedRows);
        } catch (ex) {
          alert('Failed parsing sheet contents: ' + (ex instanceof Error ? ex.message : String(ex)));
        } finally {
          setIsParsing(false);
        }
      };
      reader.readAsArrayBuffer(selectedFile);
    } catch (err) {
      alert('Failed to read file: ' + (err instanceof Error ? err.message : String(err)));
      setIsParsing(false);
    }
  };

  // Trigger mapping dropdown / filter
  const handleOpenRemap = (rowId: string, type: 'party' | 'item') => {
    setMappingRowId(rowId);
    setMappingType(type);
    setMappingSearch('');
  };

  const handleApplyRemap = (entityId: string, entityName: string) => {
    if (!mappingRowId || !mappingType) return;

    const updated = parsedRows.map(row => {
      if (row.tempId === mappingRowId) {
        if (mappingType === 'party') {
          return {
            ...row,
            resolvedPartyId: entityId,
            partyName: entityName,
          };
        } else {
          const itemObj = localItems.find(i => i.id === entityId);
          return {
            ...row,
            resolvedItemId: entityId,
            itemName: entityName,
            resolvedItemUnit: itemObj?.unit || 'PCS'
          };
        }
      }
      return row;
    });

    validateRows(updated, localLedgers, localItems);
    setMappingRowId(null);
    setMappingType(null);
  };

  // Inline Quick creation of a Party Ledger
  const handleQuickCreateParty = async () => {
    if (!quickLedgerName.trim()) {
      alert('Party ledger name is required');
      return;
    }

    try {
      const isSales = entryType === 'sales';
      const payload = {
        name: quickLedgerName.trim(),
        group: quickLedgerGroup,
        stateCode: quickLedgerState,
        gstin: '',
        openingBalance: 0,
        currentBalance: 0,
        companyId: activeCompany.id
      };

      const docRef = await dbService.add(`companies/${activeCompany.id}/ledgers`, payload);
      const newLedgerObj = { id: docRef.id, ...payload };
      
      const newLeds = [...localLedgers, newLedgerObj];
      setLocalLedgers(newLeds);

      // Auto resolve for the current row
      const updated = parsedRows.map(r => {
        if (r.tempId === quickRowId) {
          return {
            ...r,
            resolvedPartyId: docRef.id,
            partyName: quickLedgerName.trim()
          };
        }
        return r;
      });

      validateRows(updated, newLeds, localItems);
      setShowQuickLedger(false);
      setQuickRowId(null);
      setQuickLedgerName('');
      if (onRefreshData) onRefreshData();
    } catch (error: any) {
      alert('Failed creating ledger: ' + error.message);
    }
  };

  // Inline Quick creation of an Inventory Product/Item
  const handleQuickCreateItem = async () => {
    if (!quickItemName.trim()) {
      alert('Item name is required');
      return;
    }

    try {
      const payload = {
        name: quickItemName.trim(),
        openingStock: 0,
        openingStockQty: 0,
        stockLevel: 0,
        purchasePrice: quickItemPrice,
        salesPrice: quickItemPrice,
        unit: quickItemUnit,
        minStock: 5,
        sku: 'AUTO-' + Math.random().toString(36).substring(7).toUpperCase(),
        companyId: activeCompany.id
      };

      const docRef = await dbService.add(`companies/${activeCompany.id}/items`, payload);
      const newItemObj = { id: docRef.id, ...payload };
      
      const newIts = [...localItems, newItemObj];
      setLocalItems(newIts);

      // Auto resolve for the current row
      const updated = parsedRows.map(r => {
        if (r.tempId === quickRowId) {
          return {
            ...r,
            resolvedItemId: docRef.id,
            itemName: quickItemName.trim(),
            resolvedItemUnit: quickItemUnit
          };
        }
        return r;
      });

      validateRows(updated, localLedgers, newIts);
      setShowQuickItem(false);
      setQuickRowId(null);
      setQuickItemName('');
      setQuickItemPrice(0);
      if (onRefreshData) onRefreshData();
    } catch (error: any) {
      alert('Failed creating stock item: ' + error.message);
    }
  };

  // Execute bulk persistence with progress metrics
  const triggerBulkImport = async () => {
    if (parsedRows.length === 0) return;
    const errorsCount = validationSummary.error;
    if (errorsCount > 0) {
      if (!confirm(`Warning: There are ${errorsCount} rows with critical errors. Out of safe transactions, only error-free items will be imported. Proceed?`)) {
        return;
      }
    }

    const itemsToProcess = parsedRows.filter(r => r.status !== 'error');
    if (itemsToProcess.length === 0) {
      alert("No valid rows available to import!");
      return;
    }

    setIsImporting(true);
    setImportProgress(0);

    const isSales = entryType === 'sales';
    const cashLedger = localLedgers.find(l => l.group === 'Cash-in-hand' || (l.name || '').toLowerCase().includes('cash'));
    const bankLedger = localLedgers.find(l => l.group === 'Bank Accounts' || (l.name || '').toLowerCase().includes('bank'));

    let importedCount = 0;
    
    // Process rows sequentially with UI progress updates
    for (let idx = 0; idx < itemsToProcess.length; idx++) {
      try {
        const row = itemsToProcess[idx];

        // 1. Re-check party
        let partyId = row.resolvedPartyId;
        let partyName = row.partyName;
        if (!partyId) {
          // Final fallback lookup
          const match = localLedgers.find(l => (l.name || '').toLowerCase() === (row.partyName || '').toLowerCase());
          if (match) {
            partyId = match.id;
          } else {
            // Create a ledger on the fly
            const payload = {
              name: row.partyName,
              group: isSales ? 'Sundry Debtors' : 'Sundry Creditors',
              stateCode: activeCompany?.stateCode || '27',
              gstin: row.gstin || '',
              openingBalance: 0,
              currentBalance: 0,
              companyId: activeCompany.id
            };
            const docRef = await dbService.add(`companies/${activeCompany.id}/ledgers`, payload);
            partyId = docRef.id;
            // Append ledger locally so next loops can resolve it without database overhead
            localLedgers.push({ id: docRef.id, ...payload });
          }
        }

        // 2. Resolve Bank account linkage
        let bankId = null;
        let bankName = null;
        if (row.paymentMode === 'Cash') {
          bankId = cashLedger?.id || null;
          bankName = cashLedger?.name || 'Cash-in-Hand';
        } else if (row.paymentMode === 'Bank') {
          bankId = bankLedger?.id || null;
          bankName = bankLedger?.name || 'Bank Account';
        }

        // 3. Resolve GST Calculations & state code match
        const isPartyInterState = (() => {
          const lObj = localLedgers.find(ledger => ledger.id === partyId);
          if (lObj?.stateCode) {
            return lObj.stateCode !== activeCompany.stateCode;
          }
          return false;
        })();

        const subtotal = Number(row.qty) * Number(row.rate);
        const gstRatio = row.gstRate / 100;
        const totalTax = subtotal * gstRatio;

        const cgst = isPartyInterState ? 0 : totalTax / 2;
        const sgst = isPartyInterState ? 0 : totalTax / 2;
        const igst = isPartyInterState ? totalTax : 0;
        const totalAmount = subtotal + totalTax;

        // Construct complete Invoice Transaction Payload
        const transactionPayload = {
          type: isSales ? 'Sales' : 'Purchases',
          date: row.date || new Date().toISOString().split('T')[0],
          voucherNumber: row.voucherNumber,
          partyId: partyId,
          partyName: partyName,
          isPaid: row.paymentMode !== 'Credit',
          bankId: bankId,
          bankName: bankName,
          printedBankDetails: null,
          itcEligible: !isSales,
          reverseCharge: false,
          dispatchedThrough: '',
          destination: '',
          billOfLading: '',
          motorVehicleNo: '',
          subTotal: subtotal,
          cgst: cgst,
          sgst: sgst,
          igst: igst,
          totalTax: totalTax,
          totalAmount: totalAmount,
          roundOff: 0,
          companyId: activeCompany.id,
          fy: activeFY?.id || '',
          source: 'Bulk Excel Upload',
          updatedAt: new Date().toISOString(),
          items: [
            {
              itemId: row.resolvedItemId,
              name: row.itemName,
              qty: Number(row.qty),
              rate: Number(row.rate),
              gstRate: Number(row.gstRate),
              amount: subtotal,
              cgst: cgst,
              sgst: sgst,
              igst: igst,
              tax: totalTax
            }
          ]
        };

        // Persist transaction
        await dbService.addTransactionWithStock(activeCompany.id, transactionPayload);
        importedCount++;
        
        // Progress ticker
        setImportProgress(Math.round(((idx + 1) / itemsToProcess.length) * 100));
      } catch (err) {
        console.error("Failed to import individual row", err);
      }
    }

    alert(`Bulk Import Finished!\nSuccessfully created ${importedCount} transactions.`);
    
    setIsImporting(false);
    setFile(null);
    setParsedRows([]);
    if (onRefreshData) onRefreshData();
    onClose();
  };

  // Filtered ledgers lookup list for Remap popup
  const searchFilteredLedgers = useMemo(() => {
    let raw = localLedgers;
    if (entryType === 'sales') {
      raw = localLedgers.filter(l => ['Sundry Debtors', 'Cash-in-hand', 'Bank Accounts'].includes(l.group));
    } else {
      raw = localLedgers.filter(l => ['Sundry Creditors', 'Cash-in-hand', 'Bank Accounts'].includes(l.group));
    }

    if (!mappingSearch) return raw;
    return raw.filter(l => (l.name || '').toLowerCase().includes(mappingSearch.toLowerCase()));
  }, [localLedgers, entryType, mappingSearch]);

  // Filtered stock items lookup list for Remap popup
  const searchFilteredItems = useMemo(() => {
    if (!mappingSearch) return localItems;
    return localItems.filter(i => (i.name || '').toLowerCase().includes(mappingSearch.toLowerCase()));
  }, [localItems, mappingSearch]);

  const activeRow = useMemo(() => {
    return parsedRows.find(r => r.tempId === mappingRowId) || null;
  }, [parsedRows, mappingRowId]);

  return (
    <div id="bulk-entry-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-[32px] shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col h-[85vh] relative"
      >
        {/* Header Block */}
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-100 italic font-black text-xl animate-pulse">
                U
             </div>
             <div>
                <h3 className="font-black text-slate-900 text-xl tracking-tight">Bulk Transaction Master</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Excel / CSV Spreadsheet Ingestion & Automatic Ledger Reconciler</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-full transition-colors text-slate-400 hover:text-slate-900">
            <X size={20} />
          </button>
        </div>

        {/* Dynamic Mode Tabs */}
        {!file && (
          <div className="px-8 pt-4 bg-slate-50/50 flex border-b shrink-0">
            <button 
              onClick={() => setEntryType('sales')}
              className={`pb-3.5 px-6 font-bold text-sm border-b-2 transition-all flex items-center gap-2 ${entryType === 'sales' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              <Briefcase size={16} />
              Bulk Sales Entry
            </button>
            <button 
              onClick={() => setEntryType('purchases')}
              className={`pb-3.5 px-6 font-bold text-sm border-b-2 transition-all flex items-center gap-2 ${entryType === 'purchases' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              <ShoppingBag size={16} />
              Bulk Purchases Entry
            </button>
          </div>
        )}

        {/* Core Workspace Body */}
        <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/30">
          {!file ? (
            <div className="p-8 overflow-y-auto space-y-8 flex-1">
              <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                {/* Download Card */}
                <div className="bg-white p-6 rounded-3xl border border-slate-100/80 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-4 font-bold">
                      <FileDown size={20} />
                    </div>
                    <h4 className="font-bold text-slate-900 text-base mb-1">Step 1: Download Format Structure</h4>
                    <p className="text-xs text-slate-400 mb-6 font-medium leading-relaxed">
                      Download our pre-structured template containing correctly named column headers, sample rows, and format guidelines.
                    </p>

                    <div className="bg-slate-50 border p-4 rounded-2xl mb-6">
                      <p className="text-[10px] font-black uppercase text-slate-400 mb-2">Column Headers Layout</p>
                      <div className="flex flex-wrap gap-1.5">
                        {['Date', entryType === 'sales' ? 'Invoice Number' : 'Voucher Number', entryType === 'sales' ? 'Customer Name' : 'Supplier Name', 'GSTIN', 'Item Name', 'Qty', 'Rate', 'GST %', 'Payment Mode'].map((col, idx) => (
                          <span key={idx} className="bg-white px-2 py-1 text-[10px] rounded border font-mono font-semibold text-slate-600 shadow-sm">
                            {col}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button 
                      onClick={() => handleDownloadTemplate('xlsx')}
                      className="flex-1 py-3 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 border border-indigo-100"
                    >
                      <Download size={14} />
                      Excel Template
                    </button>
                    <button 
                      onClick={() => handleDownloadTemplate('csv')}
                      className="flex-1 py-3 bg-slate-50 text-slate-600 hover:bg-slate-100 text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 border border-slate-200"
                    >
                      <Download size={14} />
                      CSV Template
                    </button>
                  </div>
                </div>

                {/* Upload Card */}
                <div className="bg-white p-6 rounded-3xl border border-indigo-50/80 shadow-md shadow-indigo-100/10 flex flex-col justify-between">
                  <div>
                    <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-4 font-bold">
                      <Upload size={20} />
                    </div>
                    <h4 className="font-bold text-slate-900 text-base mb-1">Step 2: Upload Filled Template</h4>
                    <p className="text-xs text-slate-400 mb-6 font-medium leading-relaxed">
                      Once you have inputted your sales or purchase data, drag & drop the filled XLSX or CSV spreadsheet file below to validate.
                    </p>

                    {isParsing ? (
                      <div className="border border-dashed border-indigo-200 rounded-2xl p-10 flex flex-col items-center justify-center bg-indigo-50/10 mb-4 animate-pulse">
                        <Loader2 className="animate-spin text-indigo-600 mb-2" size={32} />
                        <p className="text-xs font-bold text-indigo-600">Analyzing template columns & rows...</p>
                      </div>
                    ) : (
                      <label className="border border-dashed border-slate-200 hover:border-indigo-400 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer transition-colors mb-4 group text-center bg-slate-50/30">
                        <FileSpreadsheet className="text-slate-400 group-hover:text-indigo-600 mb-2 transition-colors" size={36} />
                        <span className="text-xs font-black text-slate-700">Select Filled bulk sheet</span>
                        <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-wide">Supports *.XLSX, *.XLS, *.CSV</span>
                        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
                      </label>
                    )}
                  </div>

                  <div className="text-[10px] text-slate-400 font-semibold bg-slate-50 p-3 rounded-xl border flex items-start gap-2 leading-relaxed">
                    <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
                    <span>AI auto-matches exact Ledger Name and Stock Item names in the sheet with local database entries to prevent duplicate creation.</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            // Uploaded Mapping Workspace Grid
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Validation Summary ribbon */}
              <div className="bg-white p-4 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 px-6">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest leading-none">Validation Result:</span>
                  <div className="flex gap-2">
                    <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-xl text-xs font-bold font-mono">
                      Total: {validationSummary.total} Rows
                    </span>
                    <span className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-xl text-xs font-bold font-mono">
                      Valid: {validationSummary.valid}
                    </span>
                    {validationSummary.warning > 0 && (
                      <span className="bg-amber-50 text-amber-700 px-3 py-1 rounded-xl text-xs font-bold font-mono">
                        Attention Needed: {validationSummary.warning}
                      </span>
                    )}
                    {validationSummary.error > 0 && (
                      <span className="bg-rose-50 text-rose-700 px-3 py-1 rounded-xl text-xs font-bold font-mono">
                        Errors: {validationSummary.error}
                      </span>
                    )}
                  </div>
                </div>

                <button 
                  onClick={() => { setFile(null); setParsedRows([]); }}
                  className="text-xs text-rose-600 font-bold hover:underline"
                >
                  Clear & Re-Upload
                </button>
              </div>

              {/* Editable/Mappable Table list container */}
              <div className="flex-1 overflow-auto p-6">
                <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden shadow-inner-sm">
                  <table className="w-full text-left text-xs min-w-[1100px] table-fixed">
                    <thead className="bg-slate-50/80 text-slate-500 font-bold uppercase text-[10px] border-b border-slate-100">
                      <tr>
                        <th className="px-4 py-3 w-10 text-center">#</th>
                        <th className="px-4 py-3 w-28">Date</th>
                        <th className="px-4 py-3 w-28">Invoice #</th>
                        <th className="px-4 py-3 w-72">Customer / Supplier Name (Ledger)</th>
                        <th className="px-4 py-3 w-72">Item Name (Stock Item)</th>
                        <th className="px-4 py-3 w-20 text-center">Qty</th>
                        <th className="px-4 py-3 w-24">Rate</th>
                        <th className="px-4 py-3 w-20 text-center">GST %</th>
                        <th className="px-4 py-3 w-24 text-right">Subtotal</th>
                        <th className="px-4 py-3 w-24 text-right">Total Payable</th>
                        <th className="px-4 py-3 w-28 text-center">Payment</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                      {parsedRows.map((row, idx) => {
                        const isSales = entryType === 'sales';
                        const sub = row.qty * row.rate;
                        const tot = sub * (1 + (row.gstRate / 100));

                        return (
                          <tr key={row.tempId} className={`hover:bg-slate-50/50 transition-colors ${row.status === 'error' ? 'bg-rose-50/10' : row.status === 'warning' ? 'bg-amber-50/5' : ''}`}>
                            {/* row # and status */}
                            <td className="px-4 py-4 text-center">
                              {row.status === 'error' ? (
                                <span className="text-rose-500 font-bold cursor-help" title={row.errors.join('\n')}>⚠️</span>
                              ) : row.status === 'warning' ? (
                                <span className="text-amber-500 font-bold cursor-help" title={row.warnings.join('\n')}>●</span>
                              ) : (
                                <span className="text-emerald-500 font-bold cursor-help">✓</span>
                              )}
                            </td>

                            {/* Date */}
                            <td className="px-4 py-4 font-mono font-bold text-slate-900">{row.date}</td>

                            {/* Invoice Ref */}
                            <td className="px-4 py-4 font-mono font-bold text-slate-700">{row.voucherNumber}</td>

                            {/* Party Ledger mapping status */}
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {row.resolvedPartyId ? (
                                  <span className="text-slate-800 font-semibold truncate block" title={row.partyName}>{row.partyName}</span>
                                ) : (
                                  <div className="flex items-center gap-1 w-full min-w-0">
                                    <span className="text-rose-600 bg-rose-50 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-rose-100/30 truncate block max-w-[150px] shrink-0" title={row.partyName + ' (Unmatched)'}>
                                      {row.partyName || '(Missing)'}
                                    </span>
                                    <button 
                                      onClick={() => handleOpenRemap(row.tempId, 'party')}
                                      className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg hover:scale-105 transition-all text-[10px] font-black shrink-0 uppercase tracking-wider"
                                      title="Remap Name"
                                    >
                                      Remap
                                    </button>
                                    <button 
                                      onClick={() => {
                                        setQuickRowId(row.tempId);
                                        setQuickLedgerName(row.partyName);
                                        setQuickLedgerGroup(isSales ? 'Sundry Debtors' : 'Sundry Creditors');
                                        setShowQuickLedger(true);
                                      }}
                                      className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg hover:scale-105 transition-all text-[10px] font-black shrink-0"
                                      title="Inline Quick Create"
                                    >
                                      <UserPlus size={11} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* Stock Item mapping status */}
                            <td className="px-4 py-4">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {row.resolvedItemId ? (
                                  <span className="text-slate-800 font-semibold truncate block animate-fade" title={row.itemName}>{row.itemName}</span>
                                ) : (
                                  <div className="flex items-center gap-1 w-full min-w-0">
                                    <span className="text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-amber-100/30 truncate block max-w-[150px] shrink-0" title={row.itemName + ' (Unmatched)'}>
                                      {row.itemName || '(Missing)'}
                                    </span>
                                    <button 
                                      onClick={() => handleOpenRemap(row.tempId, 'item')}
                                      className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg hover:scale-105 transition-all text-[10px] font-black shrink-0 uppercase tracking-wider"
                                      title="Remap Product"
                                    >
                                      Remap
                                    </button>
                                    <button 
                                      onClick={() => {
                                        setQuickRowId(row.tempId);
                                        setQuickItemName(row.itemName);
                                        setQuickItemPrice(row.rate);
                                        setShowQuickItem(true);
                                      }}
                                      className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg hover:scale-105 transition-all text-[10px] font-black shrink-0"
                                      title="Inline Quick Create Item"
                                    >
                                      <Plus size={11} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* Qty */}
                            <td className="px-4 py-4 text-center font-mono font-bold text-slate-800">{row.qty}</td>

                            {/* Rate */}
                            <td className="px-4 py-4 font-mono font-bold text-slate-600">₹{row.rate.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>

                            {/* GST Rate */}
                            <td className="px-4 py-4 text-center font-mono font-bold text-slate-500">{row.gstRate}%</td>

                            {/* Subtotal */}
                            <td className="px-4 py-4 text-right font-mono font-bold text-slate-600">₹{sub.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>

                            {/* Total Payable (Tax Inc) */}
                            <td className="px-4 py-4 text-right font-mono font-extrabold text-indigo-800">₹{tot.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>

                            {/* Payment Mode */}
                            <td className="px-4 py-4 text-center">
                              <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider leading-none ${row.paymentMode === 'Credit' ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
                                {row.paymentMode}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Global Progress Overlay while processing firestore writes */}
        {isImporting && (
          <div className="absolute inset-0 bg-slate-900/60 z-[120] flex flex-col items-center justify-center p-8 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white p-8 rounded-[32px] max-w-md w-full text-center shadow-2xl"
            >
              <Loader2 className="animate-spin text-indigo-600 mx-auto mb-4" size={48} />
              <h4 className="font-extrabold text-slate-800 text-lg mb-2">Importing Transactions</h4>
              <p className="text-slate-400 text-xs mb-6">Writing batch vouchers & adjusting stock levels...</p>
              
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden mb-2">
                <div className="bg-indigo-600 h-full transition-all duration-300" style={{ width: `${importProgress}%` }} />
              </div>
              <p className="text-xs font-mono font-bold text-indigo-650">{importProgress}% Completed</p>
            </motion.div>
          </div>
        )}

        {/* Dynamic Mapping / Remap Dropdown popup */}
        {mappingRowId && (
          <div className="fixed inset-0 bg-slate-900/40 z-[115] flex items-center justify-center p-4 backdrop-blur-xs">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white border rounded-3xl shadow-2xl max-w-md w-full p-5"
            >
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-black text-slate-800 text-sm uppercase tracking-wide flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-indigo-600 rounded-full inline-block"></span>
                  Remap Uploaded {mappingType === 'party' ? 'Party Ledger' : 'Stock Item'}
                </h4>
                <button 
                  onClick={() => { setMappingRowId(null); setMappingType(null); }}
                  className="p-1 hover:bg-slate-100 rounded-full text-slate-400"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="text-[11px] text-slate-400 mb-4 font-medium">
                Map <span className="text-slate-700 font-bold">"{mappingType === 'party' ? activeRow?.partyName : activeRow?.itemName}"</span> to an existing ledger profile or master record in your system.
              </p>

              {/* Quick Select dropdown for existing ledgers */}
              <div className="mb-4 bg-indigo-50/50 border border-indigo-100 p-3.5 rounded-2xl">
                <label className="block text-[10px] font-black uppercase text-indigo-600 mb-1.5 tracking-wider">
                  Select Existing {mappingType === 'party' ? 'Ledger Account' : 'Stock Item'}:
                </label>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const selectedId = e.target.value;
                    if (!selectedId) return;
                    if (mappingType === 'party') {
                      const matched = localLedgers.find(l => l.id === selectedId);
                      if (matched) {
                        handleApplyRemap(matched.id, matched.name);
                      }
                    } else {
                      const matched = localItems.find(i => i.id === selectedId);
                      if (matched) {
                        handleApplyRemap(matched.id, matched.name);
                      }
                    }
                  }}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 transition-all cursor-pointer"
                >
                  <option value="" disabled>-- Pick from already created records --</option>
                  {mappingType === 'party' ? (
                    (() => {
                      // Sort alphabetically
                      const sortedLedgers = [...localLedgers].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                      return sortedLedgers.map(l => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({l.group || 'General'})
                        </option>
                      ));
                    })()
                  ) : (
                    [...localItems].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(i => (
                      <option key={i.id} value={i.id}>
                        {i.name} (₹{i.purchasePrice || i.salesPrice || 0})
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="relative flex py-2 items-center mb-1">
                <div className="flex-grow border-t border-slate-100"></div>
                <span className="flex-shrink mx-3 text-slate-400 font-extrabold text-[9px] uppercase tracking-wider">Or Search & Filter below</span>
                <div className="flex-grow border-t border-slate-100"></div>
              </div>

              {/* Dynamic search bar inside Remap box */}
              <div className="relative mb-3.5">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search and select..."
                  value={mappingSearch}
                  onChange={(e) => setMappingSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs font-bold outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 transition-all font-sans"
                  autoFocus
                />
              </div>

              <div className="max-h-52 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {mappingType === 'party' ? (
                  searchFilteredLedgers.length === 0 ? (
                    <p className="text-[10px] text-slate-400 text-center py-4 italic font-bold">No accounts match search.</p>
                  ) : (
                    searchFilteredLedgers.map(l => (
                      <button 
                        key={l.id}
                        onClick={() => handleApplyRemap(l.id, l.name)}
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50/50 rounded-xl text-xs font-bold text-slate-700 flex justify-between items-center group transition-colors"
                      >
                        <span className="truncate group-hover:text-indigo-600">{l.name}</span>
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">{l.group}</span>
                      </button>
                    ))
                  )
                ) : (
                  searchFilteredItems.length === 0 ? (
                    <p className="text-[10px] text-slate-400 text-center py-4 italic font-bold">No inventory items match search.</p>
                  ) : (
                    searchFilteredItems.map(i => (
                      <button 
                        key={i.id}
                        onClick={() => handleApplyRemap(i.id, i.name)}
                        className="w-full text-left px-3 py-2 hover:bg-indigo-50/50 rounded-xl text-xs font-bold text-slate-700 flex justify-between items-center group transition-colors"
                      >
                        <span className="truncate group-hover:text-indigo-600">{i.name}</span>
                        <span className="text-[10px] font-mono text-slate-400">Rate: ₹{i.salesPrice || 0}</span>
                      </button>
                    ))
                  )
                )}
              </div>
            </motion.div>
          </div>
        )}

        {/* Quick Add Party Ledger popup drawer */}
        {showQuickLedger && (
          <div className="fixed inset-0 bg-slate-900/60 z-[115] flex items-center justify-center p-4 backdrop-blur-xs">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-[24px] shadow-2xl max-w-md w-full p-6 border"
            >
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-black text-slate-800 text-base flex items-center gap-1.5">
                  <UserPlus className="text-indigo-600" size={20} />
                  Quick Create Ledger Account
                </h4>
                <button onClick={() => setShowQuickLedger(false)} className="p-1 hover:bg-slate-50 rounded-full text-slate-400">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4 font-sans">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Ledger Name</label>
                  <input 
                    type="text" 
                    value={quickLedgerName}
                    onChange={(e) => setQuickLedgerName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-bold text-slate-800 outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 transition-all font-sans"
                    placeholder="Enter customer / supplier name"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Account Group</label>
                  <select 
                    value={quickLedgerGroup}
                    onChange={(e) => setQuickLedgerGroup(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-bold text-slate-850 outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 transition-all cursor-pointer"
                  >
                    {ACCOUNT_GROUPS.map(group => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">State (GST Location Code)</label>
                  <select 
                    value={quickLedgerState}
                    onChange={(e) => setQuickLedgerState(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-bold text-slate-850 outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 transition-all cursor-pointer"
                  >
                    {Object.entries(GST_STATES).map(([code, name]) => (
                      <option key={code} value={code}>
                        {name} ({code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex gap-3 justify-end mt-6">
                <button 
                  onClick={() => setShowQuickLedger(false)}
                  className="px-5 py-2 rounded-xl text-slate-500 font-bold hover:bg-slate-50 text-xs uppercase cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleQuickCreateParty}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-slate-900 text-white font-extrabold text-xs uppercase"
                >
                  Create Ledger
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Quick Add Stock Item popup drawer */}
        {showQuickItem && (
          <div className="fixed inset-0 bg-slate-900/60 z-[115] flex items-center justify-center p-4 backdrop-blur-xs">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-[24px] shadow-2xl max-w-md w-full p-6 border"
            >
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-black text-slate-800 text-base flex items-center gap-1.5">
                  <Layers className="text-indigo-600" size={20} />
                  Quick Add Stock Product
                </h4>
                <button onClick={() => setShowQuickItem(false)} className="p-1 hover:bg-slate-50 rounded-full text-slate-400">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4 font-sans">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Item / Product Name</label>
                  <input 
                    type="text" 
                    value={quickItemName}
                    onChange={(e) => setQuickItemName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-bold text-slate-800 outline-none"
                    placeholder="Enter product or inventory service name"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Default Standard Rate</label>
                    <input 
                      type="number" 
                      value={quickItemPrice}
                      onChange={(e) => setQuickItemPrice(Number(e.target.value) || 0)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-bold text-slate-800 outline-none"
                      placeholder="Pricing rate"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 mb-1">Standard Unit of Measure</label>
                    <select 
                      value={quickItemUnit}
                      onChange={(e) => setQuickItemUnit(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-bold text-slate-850 outline-none"
                    >
                      <option value="PCS">PCS (Pieces)</option>
                      <option value="NOS">NOS (Numbers)</option>
                      <option value="BOX">BOX (Boxes)</option>
                      <option value="KGS">KGS (Kilograms)</option>
                      <option value="MTR">MTR (Meters)</option>
                      <option value="LTR">LTR (Liters)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 justify-end mt-6">
                <button 
                  onClick={() => setShowQuickItem(false)}
                  className="px-5 py-2 rounded-xl text-slate-500 font-bold hover:bg-slate-50 text-xs uppercase"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleQuickCreateItem}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-slate-900 text-white font-extrabold text-xs uppercase"
                >
                  Add Product
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Modal Action bar footer */}
        <div className="p-6 border-t border-slate-100 bg-white flex justify-between items-center shrink-0">
          <div className="flex items-center gap-4 text-xs font-semibold text-slate-400">
            {file && (
              <>
                <span>Validated: <strong className="text-slate-800">{validationSummary.valid}</strong></span>
                <span>•</span>
                <span>Warnings: <strong className="text-amber-600">{validationSummary.warning}</strong></span>
                <span>•</span>
                <span>Errors: <strong className="text-rose-600">{validationSummary.error}</strong></span>
              </>
            )}
          </div>
         
          <div className="flex gap-4">
             <button 
               onClick={onClose} 
               className="px-8 py-3 rounded-2xl text-slate-500 font-black text-xs uppercase tracking-widest border border-slate-100 hover:bg-slate-50 transition-all"
             >
               Close
             </button>
             {file && (
               <button 
                 disabled={parsedRows.length === 0 || isImporting || isParsing || validationSummary.valid + validationSummary.warning === 0}
                 onClick={triggerBulkImport}
                 className="px-8 py-3 rounded-2xl bg-indigo-600 text-white font-black text-xs uppercase tracking-widest hover:bg-slate-900 shadow-xl shadow-indigo-100 transition-all disabled:opacity-50 disabled:grayscale flex items-center gap-2"
               >
                 <span>Save {validationSummary.valid + validationSummary.warning} Vouchers</span>
                 <ArrowRight size={14} />
               </button>
             )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
