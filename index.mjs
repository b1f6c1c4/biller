import JSON5 from 'json5';
import { readFile } from 'node:fs/promises';
import readline from 'node:readline/promises';
import dayjs from 'dayjs';

// Read data file
const fn = process.argv[2] || 'data.json5';
const data = JSON5.parse(await readFile(fn, 'utf-8'));

// Verify activities and solve for occupancy
const personToFamily = new Map();
for (const f in data.families)
    for (const p of data.families[f])
        if (personToFamily.has(p)) {
            console.log(`${p} belongs to multiple families`);
            process.exit(1);
        } else {
            personToFamily.set(p, f);
        }
const occupancyHistory = [];
const occupancy = new Set(); // must start with empty occupancy
const status = new Set();
for (const d in data.activities) {
    const todayOccupancy = new Set(occupancy);
    for (const p in data.activities[d]) {
        if (!personToFamily.has(p)) {
            console.log(`data.activities[${d}].${p} does not belong to any family`);
            process.exit(1);
        }
        const action = data.activities[d][p];
        switch (action) {
            case 0: // skip a day
                if (!occupancy.has(p)) {
                    console.log(`data.activities[${d}].${p} was not previous there`);
                    process.exit(1);
                }
                todayOccupancy.delete(p);
                break;
            case +1: // move in
                if (occupancy.has(p)) {
                    console.log(`data.activities[${d}].${p} was already there`);
                    process.exit(1);
                }
                todayOccupancy.add(p);
                occupancy.add(p);
                break;
            case -1: // move out
                if (!occupancy.has(p)) {
                    console.log(`data.activities[${d}].${p} was not previous there`);
                    process.exit(1);
                }
                todayOccupancy.delete(p);
                occupancy.delete(p);
                break;
            default:
                console.log(`data.activities[${d}].${p} has invalid action: ${action}`);
                process.exit(1);
        }
    }
    const families = new Set();
    for (const p of todayOccupancy)
        families.add(personToFamily.get(p));
    occupancyHistory.push({
        date: dayjs(d, 'YYYYMMDD'),
        families,
        persons: todayOccupancy,
    });
}

// Interactive
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

console.log('List of bills:');
for (let i = 0; i < data.bills.length; i++) {
    const b = data.bills[i];
    console.log(`[${i}]: ${b.desc} - ${b.mode}`);
}
console.log();
const bill = data.bills[
    await rl.question('Which bill to generate? '),
];
const amount = +await rl.question('Amount? ');
const start = await rl.question('Bill start date? (YYYYMMDD) ');
const end = await rl.question('Bill end date? (YYYYMMDD) ');
console.log(occupancyHistory);
rl.close();
