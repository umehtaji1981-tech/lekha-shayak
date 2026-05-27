import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  ArrowLeft, 
  Download, 
  Search, 
  Package, 
  TrendingUp, 
  TrendingDown,
  ChevronDown,
  Filter,
  RefreshCw,
  Eye,
  Printer
} from 'lucide-react';
import { dbService } from '../lib/db';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const formatQty = (qty: number, unit: string) => {
  if (qty === 0 || qty === undefined || qty === null) return '—';
  if (qty < 0) {
    return `(-)${Math.abs(qty).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit || ''}`;
  }
  return `${qty.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${unit || ''}`;
};

const formatCurrency = (amount: number, forceShowZero = false) => {
  if (!forceShowZero && (amount === 0 || amount === undefined || amount === null)) return '—';
  return amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatTallyDate = (dateStr: string) => {
  if (!dateStr) return '—';
  const date = new Date(dateStr);
  const day = date.getDate();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[date.getMonth()];
  const year = String(date.getFullYear()).substring(2);
  return `${day}-${month}-${year}`;
};

interface StockSummaryReportProps {
  company: any;
  companyId: string;
  activeFY: any;
  onBack?: () => void;
}

export const StockSummaryReport = ({ company, companyId, activeFY, onBack }: StockSummaryReportProps) => {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<any[]>([]);
  const [stockSummary, setStockSummary] = useState<any[]>([]);
  const [selectedItemForMovement, setSelectedItemForMovement] = useState<any | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const [reportPeriod, setReportPeriod] = useState({
    startDate: activeFY?.startDate || '',
    endDate: activeFY?.endDate || ''
  });
  const [periodMode, setPeriodMode] = useState<'custom' | 'monthly' | 'quarterly'>('custom');

  const handleMonthChange = (month: number) => {
    if (!activeFY) return;
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
    if (!activeFY) return;
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

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch all items
        const itemsSnap = await getDocs(query(collection(db, `companies/${companyId}/items`)));
        const itemsList = itemsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setItems(itemsList);

        // Fetch all transactions for stock calculation
        const txSnap = await getDocs(query(collection(db, `companies/${companyId}/transactions`)));
        const transactions = txSnap.docs.map(doc => doc.data());

        const summaryMap: any = {};

        // Initialize with item data
        itemsList.forEach((item: any) => {
          summaryMap[item.id] = {
            id: item.id,
            name: item.name,
            unit: item.unit,
            openingStockQty: Number(item.openingStockQty || 0), // Use explicit openingStockQty as the golden source of truth
            openingStockQtyExplicit: Number(item.openingStockQty || 0),
            openingStockValue: Number(item.openingStockValue || 0),
            openingStockRate: Number(item.openingStockRate || 0),
            purchasePrice: Number(item.purchasePrice || 0),
            
            // lifetime movements (all time)
            allTimeInward: 0,
            allTimeOutward: 0,
            
            // movements before selected period
            beforeFYInward: 0,
            beforeFYOutward: 0,
            beforeFYInwardValue: 0,
            
            // movements during selected period
            duringFYInward: 0,
            duringFYOutward: 0,
            duringFYInwardValue: 0,
            duringFYOutwardValue: 0,
          };
        });

        transactions.forEach((tx: any) => {
          if (tx.items) {
            tx.items.forEach((line: any) => {
              if (line.itemId && summaryMap[line.itemId]) {
                const qty = Number(line.qty || 0);
                const s = summaryMap[line.itemId];
                const lineRate = Number(line.rate || line.price || s.purchasePrice || s.openingStockRate || 0);
                const value = qty * lineRate;
                const isPurchase = tx.type && (tx.type.toLowerCase() === 'purchases' || tx.type.toLowerCase() === 'purchase');
                const isSale = tx.type && (tx.type.toLowerCase() === 'sales' || tx.type.toLowerCase() === 'sale');
                
                if (isPurchase) {
                  s.allTimeInward += qty;
                  if (reportPeriod.startDate) {
                    if (tx.date < reportPeriod.startDate) {
                      s.beforeFYInward += qty;
                      s.beforeFYInwardValue += value;
                    } else if (!reportPeriod.endDate || tx.date <= reportPeriod.endDate) {
                      s.duringFYInward += qty;
                      s.duringFYInwardValue += value;
                    }
                  } else {
                    s.duringFYInward += qty;
                    s.duringFYInwardValue += value;
                  }
                } else if (isSale) {
                  s.allTimeOutward += qty;
                  if (reportPeriod.startDate) {
                    if (tx.date < reportPeriod.startDate) {
                      s.beforeFYOutward += qty;
                    } else if (!reportPeriod.endDate || tx.date <= reportPeriod.endDate) {
                      s.duringFYOutward += qty;
                      s.duringFYOutwardValue += value;
                    }
                  } else {
                    s.duringFYOutward += qty;
                    s.duringFYOutwardValue += value;
                  }
                }
              }
            });
          }
        });

        // Calculate final opening, inwards, outwards, closing for the selected period
        const result = Object.values(summaryMap).map((s: any) => {
          // Calculate the original absolute opening stock (when item was created in DB)
          const dbCreatedOpeningStock = Math.max(0, Number(s.openingStockQtyExplicit || 0));
          
          // Opening stock at the start of the selected period
          const openingQty = Math.max(0, dbCreatedOpeningStock + s.beforeFYInward - s.beforeFYOutward);
          const openingRate = Math.max(0, s.openingStockRate || s.purchasePrice || 0);
          
          let openingValue = 0;
          if (openingQty === dbCreatedOpeningStock && s.openingStockValue > 0) {
            openingValue = Math.max(0, s.openingStockValue);
          } else {
            openingValue = Math.max(0, openingQty) * openingRate;
          }
          
          // Movements during the selected period
          const inwardQty = s.duringFYInward;
          const outwardQty = s.duringFYOutward;
          
          // Closing stock at the end of the selected period
          const closingQty = Math.max(0, openingQty + inwardQty - outwardQty);
          const closingRate = Math.max(0, s.openingStockRate || s.purchasePrice || 0);
          const closingValue = Math.max(0, closingQty) * closingRate;
          
          return {
            id: s.id,
            name: s.name,
            unit: s.unit,
            openingQty,
            openingRate,
            openingValue,
            inwardQty,
            outwardQty,
            closingQty,
            closingRate,
            closingValue
          };
        });

        setStockSummary(result);
        setAllTransactions(transactions);
      } catch (err) {
        console.error("Error fetching stock summary:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [companyId, activeFY, reportPeriod.startDate, reportPeriod.endDate]);

  const [isManualStock, setIsManualStock] = useState(company?.manualClosingStock ?? false);
  const [manualStockVal, setManualStockVal] = useState(company?.manualClosingStockValue ?? 0);

  useEffect(() => {
    setIsManualStock(company?.manualClosingStock ?? false);
    setManualStockVal(company?.manualClosingStockValue ?? 0);
  }, [company]);

  const [allTransactions, setAllTransactions] = useState<any[]>([]);

  const adjustedStockSummary = stockSummary;

  const filteredItems = useMemo(() => {
    return adjustedStockSummary.filter(item => 
      (item.name || '').toLowerCase().includes((searchTerm || '').toLowerCase())
    );
  }, [adjustedStockSummary, searchTerm]);

  const totalStockValue = useMemo(() => {
    return adjustedStockSummary.reduce((sum, item) => sum + (item.closingValue || 0), 0);
  }, [adjustedStockSummary]);

  const filteredTotalStockValue = useMemo(() => {
    return filteredItems.reduce((sum, item) => sum + (item.closingValue || 0), 0);
  }, [filteredItems]);

  const downloadPDF = () => {
    try {
      setIsDownloading(true);
      // Portrait layout matching exactly standard Tally invoice/report size (A4 portrait)
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      }) as any;
      
      const pageWidth = pdf.internal.pageSize.getWidth(); // 210mm
      
      let currentY = 15;
      pdf.setFontSize(16);
      pdf.setTextColor(15, 23, 42); // slate-900
      pdf.setFont(undefined, 'bold');
      pdf.text(company?.name?.toUpperCase() || 'COMPANY NAME', pageWidth / 2, currentY, { align: 'center' });
      
      currentY += 6;
      pdf.setFontSize(8);
      pdf.setTextColor(80);
      pdf.setFont(undefined, 'normal');
      const address = company?.address || '';
      const splitAddress = pdf.splitTextToSize(address, 150);
      pdf.text(splitAddress, pageWidth / 2, currentY, { align: 'center' });
      
      currentY += (splitAddress.length * 4) + 1;
      const contactInfo = [
        company?.phone && `Contact : ${company.phone}`,
        company?.email && `E-Mail : ${company.email}`
      ].filter(Boolean).join(' | ');
      if (contactInfo) {
        pdf.text(contactInfo, pageWidth / 2, currentY, { align: 'center' });
        currentY += 4;
      }

      if (company?.gstIn) {
        pdf.text(`GSTIN: ${company.gstIn}`, pageWidth / 2, currentY, { align: 'center' });
        currentY += 4;
      }

      currentY += 2;
      pdf.setDrawColor(200);
      pdf.line(15, currentY, pageWidth - 15, currentY);

      currentY += 6;
      pdf.setFontSize(14);
      pdf.setTextColor(15, 23, 42);
      pdf.setFont(undefined, 'bold');
      pdf.text('Stock Summary', pageWidth / 2, currentY, { align: 'center' });
      
      currentY += 5;
      pdf.setFontSize(9);
      pdf.setTextColor(100);
      pdf.setFont(undefined, 'normal');
      pdf.text(`${formatTallyDate(reportPeriod.startDate)} to ${formatTallyDate(reportPeriod.endDate)}`, pageWidth / 2, currentY, { align: 'center' });

      currentY += 8;

      // Prepare stock summary data for the PDF
      const tableData = adjustedStockSummary.map((item: any) => {
        return [
          item.name || '',
          formatQty(item.openingQty, item.unit),
          item.openingQty > 0 ? formatCurrency(item.openingRate, true) : '—',
          item.openingQty > 0 ? formatCurrency(item.openingValue) : '—',
          formatQty(item.closingQty, item.unit),
          item.closingQty > 0 ? formatCurrency(item.closingRate, true) : '—',
          item.closingQty > 0 ? formatCurrency(item.closingValue) : '—'
        ];
      });

      const totalOpeningVal = adjustedStockSummary.reduce((sum, item) => sum + (Number(item.openingValue) || 0), 0);
      const totalClosingVal = adjustedStockSummary.reduce((sum, item) => sum + (Number(item.closingValue) || 0), 0);
      
      tableData.push([
        'Grand Total',
        '', '', formatCurrency(totalOpeningVal, true),
        '', '', formatCurrency(totalClosingVal, true)
      ]);

      const columnsWidth = {
        0: { fontStyle: 'bold', halign: 'left', cellWidth: 'auto' },
        1: { halign: 'right', cellWidth: 25 },
        2: { halign: 'right', cellWidth: 20 },
        3: { halign: 'right', cellWidth: 25 },
        4: { halign: 'right', cellWidth: 25 },
        5: { halign: 'right', cellWidth: 20 },
        6: { halign: 'right', cellWidth: 25 }
      } as any;

      autoTable(pdf, {
        startY: currentY,
        head: [
          [
            { content: 'Particulars', rowSpan: 2, styles: { halign: 'left', valign: 'middle' } },
            { content: 'Opening Balance', colSpan: 3, styles: { halign: 'center' } },
            { content: 'Closing Balance', colSpan: 3, styles: { halign: 'center' } }
          ],
          [
            'Quantity', 'Rate', 'Value',
            'Quantity', 'Rate', 'Value'
          ]
        ],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], fontSize: 8, fontStyle: 'bold', lineWidth: 0.1, lineColor: [220, 220, 220] },
        styles: { fontSize: 8, cellPadding: 2.5, font: 'helvetica', lineColor: [220, 220, 220], lineWidth: 0.1 },
        columnStyles: columnsWidth,
        didParseCell: (data) => {
          if (data.row.raw && data.row.raw[0] === 'Grand Total') {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [248, 250, 252];
            data.cell.styles.textColor = [15, 23, 42];
          }
        },
        didDrawPage: (data) => {
          pdf.setFontSize(8);
          pdf.setTextColor(150);
          pdf.setFont(undefined, 'normal');
          pdf.text(`Generated on ${new Date().toLocaleString()} | Stock Summary Report`, 15, pdf.internal.pageSize.height - 10);
          pdf.text(`Page ${data.pageNumber}`, pdf.internal.pageSize.width - 25, pdf.internal.pageSize.height - 10);
        }
      });

      pdf.save(`StockSummary_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error('PDF Generation Error:', error);
      alert('Failed to generate PDF. Please use the Print option.');
    } finally {
      setIsDownloading(false);
      setIsExporting(false);
    }
  };

  const downloadItemMovementPDF = (summaryItem: any) => {
    try {
      setIsDownloading(true);
      const itemDetails = items.find(i => i.id === summaryItem.id) || summaryItem;
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      }) as any;
      
      const pageWidth = pdf.internal.pageSize.getWidth();
      let currentY = 15;
      
      pdf.setFontSize(16);
      pdf.setTextColor(15, 23, 42);
      pdf.setFont(undefined, 'bold');
      pdf.text(company?.name?.toUpperCase() || 'COMPANY NAME', pageWidth / 2, currentY, { align: 'center' });
      
      currentY += 6;
      pdf.setFontSize(8);
      pdf.setTextColor(80);
      pdf.setFont(undefined, 'normal');
      const address = company?.address || '';
      const splitAddress = pdf.splitTextToSize(address, 150);
      pdf.text(splitAddress, pageWidth / 2, currentY, { align: 'center' });
      
      currentY += (splitAddress.length * 4) + 1;
      const contactInfo = [
        company?.phone && `Contact : ${company.phone}`,
        company?.email && `E-Mail : ${company.email}`
      ].filter(Boolean).join(' | ');
      if (contactInfo) {
        pdf.text(contactInfo, pageWidth / 2, currentY, { align: 'center' });
        currentY += 4;
      }
      if (company?.gstIn) {
        pdf.text(`GSTIN: ${company.gstIn}`, pageWidth / 2, currentY, { align: 'center' });
        currentY += 4;
      }
      
      currentY += 2;
      pdf.setDrawColor(200);
      pdf.line(15, currentY, pageWidth - 15, currentY);
      
      currentY += 6;
      pdf.setFontSize(13);
      pdf.setTextColor(15, 23, 42);
      pdf.setFont(undefined, 'bold');
      pdf.text(`ITEM STOCK LEDGER: ${itemDetails.name.toUpperCase()}`, pageWidth / 2, currentY, { align: 'center' });
      
      currentY += 5;
      pdf.setFontSize(9);
      pdf.setTextColor(100);
      pdf.setFont(undefined, 'normal');
      pdf.text(`Period: ${formatTallyDate(reportPeriod.startDate)} to ${formatTallyDate(reportPeriod.endDate)}`, pageWidth / 2, currentY, { align: 'center' });
      
      currentY += 8;
      pdf.setFontSize(9);
      pdf.setFont(undefined, 'bold');
      pdf.setTextColor(30, 41, 59);
      pdf.text(`SKU / Code: ${itemDetails.sku || 'N/A'}`, 15, currentY);
      pdf.text(`Base Unit: ${itemDetails.unit || 'PCS'}`, 80, currentY);
      pdf.text(`HSN / SAC: ${itemDetails.hsn || 'N/A'}`, 140, currentY);
      
      currentY += 4;
      pdf.text(`GST Rate: ${itemDetails.gstRate || 0}%`, 15, currentY);
      pdf.text(`Sales Rate: Rs. ${formatCurrency(itemDetails.salesPrice || 0, true)}`, 80, currentY);
      pdf.text(`Purchase Rate: Rs. ${formatCurrency(itemDetails.purchasePrice || 0, true)}`, 140, currentY);
      
      currentY += 4;
      pdf.setDrawColor(230);
      pdf.line(15, currentY, pageWidth - 15, currentY);
      
      const openingQty = summaryItem ? summaryItem.openingQty : 0;
      const openingRate = summaryItem ? summaryItem.openingRate : (itemDetails.openingStockRate || itemDetails.purchasePrice || 0);
      const openingValue = summaryItem ? summaryItem.openingValue : 0;
      
      const relevantTxs = allTransactions.filter(tx => tx.items && tx.items.some((line: any) => line.itemId === itemDetails.id));
      const sortedTxs = [...relevantTxs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const periodMovements = sortedTxs.filter(tx => {
        if (!reportPeriod.startDate) return true;
        if (reportPeriod.endDate) {
          return tx.date >= reportPeriod.startDate && tx.date <= reportPeriod.endDate;
        }
        return tx.date >= reportPeriod.startDate;
      });
      
      let runningQty = openingQty;
      let runningValue = openingValue;
      
      const tableData: any[] = [];
      
      tableData.push([
        '',
        'Opening Stock Balance',
        '', '',
        '', '',
        formatQty(openingQty, itemDetails.unit),
        openingQty > 0 ? formatCurrency(openingRate, true) : '—',
        openingQty > 0 ? formatCurrency(openingValue) : '—'
      ]);
      
      let totalInQty = 0;
      let totalInVal = 0;
      let totalOutQty = 0;
      let totalOutVal = 0;
      
      periodMovements.forEach(tx => {
        const line = tx.items.find((l: any) => l.itemId === itemDetails.id);
        const qty = Number(line?.qty || 0);
        const rate = Number(line?.rate || line?.price || itemDetails.purchasePrice || itemDetails.openingStockRate || 0);
        const value = qty * rate;
        
        const isPurchase = tx.type && (tx.type.toLowerCase() === 'purchases' || tx.type.toLowerCase() === 'purchase');
        const isSale = tx.type && (tx.type.toLowerCase() === 'sales' || tx.type.toLowerCase() === 'sale');
        
        let inQtyStr = '—';
        let inValStr = '—';
        let outQtyStr = '—';
        let outValStr = '—';
        
        if (isPurchase) {
          runningQty += qty;
          runningValue += value;
          totalInQty += qty;
          totalInVal += value;
          inQtyStr = formatQty(qty, itemDetails.unit);
          inValStr = formatCurrency(value);
        } else if (isSale) {
          runningQty -= qty;
          runningValue -= value;
          totalOutQty += qty;
          totalOutVal += value;
          outQtyStr = formatQty(qty, itemDetails.unit);
          outValStr = formatCurrency(value);
        }
        
        const ptName = tx.partyName || tx.ledgerName || 'General Account';
        const vchNo = tx.voucherNumber ? `Vch #${tx.voucherNumber}` : '—';
        
        tableData.push([
          formatTallyDate(tx.date || ''),
          `${tx.type || 'Voucher'} (${vchNo}) - ${ptName}`,
          inQtyStr,
          inValStr,
          outQtyStr,
          outValStr,
          formatQty(runningQty, itemDetails.unit),
          runningQty > 0 ? formatCurrency(rate, true) : '—',
          runningQty > 0 ? formatCurrency(runningValue) : '—'
        ]);
      });
      
      const closingQty = runningQty;
      const closingValue = runningValue;
      
      tableData.push([
        'Total',
        'Summary Totals & Closing',
        formatQty(totalInQty, itemDetails.unit),
        formatCurrency(totalInVal, true),
        formatQty(totalOutQty, itemDetails.unit),
        formatCurrency(totalOutVal, true),
        formatQty(closingQty, itemDetails.unit),
        closingQty > 0 ? formatCurrency(closingQty > 0 ? (closingValue / closingQty) : 0, true) : '—',
        formatCurrency(closingValue, true)
      ]);
      
      const columnsWidth = {
        0: { cellWidth: 16, halign: 'left' },
        1: { cellWidth: 'auto', halign: 'left' },
        2: { cellWidth: 18, halign: 'right' },
        3: { cellWidth: 18, halign: 'right' },
        4: { cellWidth: 18, halign: 'right' },
        5: { cellWidth: 18, halign: 'right' },
        6: { cellWidth: 18, halign: 'right' },
        7: { cellWidth: 16, halign: 'right' },
        8: { cellWidth: 18, halign: 'right' }
      } as any;
      
      autoTable(pdf, {
        startY: currentY + 5,
        head: [
          [
            { content: 'Date', rowSpan: 2, styles: { valign: 'middle', halign: 'left' } },
            { content: 'Particulars & Reference', rowSpan: 2, styles: { valign: 'middle', halign: 'left' } },
            { content: 'Inwards (Purchases)', colSpan: 2, styles: { halign: 'center' } },
            { content: 'Outwards (Sales)', colSpan: 2, styles: { halign: 'center' } },
            { content: 'Running Balance', colSpan: 3, styles: { halign: 'center' } }
          ],
          [
            'Quantity', 'Value',
            'Quantity', 'Value',
            'Quantity', 'Rate', 'Value'
          ]
        ],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [248, 250, 252], textColor: [15, 23, 42], fontSize: 7, fontStyle: 'bold', lineWidth: 0.1, lineColor: [220, 220, 220] },
        styles: { fontSize: 6.5, cellPadding: 2, font: 'helvetica', lineColor: [220, 220, 220], lineWidth: 0.1 },
        columnStyles: columnsWidth,
        didParseCell: (data) => {
          if (data.row.raw && data.row.raw[1] === 'Opening Stock Balance') {
            data.cell.styles.fontStyle = 'italic';
            data.cell.styles.textColor = [100, 116, 139];
          }
          if (data.row.raw && data.row.raw[0] === 'Total') {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [241, 245, 249];
            data.cell.styles.textColor = [15, 23, 42];
          }
        },
        didDrawPage: (data) => {
          pdf.setFontSize(8);
          pdf.setTextColor(150);
          pdf.setFont(undefined, 'normal');
          pdf.text(`Generated on ${new Date().toLocaleString()} | Specific Item Register`, 15, pdf.internal.pageSize.height - 10);
          pdf.text(`Page ${data.pageNumber}`, pdf.internal.pageSize.width - 25, pdf.internal.pageSize.height - 10);
        }
      });
      
      pdf.save(`StockLedger_${itemDetails.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (error) {
      console.error('PDF Generation Error:', error);
      alert('Failed to generate PDF. Please use the Print option.');
    } finally {
      setIsDownloading(false);
    }
  };

  const renderItemMovementView = (summaryItem: any) => {
    const itemDetails = items.find(i => i.id === summaryItem.id) || summaryItem;
    
    const openingQty = summaryItem ? summaryItem.openingQty : 0;
    const openingRate = summaryItem ? summaryItem.openingRate : (itemDetails.openingStockRate || itemDetails.purchasePrice || 0);
    const openingValue = summaryItem ? summaryItem.openingValue : 0;

    const relevantTxs = allTransactions.filter((tx: any) => 
      tx.items && tx.items.some((line: any) => line.itemId === itemDetails.id)
    );
    const sortedTxs = [...relevantTxs].sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return (a.voucherNumber || '').localeCompare(b.voucherNumber || '');
    });

    const periodMovements = sortedTxs.filter((tx: any) => {
      if (!reportPeriod.startDate) return true;
      if (reportPeriod.endDate) {
        return tx.date >= reportPeriod.startDate && tx.date <= reportPeriod.endDate;
      }
      return tx.date >= reportPeriod.startDate;
    });

    let runningQty = openingQty;
    let runningValue = openingValue;

    let totalInQty = 0;
    let totalInVal = 0;
    let totalOutQty = 0;
    let totalOutVal = 0;

    const rows = periodMovements.map((tx: any, idx: number) => {
      const line = tx.items.find((l: any) => l.itemId === itemDetails.id);
      const qty = Number(line?.qty || 0);
      const rate = Number(line?.rate || line?.price || itemDetails.purchasePrice || itemDetails.openingStockRate || 0);
      const value = qty * rate;

      const isPurchase = tx.type && (tx.type.toLowerCase() === 'purchases' || tx.type.toLowerCase() === 'purchase');
      const isSale = tx.type && (tx.type.toLowerCase() === 'sales' || tx.type.toLowerCase() === 'sale');

      if (isPurchase) {
        runningQty += qty;
        runningValue += value;
        totalInQty += qty;
        totalInVal += value;
      } else if (isSale) {
        runningQty -= qty;
        runningValue -= value;
        totalOutQty += qty;
        totalOutVal += value;
      }

      return {
        id: tx.id || `vch-${idx}`,
        date: tx.date || '',
        voucherType: tx.type || 'Voucher',
        voucherNo: tx.voucherNumber || '—',
        partyName: tx.partyName || tx.ledgerName || 'General Account',
        inQty: isPurchase ? qty : 0,
        inRate: isPurchase ? rate : 0,
        inValue: isPurchase ? value : 0,
        outQty: isSale ? qty : 0,
        outRate: isSale ? rate : 0,
        outValue: isSale ? value : 0,
        runQty: runningQty,
        runValue: runningValue
      };
    });

    const closingQty = runningQty;
    const closingValue = runningValue;

    return (
      <div className="space-y-6">
        {/* Print Header Specific for Item */}
        <div className="hidden print:block text-center mb-8 pb-4 border-b-2 border-slate-900">
          <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900">{company?.name || 'Company Name'}</h1>
          <p className="text-sm font-bold text-slate-500 mt-1">Specific Item Stock Ledger: {itemDetails.name}</p>
          <p className="text-xs text-slate-400 mt-0.5">Period: {reportPeriod.startDate ? formatTallyDate(reportPeriod.startDate) : '—'} to {reportPeriod.endDate ? formatTallyDate(reportPeriod.endDate) : '—'}</p>
        </div>

        {/* Dynamic header navigation */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm print:hidden">
          <div className="flex items-center gap-4 flex-wrap">
            <button 
              onClick={() => setSelectedItemForMovement(null)} 
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500 flex items-center gap-1.5 focus:outline-none h-10 px-3 border border-slate-200"
            >
              <ArrowLeft size={16} />
              <span className="text-xs font-bold">Summary</span>
            </button>
            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
              <Package size={20} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                <span>{itemDetails.name}</span>
                <span className="text-[10px] font-mono bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded text-indigo-700">Ledger Book</span>
              </h3>
              <p className="text-xs text-slate-500">
                Sku: {itemDetails.sku || 'N/A'} | Unit: {itemDetails.unit || 'PCS'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Quick selectivity switcher */}
            <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200 shadow-inner h-10">
              <span className="text-[10px] font-bold text-slate-500 px-2 uppercase">Switch:</span>
              <select
                value={summaryItem.id}
                onChange={(e) => {
                  const sItem = adjustedStockSummary.find(s => s.id === e.target.value);
                  if (sItem) setSelectedItemForMovement(sItem);
                }}
                className="bg-white border border-slate-200 text-xs font-black text-indigo-600 focus:outline-none p-1.5 rounded-lg cursor-pointer max-w-[160px]"
              >
                {adjustedStockSummary.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* Date logic in synchrony */}
            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 h-10 items-center">
              <select 
                value={periodMode}
                onChange={(e: any) => setPeriodMode(e.target.value)}
                className="bg-transparent border-none text-[10px] font-bold text-indigo-600 focus:ring-0 p-1 cursor-pointer border-r border-slate-200 mr-1"
              >
                <option value="custom">Custom Date</option>
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
                      {new Date(2000, m).toLocaleString('default', { month: 'long' })} {m >= 3 ? new Date(activeFY?.startDate).getFullYear() : new Date(activeFY?.endDate).getFullYear()}
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

            <button 
              onClick={() => downloadItemMovementPDF(summaryItem)} 
              disabled={isDownloading}
              className="btn-secondary text-xs h-10 flex items-center gap-2 font-bold"
            >
              {isDownloading ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
              {isDownloading ? 'Downloading...' : 'PDF'}
            </button>
            <button onClick={() => window.print()} className="btn-secondary text-xs h-10 text-slate-700 font-bold flex items-center gap-2">
               <Printer size={14} /> Print
            </button>
          </div>
        </div>

        {/* Quick details bento panel */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Opening Stock</span>
            <span className="text-xl font-black text-slate-800 tracking-tight block">
              {formatQty(openingQty, itemDetails.unit)}
            </span>
            <div className="text-[10px] font-bold text-slate-500 mt-1 flex justify-between">
              <span>Rate: ₹{formatCurrency(openingRate, true)}</span>
              <span className="text-slate-600">Val: ₹{formatCurrency(openingValue)}</span>
            </div>
          </div>

          <div className="bg-white p-4 border border-slate-110 rounded-2xl shadow-sm hover:shadow-md transition-shadow border-l-4 border-l-emerald-500">
            <span className="text-[10px] font-black text-slate-block uppercase tracking-widest block mb-1">Total Inwards (+)</span>
            <span className="text-xl font-black text-emerald-600 tracking-tight block">
              {formatQty(totalInQty, itemDetails.unit)}
            </span>
            <div className="text-[10px] font-bold text-slate-500 mt-1">
              <span>Total Value: ₹{formatCurrency(totalInVal, true)}</span>
            </div>
          </div>

          <div className="bg-white p-4 border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow border-l-4 border-l-rose-500">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Total Outwards (-)</span>
            <span className="text-xl font-black text-rose-600 tracking-tight block">
              {formatQty(totalOutQty, itemDetails.unit)}
            </span>
            <div className="text-[10px] font-bold text-slate-500 mt-1">
              <span>Total Value: ₹{formatCurrency(totalOutVal, true)}</span>
            </div>
          </div>

          <div className="bg-white p-4 border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow border-l-4 border-l-indigo-600">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Closing Stock</span>
            <span className="text-xl font-black text-indigo-600 tracking-tight block">
              {formatQty(closingQty, itemDetails.unit)}
            </span>
            <div className="text-[10px] font-bold text-slate-500 mt-1 flex justify-between">
              <span>Avg Rate: ₹{formatCurrency(closingQty > 0 ? (closingValue / closingQty) : openingRate, true)}</span>
              <span className="text-slate-700 font-extrabold text-[11px]">Val: ₹{formatCurrency(closingValue)}</span>
            </div>
          </div>
        </div>

        {/* Specific item metadata description block */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-semibold text-slate-600">
          <div>
            <span className="text-[10px] font-black text-slate-400 uppercase block mb-0.5">HSN Code</span>
            <span className="text-slate-800 font-bold">{itemDetails.hsn || 'N/A'}</span>
          </div>
          <div>
            <span className="text-[10px] font-black text-slate-400 uppercase block mb-0.5">GST Rate</span>
            <span className="text-slate-800 font-bold">{itemDetails.gstRate || 0}%</span>
          </div>
          <div>
            <span className="text-[10px] font-black text-slate-400 uppercase block mb-0.5">Purchase Cost Limit</span>
            <span className="text-slate-800 font-bold">₹{formatCurrency(itemDetails.purchasePrice || 0, true)}</span>
          </div>
          <div>
            <span className="text-[10px] font-black text-slate-400 uppercase block mb-0.5">Standard Selling Price</span>
            <span className="text-slate-800 font-bold">₹{formatCurrency(itemDetails.salesPrice || 0, true)}</span>
          </div>
        </div>

        {/* Item movements ledger table */}
        <div className="card overflow-hidden shadow-sm border border-slate-200">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 text-slate-700 uppercase font-black text-[10px] tracking-wider border-b border-slate-200">
                <tr>
                  <th rowSpan={2} className="px-4 py-3 border-r border-slate-200 min-w-[80px] align-middle">Date</th>
                  <th rowSpan={2} className="px-4 py-3 border-r border-slate-200 min-w-[240px] align-middle">Particulars &amp; Voucher No</th>
                  <th colSpan={3} className="px-4 py-2 text-center border-r border-slate-200 bg-emerald-50/50 text-emerald-950">Inwards (Purchases)</th>
                  <th colSpan={3} className="px-4 py-2 text-center border-r border-slate-200 bg-rose-50/50 text-rose-950">Outwards (Sales)</th>
                  <th colSpan={2} className="px-4 py-2 text-center bg-indigo-50/50 text-indigo-950">Running Balance</th>
                </tr>
                <tr className="border-t border-slate-200">
                  <th className="px-3 py-2 text-right bg-emerald-50/20 text-emerald-800">Qty</th>
                  <th className="px-3 py-2 text-right bg-emerald-50/20 text-emerald-800">Rate</th>
                  <th className="px-3 py-2 text-right border-r border-slate-200 bg-emerald-50/20 text-emerald-800 font-bold">Value</th>
                  
                  <th className="px-3 py-2 text-right bg-rose-50/20 text-rose-800">Qty</th>
                  <th className="px-3 py-2 text-right bg-rose-50/20 text-rose-800">Rate</th>
                  <th className="px-3 py-2 text-right border-r border-slate-200 bg-rose-50/20 text-rose-800 font-bold">Value</th>
                  
                  <th className="px-3 py-2 text-right bg-indigo-50/20 text-indigo-800">Qty</th>
                  <th className="px-3 py-2 text-right bg-indigo-50/20 text-indigo-800 font-bold">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-800">
                {/* Opening row */}
                <tr className="bg-slate-50/50 italic text-slate-500 font-medium">
                  <td className="px-4 py-2.5 border-r border-slate-200">—</td>
                  <td className="px-4 py-2.5 border-r border-slate-200 font-bold text-slate-650">Opening Stock Balance</td>
                  <td className="px-3 py-2.5 text-right bg-slate-100/10">—</td>
                  <td className="px-3 py-2.5 text-right bg-slate-100/10">—</td>
                  <td className="px-3 py-2.5 text-right border-r border-slate-200 bg-slate-100/10">—</td>
                  <td className="px-3 py-2.5 text-right bg-slate-100/10">—</td>
                  <td className="px-3 py-2.5 text-right bg-slate-100/10">—</td>
                  <td className="px-3 py-2.5 text-right border-r border-slate-200 bg-slate-100/10">—</td>
                  <td className="px-3 py-2.5 text-right bg-indigo-50/5 font-bold text-slate-700">{formatQty(openingQty, itemDetails.unit)}</td>
                  <td className="px-3 py-2.5 text-right bg-indigo-50/5 font-extrabold text-slate-800">₹{formatCurrency(openingValue)}</td>
                </tr>

                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 border-r border-slate-200 font-mono text-slate-600 whitespace-nowrap">{formatTallyDate(row.date)}</td>
                    <td className="px-4 py-3 border-r border-slate-200">
                      <div className="font-bold text-slate-800">
                        {row.voucherType} <span className="text-indigo-600 text-[10px] font-mono font-medium">({row.voucherNo})</span>
                      </div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-0.5">
                        {row.partyName}
                      </div>
                    </td>
                    
                    {/* Inwards */}
                    <td className="px-3 py-3 text-right bg-emerald-50/5 text-slate-800 font-medium">
                      {row.inQty > 0 ? formatQty(row.inQty, itemDetails.unit) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right bg-emerald-50/5 font-mono text-slate-500">
                      {row.inQty > 0 ? `₹${formatCurrency(row.inRate, true)}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right border-r border-slate-200 bg-emerald-50/10 font-bold text-emerald-800">
                      {row.inQty > 0 ? `₹${formatCurrency(row.inValue)}` : '—'}
                    </td>
                    
                    {/* Outwards */}
                    <td className="px-3 py-3 text-right bg-rose-50/5 text-slate-800 font-medium">
                      {row.outQty > 0 ? formatQty(row.outQty, itemDetails.unit) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right bg-rose-50/5 font-mono text-slate-500">
                      {row.outQty > 0 ? `₹${formatCurrency(row.outRate, true)}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right border-r border-slate-200 bg-rose-50/10 font-bold text-rose-800">
                      {row.outQty > 0 ? `₹${formatCurrency(row.outValue)}` : '—'}
                    </td>
                    
                    {/* Running balance */}
                    <td className="px-3 py-3 text-right bg-indigo-50/5 font-bold text-indigo-900">
                      {formatQty(row.runQty, itemDetails.unit)}
                    </td>
                    <td className="px-3 py-3 text-right bg-indigo-50/10 font-black text-indigo-950">
                      ₹{formatCurrency(row.runValue)}
                    </td>
                  </tr>
                ))}

                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-6 py-12 text-center text-slate-400 italic">
                      No stock movement transactions recorded in this period.
                    </td>
                  </tr>
                )}

                {/* Closing ledger summary row */}
                <tr className="bg-slate-100 font-black border-t-2 border-slate-300">
                  <td className="px-4 py-3 border-r border-slate-200 text-slate-900">Total</td>
                  <td className="px-4 py-3 border-r border-slate-200 text-slate-700 uppercase text-[10px] tracking-widest text-left">Summary Totals</td>
                  {/* Total Inward Column */}
                  <td className="px-3 py-3 text-right bg-emerald-100/50 text-emerald-900">{formatQty(totalInQty, itemDetails.unit)}</td>
                  <td className="px-3 py-3 text-right bg-emerald-110/50">—</td>
                  <td className="px-3 py-3 text-right border-r border-slate-200 bg-emerald-100 text-emerald-950">₹{formatCurrency(totalInVal, true)}</td>
                  {/* Total Outward Column */}
                  <td className="px-3 py-3 text-right bg-rose-100/50 text-rose-900">{formatQty(totalOutQty, itemDetails.unit)}</td>
                  <td className="px-3 py-3 text-right bg-rose-110/50">—</td>
                  <td className="px-3 py-3 text-right border-r border-slate-200 bg-rose-100 text-rose-950">₹{formatCurrency(totalOutVal, true)}</td>
                  {/* Final closing */}
                  <td className="px-3 py-3 text-right bg-indigo-100 text-indigo-900">{formatQty(closingQty, itemDetails.unit)}</td>
                  <td className="px-3 py-3 text-right bg-indigo-200 text-indigo-950">₹{formatCurrency(closingValue, true)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  if (selectedItemForMovement) {
    return renderItemMovementView(selectedItemForMovement);
  }

  return (
    <div className="space-y-6 print:pb-0">
      {/* Print Header */}
      <div className="hidden print:block text-center mb-8 pb-4 border-b-2 border-slate-900">
        <h1 className="text-2xl font-black uppercase tracking-tighter text-slate-900">Stock Summary Report</h1>
        <p className="text-sm font-bold text-slate-500 mt-1">Item-wise Stock Movement Analysis</p>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm print:hidden">
        <div className="flex items-center gap-4">
          {onBack && (
            <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500 print:hidden">
              <ArrowLeft size={20} />
            </button>
          )}
          <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
             <Package size={20} />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Stock Summary</h3>
            <p className="text-xs text-slate-500">
              Period: {reportPeriod.startDate ? new Date(reportPeriod.startDate).toLocaleDateString() : '—'} to {reportPeriod.endDate ? new Date(reportPeriod.endDate).toLocaleDateString() : '—'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto print:hidden">
           <div className="relative flex-1 md:w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                className="input-field pl-10 py-2 text-sm w-full" 
                placeholder="Search items..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
           </div>

           <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 h-10 items-center">
             <select 
               value={periodMode}
               onChange={(e: any) => setPeriodMode(e.target.value)}
               className="bg-transparent border-none text-[10px] font-bold text-indigo-600 focus:ring-0 p-1 cursor-pointer border-r border-slate-200 mr-1"
             >
               <option value="custom">Custom Date</option>
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
                     {new Date(2000, m).toLocaleString('default', { month: 'long' })} {m >= 3 ? new Date(activeFY?.startDate).getFullYear() : new Date(activeFY?.endDate).getFullYear()}
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

           <button 
             onClick={downloadPDF} 
             disabled={isDownloading}
             className="btn-secondary text-xs h-10 flex items-center gap-2 font-bold"
           >
             {isDownloading ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
             {isDownloading ? 'Downloading...' : 'PDF'}
           </button>
           <button onClick={() => window.print()} className="btn-secondary text-xs h-10 print:hidden text-slate-700 font-bold flex items-center gap-2">
              <Download size={14} /> Print
           </button>
        </div>

      </div>

      <div ref={reportRef} className="space-y-6 bg-white p-8 print:p-0">
        <div className="text-center mb-8 pb-6 border-b-2 border-slate-900">
          <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900">{company?.name}</h1>
          <div className="text-xs uppercase font-bold text-slate-500 mt-1 flex flex-col gap-0.5">
            <span>{company?.address}</span>
            <span>GSTIN: {company?.gstIn} | PAN: {company?.pan || (company?.gstIn ? company.gstIn.substring(2, 12) : 'N/A')}</span>
            {company?.phone && <span>Ph: {company.phone} | Email: {company.email}</span>}
          </div>
          <div className="mt-6 pt-4 border-t border-slate-100">
            <h2 className="text-xl font-bold uppercase tracking-widest text-slate-800">Stock Summary</h2>
            <p className="text-sm font-bold text-slate-500 mt-1">Period: {reportPeriod.startDate ? formatTallyDate(reportPeriod.startDate) : '—'} to {reportPeriod.endDate ? formatTallyDate(reportPeriod.endDate) : '—'}</p>
          </div>
        </div>

      {/* Manual Closing Stock Override Selector Panel */}
      <div className="grid grid-cols-1 gap-4 print:hidden mb-6">
        <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-800 block">Closing Stock Valuation Mode</span>
            <p className="text-[10px] text-slate-500 font-medium mt-0.5 leading-normal">Override closing stock with a manual valuation on Balance Sheet &amp; Profit &amp; Loss</p>
          </div>
          <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm shrink-0 items-center gap-2">
            <select
              value={isManualStock ? 'Manual' : 'Dynamic'}
              onChange={async (e) => {
                const manual = e.target.value === 'Manual';
                setIsManualStock(manual);
                await dbService.update(`companies`, companyId, {
                  manualClosingStock: manual
                });
              }}
              className="bg-transparent border-none text-[10px] font-black uppercase tracking-wide text-indigo-600 focus:ring-0 p-1 cursor-pointer"
            >
              <option value="Dynamic">Dynamic</option>
              <option value="Manual">Manual</option>
            </select>
            {isManualStock && (
              <input
                type="number"
                min="0"
                value={manualStockVal}
                onChange={async (e) => {
                  const val = Math.max(0, Number(e.target.value));
                  setManualStockVal(val);
                  await dbService.update(`companies`, companyId, {
                    manualClosingStockValue: val
                  });
                }}
                className="w-24 text-[10px] font-bold p-1 border rounded bg-slate-50 text-indigo-600 focus:outline-none"
                placeholder="Value..."
              />
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:hidden">
        <div className="card p-5 border-b-4 border-indigo-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Items</div>
          <div className="text-2xl font-black text-slate-900">{stockSummary.length}</div>
        </div>
        <div className="card p-5 border-b-4 border-amber-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Stock Value</div>
          <div className="text-2xl font-black text-amber-600">
            ₹{totalStockValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden shadow-sm border border-slate-200 mt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-700 uppercase font-black text-[10px] tracking-wider border-b border-slate-200">
              <tr>
                <th rowSpan={2} className="px-4 py-3 border-r border-slate-200 min-w-[200px] align-middle">Particulars</th>
                <th colSpan={3} className="px-4 py-2 text-center border-r border-slate-200 bg-slate-100/50">Opening Balance</th>
                <th colSpan={3} className="px-4 py-2 text-center bg-indigo-50/50 text-indigo-900">Closing Balance</th>
              </tr>
              <tr className="border-t border-slate-200">
                {/* Opening Balance Sub-headers */}
                <th className="px-3 py-2 text-right bg-slate-100/30">Quantity</th>
                <th className="px-3 py-2 text-right bg-slate-100/30">Rate</th>
                <th className="px-3 py-2 text-right border-r border-slate-200 bg-slate-100/30">Value</th>
                {/* Closing Balance Sub-headers */}
                <th className="px-3 py-2 text-right text-indigo-700 bg-indigo-50/20">Quantity</th>
                <th className="px-3 py-2 text-right text-indigo-700 bg-indigo-50/20">Rate</th>
                <th className="px-3 py-2 text-right text-indigo-700 bg-indigo-50/20 font-bold">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-800">
              {loading ? (
                <tr>
                   <td colSpan={7} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                        <span className="text-slate-500 font-medium">Calculating stock levels...</span>
                      </div>
                   </td>
                </tr>
              ) : filteredItems.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3 border-r border-slate-200 font-bold text-slate-900">
                    <button 
                      onClick={() => setSelectedItemForMovement(item)}
                      className="text-left text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1.5 focus:outline-none focus:ring-0 leading-normal"
                      title="View Complete Stock Movement Ledger"
                    >
                      <Eye size={13} className="shrink-0 text-slate-400 hover:text-indigo-600 cursor-pointer" />
                      <span>{item.name}</span>
                    </button>
                  </td>
                  {/* Opening Balance */}
                  <td className="px-3 py-3 text-right bg-slate-50/10 font-medium">{formatQty(item.openingQty, item.unit)}</td>
                  <td className="px-3 py-3 text-right bg-slate-50/10 font-mono text-slate-600">{item.openingQty > 0 ? formatCurrency(item.openingRate, true) : '—'}</td>
                  <td className="px-3 py-3 text-right border-r border-slate-200 bg-slate-50/10 font-bold text-slate-900">{item.openingQty > 0 ? formatCurrency(item.openingValue) : '—'}</td>
                  {/* Closing Balance */}
                  <td className="px-3 py-3 text-right bg-indigo-50/10 font-semibold text-indigo-900">{formatQty(item.closingQty, item.unit)}</td>
                  <td className="px-3 py-3 text-right bg-indigo-50/10 font-mono text-indigo-800">{item.closingQty > 0 ? formatCurrency(item.closingRate, true) : '—'}</td>
                  <td className="px-3 py-3 text-right bg-indigo-50/20 font-black text-indigo-950">{item.closingQty > 0 ? formatCurrency(item.closingValue) : '—'}</td>
                </tr>
              ))}
              {!loading && filteredItems.length > 0 && (
                <tr className="bg-slate-100 font-black border-t-2 border-slate-300">
                  <td className="px-4 py-3 border-r border-slate-200 text-slate-900">Grand Total</td>
                  {/* Opening Balance Total */}
                  <td className="px-3 py-3 text-right bg-slate-100">—</td>
                  <td className="px-3 py-3 text-right bg-slate-100">—</td>
                  <td className="px-3 py-3 text-right border-r border-slate-200 bg-slate-100 text-slate-900">
                    {formatCurrency(filteredItems.reduce((sum, item) => sum + (Number(item.openingValue) || 0), 0), true)}
                  </td>
                  {/* Closing Balance Total */}
                  <td className="px-3 py-3 text-right bg-indigo-50/20">—</td>
                  <td className="px-3 py-3 text-right bg-indigo-50/20">—</td>
                  <td className="px-3 py-3 text-right bg-indigo-100 text-indigo-950">
                    {formatCurrency(filteredItems.reduce((sum, item) => sum + (Number(item.closingValue) || 0), 0), true)}
                  </td>
                </tr>
              )}
              {filteredItems.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400 italic">
                    No matching items found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  );
};
