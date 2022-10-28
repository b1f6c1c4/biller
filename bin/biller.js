#!/usr/bin/env node

import Biller from '../index.js';

import yaml from 'yaml';
import { readFile } from 'node:fs/promises';
import readline from 'node:readline/promises';

// Read data file
const fn = process.argv[2] || 'data.yaml';
const data = yaml.parse(await readFile(fn, 'utf-8'));

const biller = new Biller(data);

// Ask for information
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stderr,
});
if (!process.argv[6]) {
  console.error('List of bills:');
  for (let i = 0; i < data.bills.length; i++) {
    const b = data.bills[i];
    console.error(`[${i}]: ${b.desc} - ${b.mode}`);
  }
  console.error();
}
const billName = process.argv[3] || await rl.question('Which bill to generate? ');
const start = process.argv[4] || await rl.question('Bill start date (incl.)? (YYYYMMDD) ');
const end = process.argv[5] || await rl.question('Bill end date (incl.)? (YYYYMMDD) ');
const amount = +(process.argv[6] || await rl.question('Amount? '));
rl.close();

const {
  sharesReport,
  billedReport,
} = biller.compute({ billName, start, end, amount });

console.log('========================');
console.log('==== SHARES REPORT =====');
console.log('========================');
console.log(sharesReport);

if (billedReport) {
    console.log('========================');
    console.log('==== BILLED REPORT =====');
    console.log('========================');
    console.log(billedReport);
}
