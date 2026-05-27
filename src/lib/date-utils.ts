export function getFinancialYears(count = 5) {
  const years = [];
  const now = new Date();
  const currentYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

  for (let i = 0; i < count; i++) {
    const startYear = currentYear - i;
    const endYear = (startYear + 1).toString().substring(2);
    years.push({
      id: `${startYear}-${endYear}`,
      label: `FY ${startYear}-${endYear}`,
      startDate: `${startYear}-04-01`,
      endDate: `${startYear + 1}-03-31`
    });
  }
  return years;
}

export function getCurrentFY() {
  const years = getFinancialYears(1);
  return years[0];
}
