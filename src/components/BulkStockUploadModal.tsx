import React, { useState, useMemo } from 'react';
import { 
  X, 
  Upload, 
  FileSpreadsheet, 
  Download, 
  CheckCircle2, 
  AlertTriangle, 
  Loader2, 
  FileDown, 
  Info, 
  ArrowRight, 
  RefreshCw,
  Edit2,
  PlusCircle,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { dbService } from '../lib/db';

interface BulkStockUploadModalProps {
  companyId: string;
  existingItems: any[];
  onClose: () => void;
}

interface ParsedStockRow {
  tempId: string;
  name: string;
  sku: string;
  hsn: string;
  unit: string;
  gstRate: number;
  purchasePrice: number;
  salesPrice: number;
  openingStockQty: number;
  openingStockRate: number;
  
  // Status check attributes
  status: 'create' | 'update' | 'error';
  matchedItemId?: string;
  matchedItemName?: string;
  errors: string[];
  warnings: string[];
}

export const BulkStockUploadModal = ({ 
  companyId, 
  existingItems, 
  onClose 
}: BulkStockUploadModalProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedStockRow[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  // Download template handler
  const handleDownloadTemplate = (format: 'xlsx' | 'csv') => {
    const headers = [
      'Item Name',
      'SKU',
      'HSN/SAC',
      'Unit',
      'GST Rate %',
      'Purchase Price',
      'Sales Price',
      'Opening Stock Qty',
      'Opening Stock Rate'
    ];

    const sampleRows = [
      ['Laptop Dell Vostro', 'LAP-VOS-01', '8471', 'PCS', '18', '42000', '48000', '10', '42000'],
      ['Wireless Mouse Logitech', 'MSE-LOG-GP', '8471', 'PCS', '18', '850', '1200', '35', '850'],
      ['Premium A4 Copy Paper', 'PAP-A4-PREM', '4802', 'BOX', '12', '240', '320', '50', '240']
    ];

    if (format === 'xlsx') {
      const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
      
      // Auto-fit column widths
      ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 3, 16) }));
      
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Inventory Bulk Upload');
      XLSX.writeFile(wb, 'bulk_stock_template.xlsx');
    } else {
      const csvContent = [headers, ...sampleRows]
        .map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(','))
        .join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", 'bulk_stock_template.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // Normalizes Excel object keys to match our standard field names
  const normalizeRowKeys = (row: any): Record<string, any> => {
    const normalized: Record<string, any> = {};
    Object.keys(row).forEach(key => {
      const value = row[key];
      const cleanKey = key.toLowerCase().trim();
      
      if (cleanKey === 'item name' || cleanKey === 'name') {
        normalized.name = value;
      } else if (cleanKey === 'sku') {
        normalized.sku = value;
      } else if (cleanKey === 'hsn/sac' || cleanKey === 'hsn') {
        normalized.hsn = value;
      } else if (cleanKey === 'unit') {
        normalized.unit = value;
      } else if (cleanKey === 'gst rate %' || cleanKey === 'gst rate' || cleanKey === 'gst %' || cleanKey === 'gst') {
        normalized.gstRate = value;
      } else if (cleanKey === 'purchase price' || cleanKey === 'purchase') {
        normalized.purchasePrice = value;
      } else if (cleanKey === 'sales price' || cleanKey === 'sales') {
        normalized.salesPrice = value;
      } else if (cleanKey === 'opening stock qty' || cleanKey === 'opening qty' || cleanKey === 'stock level' || cleanKey === 'quantity' || cleanKey === 'qty') {
        normalized.openingStockQty = value;
      } else if (cleanKey === 'opening stock rate' || cleanKey === 'opening rate') {
        normalized.openingStockRate = value;
      }
    });

    return normalized;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setIsParsing(true);

    try {
      const reader = new FileReader();
      
      reader.onload = async (evt) => {
        const data = evt.target?.result;
        if (!data) {
          setIsParsing(false);
          return;
        }

        const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Parse rows as raw objects
        const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        
        const processed: ParsedStockRow[] = rawRows.map((rawRow: any, index) => {
          const normalized = normalizeRowKeys(rawRow);
          
          const name = String(normalized.name || '').trim();
          const sku = String(normalized.sku || '').trim();
          const hsn = String(normalized.hsn || '').trim();
          const unit = String(normalized.unit || 'PCS').trim().toUpperCase();
          const gstRateRaw = Number(normalized.gstRate !== undefined ? normalized.gstRate : 18);
          const purchasePrice = Number(normalized.purchasePrice || 0);
          const salesPrice = Number(normalized.salesPrice || 0);
          const openingStockQty = Number(normalized.openingStockQty !== undefined ? normalized.openingStockQty : 0);
          const openingStockRate = Number(normalized.openingStockRate !== undefined ? normalized.openingStockRate : purchasePrice);

          const errors: string[] = [];
          const warnings: string[] = [];

          if (!name) {
            errors.push('Item Name is required.');
          }

          if (isNaN(gstRateRaw) || ![0, 5, 12, 18, 28].includes(gstRateRaw)) {
            warnings.push(`Standard GST Rate not detected (${gstRateRaw}%). Will fallback to closest standard or default to 18%.`);
          }

          if (isNaN(purchasePrice) || purchasePrice < 0) {
            errors.push('Purchase Price must be a non-negative number.');
          }

          if (isNaN(salesPrice) || salesPrice < 0) {
            errors.push('Sales Price must be a non-negative number.');
          }

          if (isNaN(openingStockQty) || openingStockQty < 0) {
            errors.push('Opening Stock Qty must be a non-negative number.');
          }

          if (isNaN(openingStockRate) || openingStockRate < 0) {
            errors.push('Opening Stock Rate must be a non-negative value.');
          }

          // Search match in local DB copy
          // First attempt lookup by SKU (since SKU is distinct and definitive)
          let matchedItem = sku 
            ? existingItems.find(item => (item.sku || '').toLowerCase().trim() === sku.toLowerCase()) 
            : null;

          // Second attempt lookup by exact Name
          if (!matchedItem) {
            matchedItem = existingItems.find(item => (item.name || '').toLowerCase().trim() === name.toLowerCase());
          }

          const status = errors.length > 0 
            ? 'error' 
            : matchedItem 
              ? 'update' 
              : 'create';

          return {
            tempId: `row-${index}-${Date.now()}`,
            name,
            sku,
            hsn,
            unit,
            gstRate: [0, 5, 12, 18, 28].includes(gstRateRaw) ? gstRateRaw : 18,
            purchasePrice,
            salesPrice,
            openingStockQty,
            openingStockRate,
            status,
            matchedItemId: matchedItem?.id,
            matchedItemName: matchedItem?.name,
            errors,
            warnings
          };
        });

        setParsedRows(processed);
        setIsParsing(false);
      };

      reader.readAsBinaryString(uploadedFile);
    } catch (err) {
      console.error('Error parsing sheet', err);
      setIsParsing(false);
    }
  };

  const validationSummary = useMemo(() => {
    return parsedRows.reduce((acc, row) => {
      acc.total++;
      if (row.status === 'error') acc.error++;
      else if (row.status === 'update') acc.update++;
      else acc.create++;
      return acc;
    }, { total: 0, create: 0, update: 0, error: 0 });
  }, [parsedRows]);

  const handleApplyImport = async () => {
    const importableRows = parsedRows.filter(r => r.status !== 'error');
    if (importableRows.length === 0) return;

    setIsImporting(true);
    setImportProgress(0);

    try {
      let completed = 0;
      const total = importableRows.length;

      // Group into sequential chunks to manage write traffic nicely
      for (const row of importableRows) {
        if (row.status === 'update' && row.matchedItemId) {
          // Perform surgical update
          const existing = existingItems.find(i => i.id === row.matchedItemId);
          if (existing) {
            const oldOpeningQty = Number(existing.openingStockQty || 0);
            const newOpeningQty = Number(row.openingStockQty);
            const currentStockLevel = Number(existing.stockLevel || 0);
            const updatedStockLevel = currentStockLevel - oldOpeningQty + newOpeningQty;

            const updatedDoc = {
              sku: row.sku || existing.sku || '',
              hsn: row.hsn || existing.hsn || '',
              unit: row.unit || existing.unit || 'PCS',
              gstRate: row.gstRate ?? existing.gstRate ?? 18,
              purchasePrice: row.purchasePrice ?? existing.purchasePrice ?? 0,
              salesPrice: row.salesPrice ?? existing.salesPrice ?? 0,
              openingStockQty: newOpeningQty,
              stockLevel: Math.max(0, updatedStockLevel),
              openingStockRate: row.openingStockRate ?? existing.openingStockRate ?? existing.purchasePrice ?? 0,
              openingStockValue: newOpeningQty * (row.openingStockRate ?? existing.openingStockRate ?? existing.purchasePrice ?? 0),
              name: row.name || existing.name,
              companyId
            };

            await dbService.update(`companies/${companyId}/items`, row.matchedItemId, updatedDoc);
          }
        } else if (row.status === 'create') {
          // Create new Item
          const newDoc = {
            name: row.name,
            sku: row.sku || '',
            hsn: row.hsn || '',
            unit: row.unit || 'PCS',
            gstRate: Number(row.gstRate ?? 18),
            purchasePrice: Number(row.purchasePrice || 0),
            salesPrice: Number(row.salesPrice || 0),
            openingStockQty: Number(row.openingStockQty || 0),
            stockLevel: Number(row.openingStockQty || 0), // Base stock matches opening on creation
            openingStockRate: Number(row.openingStockRate || row.purchasePrice || 0),
            openingStockValue: Number(row.openingStockQty || 0) * Number(row.openingStockRate || row.purchasePrice || 0),
            companyId
          };

          await dbService.add(`companies/${companyId}/items`, newDoc);
        }

        completed++;
        setImportProgress(Math.floor((completed / total) * 100));
      }

      // Complete
      setIsImporting(false);
      onClose();
    } catch (err) {
      console.error('Import failed', err);
      setIsImporting(false);
      alert('An error occurred while bulk importing stock levels. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex justify-center items-center p-4 overflow-hidden">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-white rounded-3xl shadow-2xl border border-slate-100 flex flex-col w-full max-w-5xl h-[85vh]"
      >
        {/* Modal Header */}
        <div className="bg-slate-50 border-b flex justify-between items-center py-4 px-6 rounded-t-3xl shrink-0">
          <div>
            <h3 className="font-extrabold text-slate-900 text-lg tracking-tight flex items-center gap-2">
              <FileSpreadsheet className="text-indigo-600" size={20} /> Bulk Stock & Pricing Ingest
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
              Update multiple stock levels, SKU mappings, and buy/sell pricing simultaneously
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 hover:bg-slate-200/60 text-slate-400 hover:text-slate-800 rounded-full transition-colors"
            title="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Content Frame */}
        <div className="flex-1 overflow-hidden flex flex-col bg-slate-50/10">
          {!file ? (
            <div className="p-8 overflow-y-auto space-y-8 flex-1 flex flex-col justify-center">
              <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto w-full">
                {/* Download Step Card */}
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="w-10 h-10 bg-indigo-50/70 text-indigo-600 rounded-2xl flex items-center justify-center mb-4 font-bold">
                      <FileDown size={20} />
                    </div>
                    <h4 className="font-bold text-slate-900 text-base mb-1">1. Download Template Structure</h4>
                    <p className="text-xs text-slate-400 mb-6 font-medium leading-relaxed">
                      Download our pre-structured template containing correctly named column headers, pre-filled sample rows, and guidelines.
                    </p>

                    <div className="bg-slate-50 border p-4 rounded-2xl mb-6">
                      <p className="text-[10px] font-black uppercase text-slate-400 mb-2">Required Columns Map</p>
                      <div className="flex flex-wrap gap-1.5">
                        {['Item Name', 'SKU', 'HSN/SAC', 'Unit', 'GST Rate %', 'Purchase Price', 'Sales Price', 'Opening Stock Qty'].map((col, idx) => (
                          <span key={idx} className="bg-white px-2 py-1 text-[10px] rounded border font-mono font-semibold text-slate-600 shadow-sm">
                            {col}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 shrink-0">
                    <button 
                      onClick={() => handleDownloadTemplate('xlsx')}
                      className="flex-1 py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 border border-indigo-100 cursor-pointer"
                    >
                      <Download size={14} /> Excel Spreadsheet
                    </button>
                    <button 
                      onClick={() => handleDownloadTemplate('csv')}
                      className="flex-1 py-3 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 border border-slate-200 cursor-pointer"
                    >
                      <Download size={14} /> CSV Raw File
                    </button>
                  </div>
                </div>

                {/* Upload Step Card */}
                <div className="bg-white p-6 rounded-3xl border border-indigo-50 shadow-sm flex flex-col justify-between">
                  <div>
                    <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-4 font-bold">
                      <Upload size={20} />
                    </div>
                    <h4 className="font-bold text-slate-900 text-base mb-1">2. Import Filled Template</h4>
                    <p className="text-xs text-slate-400 mb-6 font-medium leading-relaxed">
                      Once directories are populated, upload your edited spreadsheet. Items with matching names or SKUs will be merged/updated seamlessly.
                    </p>

                    {isParsing ? (
                      <div className="border border-dashed border-indigo-200 rounded-2xl p-10 flex flex-col items-center justify-center bg-indigo-50/10 mb-2 animate-pulse">
                        <Loader2 className="animate-spin text-indigo-600 mb-2" size={32} />
                        <p className="text-xs font-bold text-indigo-600">Reading columns and looking up existing stock records...</p>
                      </div>
                    ) : (
                      <label className="border border-dashed border-slate-200 hover:border-indigo-400 rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer transition-colors mb-2 bg-slate-50/20 group text-center">
                        <FileSpreadsheet className="text-slate-400 group-hover:text-indigo-600 mb-2 transition-colors" size={38} />
                        <span className="text-xs font-bold text-slate-700">Select stock-pricing sheet</span>
                        <span className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider font-mono">XLSX, XLS, CSV</span>
                        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
                      </label>
                    )}
                  </div>

                  <div className="text-[10px] text-slate-500 font-medium bg-slate-50 p-3 rounded-xl border flex items-start gap-2 leading-relaxed">
                    <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
                    <span>The system matches stock items by SKU (if provided) or Item Name. If a match is found, prices and opening quantities are re-assigned without duplicating profiles.</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Mapping/Review preview workspace */
            <div className="flex-1 overflow-hidden flex flex-col">
              {/* Validation Summary ribbon */}
              <div className="bg-white p-4 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shrink-0 px-6">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest leading-none">Mapping Summary:</span>
                  <div className="flex flex-wrap gap-2">
                    <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-xl text-xs font-bold font-mono">
                      Parsed: {validationSummary.total} Rows
                    </span>
                    <span className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-xl text-xs font-bold font-mono flex items-center gap-1">
                      <PlusCircle size={12} /> Create New: {validationSummary.create}
                    </span>
                    <span className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-xl text-xs font-bold font-mono flex items-center gap-1">
                      <Edit2 size={12} /> Update Match: {validationSummary.update}
                    </span>
                    {validationSummary.error > 0 && (
                      <span className="bg-rose-50 text-rose-700 px-3 py-1 rounded-xl text-xs font-bold font-mono flex items-center gap-1 animate-pulse">
                        <AlertCircle size={12} /> Invalid: {validationSummary.error}
                      </span>
                    )}
                  </div>
                </div>

                <button 
                  onClick={() => { setFile(null); setParsedRows([]); }}
                  className="text-xs hover:text-indigo-600 font-bold border rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <RefreshCw size={12} /> Reset & Upload Another File
                </button>
              </div>

              {/* Grid Workspace Preview Table */}
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="border border-slate-100 rounded-2xl overflow-hidden shadow-sm bg-white">
                  <table className="w-full text-left text-xs font-sans">
                    <thead className="bg-slate-50 text-slate-550 font-black uppercase text-[10px] tracking-wider border-b border-slate-100">
                      <tr>
                        <th className="px-4 py-3">Suggested Action</th>
                        <th className="px-4 py-3">Item Details</th>
                        <th className="px-4 py-3">SKU / HSN</th>
                        <th className="px-4 py-3 text-right">GST Rate</th>
                        <th className="px-4 py-3 text-right">Purchase Rate</th>
                        <th className="px-4 py-3 text-right">Sales Price</th>
                        <th className="px-4 py-3 text-right">Stock Qty</th>
                        <th className="px-4 py-3">Status Comments</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedRows.map((row) => (
                        <tr key={row.tempId} className={`hover:bg-slate-50/50 transition-colors ${row.status === 'error' ? 'bg-red-50/20' : ''}`}>
                          <td className="px-4 py-3">
                            {row.status === 'create' ? (
                              <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 font-bold px-2.5 py-1 rounded-lg text-[10px] border border-emerald-150">
                                <PlusCircle size={10} /> + CREATE
                              </span>
                            ) : row.status === 'update' ? (
                              <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 font-bold px-2.5 py-1 rounded-lg text-[10px] border border-indigo-150">
                                <Edit2 size={10} /> ✎ UPDATE
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 font-bold px-2.5 py-1 rounded-lg text-[10px] border border-rose-150">
                                <AlertCircle size={10} /> 𐄂 REJECT
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-extrabold text-slate-900 block">{row.name || '—'}</span>
                            {row.status === 'update' && (
                              <span className="text-[10px] text-indigo-500 font-medium font-mono">Matches item: {row.matchedItemName}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono">
                            <span className="block text-slate-600">SKU: {row.sku || 'N/A'}</span>
                            <span className="text-[10px] text-slate-400">HSN: {row.hsn || 'N/A'}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-slate-600">{row.gstRate}%</td>
                          <td className="px-4 py-3 text-right font-mono text-slate-800">₹{row.purchasePrice.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right font-mono text-[11px] font-black text-slate-900">₹{row.salesPrice.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right">
                            <span className="font-extrabold text-indigo-900 font-mono text-[11px] block">{row.openingStockQty.toLocaleString()}</span>
                            <span className="text-[9px] text-slate-400 block tracking-widest uppercase">Unit: {row.unit}</span>
                          </td>
                          <td className="px-4 py-3 text-xs leading-normal">
                            {row.errors.length > 0 && (
                              <div className="text-red-600 font-semibold space-y-0.5">
                                {row.errors.map((e, i) => <span key={i} className="block">• {e}</span>)}
                              </div>
                            )}
                            {row.warnings.length > 0 && (
                              <div className="text-amber-600 font-medium space-y-0.5">
                                {row.warnings.map((w, i) => <span key={i} className="block">• {w}</span>)}
                              </div>
                            )}
                            {row.errors.length === 0 && row.warnings.length === 0 && (
                              <span className="text-emerald-600 font-bold tracking-tight">Ready to map. No issues found.</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Progress Bar & Apply Footer Bar */}
              <div className="bg-slate-50 border-t py-4 px-6 flex flex-col md:flex-row justify-between items-center gap-4 shrink-0 rounded-b-3xl">
                <div className="w-full md:w-auto">
                  {isImporting ? (
                    <div className="space-y-1.5 min-w-[280px]">
                      <div className="flex justify-between text-xs font-black text-indigo-800">
                        <span>Writing to Cloud Firestore Master...</span>
                        <span>{importProgress}%</span>
                      </div>
                      <div className="w-full bg-indigo-100 rounded-full h-2 overflow-hidden shadow-inner">
                        <div className="bg-indigo-600 h-full rounded-full transition-all duration-300" style={{ width: `${importProgress}%` }}></div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium leading-relaxed">
                      <Info size={14} className="text-slate-400 shrink-0" />
                      <span>Items marked with "CREATE" will enter stock records. Items marked "UPDATE" will overwrite buy/sell prices and adjust opening/running stock levels.</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 w-full md:w-auto shrink-0 justify-end">
                  <button 
                    disabled={isImporting}
                    onClick={() => { setFile(null); setParsedRows([]); }} 
                    className="py-2.5 px-5 hover:bg-slate-200 border text-xs font-black uppercase tracking-wider rounded-xl transition-all cursor-pointer text-slate-600"
                  >
                    Cancel
                  </button>
                  <button 
                    disabled={isImporting || validationSummary.create + validationSummary.update === 0}
                    onClick={handleApplyImport}
                    className="py-2.5 px-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-md shadow-indigo-100 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isImporting ? (
                      <>
                        <Loader2 className="animate-spin" size={14} /> Importing...
                      </>
                    ) : (
                      <>
                        Confirm & Apply Updates <ArrowRight size={14} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
