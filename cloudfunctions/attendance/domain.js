'use strict';

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHALLENGE_ALPHABET = '0123456789abcdef';
const EARTH_RADIUS_METERS = 6371008.8;
const MAX_CHECKIN_ACCURACY_METERS = 500;

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function finiteNumber(value) {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : NaN;
}

function toShanghaiLocalDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('INVALID_DATE');
  }
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shanghaiStartOfDay(startDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate))) {
    throw new Error('INVALID_START_DATE');
  }
  const timestamp = Date.parse(`${startDate}T00:00:00+08:00`);
  if (Number.isNaN(timestamp)) {
    throw new Error('INVALID_START_DATE');
  }
  return new Date(timestamp);
}

function haversineMeters(from, to) {
  const latitudeDelta = toRadians(Number(to.latitude) - Number(from.latitude));
  const longitudeDelta = toRadians(Number(to.longitude) - Number(from.longitude));
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function evaluateCheckin({ home, location, radiusMeters, maxAccuracyMeters = MAX_CHECKIN_ACCURACY_METERS }) {
  if (!home || !location) {
    return { allowed: false, reason: 'INVALID_LOCATION', distanceMeters: null };
  }
  const homeLatitude = finiteNumber(home.latitude);
  const homeLongitude = finiteNumber(home.longitude);
  const latitude = finiteNumber(location.latitude);
  const longitude = finiteNumber(location.longitude);
  const accuracy = finiteNumber(location.accuracy);
  if (
    !(homeLatitude >= -90 && homeLatitude <= 90) ||
    !(homeLongitude >= -180 && homeLongitude <= 180) ||
    !(latitude >= -90 && latitude <= 90) ||
    !(longitude >= -180 && longitude <= 180)
  ) {
    return { allowed: false, reason: 'INVALID_LOCATION', distanceMeters: null };
  }
  if (!(accuracy >= 0 && accuracy <= maxAccuracyMeters)) {
    return { allowed: false, reason: 'POOR_ACCURACY', distanceMeters: null };
  }
  const distanceMeters = round(haversineMeters(home, location), 2);
  if (distanceMeters > Number(radiusMeters)) {
    return { allowed: false, reason: 'OUT_OF_FENCE', distanceMeters };
  }
  return { allowed: true, reason: undefined, distanceMeters };
}

function calculateSettlement({ totalAmount, targetDays, days }) {
  const amount = roundMoney((Number(totalAmount) / Number(targetDays)) * Number(days));
  return {
    days: Number(days),
    dailySalary: roundMoney(Number(totalAmount) / Number(targetDays)),
    amount
  };
}

function randomString(length, alphabet, rng = Math.random) {
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output += alphabet[randomIndex(alphabet.length, rng)];
  }
  return output;
}

function randomIndex(alphabetLength, rng) {
  if (rng !== Math.random) {
    return Math.floor(rng() * alphabetLength);
  }
  if (
    typeof globalThis.crypto === 'object' &&
    globalThis.crypto &&
    typeof globalThis.crypto.getRandomValues === 'function'
  ) {
    const upperBound = Math.floor(256 / alphabetLength) * alphabetLength;
    const bytes = new Uint8Array(1);
    do {
      globalThis.crypto.getRandomValues(bytes);
    } while (bytes[0] >= upperBound);
    return bytes[0] % alphabetLength;
  }
  return Math.floor(rng() * alphabetLength);
}

function createInviteCode({ rng } = {}) {
  return randomString(8, INVITE_ALPHABET, rng);
}

function createChallengeToken({ rng } = {}) {
  return randomString(32, CHALLENGE_ALPHABET, rng);
}

function createId(prefix, now = new Date()) {
  const random = randomString(6, INVITE_ALPHABET);
  return `${prefix}_${now.getTime().toString(36)}_${random}`;
}

function validateContractInput(input) {
  const totalAmount = finiteNumber(input.totalAmount);
  const targetDays = finiteNumber(input.targetDays);
  const radiusMeters = finiteNumber(input.radiusMeters === undefined ? 300 : input.radiusMeters);
  const latitude = finiteNumber(input.latitude);
  const longitude = finiteNumber(input.longitude);
  const address = typeof input.address === 'string' ? input.address.trim() : '';
  const startDate = String(input.startDate || '');

  if (!(totalAmount >= 1 && totalAmount <= 1000000)) throw new Error('INVALID_TOTAL_AMOUNT');
  if (!Number.isInteger(targetDays) || targetDays < 1 || targetDays > 365) throw new Error('INVALID_TARGET_DAYS');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(`${startDate}T00:00:00+08:00`))) {
    throw new Error('INVALID_START_DATE');
  }
  if (!address || address.length > 120) throw new Error('INVALID_ADDRESS');
  if (!(latitude >= -90 && latitude <= 90)) throw new Error('INVALID_LATITUDE');
  if (!(longitude >= -180 && longitude <= 180)) throw new Error('INVALID_LONGITUDE');
  if (!Number.isInteger(radiusMeters) || radiusMeters < 100 || radiusMeters > 1000) throw new Error('INVALID_RADIUS');

  return {
    totalAmount,
    targetDays,
    startDate,
    homeLocation: { address, latitude, longitude },
    radiusMeters
  };
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

module.exports = {
  MAX_CHECKIN_ACCURACY_METERS,
  calculateSettlement,
  createChallengeToken,
  createId,
  createInviteCode,
  evaluateCheckin,
  haversineMeters,
  randomString,
  roundMoney,
  shanghaiStartOfDay,
  toShanghaiLocalDate,
  validateContractInput
};
