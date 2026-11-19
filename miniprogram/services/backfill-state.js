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
  selectedLocalDates = [],
  checkedLocalDates = [],
  mode = 'range'
}) {
  const eligible = new Set(eligibleLocalDates);
  const checked = new Set(checkedLocalDates);
  const selected = new Set(selectedLocalDates);
  const sortedSelectedDates = Array.from(selected).sort((left, right) => left.localeCompare(right));
  const rangeStart = sortedSelectedDates[0] || null;
  const rangeEnd = sortedSelectedDates[sortedSelectedDates.length - 1] || null;
  const hasRangeEndpoints = Boolean(
    mode === 'range' && rangeStart && rangeEnd && rangeStart !== rangeEnd
  );
  const dates = enumerateLocalDates(earliestLocalDate, latestLocalDate);
  const groupedByMonth = new Map();
  dates.forEach((localDate) => {
    const year = Number(localDate.slice(0, 4));
    const month = Number(localDate.slice(5, 7));
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!groupedByMonth.has(key)) groupedByMonth.set(key, []);
    groupedByMonth.get(key).push({
      blank: false,
      date: localDate,
      day: Number(localDate.slice(8, 10)),
      eligible: eligible.has(localDate),
      checked: checked.has(localDate),
      selected: selected.has(localDate),
      rangeStart: mode === 'range' && localDate === rangeStart,
      rangeEnd: mode === 'range' && localDate === rangeEnd,
      rangeMiddle: hasRangeEndpoints && localDate > rangeStart && localDate < rangeEnd
    });
  });

  const boards = Array.from(groupedByMonth.entries()).map(([key, monthDays]) => {
    const [year, month] = key.split('-').map(Number);
    const firstLocalDate = monthDays[0].date;
    const [firstYear, firstMonth, firstDay] = firstLocalDate.split('-').map(Number);
    const weekdayOffset = (new Date(Date.UTC(firstYear, firstMonth - 1, firstDay)).getUTCDay() + 6) % 7;
    const cells = Array.from({ length: weekdayOffset }, () => ({
      blank: true,
      date: null,
      day: null,
      eligible: false,
      checked: false,
      selected: false,
      rangeStart: false,
      rangeEnd: false,
      rangeMiddle: false
    })).concat(monthDays);
    while (cells.length % 7 !== 0) {
      cells.push({
        blank: true,
        date: null,
        day: null,
        eligible: false,
        checked: false,
        selected: false,
        rangeStart: false,
        rangeEnd: false,
        rangeMiddle: false
      });
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
    return selectedLocalDates.length === 1 && selectedLocalDates[0] === date
      ? []
      : [date];
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
