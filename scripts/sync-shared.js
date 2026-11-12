'use strict';

const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '..', 'shared');
const targetDir = path.join(__dirname, '..', 'cloudfunctions', 'attendance');
const cloudFiles = ['domain.js', 'errors.js', 'backend-core.js'];
const miniprogramFiles = [
  'domain.js',
  'errors.js',
  'backend-core.js',
  'memory-repository.js',
  'mock-backend.js',
  'storage.js'
];
const miniprogramDir = path.join(__dirname, '..', 'miniprogram', 'shared');

fs.mkdirSync(targetDir, { recursive: true });
fs.mkdirSync(miniprogramDir, { recursive: true });
for (const file of cloudFiles) {
  fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
}
for (const file of miniprogramFiles) {
  fs.copyFileSync(path.join(sourceDir, file), path.join(miniprogramDir, file));
}
