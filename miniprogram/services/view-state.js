'use strict';

function formatMoney(value) {
  const number = Number(value || 0);
  const fixed = number.toFixed(2);
  const [integer, decimals] = fixed.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `¥${grouped}.${decimals}`;
}

function formatCompactMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '--';
  const fixed = Number.isInteger(number) ? String(number) : number.toFixed(2);
  const [integer, decimals] = fixed.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `¥${grouped}${decimals ? `.${decimals}` : ''}`;
}

function buildCycleViewModel(state) {
  if (!state || !state.progress) {
    return {
      dayValue: '--',
      payableText: formatMoney(0),
      progressPercent: 0,
      reminderText: '',
      isComplete: false
    };
  }

  const { checkinDays = 0, targetDays = 0, payableAmount = 0, progressPercent = 0 } = state.progress;
  const daysOver = state.reminder ? state.reminder.daysOver || 0 : 0;
  return {
    dayValue: `${checkinDays}/${targetDays}`,
    payableText: formatMoney(payableAmount),
    progressPercent,
    reminderText:
      checkinDays >= targetDays
        ? daysOver > 0
          ? `已超过目标 ${daysOver} 天，请尽快结算`
          : '已达到目标天数，请确认并结算'
        : '',
    isComplete: checkinDays >= targetDays
  };
}

function formatDisplayDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const shanghaiDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = shanghaiDate.getUTCFullYear();
  const month = String(shanghaiDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shanghaiDate.getUTCDate()).padStart(2, '0');
  const hours = String(shanghaiDate.getUTCHours()).padStart(2, '0');
  const minutes = String(shanghaiDate.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatChineseDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '--';
  return `${Number(match[2])}.${Number(match[3])}`;
}

function formatCompactDateWithYear(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '--';
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function formatShanghaiClockTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const shanghaiDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const hours = String(shanghaiDate.getUTCHours()).padStart(2, '0');
  const minutes = String(shanghaiDate.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatShanghaiDateInput(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const shanghaiDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = shanghaiDate.getUTCFullYear();
  const month = String(shanghaiDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shanghaiDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatPlainAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function formatSettlementDifference(difference) {
  const number = Number(difference || 0);
  if (!Number.isFinite(number) || Math.abs(number) < 0.005) return '';
  return number > 0
    ? `实付多 ${formatMoney(Math.abs(number))}`
    : `实付少 ${formatMoney(Math.abs(number))}`;
}

function buildSettlementExplanation({
  totalAmount,
  targetDays,
  days = 0,
  dailySalary,
  suggestedAmount,
  paidAmount
} = {}) {
  const amount = Number(totalAmount);
  const target = Number(targetDays);
  const salary = Number(dailySalary || 0);
  const workDays = Number(days || 0);
  const suggested = Number.isFinite(Number(suggestedAmount))
    ? Number(suggestedAmount)
    : Math.round(salary * workDays * 100) / 100;
  const paid = Number.isFinite(Number(paidAmount)) ? Number(paidAmount) : suggested;
  const hasContractBasis = Number.isFinite(amount) && amount > 0 &&
    Number.isFinite(target) && target > 0;

  return {
    contractText: hasContractBasis
      ? `${formatPlainAmount(amount)} 元 ÷ ${formatPlainAmount(target)} 天`
      : '按日薪计算',
    dailySalaryText: `${formatMoney(salary)} / 天`,
    calculationText: `${formatMoney(salary)} × ${formatPlainAmount(workDays)} 天`,
    formulaText: hasContractBasis
      ? `${formatPlainAmount(amount)} ÷ ${formatPlainAmount(target)} × ${formatPlainAmount(workDays)}`
      : `日薪 × ${formatPlainAmount(workDays)} 天`,
    suggestedText: formatMoney(suggested),
    paidText: formatMoney(paid),
    differenceText: formatSettlementDifference(paid - suggested)
  };
}

function buildSettlementsViewModel(settlements = []) {
  return settlements.map((item, index) => {
    const match = String(item.cycleId || '').match(/_(\d+)$/);
    return {
      ...item,
      cycleIndex: match ? Number(match[1]) : index + 1,
      amountText: formatMoney(item.amount),
      dailySalaryText: formatMoney(item.dailySalary),
      settledAtText: formatDisplayDate(item.settledAt)
    };
  });
}

function buildContractPricingViewModel({ totalAmount, targetDays } = {}) {
  const amount = Number(totalAmount);
  const days = Number(targetDays);
  if (
    !Number.isFinite(amount) ||
    !Number.isInteger(days) ||
    amount <= 0 ||
    days <= 0
  ) {
    return {
      dailySalaryText: '自动计算日薪',
      pricingFormulaText: '请输入合同总金额和约定天数'
    };
  }
  return {
    dailySalaryText: `每天 ${formatMoney(amount / days)}`,
    pricingFormulaText: `按 ${Number.isInteger(amount) ? amount : amount.toFixed(2)} 元 ÷ ${days} 天计算`
  };
}

module.exports = {
  buildContractPricingViewModel,
  buildCycleViewModel,
  buildSettlementExplanation,
  buildSettlementsViewModel,
  formatChineseDate,
  formatCompactDateWithYear,
  formatDisplayDate,
  formatCompactMoney,
  formatMoney,
  formatShanghaiDateInput,
  formatShanghaiClockTime
};
