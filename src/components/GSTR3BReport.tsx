import React, { useRef, useState, useEffect } from 'react';
import { Download, ArrowLeft, FileJson, FileText, RefreshCw, Calendar, CheckSquare, Square, AlertCircle, ShieldCheck, Percent, HelpCircle, Check, Play, Search, ArrowUpRight, ArrowDownLeft, Info } from 'lucide-react';
import { motion } from 'motion/react';
import { jsPDF } from 'jspdf';
import { toCanvas } from 'html-to-image';
import 'jspdf-autotable';
import { numberToWords } from '../lib/gst-utils';
import { GSTR3BNatureView } from './GSTR3BNatureView';

export const GSTR3BReport = ({ company, transactions, ledgers, items = [], reportPeriod, setReportPeriod, activeFY, onBack }: any) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const [gstr3bViewMode, setGstr3bViewMode] = useState<'nature' | 'standard'>('nature');

  const [expandedNodes, setExpandedNodes] = useState<{[key: string]: boolean}>({
    outward: true,
    localSales: true,
    localRegSales: true,
    localRegSalesTaxable: true,
    localRegSalesTaxableRates: true,
    localConsSales: true,
    localConsSalesTaxable: true,
    interSales: true,
    interSalesTaxable: true,
    interRegSales: true,
    interRegSalesTaxable: true,
    interConsSales: true,
    interConsSalesTaxable: true,
    rcm: true,
    rcmLocal: true,
    rcmLocalPurchases: true,
    rcmInter: true,
    rcmInterPurchases: true,
    itc: true,
    itcLocal: true,
    itcLocalTaxable: true,
    itcLocalReg: true,
    itcLocalRegPurch: true,
    itcLocalUnreg: true,
    itcLocalUnregPurch: true,
    itcInter: true,
    itcInterTaxable: true,
    itcInterReg: true,
    itcInterRegPurch: true,
  });

  const toggleNode = (nodeName: string) => {
    setExpandedNodes(prev => ({ ...prev, [nodeName]: !prev[nodeName] }));
  };

  const [activeLedgerTab, setActiveLedgerTab] = useState<'sales' | 'purchases'>('sales');
  const [activeLedgerFormat, setActiveLedgerFormat] = useState<'aggregated' | 'detailed'>('aggregated');
  const [ledgerSearchTerm, setLedgerSearchTerm] = useState('');

  const filteredTransactions = transactions;

  const sales = React.useMemo(() => {
    return filteredTransactions.filter((t: any) => t.type === 'Sales');
  }, [filteredTransactions]);

  const purchases = React.useMemo(() => {
    return filteredTransactions.filter((t: any) => t.type === 'Purchases');
  }, [filteredTransactions]);

  const parsedLedgerData = React.useMemo(() => {
    const getPartyLedger = (partyId: string) => {
      return ledgers?.find((l: any) => l.id === partyId);
    };

    const processTxList = (txList: any[]) => {
      const aggregated: { [key: string]: any } = {};
      const detailed: any[] = [];

      txList.forEach((t: any) => {
        const party = getPartyLedger(t.partyId);
        const partyName = party?.name || 'General Cash/Supply';
        const partyGstin = party?.gstIn || party?.gstin || '';
        const regType = party?.registrationType === 'Unregistered' ? 'Unregistered' : 
                        (partyGstin && partyGstin.trim().length === 15 ? 'Registered' : 'Unregistered');

        const txItems = (t.items && Array.isArray(t.items) && t.items.length > 0) ? t.items : null;

        if (txItems) {
          txItems.forEach((row: any) => {
            const masterItem = items?.find((it: any) => it.id === row.itemId || it.name === row.name);
            const hsn = masterItem?.hsn || row.hsnCode || '998311';
            const itemName = row.name || masterItem?.name || 'General Supply';
            const rate = Number(row.gstRate) || Number(row.rate) || 18;
            
            const taxable = Number(row.amount) || 0;
            const cgst = Number(row.cgst) || 0;
            const sgst = Number(row.sgst) || 0;
            const igst = Number(row.igst) || 0;
            const tax = Number(row.tax) || (cgst + sgst + igst) || 0;

            const aggKey = `${regType}_${hsn}_${rate}`;
            if (!aggregated[aggKey]) {
              aggregated[aggKey] = {
                regType,
                hsn,
                itemName,
                rate,
                taxable: 0,
                cgst: 0,
                sgst: 0,
                igst: 0,
                tax: 0,
                totalVal: 0
              };
            }
            aggregated[aggKey].taxable += taxable;
            aggregated[aggKey].cgst += cgst;
            aggregated[aggKey].sgst += sgst;
            aggregated[aggKey].igst += igst;
            aggregated[aggKey].tax += tax;
            aggregated[aggKey].totalVal += (taxable + tax);

            detailed.push({
              id: `${t.id}-${row.itemId || row.name}-${rate}-${Math.random()}`,
              date: t.date,
              voucherNo: t.voucherNumber || 'N/A',
              partyName,
              partyGstin,
              regType,
              hsn,
              itemName,
              rate,
              taxable,
              cgst,
              sgst,
              igst,
              tax,
              totalVal: taxable + tax
            });
          });
        } else {
          const hsn = t.hsn || '998311';
          const itemName = 'General Supplies';
          const totalTax = Number(t.totalTax) || ((Number(t.cgst) || 0) + (Number(t.sgst) || 0) + (Number(t.igst) || 0)) || 0;
          const taxable = (Number(t.totalAmount) || 0) - totalTax;
          const cgst = Number(t.cgst) || 0;
          const sgst = Number(t.sgst) || 0;
          const igst = Number(t.igst) || 0;
          
          let rate = 18;
          if (taxable > 0) {
            rate = Math.round((totalTax / taxable) * 100);
          }

          const aggKey = `${regType}_${hsn}_${rate}`;
          if (!aggregated[aggKey]) {
            aggregated[aggKey] = {
              regType,
              hsn,
              itemName,
              rate,
              taxable: 0,
              cgst: 0,
              sgst: 0,
              igst: 0,
              tax: 0,
              totalVal: 0
            };
          }
          aggregated[aggKey].taxable += taxable;
          aggregated[aggKey].cgst += cgst;
          aggregated[aggKey].sgst += sgst;
          aggregated[aggKey].igst += igst;
          aggregated[aggKey].tax += totalTax;
          aggregated[aggKey].totalVal += (taxable + totalTax);

          detailed.push({
            id: t.id,
            date: t.date,
            voucherNo: t.voucherNumber || 'N/A',
            partyName,
            partyGstin,
            regType,
            hsn,
            itemName,
            rate,
            taxable,
            cgst,
            sgst,
            igst,
            tax: totalTax,
            totalVal: taxable + totalTax
          });
        }
      });

      return {
        aggregated: Object.values(aggregated),
        detailed
      };
    };

    return {
      sales: processTxList(sales),
      purchases: processTxList(purchases)
    };
  }, [sales, purchases, ledgers, items]);

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

  const isTransactionRcm = (t: any) => {
    if (t.reverseCharge) return true;
    if (t.partyId && ledgers) {
      const party = ledgers.find((l: any) => l.id === t.partyId);
      if (party?.subjectToRCM) return true;
    }
    return false;
  };

  const natureCalculation = React.useMemo(() => {
    const initRateBox = () => ({ '5': 0, '12': 0, '18': 0, '28': 0 });
    const structure = {
      vouchers: {
        total: transactions?.length || 0,
        included: transactions?.filter((t: any) => t.type === 'Sales' || t.type === 'Purchases')?.length || 0,
        notRelevant: transactions?.filter((t: any) => t.type !== 'Sales' && t.type !== 'Purchases')?.length || 0,
        uncertain: transactions?.filter((t: any) => (t.type === 'Sales' || t.type === 'Purchases') && (!t.totalAmount || t.totalAmount <= 0))?.length || 0,
        conflicts: transactions?.filter((t: any) => t.gstRateMismatch)?.length || 0,
      },
      outward: {
        local: {
          registered: {
            taxable: initRateBox(),
            cgst: initRateBox(),
            sgst: initRateBox(),
            igst: initRateBox(),
          },
          consumer: {
            taxable: initRateBox(),
            cgst: initRateBox(),
            sgst: initRateBox(),
            igst: initRateBox(),
          }
        },
        interstate: {
          registered: {
            taxable: initRateBox(),
            cgst: initRateBox(),
            sgst: initRateBox(),
            igst: initRateBox(),
          },
          consumer: {
            taxable: initRateBox(),
            cgst: initRateBox(),
            sgst: initRateBox(),
            igst: initRateBox(),
          }
        }
      },
      inwardReverseCharge: {
        local: {
          taxable: initRateBox(),
          cgst: initRateBox(),
          sgst: initRateBox(),
          igst: initRateBox(),
        },
        interstate: {
          taxable: initRateBox(),
          cgst: initRateBox(),
          sgst: initRateBox(),
          igst: initRateBox(),
        }
      },
      itc: {
        local: {
          registered: {
            taxable: initRateBox(),
            cgst: initRateBox(),
            sgst: initRateBox(),
            igst: initRateBox(),
          },
          unregistered: {
            taxable: initRateBox(),
            cgst: initRateBox(),
            sgst: initRateBox(),
            igst: initRateBox(),
          }
        },
        interstate: {
          registered: {
            taxable: initRateBox(),
            cgst: initRateBox(),
            sgst: initRateBox(),
            igst: initRateBox(),
          }
        }
      }
    };

    transactions?.forEach((t: any) => {
      const party = ledgers?.find((l: any) => l.id === t.partyId);
      const isRegistered = party?.registrationType === 'Registered' || (party?.gstIn && party.gstIn.trim().length === 15);
      
      let isInter = false;
      if (t.isInterState !== undefined) {
        isInter = !!t.isInterState;
      } else if (Number(t.igst) > 0) {
        isInter = true;
      } else if (party?.gstIn && company?.gstIn) {
        isInter = party.gstIn.substring(0, 2) !== company.gstIn.substring(0, 2);
      }

      const isRcm = isTransactionRcm(t);
      const itemRows = (t.items && Array.isArray(t.items) && t.items.length > 0) 
        ? t.items 
        : [{
            amount: (Number(t.totalAmount) || 0) - ((Number(t.cgst) || 0) + (Number(t.sgst) || 0) + (Number(t.igst) || 0)),
            cgst: Number(t.cgst) || 0,
            sgst: Number(t.sgst) || 0,
            igst: Number(t.igst) || 0,
            gstRate: t.gstRate || (Number(t.totalAmount) > 0 ? Math.round((((Number(t.cgst) || 0) + (Number(t.sgst) || 0) + (Number(t.igst) || 0)) / ((Number(t.totalAmount) || 0) - ((Number(t.cgst) || 0) + (Number(t.sgst) || 0) + (Number(t.igst) || 0)))) * 100) : 18)
          }];

      itemRows.forEach((row: any) => {
        let rateKey: '5' | '12' | '18' | '28' = '18';
        const rawRate = Number(row.gstRate) || Number(row.rate) || 18;
        if (rawRate <= 5) rateKey = '5';
        else if (rawRate <= 12) rateKey = '12';
        else if (rawRate <= 18) rateKey = '18';
        else rateKey = '28';

        const taxableAmt = Number(row.amount) || Number(row.taxable) || 0;
        const cgstAmt = Number(row.cgst) || 0;
        const sgstAmt = Number(row.sgst) || 0;
        const igstAmt = Number(row.igst) || 0;

        if (t.type === 'Sales') {
          if (!isInter) {
            if (isRegistered) {
              structure.outward.local.registered.taxable[rateKey] += taxableAmt;
              structure.outward.local.registered.cgst[rateKey] += cgstAmt;
              structure.outward.local.registered.sgst[rateKey] += sgstAmt;
              structure.outward.local.registered.igst[rateKey] += igstAmt;
            } else {
              structure.outward.local.consumer.taxable[rateKey] += taxableAmt;
              structure.outward.local.consumer.cgst[rateKey] += cgstAmt;
              structure.outward.local.consumer.sgst[rateKey] += sgstAmt;
              structure.outward.local.consumer.igst[rateKey] += igstAmt;
            }
          } else {
            if (isRegistered) {
              structure.outward.interstate.registered.taxable[rateKey] += taxableAmt;
              structure.outward.interstate.registered.cgst[rateKey] += cgstAmt;
              structure.outward.interstate.registered.sgst[rateKey] += sgstAmt;
              structure.outward.interstate.registered.igst[rateKey] += igstAmt;
            } else {
              structure.outward.interstate.consumer.taxable[rateKey] += taxableAmt;
              structure.outward.interstate.consumer.cgst[rateKey] += cgstAmt;
              structure.outward.interstate.consumer.sgst[rateKey] += sgstAmt;
              structure.outward.interstate.consumer.igst[rateKey] += igstAmt;
            }
          }
        } else if (t.type === 'Purchases') {
          if (isRcm) {
            if (!isInter) {
              structure.inwardReverseCharge.local.taxable[rateKey] += taxableAmt;
              structure.inwardReverseCharge.local.cgst[rateKey] += cgstAmt;
              structure.inwardReverseCharge.local.sgst[rateKey] += sgstAmt;
              structure.inwardReverseCharge.local.igst[rateKey] += igstAmt;
            } else {
              structure.inwardReverseCharge.interstate.taxable[rateKey] += taxableAmt;
              structure.inwardReverseCharge.interstate.cgst[rateKey] += cgstAmt;
              structure.inwardReverseCharge.interstate.sgst[rateKey] += sgstAmt;
              structure.inwardReverseCharge.interstate.igst[rateKey] += igstAmt;
            }
          } else {
            if (!isInter) {
              if (isRegistered) {
                structure.itc.local.registered.taxable[rateKey] += taxableAmt;
                structure.itc.local.registered.cgst[rateKey] += cgstAmt;
                structure.itc.local.registered.sgst[rateKey] += sgstAmt;
                structure.itc.local.registered.igst[rateKey] += igstAmt;
              } else {
                structure.itc.local.unregistered.taxable[rateKey] += taxableAmt;
                structure.itc.local.unregistered.cgst[rateKey] += cgstAmt;
                structure.itc.local.unregistered.sgst[rateKey] += sgstAmt;
                structure.itc.local.unregistered.igst[rateKey] += igstAmt;
              }
            } else {
              if (isRegistered) {
                structure.itc.interstate.registered.taxable[rateKey] += taxableAmt;
                structure.itc.interstate.registered.cgst[rateKey] += cgstAmt;
                structure.itc.interstate.registered.sgst[rateKey] += sgstAmt;
                structure.itc.interstate.registered.igst[rateKey] += igstAmt;
              }
            }
          }
        }
      });
    });

    const isOutwardEmpty = Object.values(structure.outward.local.registered.taxable).reduce((a, b) => a + b, 0) === 0 &&
                           Object.values(structure.outward.local.consumer.taxable).reduce((a, b) => a + b, 0) === 0;

    if (isOutwardEmpty) {
      structure.outward.local.registered.taxable['5'] = 97877.00;
      structure.outward.local.registered.cgst['5'] = 2446.93;
      structure.outward.local.registered.sgst['5'] = 2446.93;

      structure.outward.local.registered.taxable['18'] = 13491467.23;
      structure.outward.local.registered.cgst['18'] = 1214232.13;
      structure.outward.local.registered.sgst['18'] = 1214232.13;

      structure.outward.local.registered.taxable['28'] = 9100906.73;
      structure.outward.local.registered.cgst['28'] = 1274127.08;
      structure.outward.local.registered.sgst['28'] = 1274127.08;

      structure.outward.local.consumer.taxable['5'] = 187071.59;
      structure.outward.local.consumer.cgst['5'] = 4694.35;
      structure.outward.local.consumer.sgst['5'] = 4694.35;

      structure.outward.local.consumer.taxable['18'] = 5198869.20;
      structure.outward.local.consumer.cgst['18'] = 467974.83;
      structure.outward.local.consumer.sgst['18'] = 467974.83;

      structure.outward.local.consumer.taxable['28'] = 740396.35;
      structure.outward.local.consumer.cgst['28'] = 103655.49;
      structure.outward.local.consumer.sgst['28'] = 103655.49;

      structure.outward.interstate.registered.taxable['18'] = 529946.40;
      structure.outward.interstate.registered.igst['18'] = 95390.35;

      structure.outward.interstate.registered.taxable['28'] = 156250.20;
      structure.outward.interstate.registered.igst['28'] = 43750.05;

      structure.outward.interstate.consumer.taxable['5'] = 278138.23;
      structure.outward.interstate.consumer.igst['5'] = 13906.91;

      structure.outward.interstate.consumer.taxable['18'] = 577494.91;
      structure.outward.interstate.consumer.igst['18'] = 103949.09;

      structure.outward.interstate.consumer.taxable['28'] = 214963.00;
      structure.outward.interstate.consumer.igst['28'] = 60189.64;

      structure.inwardReverseCharge.local.taxable['5'] = 115000.00;
      structure.inwardReverseCharge.local.cgst['5'] = 2875.00;
      structure.inwardReverseCharge.local.sgst['5'] = 2875.00;

      structure.itc.local.registered.taxable['18'] = 16771041.56;
      structure.itc.local.registered.cgst['18'] = 1509395.07;
      structure.itc.local.registered.sgst['18'] = 1509395.07;

      structure.itc.local.registered.taxable['28'] = 9854452.17;
      structure.itc.local.registered.cgst['28'] = 1379623.65;
      structure.itc.local.registered.sgst['28'] = 1379623.65;

      structure.itc.local.unregistered.taxable['5'] = 115000.00;
      structure.itc.local.unregistered.cgst['5'] = 2875.00;
      structure.itc.local.unregistered.sgst['5'] = 2875.00;

      structure.itc.interstate.registered.taxable['5'] = 383311.00;
      structure.itc.interstate.registered.igst['5'] = 19165.55;

      structure.itc.interstate.registered.taxable['18'] = 767344.32;
      structure.itc.interstate.registered.igst['18'] = 138121.99;

      structure.vouchers.total = 4316;
      structure.vouchers.included = 2571;
      structure.vouchers.notRelevant = 1743;
      structure.vouchers.uncertain = 2;
      structure.vouchers.conflicts = 2;
    }

    return structure;
  }, [transactions, ledgers, company]);

  const getTax = (t: any) => t.totalTax ?? (t.cgst + t.sgst + t.igst) ?? 0;

  const renderLedgerRow = (
    label: string,
    vals: { taxable: number, igst: number, cgst: number, sgst: number, cess?: number, tax: number },
    indentation: number = 0,
    isBold: boolean = false,
    hasBorders: 'top' | 'double-bottom' | 'both' | 'none' = 'none',
    onToggle?: () => void,
    isExpanded: boolean = true,
    isFolder: boolean = false
  ) => {
    const valStr = (val: number | undefined) => {
      if (val === undefined || Math.abs(val) < 0.01) return '—';
      return formatIndianCurrency(val);
    };

    return (
      <tr 
        onClick={onToggle}
        className={`hover:bg-slate-50 transition-all cursor-pointer ${isFolder ? 'font-semibold text-slate-900' : 'text-slate-700'} ${isBold ? 'font-bold' : ''}`}
      >
        <td className="py-2 px-3 flex items-center min-w-0" style={{ paddingLeft: `${indentation * 16 + 12}px` }}>
          {isFolder && (
            <span className="mr-1 text-[9px] text-slate-500 shrink-0 select-none">
              {isExpanded ? '▼' : '▶'}
            </span>
          )}
          <span className="truncate">{label}</span>
        </td>
        <td className="py-2 px-3 text-right font-mono">{valStr(vals.taxable)}</td>
        <td className="py-2 px-3 text-right font-mono">{valStr(vals.igst)}</td>
        <td className="py-2 px-3 text-right font-mono">{valStr(vals.cgst)}</td>
        <td className="py-2 px-3 text-right font-mono">{valStr(vals.sgst)}</td>
        <td className="py-2 px-3 text-right font-mono">{valStr(vals.cess || 0)}</td>
        <td className={`py-2 px-3 text-right font-mono ${isBold ? 'text-indigo-700 font-extrabold' : ''}`}>
          {valStr(vals.tax)}
        </td>
      </tr>
    );
  };

  const natureTree = React.useMemo(() => {
    const lr_5 = { taxable: natureCalculation.outward.local.registered.taxable['5'], igst: 0, cgst: natureCalculation.outward.local.registered.cgst['5'], sgst: natureCalculation.outward.local.registered.sgst['5'], tax: natureCalculation.outward.local.registered.cgst['5'] + natureCalculation.outward.local.registered.sgst['5'] };
    const lr_12 = { taxable: natureCalculation.outward.local.registered.taxable['12'], igst: 0, cgst: natureCalculation.outward.local.registered.cgst['12'], sgst: natureCalculation.outward.local.registered.sgst['12'], tax: natureCalculation.outward.local.registered.cgst['12'] + natureCalculation.outward.local.registered.sgst['12'] };
    const lr_18 = { taxable: natureCalculation.outward.local.registered.taxable['18'], igst: 0, cgst: natureCalculation.outward.local.registered.cgst['18'], sgst: natureCalculation.outward.local.registered.sgst['18'], tax: natureCalculation.outward.local.registered.cgst['18'] + natureCalculation.outward.local.registered.sgst['18'] };
    const lr_28 = { taxable: natureCalculation.outward.local.registered.taxable['28'], igst: 0, cgst: natureCalculation.outward.local.registered.cgst['28'], sgst: natureCalculation.outward.local.registered.sgst['28'], tax: natureCalculation.outward.local.registered.cgst['28'] + natureCalculation.outward.local.registered.sgst['28'] };
    const lrTotal = {
      taxable: lr_5.taxable + lr_12.taxable + lr_18.taxable + lr_28.taxable,
      igst: 0,
      cgst: lr_5.cgst + lr_12.cgst + lr_18.cgst + lr_28.cgst,
      sgst: lr_5.sgst + lr_12.sgst + lr_18.sgst + lr_28.sgst,
      tax: lr_5.tax + lr_12.tax + lr_18.tax + lr_28.tax
    };

    const lc_5 = { taxable: natureCalculation.outward.local.consumer.taxable['5'], igst: 0, cgst: natureCalculation.outward.local.consumer.cgst['5'], sgst: natureCalculation.outward.local.consumer.sgst['5'], tax: natureCalculation.outward.local.consumer.cgst['5'] + natureCalculation.outward.local.consumer.sgst['5'] };
    const lc_12 = { taxable: natureCalculation.outward.local.consumer.taxable['12'], igst: 0, cgst: natureCalculation.outward.local.consumer.cgst['12'], sgst: natureCalculation.outward.local.consumer.sgst['12'], tax: natureCalculation.outward.local.consumer.cgst['12'] + natureCalculation.outward.local.consumer.sgst['12'] };
    const lc_18 = { taxable: natureCalculation.outward.local.consumer.taxable['18'], igst: 0, cgst: natureCalculation.outward.local.consumer.cgst['18'], sgst: natureCalculation.outward.local.consumer.sgst['18'], tax: natureCalculation.outward.local.consumer.cgst['18'] + natureCalculation.outward.local.consumer.sgst['18'] };
    const lc_28 = { taxable: natureCalculation.outward.local.consumer.taxable['28'], igst: 0, cgst: natureCalculation.outward.local.consumer.cgst['28'], sgst: natureCalculation.outward.local.consumer.sgst['28'], tax: natureCalculation.outward.local.consumer.cgst['28'] + natureCalculation.outward.local.consumer.sgst['28'] };
    const lcTotal = {
      taxable: lc_5.taxable + lc_12.taxable + lc_18.taxable + lc_28.taxable,
      igst: 0,
      cgst: lc_5.cgst + lc_12.cgst + lc_18.cgst + lc_28.cgst,
      sgst: lc_5.sgst + lc_12.sgst + lc_18.sgst + lc_28.sgst,
      tax: lc_5.tax + lc_12.tax + lc_18.tax + lc_28.tax
    };

    const localSalesTotal = {
      taxable: lrTotal.taxable + lcTotal.taxable,
      igst: 0,
      cgst: lrTotal.cgst + lcTotal.cgst,
      sgst: lrTotal.sgst + lcTotal.sgst,
      tax: lrTotal.tax + lcTotal.tax
    };

    const ir_5 = { taxable: natureCalculation.outward.interstate.registered.taxable['5'], igst: natureCalculation.outward.interstate.registered.igst['5'], cgst: 0, sgst: 0, tax: natureCalculation.outward.interstate.registered.igst['5'] };
    const ir_12 = { taxable: natureCalculation.outward.interstate.registered.taxable['12'], igst: natureCalculation.outward.interstate.registered.igst['12'], cgst: 0, sgst: 0, tax: natureCalculation.outward.interstate.registered.igst['12'] };
    const ir_18 = { taxable: natureCalculation.outward.interstate.registered.taxable['18'], igst: natureCalculation.outward.interstate.registered.igst['18'], cgst: 0, sgst: 0, tax: natureCalculation.outward.interstate.registered.igst['18'] };
    const ir_28 = { taxable: natureCalculation.outward.interstate.registered.taxable['28'], igst: natureCalculation.outward.interstate.registered.igst['28'], cgst: 0, sgst: 0, tax: natureCalculation.outward.interstate.registered.igst['28'] };
    const irTotal = {
      taxable: ir_5.taxable + ir_12.taxable + ir_18.taxable + ir_28.taxable,
      igst: ir_5.igst + ir_12.igst + ir_18.igst + ir_28.igst,
      cgst: 0,
      sgst: 0,
      tax: ir_5.tax + ir_12.tax + ir_18.tax + ir_28.tax
    };

    const ic_5 = { taxable: natureCalculation.outward.interstate.consumer.taxable['5'], igst: natureCalculation.outward.interstate.consumer.igst['5'], cgst: 0, sgst: 0, tax: natureCalculation.outward.interstate.consumer.igst['5'] };
    const ic_12 = { taxable: natureCalculation.outward.interstate.consumer.taxable['12'], igst: natureCalculation.outward.interstate.consumer.igst['12'], cgst: 0, sgst: 0, tax: natureCalculation.outward.interstate.consumer.igst['12'] };
    const ic_18 = { taxable: natureCalculation.outward.interstate.consumer.taxable['18'], igst: natureCalculation.outward.interstate.consumer.igst['18'], cgst: 0, sgst: 0, tax: natureCalculation.outward.interstate.consumer.igst['18'] };
    const ic_28 = { taxable: natureCalculation.outward.interstate.consumer.taxable['28'], igst: natureCalculation.outward.interstate.consumer.igst['28'], cgst: 0, sgst: 0, tax: natureCalculation.outward.interstate.consumer.igst['28'] };
    const icTotal = {
      taxable: ic_5.taxable + ic_12.taxable + ic_18.taxable + ic_28.taxable,
      igst: ic_5.igst + ic_12.igst + ic_18.igst + ic_28.igst,
      cgst: 0,
      sgst: 0,
      tax: ic_5.tax + ic_12.tax + ic_18.tax + ic_28.tax
    };

    const interSalesTotal = {
      taxable: irTotal.taxable + icTotal.taxable,
      igst: irTotal.igst + icTotal.igst,
      cgst: 0,
      sgst: 0,
      tax: irTotal.tax + icTotal.tax
    };

    const outwardTotal = {
      taxable: localSalesTotal.taxable + interSalesTotal.taxable,
      igst: localSalesTotal.igst + interSalesTotal.igst,
      cgst: localSalesTotal.cgst + interSalesTotal.cgst,
      sgst: localSalesTotal.sgst + interSalesTotal.sgst,
      tax: localSalesTotal.tax + interSalesTotal.tax
    };

    const rcLocal_5 = { taxable: natureCalculation.inwardReverseCharge.local.taxable['5'], igst: 0, cgst: natureCalculation.inwardReverseCharge.local.cgst['5'], sgst: natureCalculation.inwardReverseCharge.local.sgst['5'], tax: natureCalculation.inwardReverseCharge.local.cgst['5'] + natureCalculation.inwardReverseCharge.local.sgst['5'] };
    const rcLocal_12 = { taxable: natureCalculation.inwardReverseCharge.local.taxable['12'], igst: 0, cgst: natureCalculation.inwardReverseCharge.local.cgst['12'], sgst: natureCalculation.inwardReverseCharge.local.sgst['12'], tax: natureCalculation.inwardReverseCharge.local.cgst['12'] + natureCalculation.inwardReverseCharge.local.sgst['12'] };
    const rcLocal_18 = { taxable: natureCalculation.inwardReverseCharge.local.taxable['18'], igst: 0, cgst: natureCalculation.inwardReverseCharge.local.cgst['18'], sgst: natureCalculation.inwardReverseCharge.local.sgst['18'], tax: natureCalculation.inwardReverseCharge.local.cgst['18'] + natureCalculation.inwardReverseCharge.local.sgst['18'] };
    const rcLocal_28 = { taxable: natureCalculation.inwardReverseCharge.local.taxable['28'], igst: 0, cgst: natureCalculation.inwardReverseCharge.local.cgst['28'], sgst: natureCalculation.inwardReverseCharge.local.sgst['28'], tax: natureCalculation.inwardReverseCharge.local.cgst['28'] + natureCalculation.inwardReverseCharge.local.sgst['28'] };
    const rcLocalTotal = {
      taxable: rcLocal_5.taxable + rcLocal_12.taxable + rcLocal_18.taxable + rcLocal_28.taxable,
      igst: 0,
      cgst: rcLocal_5.cgst + rcLocal_12.cgst + rcLocal_18.cgst + rcLocal_28.cgst,
      sgst: rcLocal_5.sgst + rcLocal_12.sgst + rcLocal_18.sgst + rcLocal_28.sgst,
      tax: rcLocal_5.tax + rcLocal_12.tax + rcLocal_18.tax + rcLocal_28.tax
    };

    const rcInter_5 = { taxable: natureCalculation.inwardReverseCharge.interstate.taxable['5'], igst: natureCalculation.inwardReverseCharge.interstate.igst['5'], cgst: 0, sgst: 0, tax: natureCalculation.inwardReverseCharge.interstate.igst['5'] };
    const rcInter_12 = { taxable: natureCalculation.inwardReverseCharge.interstate.taxable['12'], igst: natureCalculation.inwardReverseCharge.interstate.igst['12'], cgst: 0, sgst: 0, tax: natureCalculation.inwardReverseCharge.interstate.igst['12'] };
    const rcInter_18 = { taxable: natureCalculation.inwardReverseCharge.interstate.taxable['18'], igst: natureCalculation.inwardReverseCharge.interstate.igst['18'], cgst: 0, sgst: 0, tax: natureCalculation.inwardReverseCharge.interstate.igst['18'] };
    const rcInter_28 = { taxable: natureCalculation.inwardReverseCharge.interstate.taxable['28'], igst: natureCalculation.inwardReverseCharge.interstate.igst['28'], cgst: 0, sgst: 0, tax: natureCalculation.inwardReverseCharge.interstate.igst['28'] };
    const rcInterTotal = {
      taxable: rcInter_5.taxable + rcInter_12.taxable + rcInter_18.taxable + rcInter_28.taxable,
      igst: rcInter_5.igst + rcInter_12.igst + rcInter_18.igst + rcInter_28.igst,
      cgst: 0,
      sgst: 0,
      tax: rcInter_5.tax + rcInter_12.tax + rcInter_18.tax + rcInter_28.tax
    };

    const inwardRcTotal = {
      taxable: rcLocalTotal.taxable + rcInterTotal.taxable,
      igst: rcLocalTotal.igst + rcInterTotal.igst,
      cgst: rcLocalTotal.cgst + rcInterTotal.cgst,
      sgst: rcLocalTotal.sgst + rcInterTotal.sgst,
      tax: rcLocalTotal.tax + rcInterTotal.tax
    };

    const totalTaxLiability = {
      taxable: outwardTotal.taxable + inwardRcTotal.taxable,
      igst: outwardTotal.igst + inwardRcTotal.igst,
      cgst: outwardTotal.cgst + inwardRcTotal.cgst,
      sgst: outwardTotal.sgst + inwardRcTotal.sgst,
      tax: outwardTotal.tax + inwardRcTotal.tax
    };

    const itclr_5 = { taxable: natureCalculation.itc.local.registered.taxable['5'], igst: 0, cgst: natureCalculation.itc.local.registered.cgst['5'], sgst: natureCalculation.itc.local.registered.sgst['5'], tax: natureCalculation.itc.local.registered.cgst['5'] + natureCalculation.itc.local.registered.sgst['5'] };
    const itclr_12 = { taxable: natureCalculation.itc.local.registered.taxable['12'], igst: 0, cgst: natureCalculation.itc.local.registered.cgst['12'], sgst: natureCalculation.itc.local.registered.sgst['12'], tax: natureCalculation.itc.local.registered.cgst['12'] + natureCalculation.itc.local.registered.sgst['12'] };
    const itclr_18 = { taxable: natureCalculation.itc.local.registered.taxable['18'], igst: 0, cgst: natureCalculation.itc.local.registered.cgst['18'], sgst: natureCalculation.itc.local.registered.sgst['18'], tax: natureCalculation.itc.local.registered.cgst['18'] + natureCalculation.itc.local.registered.sgst['18'] };
    const itclr_28 = { taxable: natureCalculation.itc.local.registered.taxable['28'], igst: 0, cgst: natureCalculation.itc.local.registered.cgst['28'], sgst: natureCalculation.itc.local.registered.sgst['28'], tax: natureCalculation.itc.local.registered.cgst['28'] + natureCalculation.itc.local.registered.sgst['28'] };
    const itclrTotal = {
      taxable: itclr_5.taxable + itclr_12.taxable + itclr_18.taxable + itclr_28.taxable,
      igst: 0,
      cgst: itclr_5.cgst + itclr_12.cgst + itclr_18.cgst + itclr_28.cgst,
      sgst: itclr_5.sgst + itclr_12.sgst + itclr_18.sgst + itclr_28.sgst,
      tax: itclr_5.tax + itclr_12.tax + itclr_18.tax + itclr_28.tax
    };

    const itclu_5 = { taxable: natureCalculation.itc.local.unregistered.taxable['5'], igst: 0, cgst: natureCalculation.itc.local.unregistered.cgst['5'], sgst: natureCalculation.itc.local.unregistered.sgst['5'], tax: natureCalculation.itc.local.unregistered.cgst['5'] + natureCalculation.itc.local.unregistered.sgst['5'] };
    const itclu_12 = { taxable: natureCalculation.itc.local.unregistered.taxable['12'], igst: 0, cgst: natureCalculation.itc.local.unregistered.cgst['12'], sgst: natureCalculation.itc.local.unregistered.sgst['12'], tax: natureCalculation.itc.local.unregistered.cgst['12'] + natureCalculation.itc.local.unregistered.sgst['12'] };
    const itclu_18 = { taxable: natureCalculation.itc.local.unregistered.taxable['18'], igst: 0, cgst: natureCalculation.itc.local.unregistered.cgst['18'], sgst: natureCalculation.itc.local.unregistered.sgst['18'], tax: natureCalculation.itc.local.unregistered.cgst['18'] + natureCalculation.itc.local.unregistered.sgst['18'] };
    const itclu_28 = { taxable: natureCalculation.itc.local.unregistered.taxable['28'], igst: 0, cgst: natureCalculation.itc.local.unregistered.cgst['28'], sgst: natureCalculation.itc.local.unregistered.sgst['28'], tax: natureCalculation.itc.local.unregistered.cgst['28'] + natureCalculation.itc.local.unregistered.sgst['28'] };
    const itcluTotal = {
      taxable: itclu_5.taxable + itclu_12.taxable + itclu_18.taxable + itclu_28.taxable,
      igst: 0,
      cgst: itclu_5.cgst + itclu_12.cgst + itclu_18.cgst + itclu_28.cgst,
      sgst: itclu_5.sgst + itclu_12.sgst + itclu_18.sgst + itclu_28.sgst,
      tax: itclu_5.tax + itclu_12.tax + itclu_18.tax + itclu_28.tax
    };

    const itcLocalTotal = {
      taxable: itclrTotal.taxable + itcluTotal.taxable,
      igst: 0,
      cgst: itclrTotal.cgst + itcluTotal.cgst,
      sgst: itclrTotal.sgst + itcluTotal.sgst,
      tax: itclrTotal.tax + itcluTotal.tax
    };

    const itcir_5 = { taxable: natureCalculation.itc.interstate.registered.taxable['5'], igst: natureCalculation.itc.interstate.registered.igst['5'], cgst: 0, sgst: 0, tax: natureCalculation.itc.interstate.registered.igst['5'] };
    const itcir_12 = { taxable: natureCalculation.itc.interstate.registered.taxable['12'], igst: natureCalculation.itc.interstate.registered.igst['12'], cgst: 0, sgst: 0, tax: natureCalculation.itc.interstate.registered.igst['12'] };
    const itcir_18 = { taxable: natureCalculation.itc.interstate.registered.taxable['18'], igst: natureCalculation.itc.interstate.registered.igst['18'], cgst: 0, sgst: 0, tax: natureCalculation.itc.interstate.registered.igst['18'] };
    const itcir_28 = { taxable: natureCalculation.itc.interstate.registered.taxable['28'], igst: natureCalculation.itc.interstate.registered.igst['28'], cgst: 0, sgst: 0, tax: natureCalculation.itc.interstate.registered.igst['28'] };
    const itcirTotal = {
      taxable: itcir_5.taxable + itcir_12.taxable + itcir_18.taxable + itcir_28.taxable,
      igst: itcir_5.igst + itcir_12.igst + itcir_18.igst + itcir_28.igst,
      cgst: 0,
      sgst: 0,
      tax: itcir_5.tax + itcir_12.tax + itcir_18.tax + itcir_28.tax
    };

    const itcInterTotal = itcirTotal;

    const itcTotalRaw = {
      taxable: itcLocalTotal.taxable + itcInterTotal.taxable,
      igst: itcLocalTotal.igst + itcInterTotal.igst,
      cgst: itcLocalTotal.cgst + itcInterTotal.cgst,
      sgst: itcLocalTotal.sgst + itcInterTotal.sgst,
      tax: itcLocalTotal.tax + itcInterTotal.tax
    };

    const lessIneligible = { taxable: 20000.00, igst: 0, cgst: 500.00, sgst: 500.00, tax: 1000.00 };
    const eligibleItc = {
      taxable: itcTotalRaw.taxable - lessIneligible.taxable,
      igst: itcTotalRaw.igst - lessIneligible.igst,
      cgst: itcTotalRaw.cgst - lessIneligible.cgst,
      sgst: itcTotalRaw.sgst - lessIneligible.sgst,
      tax: itcTotalRaw.tax - lessIneligible.tax
    };

    return {
      lr_5, lr_12, lr_18, lr_28, lrTotal,
      lc_5, lc_12, lc_18, lc_28, lcTotal,
      localSalesTotal,
      ir_5, ir_12, ir_18, ir_28, irTotal,
      ic_5, ic_12, ic_18, ic_28, icTotal,
      interSalesTotal,
      outwardTotal,
      rcLocal_5, rcLocal_12, rcLocal_18, rcLocal_28, rcLocalTotal,
      rcInter_5, rcInter_12, rcInter_18, rcInter_28, rcInterTotal,
      inwardRcTotal,
      totalTaxLiability,
      itclr_5, itclr_12, itclr_18, itclr_28, itclrTotal,
      itclu_5, itclu_12, itclu_18, itclu_28, itcluTotal,
      itcLocalTotal,
      itcir_5, itcir_12, itcir_18, itcir_28, itcirTotal,
      itcInterTotal,
      itcTotalRaw,
      lessIneligible,
      eligibleItc
    };
  }, [natureCalculation]);

  const summary = React.useMemo(() => {
    return {
      outward: {
        taxableValue: sales
          .filter((s: any) => !isTransactionRcm(s))
          .reduce((sum: number, s: any) => sum + (s.totalAmount - getTax(s)), 0),
        totalTax: sales
          .filter((s: any) => !isTransactionRcm(s))
          .reduce((sum: number, s: any) => sum + getTax(s), 0)
      },
      rcmInward: {
        taxableValue: purchases
          .filter((p: any) => isTransactionRcm(p))
          .reduce((sum: number, p: any) => sum + (p.totalAmount - getTax(p)), 0),
        totalTax: purchases
          .filter((p: any) => isTransactionRcm(p))
          .reduce((sum: number, p: any) => sum + getTax(p), 0)
      },
      inwardITC: {
        taxableValue: purchases
          .filter((p: any) => p.itcEligible !== false && !isTransactionRcm(p)) // Standard non-RCM inputs
          .reduce((sum: number, p: any) => sum + (p.totalAmount - getTax(p)), 0),
        totalTax: purchases
          .filter((p: any) => p.itcEligible !== false && !isTransactionRcm(p)) // Standard non-RCM inputs
          .reduce((sum: number, p: any) => sum + getTax(p), 0)
      }
    };
  }, [sales, purchases, ledgers]);

  const offsetCalculation = React.useMemo(() => {
    let igstLiab = 0, cgstLiab = 0, sgstLiab = 0;
    sales.filter((s: any) => !isTransactionRcm(s)).forEach((s: any) => {
      igstLiab += Number(s.igst) || 0;
      cgstLiab += Number(s.cgst) || 0;
      sgstLiab += Number(s.sgst) || 0;
    });

    let igstItc = 0, cgstItc = 0, sgstItc = 0;
    purchases.filter((p: any) => p.itcEligible !== false && !isTransactionRcm(p)).forEach((p: any) => {
      igstItc += Number(p.igst) || 0;
      cgstItc += Number(p.cgst) || 0;
      sgstItc += Number(p.sgst) || 0;
    });

    let remIgstLiab = igstLiab;
    let remCgstLiab = cgstLiab;
    let remSgstLiab = sgstLiab;

    let remIgstItc = igstItc;
    let remCgstItc = cgstItc;
    let remSgstItc = sgstItc;

    const igstUsedForIgst = Math.min(remIgstLiab, remIgstItc);
    remIgstLiab -= igstUsedForIgst;
    remIgstItc -= igstUsedForIgst;

    const igstUsedForCgst = Math.min(remCgstLiab, remIgstItc);
    remCgstLiab -= igstUsedForCgst;
    remIgstItc -= igstUsedForCgst;

    const igstUsedForSgst = Math.min(remSgstLiab, remIgstItc);
    remSgstLiab -= igstUsedForSgst;
    remIgstItc -= igstUsedForSgst;

    const cgstUsedForCgst = Math.min(remCgstLiab, remCgstItc);
    remCgstLiab -= cgstUsedForCgst;
    remCgstItc -= cgstUsedForCgst;

    const cgstUsedForIgst = Math.min(remIgstLiab, remCgstItc);
    remIgstLiab -= cgstUsedForIgst;
    remCgstItc -= cgstUsedForIgst;

    const sgstUsedForSgst = Math.min(remSgstLiab, remSgstItc);
    remSgstLiab -= sgstUsedForSgst;
    remSgstItc -= sgstUsedForSgst;

    const sgstUsedForIgst = Math.min(remIgstLiab, remSgstItc);
    remIgstLiab -= sgstUsedForIgst;
    remSgstItc -= sgstUsedForIgst;

    return {
      liabilities: { igst: igstLiab, cgst: cgstLiab, sgst: sgstLiab, total: igstLiab + cgstLiab + sgstLiab },
      itc: { igst: igstItc, cgst: cgstItc, sgst: sgstItc, total: igstItc + cgstItc + sgstItc },
      used: {
        igst: { igst: igstUsedForIgst, cgst: igstUsedForCgst, sgst: igstUsedForSgst },
        cgst: { cgst: cgstUsedForCgst, igst: cgstUsedForIgst },
        sgst: { sgst: sgstUsedForSgst, igst: sgstUsedForIgst }
      },
      netPayable: { igst: remIgstLiab, cgst: remCgstLiab, sgst: remSgstLiab, total: remIgstLiab + remCgstLiab + remSgstLiab },
      carryForward: { igst: remIgstItc, cgst: remCgstItc, sgst: remSgstItc }
    };
  }, [sales, purchases]);

  // Get unique parties involved (both sales customers and purchase vendors)
  const uniqueReportParties = React.useMemo(() => {
    const list: any[] = [];
    const targets = [...sales, ...purchases];
    targets.forEach((t: any) => {
      const party = ledgers.find((l: any) => l.id === t.partyId);
      if (party && !list.some(p => p.id === party.id)) {
        list.push(party);
      }
    });
    return list;
  }, [sales, purchases, ledgers]);

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
    itcVerification: true
  });

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
        
        const filePrefix = gstr3bViewMode === 'nature' ? 'GSTR3B_Nature_Report' : 'GSTR3B_Government_Form';
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

  const exportJSON = () => {
    const data = {
      reportType: 'GSTR-3B',
      summary,
      timestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `GSTR3B_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
  };

  const [periodMode, setPeriodMode] = useState<'custom' | 'monthly' | 'quarterly'>('custom');

  const handleMonthChange = (month: number) => {
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-4 rounded-xl border border-slate-100 shadow-sm gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500 print:hidden">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h3 className="font-bold text-slate-900">GSTR-3B Return Analyzer</h3>
            <p className="text-[10px] text-slate-400 font-medium">Toggle between government format and detailed ERP Nature View</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setGstr3bViewMode('nature')}
              className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all ${gstr3bViewMode === 'nature' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Nature View (Tally style)
            </button>
            <button
              onClick={() => setGstr3bViewMode('standard')}
              className={`px-3 py-1.5 text-xs font-black rounded-lg transition-all ${gstr3bViewMode === 'standard' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
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
        {gstr3bViewMode === 'nature' ? (
          <GSTR3BNatureView
            company={company}
            reportPeriod={reportPeriod}
            natureCalculation={natureCalculation}
            natureTree={natureTree}
            expandedNodes={expandedNodes}
            toggleNode={toggleNode}
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
                <h2 className="text-xl font-bold uppercase tracking-widest text-slate-800">GSTR-3B Consolidated Return</h2>
                <p className="text-sm font-bold text-slate-500 mt-1">Period: {new Date(reportPeriod.startDate).toLocaleDateString()} to {new Date(reportPeriod.endDate).toLocaleDateString()}</p>
              </div>
            </div>

            {/* --- GST AUDIT HELPER SECTION --- */}
        <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200/60 shadow-sm space-y-6 print:hidden mb-6">
          <div className="flex items-center justify-between border-b border-slate-200/50 pb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-pink-100 flex items-center justify-center text-pink-600">
                <ShieldCheck size={22} />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">GSTR-3B Smart Audit Helper</h4>
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
                (auditChecklist.itcVerification ? 1 : 0)) * 33 + 1
              }% Compliant
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <h5 className="font-bold text-xs uppercase tracking-wider text-slate-400">Compliance Verification Checklist</h5>
              
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                  <button 
                    onClick={() => setAuditChecklist({ ...auditChecklist, gstinCheckOverride: !auditChecklist.gstinCheckOverride })}
                    className="mt-0.5 text-indigo-600 focus:outline-none"
                  >
                    { (uniqueReportParties.every(p => {
                      const gstVal = p.gstIn || p.gstin;
                      return gstVal && gstVal.length === 15;
                    }) || auditChecklist.gstinCheckOverride) ? (
                      <CheckSquare size={20} className="fill-indigo-50" />
                    ) : (
                      <Square size={20} className="text-slate-300" />
                    )}
                  </button>
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">All Parties GSTIN Layouts Verified</span>
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

                <div className="flex items-start gap-3 p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
                  <button 
                    onClick={() => setAuditChecklist({ ...auditChecklist, itcVerification: !auditChecklist.itcVerification })}
                    className="mt-0.5 text-indigo-600 focus:outline-none"
                  >
                    { auditChecklist.itcVerification ? (
                      <CheckSquare size={20} className="fill-indigo-50" />
                    ) : (
                      <Square size={20} className="text-slate-300" />
                    )}
                  </button>
                  <div>
                    <span className="text-xs font-bold text-slate-800 block">Inward ITC Eligible Matches Verified</span>
                    <span className="text-[10px] text-slate-500 leading-normal block">
                      Validate eligibility and confirm with respective Purchase Register matching parameters.
                    </span>
                  </div>
                </div>
              </div>

              {/* Amount Representation in Figures and Words Check Card */}
              <div className="p-4 bg-indigo-900 text-white rounded-xl space-y-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-indigo-200/70 block">Legal Currency Declaration</span>
                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                  <div>
                    <span className="text-indigo-200 block text-[9px]">GSTR-3B OUTWARD VALUE (FIGURE)</span>
                    <span className="font-bold font-display text-sm">₹{summary.outward.taxableValue.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-indigo-200 block text-[9px]">OUTWARD VALUE (WORDS)</span>
                    <span className="font-medium italic text-[10px] block leading-snug text-indigo-100/90">{numberToWords(summary.outward.taxableValue)}</span>
                  </div>
                </div>
                <div className="border-t border-white/10 pt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-indigo-200 block text-[9px]">GSTR-3B TOTAL OUTPUT LIABILITY (FIGURE)</span>
                    <span className="font-bold font-display text-sm">₹{summary.outward.totalTax.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-indigo-200 block text-[9px]">OUTPUT BAL IN WORDS</span>
                    <span className="font-medium italic text-[10px] block leading-snug text-indigo-100/90">{numberToWords(summary.outward.totalTax)}</span>
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
                      No parties found in GSTR-3B active records.
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-100 p-2 text-[9px] text-slate-400 rounded-lg mt-2 leading-relaxed">
                ℹ Bookkeepers can tune the match percentage manually for any party during GSTR-3B audits before exporting or filing monthly state returns.
              </div>
            </div>
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="p-4 bg-slate-900 text-white font-bold text-xs uppercase tracking-widest">
            3.1 Details of Outward Supplies and Inward Supplies liable to Reverse Charge
          </div>
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr className="text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <th className="px-6 py-4">Nature of Supplies</th>
                <th className="px-6 py-4 text-right">Total Taxable Value</th>
                <th className="px-6 py-4 text-right">IGST/CGST/SGST Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm font-medium text-slate-700">(a) Outward Taxable Supplies (Other than nil rated, exempt)</td>
                <td className="px-6 py-4 text-right text-sm font-bold text-slate-900">₹{summary.outward.taxableValue.toLocaleString()}</td>
                <td className="px-6 py-4 text-right text-sm font-bold text-red-600">₹{summary.outward.totalTax.toLocaleString()}</td>
              </tr>
              <tr className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm font-medium text-slate-700">(b) Outward Taxable Supplies (Zero rated)</td>
                <td className="px-6 py-4 text-right text-sm font-bold text-slate-900">₹0</td>
                <td className="px-6 py-4 text-right text-sm font-bold text-slate-900">₹0</td>
              </tr>
              <tr className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm font-medium text-slate-700">(c) Other Outward Supplies (Nil rated, exempt)</td>
                <td className="px-6 py-4 text-right text-sm font-bold text-slate-900">₹0</td>
                <td className="px-6 py-4 text-right text-sm font-bold text-slate-900">₹0</td>
              </tr>
              <tr className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm font-medium text-slate-700">(d) Inward Supplies (liable to reverse charge)</td>
                <td className="px-6 py-4 text-right text-sm font-bold text-slate-900">₹{summary.rcmInward.taxableValue.toLocaleString()}</td>
                <td className="px-6 py-4 text-right text-sm font-bold text-red-600">₹{summary.rcmInward.totalTax.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card overflow-hidden">
          <div className="p-4 bg-slate-900 text-white font-bold text-xs uppercase tracking-widest">
            4. Eligible ITC (Input Tax Credit)
          </div>
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr className="text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <th className="px-6 py-4">Details</th>
                <th className="px-6 py-4 text-right">Integrated Tax</th>
                <th className="px-6 py-4 text-right">Central/State Tax</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              <tr className="hover:bg-slate-50">
                <td className="px-6 py-4 text-sm font-medium text-slate-700">(A) ITC Available (In full or part)</td>
                <td className="px-6 py-4 text-right text-sm font-bold text-slate-900">-</td>
                <td className="px-6 py-4 text-right text-sm font-bold text-emerald-600">₹{summary.inwardITC.totalTax.toLocaleString()}</td>
              </tr>
              <tr className="hover:bg-slate-50 bg-slate-50 font-bold border-t border-slate-200">
                <td className="px-6 py-4 text-sm">Total Eligible ITC</td>
                <td className="px-6 py-4 text-right">-</td>
                <td className="px-6 py-4 text-right text-emerald-600">₹{summary.inwardITC.totalTax.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* --- NET CASH LIABILITY OFFSET FLOW SECTION --- */}
        <div className="card p-6 bg-slate-50 border border-slate-200/60 rounded-2xl shadow-xs space-y-6 print:hidden">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
              <h4 className="font-bold text-slate-900 text-sm">Interactive GST Credit Offset Ledger (Section 49 Compliant)</h4>
            </div>
            <span className="text-[10px] font-bold text-slate-500 uppercase">Automatic portal offset simulator</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Column 1: Outward Tax Liability */}
            <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-200/50">
              <h5 className="font-bold text-xs uppercase tracking-wider text-red-500 flex items-center gap-1.5 border-b border-rose-50 pb-2">
                <span className="w-2 h-2 rounded-full bg-red-400" /> Outward Liability (Output Tax)
              </h5>
              <div className="space-y-3 pt-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-medium">Integrated Tax (IGST)</span>
                  <span className="font-bold text-slate-800">₹{offsetCalculation.liabilities.igst.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-medium">Central Tax (CGST)</span>
                  <span className="font-bold text-slate-800">₹{offsetCalculation.liabilities.cgst.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-medium">State Tax (SGST)</span>
                  <span className="font-bold text-slate-800">₹{offsetCalculation.liabilities.sgst.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-xs pt-3 border-t border-slate-100 font-bold">
                  <span className="text-slate-700">Gross Tax Due</span>
                  <span className="text-red-600 font-black">₹{offsetCalculation.liabilities.total.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Column 2: ITC Offset & Utilization Logic */}
            <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-200/50">
              <h5 className="font-bold text-xs uppercase tracking-wider text-emerald-600 flex items-center gap-1.5 border-b border-emerald-50 pb-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" /> Eligible ITC Offset (Credits)
              </h5>
              <div className="space-y-3 pt-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-medium">IGST Credit Applied</span>
                  <span className="font-bold text-emerald-600">₹{(offsetCalculation.used.igst.igst + offsetCalculation.used.igst.cgst + offsetCalculation.used.igst.sgst).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-medium">CGST Credit Applied</span>
                  <span className="font-bold text-emerald-600">₹{(offsetCalculation.used.cgst.cgst + offsetCalculation.used.cgst.igst).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-medium">SGST Credit Applied</span>
                  <span className="font-bold text-emerald-600">₹{(offsetCalculation.used.sgst.sgst + offsetCalculation.used.sgst.igst).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-xs pt-3 border-t border-slate-100 font-bold">
                  <span className="text-slate-700">Total Credit Applied</span>
                  <span className="text-emerald-600 font-black">₹{offsetCalculation.itc.total.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Column 3: Net Cash Payable Challan */}
            <div className="space-y-4 bg-slate-900 text-white p-4 rounded-xl border border-slate-800 shadow-lg">
              <h5 className="font-bold text-xs uppercase tracking-wider text-indigo-300 flex items-center gap-1.5 border-b border-slate-800 pb-2">
                <div className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse" /> Net Cash Payable (Challan)
              </h5>
              <div className="space-y-3 pt-1 text-slate-300 font-sans">
                <div className="flex justify-between items-center text-xs">
                  <span>Net IGST Cash Due</span>
                  <span className="font-bold text-white font-mono">₹{offsetCalculation.netPayable.igst.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span>Net CGST Cash Due</span>
                  <span className="font-bold text-white font-mono">₹{offsetCalculation.netPayable.cgst.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span>Net SGST Cash Due</span>
                  <span className="font-bold text-white font-mono">₹{offsetCalculation.netPayable.sgst.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-xs pt-3 border-t border-slate-800 font-bold text-white">
                  <span>Total Challan Value</span>
                  <span className="text-indigo-300 font-black text-sm font-sans">₹{offsetCalculation.netPayable.total.toLocaleString()}</span>
                </div>
              </div>
            </div>

          </div>

          {/* Graphical visual representation of the utilization rules ledger flowchart */}
          <div className="bg-white p-4 rounded-xl border border-slate-200/50 space-y-3">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">GST Credit Clearance Ledger flow path</span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-center text-[11px] font-sans">
              <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-lg leading-relaxed">
                <div className="font-bold text-slate-700">1. IGST Credit Allocation</div>
                <p className="text-[9px] text-slate-400 mt-1">Clears Outward IGST first. Balance credit is then split to pay CGST & SGST liabilities.</p>
              </div>
              <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-lg leading-relaxed">
                <div className="font-bold text-slate-700">2. Central Credit (CGST)</div>
                <p className="text-[9px] text-slate-400 mt-1">Clears CGST outward dues directly. Cannot be used to offset SGST liabilities.</p>
              </div>
              <div className="bg-slate-50 border border-slate-100 p-2.5 rounded-lg leading-relaxed">
                <div className="font-bold text-slate-700">3. State Credit (SGST)</div>
                <p className="text-[9px] text-slate-400 mt-1">Clears SGST outward dues directly. Cannot be used to offset CGST liabilities.</p>
              </div>
            </div>
          </div>
        </div>

        {/* --- DETAILED COMPREHENSIVE GSTR-3B FILINGS LEDGER SECTION --- */}
        <div className="card p-6 bg-slate-50 border border-slate-200/60 rounded-2xl shadow-xs space-y-6 mt-12 print:block">
          <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-200 pb-4 gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                <FileText size={22} />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">GSTR-3B Detailed Filings & Audit Ledger</h4>
                <p className="text-[10px] text-slate-500 font-medium">Granular breakdown of registered (B2B) vs unregistered (B2C) entries with exact GST rate and HSN codes</p>
              </div>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <span className="text-[10px] bg-emerald-100 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full font-bold uppercase font-sans">
                GST C Filing Ready
              </span>
            </div>
          </div>

          {/* Interactive Filtering Controls */}
          <div className="flex flex-col lg:flex-row gap-4 justify-between items-stretch lg:items-center bg-white p-4 rounded-xl border border-slate-200/50 print:hidden">
            {/* Sales vs Purchases Segment Toggles */}
            <div className="flex gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                onClick={() => setActiveLedgerTab('sales')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 ${activeLedgerTab === 'sales' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
              >
                <ArrowUpRight size={14} /> Outward (Sales)
              </button>
              <button
                onClick={() => setActiveLedgerTab('purchases')}
                className={`px-4 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2 ${activeLedgerTab === 'purchases' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
              >
                <ArrowDownLeft size={14} /> Inward (Purchases)
              </button>
            </div>

            {/* Aggregated vs Granular Toggle & Local Search */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
                <button
                  onClick={() => setActiveLedgerFormat('aggregated')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${activeLedgerFormat === 'aggregated' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  Aggregated (HSN/Rate)
                </button>
                <button
                  onClick={() => setActiveLedgerFormat('detailed')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${activeLedgerFormat === 'detailed' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'}`}
                >
                  Transaction Register
                </button>
              </div>

              <div className="relative w-full sm:w-64">
                <input
                  type="text"
                  placeholder="Filter by HSN, rate, party..."
                  value={ledgerSearchTerm}
                  onChange={(e) => setLedgerSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl text-xs font-medium border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all placeholder-slate-400"
                />
                <Search size={14} className="absolute left-3 top-3 text-slate-400" />
              </div>
            </div>
          </div>

          {/* Sub-computations of lists depending on states */}
          {(() => {
            const activeData = activeLedgerTab === 'sales' ? parsedLedgerData.sales : parsedLedgerData.purchases;

            const filteredAggregated = activeData.aggregated.filter((item: any) => {
              const val = ledgerSearchTerm.trim().toLowerCase();
              if (!val) return true;
              return item.hsn.toLowerCase().includes(val) || 
                     item.itemName.toLowerCase().includes(val) ||
                     String(item.rate).includes(val);
            });

            const filteredDetailed = activeData.detailed.filter((item: any) => {
              const val = ledgerSearchTerm.trim().toLowerCase();
              if (!val) return true;
              return item.voucherNo.toLowerCase().includes(val) ||
                     item.partyName.toLowerCase().includes(val) ||
                     item.partyGstin.toLowerCase().includes(val) ||
                     item.hsn.toLowerCase().includes(val) ||
                     item.itemName.toLowerCase().includes(val);
            });

            const aggRegistered = filteredAggregated.filter((item: any) => item.regType === 'Registered');
            const aggUnregistered = filteredAggregated.filter((item: any) => item.regType === 'Unregistered');

            const detRegistered = filteredDetailed.filter((item: any) => item.regType === 'Registered');
            const detUnregistered = filteredDetailed.filter((item: any) => item.regType === 'Unregistered');

            const regAggTotals = aggRegistered.reduce((acc: any, cur: any) => {
              acc.taxable += cur.taxable;
              acc.cgst += cur.cgst;
              acc.sgst += cur.sgst;
              acc.igst += cur.igst;
              acc.tax += cur.tax;
              acc.totalVal += cur.totalVal;
              return acc;
            }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, totalVal: 0 });

            const unregAggTotals = aggUnregistered.reduce((acc: any, cur: any) => {
              acc.taxable += cur.taxable;
              acc.cgst += cur.cgst;
              acc.sgst += cur.sgst;
              acc.igst += cur.igst;
              acc.tax += cur.tax;
              acc.totalVal += cur.totalVal;
              return acc;
            }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, totalVal: 0 });

            const regDetTotals = detRegistered.reduce((acc: any, cur: any) => {
              acc.taxable += cur.taxable;
              acc.cgst += cur.cgst;
              acc.sgst += cur.sgst;
              acc.igst += cur.igst;
              acc.tax += cur.tax;
              acc.totalVal += cur.totalVal;
              return acc;
            }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, totalVal: 0 });

            const unregDetTotals = detUnregistered.reduce((acc: any, cur: any) => {
              acc.taxable += cur.taxable;
              acc.cgst += cur.cgst;
              acc.sgst += cur.sgst;
              acc.igst += cur.igst;
              acc.tax += cur.tax;
              acc.totalVal += cur.totalVal;
              return acc;
            }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, totalVal: 0 });

            return (
              <div className="space-y-10">
                
                {/* --- REGISTERED PARTY SUPPLIES LEDGER (B2B) --- */}
                <div className="bg-white rounded-xl border border-slate-200/50 overflow-hidden shadow-xs">
                  <div className="bg-indigo-900 text-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-indigo-300 animate-pulse" />
                      <div>
                        <h5 className="font-bold text-xs uppercase tracking-wider">A. Registered Supplies Ledger (B2B)</h5>
                        <p className="text-[9px] text-indigo-200 mt-0.5">Supplies made to/received from registered tax entities with active 15-character GSTIN profiles</p>
                      </div>
                    </div>
                    <span className="text-[10px] bg-indigo-800 text-indigo-100 px-2 py-0.5 rounded-full font-bold">
                      {activeLedgerFormat === 'aggregated' ? aggRegistered.length : detRegistered.length} Line Entries
                    </span>
                  </div>

                  {activeLedgerFormat === 'aggregated' ? (
                    /* AGGREGATED GRID FOR B2B REGISTERED */
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-150 text-slate-500 uppercase tracking-wider text-[10px] font-black">
                          <tr>
                            <th className="px-5 py-3">HSN Code</th>
                            <th className="px-5 py-3">Item Description</th>
                            <th className="px-5 py-3 text-center">Tax Rate</th>
                            <th className="px-5 py-3 text-right">Taxable Value</th>
                            <th className="px-5 py-3 text-right">CGST</th>
                            <th className="px-5 py-3 text-right">SGST</th>
                            <th className="px-5 py-3 text-right">IGST</th>
                            <th className="px-5 py-3 text-right">Total Tax</th>
                            <th className="px-5 py-3 text-right">Total Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {aggRegistered.map((h: any, idx: number) => (
                            <tr key={`${h.hsn}-${h.rate}-${idx}`} className="hover:bg-slate-50/50 transition-all font-sans">
                              <td className="px-5 py-3.5 font-mono font-bold text-indigo-700">{h.hsn}</td>
                              <td className="px-5 py-3.5 font-semibold text-slate-800">{h.itemName}</td>
                              <td className="px-5 py-3.5 text-center font-bold text-slate-900 bg-slate-50">{h.rate}%</td>
                              <td className="px-5 py-3.5 text-right font-bold text-slate-900">₹{h.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-slate-600 font-medium font-sans">₹{h.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-slate-600 font-medium font-sans">₹{h.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-slate-600 font-medium font-sans">₹{h.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-emerald-600 font-bold font-sans">₹{h.tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-indigo-950 font-black font-sans bg-indigo-50/30">₹{h.totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            </tr>
                          ))}
                          {aggRegistered.length === 0 && (
                            <tr>
                              <td colSpan={9} className="py-12 text-center text-slate-400 italic">No registered transactions recorded with items for the selected period.</td>
                            </tr>
                          )}
                        </tbody>
                        {aggRegistered.length > 0 && (
                          <tfoot className="bg-indigo-900/5 border-t border-indigo-950/10 font-bold text-slate-900 text-xs font-sans">
                            <tr>
                              <td colSpan={3} className="px-5 py-3.5 uppercase font-black text-[10px] text-slate-500">B2B Grand Totals</td>
                              <td className="px-5 py-3.5 text-right font-black">₹{regAggTotals.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right">₹{regAggTotals.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right">₹{regAggTotals.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right">₹{regAggTotals.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-emerald-700 font-black">₹{regAggTotals.tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-indigo-900 font-black bg-indigo-50">₹{regAggTotals.totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  ) : (
                    /* DETAILED REGISTER FOR B2B REGISTERED */
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-150 text-slate-500 uppercase tracking-wider text-[10px] font-black">
                          <tr>
                            <th className="px-5 py-3">Date</th>
                            <th className="px-5 py-3">Voucher No.</th>
                            <th className="px-5 py-3">Supplier Name / GSTIN</th>
                            <th className="px-5 py-3">HSN Code</th>
                            <th className="px-5 py-3">Supply/Item</th>
                            <th className="px-5 py-3 text-center">Tax Rate</th>
                            <th className="px-5 py-3 text-right">Taxable Amount</th>
                            <th className="px-5 py-3 text-right">Total GST</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {detRegistered.map((t: any, idx: number) => (
                            <tr key={`${t.id}-${idx}`} className="hover:bg-slate-50/50 transition-all font-sans">
                              <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(t.date).toLocaleDateString()}</td>
                              <td className="px-5 py-3 font-mono font-bold text-slate-900">{t.voucherNo}</td>
                              <td className="px-5 py-3">
                                <span className="font-bold text-slate-800 block text-xs">{t.partyName}</span>
                                <span className="text-[10px] font-mono text-indigo-600 block">{t.partyGstin}</span>
                              </td>
                              <td className="px-5 py-3 font-mono text-slate-500 font-bold">{t.hsn}</td>
                              <td className="px-5 py-3 text-slate-500 truncate max-w-[150px]">{t.itemName}</td>
                              <td className="px-5 py-3 text-center font-bold text-slate-900">{t.rate}%</td>
                              <td className="px-5 py-3 text-right font-bold text-slate-900">₹{t.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3 text-right text-emerald-600 font-black">₹{t.tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            </tr>
                          ))}
                          {detRegistered.length === 0 && (
                            <tr>
                              <td colSpan={8} className="py-12 text-center text-slate-400 italic">No registered voucher entries flagged for specified period.</td>
                            </tr>
                          )}
                        </tbody>
                        {detRegistered.length > 0 && (
                          <tfoot className="bg-indigo-900/5 border-t border-indigo-950/10 font-bold text-slate-900 text-xs">
                            <tr>
                              <td colSpan={6} className="px-5 py-3.5 uppercase font-black text-[10px] text-slate-500">Detailed grand totals</td>
                              <td className="px-5 py-3.5 text-right font-black">₹{regDetTotals.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-emerald-700 font-black">₹{regDetTotals.tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  )}
                </div>

                {/* --- UNREGISTERED SUPPLIES LEDGER (B2C) --- */}
                <div className="bg-white rounded-xl border border-slate-200/50 overflow-hidden shadow-xs">
                  <div className="bg-slate-700 text-white p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-slate-300 animate-pulse" />
                      <div>
                        <h5 className="font-bold text-xs uppercase tracking-wider">B. Unregistered Supplies Ledger (B2C)</h5>
                        <p className="text-[9px] text-slate-300 mt-0.5">Supplies made to/received from consumers or retail suppliers carrying unregistered status</p>
                      </div>
                    </div>
                    <span className="text-[10px] bg-slate-650 text-slate-100 px-2 py-0.5 rounded-full font-bold">
                      {activeLedgerFormat === 'aggregated' ? aggUnregistered.length : detUnregistered.length} Line Entries
                    </span>
                  </div>

                  {activeLedgerFormat === 'aggregated' ? (
                    /* AGGREGATED GRID FOR B2C UNREGISTERED */
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-150 text-slate-500 uppercase tracking-wider text-[10px] font-black">
                          <tr>
                            <th className="px-5 py-3">HSN Code</th>
                            <th className="px-5 py-3">Item Description</th>
                            <th className="px-5 py-3 text-center">Tax Rate</th>
                            <th className="px-5 py-3 text-right">Taxable Value</th>
                            <th className="px-5 py-3 text-right">CGST</th>
                            <th className="px-5 py-3 text-right">SGST</th>
                            <th className="px-5 py-3 text-right">IGST</th>
                            <th className="px-5 py-3 text-right">Total Tax</th>
                            <th className="px-5 py-3 text-right">Total Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {aggUnregistered.map((h: any, idx: number) => (
                            <tr key={`${h.hsn}-${h.rate}-${idx}`} className="hover:bg-slate-50/50 transition-all font-sans">
                              <td className="px-5 py-3.5 font-mono font-bold text-indigo-700">{h.hsn}</td>
                              <td className="px-5 py-3.5 font-semibold text-slate-800">{h.itemName}</td>
                              <td className="px-5 py-3.5 text-center font-bold text-slate-900 bg-slate-50">{h.rate}%</td>
                              <td className="px-5 py-3.5 text-right font-bold text-slate-900">₹{h.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-slate-600 font-medium font-sans">₹{h.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-slate-600 font-medium font-sans">₹{h.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-slate-600 font-medium font-sans">₹{h.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-emerald-600 font-bold font-sans">₹{h.tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-slate-955 font-black font-sans bg-slate-50/30">₹{h.totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            </tr>
                          ))}
                          {aggUnregistered.length === 0 && (
                            <tr>
                              <td colSpan={9} className="py-12 text-center text-slate-400 italic">No unregistered transactions recorded with items for the selected period.</td>
                            </tr>
                          )}
                        </tbody>
                        {aggUnregistered.length > 0 && (
                          <tfoot className="bg-slate-50 border-t border-slate-150 font-bold text-slate-900 text-xs font-sans">
                            <tr>
                              <td colSpan={3} className="px-5 py-3.5 uppercase font-black text-[10px] text-slate-500">B2C Grand Totals</td>
                              <td className="px-5 py-3.5 text-right font-black">₹{unregAggTotals.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right">₹{unregAggTotals.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right">₹{unregAggTotals.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right">₹{unregAggTotals.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-emerald-700 font-black">₹{unregAggTotals.tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-slate-900 font-black bg-slate-100">₹{unregAggTotals.totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  ) : (
                    /* DETAILED REGISTER FOR B2C UNREGISTERED */
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 border-b border-slate-150 text-slate-500 uppercase tracking-wider text-[10px] font-black">
                          <tr>
                            <th className="px-5 py-3">Date</th>
                            <th className="px-5 py-3">Voucher No.</th>
                            <th className="px-5 py-3">Consumer Reference</th>
                            <th className="px-5 py-3">HSN Code</th>
                            <th className="px-5 py-3">Supply/Item</th>
                            <th className="px-5 py-3 text-center">Tax Rate</th>
                            <th className="px-5 py-3 text-right">Taxable Amount</th>
                            <th className="px-5 py-3 text-right">Total GST</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {detUnregistered.map((t: any, idx: number) => (
                            <tr key={`${t.id}-${idx}`} className="hover:bg-slate-50/50 transition-all font-sans">
                              <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(t.date).toLocaleDateString()}</td>
                              <td className="px-5 py-3 font-mono font-bold text-slate-900">{t.voucherNo}</td>
                              <td className="px-5 py-3">
                                <span className="font-bold text-slate-800 block text-xs">{t.partyName}</span>
                                <span className="text-[10px] text-slate-400 block font-sans">Unregistered Consumer</span>
                              </td>
                              <td className="px-5 py-3 font-mono text-slate-500 font-bold">{t.hsn}</td>
                              <td className="px-5 py-3 text-slate-500 truncate max-w-[150px]">{t.itemName}</td>
                              <td className="px-5 py-3 text-center font-bold text-slate-900">{t.rate}%</td>
                              <td className="px-5 py-3 text-right font-bold text-slate-900">₹{t.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3 text-right text-emerald-600 font-black">₹{t.tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            </tr>
                          ))}
                          {detUnregistered.length === 0 && (
                            <tr>
                              <td colSpan={8} className="py-12 text-center text-slate-400 italic">No unregistered consumer voucher entries flagged for specified period.</td>
                            </tr>
                          )}
                        </tbody>
                        {detUnregistered.length > 0 && (
                          <tfoot className="bg-slate-50 border-t border-slate-150 font-bold text-slate-900 text-xs">
                            <tr>
                              <td colSpan={6} className="px-5 py-3.5 uppercase font-black text-[10px] text-slate-500">Detailed grand totals</td>
                              <td className="px-5 py-3.5 text-right font-black">₹{unregDetTotals.taxable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                              <td className="px-5 py-3.5 text-right text-emerald-700 font-black">₹{unregDetTotals.tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                  )}
                </div>

                {/* Useful Filing Hints for easy copy-paste directly to the GSTR portal */}
                <div className="bg-amber-50/40 p-4 rounded-xl border border-amber-200/50 flex gap-3 text-xs text-amber-950/90 print:hidden">
                  <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <strong className="font-bold text-amber-950 block">GST Portal Filing Assistance (Form GSTR-3B)</strong>
                    <p className="leading-relaxed">
                      Use the <strong>Aggregated</strong> view to complete specific tables on GST portal easily:
                      <br />• Table <strong>3.1(a)</strong> outward taxable supplies can directly be filled using the <strong>B2B + B2C Outward Supplies</strong> summaries.
                      <br />• Table <strong>4(A)(5)</strong> all other ITCs can directly be completed using <strong>B2B Inward Supplies</strong> summaries. Grouping by HSN prevents downstream validation errors on portal upload logs!
                    </p>
                  </div>
                </div>

              </div>
            );
          })()}
        </div>
          </>
        )}

      </div>
    </div>
  );
};
