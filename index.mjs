import JSON5 from 'json5';
import { readFile } from 'fs/promises';

const fn = process.argv[2] || 'data.json5';
const data = JSON5.parse(await readFile(fn, 'utf-8'));
console.log(data);
