export const getDynamicStockValueForPeriod = (
  items: any[], 
  transactions: any[], 
  targetPeriod: { startDate: string, endDate: string },
  company?: any
) => {
  const summaryMap: any = {};

  // Initialize with item data
  (items || []).forEach((item: any) => {
    summaryMap[item.id] = {
      id: item.id,
      name: item.name,
      unit: item.unit,
      openingStockQty: Number(item.openingStockQty || 0), // Use explicit openingStockQty as the source of truth
      openingStockQtyExplicit: Number(item.openingStockQty || 0),
      openingValue: Number(item.openingStockValue || 0),
      openingRate: Number(item.openingStockRate || 0),
      purchasePrice: Number(item.purchasePrice || 0),
      
      // lifetime movements (all time)
      allTimeInward: 0,
      allTimeOutward: 0,
      
      // movements before selected period
      beforeFYInward: 0,
      beforeFYOutward: 0,
      
      // movements during selected period
      duringFYInward: 0,
      duringFYOutward: 0,
    };
  });

  (transactions || []).forEach((tx: any) => {
    if (tx.items) {
      tx.items.forEach((line: any) => {
        if (line.itemId && summaryMap[line.itemId]) {
          const qty = Number(line.qty || 0);
          const isPurchase = tx.type && (tx.type.toLowerCase() === 'purchases' || tx.type.toLowerCase() === 'purchase');
          const isSale = tx.type && (tx.type.toLowerCase() === 'sales' || tx.type.toLowerCase() === 'sale');
          
          if (isPurchase) {
            summaryMap[line.itemId].allTimeInward += qty;
            if (targetPeriod.startDate) {
              if (tx.date < targetPeriod.startDate) {
                summaryMap[line.itemId].beforeFYInward += qty;
              } else if (tx.date <= targetPeriod.endDate) {
                summaryMap[line.itemId].duringFYInward += qty;
              }
            } else {
              summaryMap[line.itemId].duringFYInward += qty;
            }
          } else if (isSale) {
            summaryMap[line.itemId].allTimeOutward += qty;
            if (targetPeriod.startDate) {
              if (tx.date < targetPeriod.startDate) {
                summaryMap[line.itemId].beforeFYOutward += qty;
              } else if (tx.date <= targetPeriod.endDate) {
                summaryMap[line.itemId].duringFYOutward += qty;
              }
            } else {
              summaryMap[line.itemId].duringFYOutward += qty;
            }
          }
        }
      });
    }
  });

  let totalOpeningStockValue = 0;
  let totalClosingStockValue = 0;

  const dynamicItems = (items || []).map((item: any) => {
    const s = summaryMap[item.id];
    if (!s) return { ...item, dynamicOpeningQty: 0, dynamicClosingQty: 0, dynamicOpeningValue: 0, dynamicClosingValue: 0 };

    const dbCreatedOpeningStock = Math.max(0, Number(s.openingStockQtyExplicit || 0));
    const openingQty = Math.max(0, dbCreatedOpeningStock + s.beforeFYInward - s.beforeFYOutward);
    const closingQty = Math.max(0, openingQty + s.duringFYInward - s.duringFYOutward);

    // Robust rate extraction:
    // 1. If explicit opening rate is provided, use it.
    // 2. If opening stock quantity and opening value are positive, derive rate from openingValue / dbCreatedOpeningStock.
    // 3. Fall back to purchasePrice.
    // 4. Default to 0. All rates are guarded to be non-negative with Math.max(0).
    const derivedOpeningRate = Math.max(0, s.openingRate || (dbCreatedOpeningStock > 0 ? (s.openingValue / dbCreatedOpeningStock) : 0));
    const rate = Math.max(0, Number(s.purchasePrice || derivedOpeningRate || 0));

    // Maintain the explicit opening value if no before-transactions have occurred to affect stock level,
    // otherwise calculate based on remaining qty using the derived opening rate.
    let openingValue = 0;
    if (openingQty === dbCreatedOpeningStock && s.openingValue > 0) {
      openingValue = Math.max(0, s.openingValue);
    } else {
      openingValue = Math.max(0, openingQty) * Math.max(0, derivedOpeningRate || rate || 0);
    }

    const closingValue = Math.max(0, closingQty) * rate;

    totalOpeningStockValue += openingValue;
    totalClosingStockValue += closingValue;

    return {
      ...item,
      dynamicOpeningQty: Math.max(0, openingQty),
      dynamicClosingQty: Math.max(0, closingQty),
      dynamicOpeningValue: openingValue,
      dynamicClosingValue: closingValue,
    };
  });

  let finalClosingStockValue = totalClosingStockValue;
  if (company?.manualClosingStock) {
    finalClosingStockValue = Number(company.manualClosingStockValue || 0);
  }

  return {
    totalOpeningStockValue,
    totalClosingStockValue: finalClosingStockValue,
    dynamicItems,
  };
};
