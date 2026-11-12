'use strict';

function toLocalDateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildCalendarMonth({
  year,
  month,
  startLocalDate = '0000-01-01',
  today = '',
  checkinDates = [],
  settledDates = []
}) {
  const checkedSet = new Set(checkinDates);
  const settledSet = new Set(settledDates);
  const firstDay = new Date(`${toLocalDateKey(year, month, 1)}T00:00:00+08:00`);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekdayOffset = (firstDay.getUTCDay() + 6) % 7;
  const cells = Array.from({ length: weekdayOffset }, () => ({
    date: null,
    day: null,
    withinStage: false,
    checkedIn: false,
    settled: false,
    markText: '',
    today: false,
    future: false,
    stageStart: false
  }));

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = toLocalDateKey(year, month, day);
    const withinStage = date >= startLocalDate;
    const checkedIn = checkedSet.has(date);
    cells.push({
      date,
      day,
      withinStage,
      checkedIn,
      settled: settledSet.has(date) && !checkedIn,
      markText: checkedIn ? '✓' : '',
      today: date === today,
      future: Boolean(today && date > today),
      stageStart: date === startLocalDate
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      date: null,
      day: null,
      withinStage: false,
      checkedIn: false,
      settled: false,
      markText: '',
      today: false,
      future: false,
      stageStart: false
    });
  }

  return {
    title: `${year}年${month}月`,
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    weeks: Array.from({ length: cells.length / 7 }, (_, index) =>
      cells.slice(index * 7, index * 7 + 7)
    ),
    legend: []
  };
}

function monthIndex(localDate) {
  const [year, month] = String(localDate || '').split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return Number.NEGATIVE_INFINITY;
  }
  return year * 12 + month - 1;
}

function getCalendarNavigation({ startLocalDate = '', todayLocalDate = '', year, month }) {
  const current = monthIndex(`${year}-${String(month).padStart(2, '0')}-01`);
  const latestMonth = Math.max(monthIndex(startLocalDate), monthIndex(todayLocalDate));
  return {
    canPrevMonth: current > monthIndex(startLocalDate),
    canNextMonth: current < latestMonth
  };
}

module.exports = { buildCalendarMonth, getCalendarNavigation, toLocalDateKey };
