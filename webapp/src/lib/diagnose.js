// DIAGNOSTIC_REPORT_SPEC.md A그룹 스펙에 대응하는 순수 계산 함수 모음.
// 필수 입력만으로도 항상 값이 나와야 하고, 선택 입력이 있으면 더 정밀해진다.

export function hasOptionalCustomerData(entry) {
  return (
    entry.newCustomers !== undefined &&
    entry.newCustomers !== null &&
    entry.returningCustomers !== undefined &&
    entry.returningCustomers !== null
  );
}

export function hasOptionalRevenueMix(entry) {
  return (
    entry.serviceRevenue != null &&
    entry.prepaidRevenue != null &&
    entry.retailRevenue != null
  );
}

export function daysInPeriod(period) {
  // period: "YYYY-MM"
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}

export function computeKpis(entry) {
  const totalRevenue = entry.totalRevenue || 0;
  const totalVisits = entry.totalVisits || 0;
  const unitPrice = totalVisits > 0 ? totalRevenue / totalVisits : 0;
  const days = daysInPeriod(entry.period);
  const dailyAvg = days > 0 ? totalRevenue / days : 0;
  return { totalRevenue, totalVisits, unitPrice, dailyAvg };
}

export function computeCustomerStructure(entry) {
  if (!hasOptionalCustomerData(entry)) return null;
  const newC = entry.newCustomers || 0;
  const returningC = entry.returningCustomers || 0;
  const total = newC + returningC;
  const returnRate = total > 0 ? returningC / total : 0;
  return { newC, returningC, total, returnRate };
}

export function computeRevenueMix(entry) {
  if (!hasOptionalRevenueMix(entry)) return null;
  const service = entry.serviceRevenue || 0;
  const prepaid = entry.prepaidRevenue || 0;
  const retail = entry.retailRevenue || 0;
  const total = service + prepaid + retail;
  return {
    service,
    prepaid,
    retail,
    total,
    servicePct: total > 0 ? service / total : 0,
    prepaidPct: total > 0 ? prepaid / total : 0,
    retailPct: total > 0 ? retail / total : 0,
  };
}

// 이전 기간 대비 증감(금액) — 원인 분해 카드용. 이전 기간에도 선택 입력이 있어야 계산 가능.
export function computeCauseBreakdown(entry, prevEntry) {
  if (!hasOptionalRevenueMix(entry)) return null;
  if (!prevEntry || !hasOptionalRevenueMix(prevEntry)) {
    return { hasComparison: false, current: computeRevenueMix(entry) };
  }
  const cur = computeRevenueMix(entry);
  const prev = computeRevenueMix(prevEntry);
  return {
    hasComparison: true,
    current: cur,
    deltas: {
      service: cur.service - prev.service,
      prepaid: cur.prepaid - prev.prepaid,
      retail: cur.retail - prev.retail,
    },
  };
}

const REVENUE_GROWTH_ASSUMPTION = 0.1; // 객단가 10% 개선 시나리오 (기본형)
const RETURN_RATE_GROWTH_ASSUMPTION = 0.1; // 재방문율 10%p 개선 시나리오 (정밀형)

export function computeGrowthPotential(entry) {
  const { totalRevenue, totalVisits, unitPrice } = computeKpis(entry);
  const basic = {
    label: `객단가를 ${Math.round(REVENUE_GROWTH_ASSUMPTION * 100)}% 개선하면`,
    amount: totalRevenue * REVENUE_GROWTH_ASSUMPTION,
  };

  const mix = computeRevenueMix(entry);
  const customer = computeCustomerStructure(entry);
  let precise = null;
  if (mix && customer && customer.total > 0) {
    const serviceUnitPrice = customer.total > 0 ? mix.service / customer.total : unitPrice;
    const extraCustomers = totalVisits * RETURN_RATE_GROWTH_ASSUMPTION;
    precise = {
      label: `재방문율을 ${Math.round(RETURN_RATE_GROWTH_ASSUMPTION * 100)}%p 올리면`,
      amount: extraCustomers * serviceUnitPrice,
    };
  }

  return { basic, precise };
}

export function computeGoalProgress(entry) {
  if (entry.targetRevenue == null || entry.targetRevenue <= 0) return null;
  const actual = entry.totalRevenue || 0;
  const target = entry.targetRevenue;
  return {
    target,
    actual,
    pct: Math.min(actual / target, 999),
    remaining: Math.max(target - actual, 0),
  };
}

export function formatCurrency(amount) {
  if (amount == null || Number.isNaN(amount)) return "-";
  return `${Math.round(amount).toLocaleString("ko-KR")}원`;
}

export function formatPercent(ratio, digits = 1) {
  if (ratio == null || Number.isNaN(ratio)) return "-";
  return `${(ratio * 100).toFixed(digits)}%`;
}
