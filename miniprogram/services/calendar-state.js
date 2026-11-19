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
  settledDates = [],
  checkinRecords = [],
  settledRecords = []
}) {
  const checkedMap = buildCheckinMap(checkinRecords.length ? checkinRecords : checkinDates);
  const settledMap = buildCheckinMap(settledRecords.length ? settledRecords : settledDates);
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekdayOffset = (firstDay.getUTCDay() + 6) % 7;
  const cells = Array.from({ length: weekdayOffset }, () => ({
    date: null,
    day: null,
    withinStage: false,
    checkedIn: false,
    backfill: false,
    settled: false,
    markText: '',
    timeText: '',
    source: '',
    today: false,
    future: false,
    stageStart: false
  }));

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = toLocalDateKey(year, month, day);
    const withinStage = date >= startLocalDate;
    const checkedIn = checkedMap.has(date);
    const settled = settledMap.has(date) && !checkedIn;
    const record = checkedIn ? checkedMap.get(date) : settledMap.get(date) || null;
    cells.push({
      date,
      day,
      withinStage,
      checkedIn,
      backfill: checkedIn && record.source === 'employer_backfill',
      settled,
      markText: '',
      timeText: record ? record.time : '',
      source: record ? record.source : '',
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
      backfill: false,
      settled: false,
      markText: '',
    timeText: '',
    source: '',
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

function buildCheckinMap(records) {
  const map = new Map();
  records.forEach((value) => {
    if (typeof value === 'string') {
      map.set(value, { localDate: value, time: '', source: '' });
      return;
    }
    if (!value || !value.localDate) return;
    map.set(value.localDate, {
      localDate: value.localDate,
      time: compactShanghaiTime(value.time || value.workTime),
      source: value.source || ''
    });
  });
  return map;
}

function compactShanghaiTime(value) {
  const text = String(value || '');
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  const shanghaiDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${String(shanghaiDate.getUTCHours()).padStart(2, '0')}:${String(shanghaiDate.getUTCMinutes()).padStart(2, '0')}`;
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

function getInitialCalendarMonth({ startLocalDate = '', todayLocalDate = '', checkinRecords = [] }) {
  const latestCheckinDate = checkinRecords
    .map((item) => (typeof item === 'string' ? item : item && item.localDate))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right))
    .pop() || '';
  const focusDate = latestCheckinDate || (startLocalDate > todayLocalDate ? startLocalDate : todayLocalDate);
  const [year, month] = focusDate.split('-').map(Number);
  return { year, month };
}

module.exports = {
  buildCalendarMonth,
  getCalendarNavigation,
  getInitialCalendarMonth,
  toLocalDateKey
};
