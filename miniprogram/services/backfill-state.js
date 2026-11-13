'use strict';

function parseLocalDate(localDate) {
  return new Date(`${localDate}T00:00:00+08:00`);
}

function toLocalDateKey(date) {
  const shanghaiDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shanghaiDate.getUTCFullYear()}-${String(shanghaiDate.getUTCMonth() + 1).padStart(2, '0')}-${String(shanghaiDate.getUTCDate()).padStart(2, '0')}`;
}

function addLocalDays(localDate, days) {
  const date = parseLocalDate(localDate);
  date.setUTCDate(date.getUTCDate() + days);
  return toLocalDateKey(date);
}

function enumerateLocalDates(startLocalDate, endLocalDate) {
  const dates = [];
  if (!startLocalDate || !endLocalDate || startLocalDate > endLocalDate) return dates;
  let cursor = startLocalDate;
  while (cursor <= endLocalDate) {
    dates.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  return dates;
}

function buildBackfillBoard({
  earliestLocalDate,
  latestLocalDate,
  eligibleLocalDates = [],
  selectedLocalDates = []
}) {
  const eligible = new Set(eligibleLocalDates);
  const selected = new Set(selectedLocalDates);
  const dates = enumerateLocalDates(earliestLocalDate, latestLocalDate);
  const groupedByMonth = new Map();
  dates.forEach((localDate) => {
    const year = Number(localDate.slice(0, 4));
    const month = Number(localDate.slice(5, 7));
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!groupedByMonth.has(key)) groupedByMonth.set(key, []);
    groupedByMonth.get(key).push({
      date: localDate,
      day: Number(localDate.slice(8, 10)),
      eligible: eligible.has(localDate),
      selected: selected.has(localDate)
    });
  });

  const boards = Array.from(groupedByMonth.entries()).map(([key, monthDays]) => {
    const [year, month] = key.split('-').map(Number);
    const firstDate = parseLocalDate(monthDays[0].date);
    const weekdayOffset = (new Date(
      Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth(), firstDate.getUTCDate())
    ).getUTCDay() + 6) % 7;
    const cells = Array.from({ length: weekdayOffset }, () => ({
      date: null,
      day: null,
      eligible: false,
      selected: false
    })).concat(monthDays);
    while (cells.length % 7 !== 0) {
      cells.push({ date: null, day: null, eligible: false, selected: false });
    }
    return {
      title: `${year}年${month}月`,
      weeks: Array.from({ length: cells.length / 7 }, (_, index) =>
        cells.slice(index * 7, index * 7 + 7)
      )
    };
  });

  return { boards, selectedLocalDates: Array.from(selected).sort() };
}

function selectBackfillDate({ mode, date, selectedLocalDates = [], eligibleLocalDates = [] }) {
  const eligible = new Set(eligibleLocalDates);
  if (!eligible.has(date)) return selectedLocalDates.slice().sort();

  if (mode === 'single') {
    const selected = new Set(selectedLocalDates);
    if (selected.has(date)) selected.delete(date);
    else selected.add(date);
    return Array.from(selected).sort();
  }

  if (selectedLocalDates.length !== 1) return [date];
  const anchor = selectedLocalDates[0];
  if (anchor === date) return [date];
  const from = anchor < date ? anchor : date;
  const to = anchor < date ? date : anchor;
  return eligibleLocalDates.filter((localDate) => localDate >= from && localDate <= to).sort();
}

module.exports = {
  addLocalDays,
  buildBackfillBoard,
  enumerateLocalDates,
  selectBackfillDate
};
