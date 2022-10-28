import debug from 'debug';
import yaml from 'yaml';
import { readFile } from 'node:fs/promises';
import readline from 'node:readline/promises';
import dayjs from 'dayjs';

const dbg = debug('biller');

// Read data file
const fn = process.argv[2] || 'data.yaml';
const data = yaml.parse(await readFile(fn, 'utf-8'));

// Verify persons and families
const personToFamily = new Map();
{
    for (const f in data.families)
        for (const p of data.families[f].persons)
            if (personToFamily.has(p)) {
                console.error(`${p} belongs to multiple families`);
                process.exit(1);
            } else {
                personToFamily.set(p, f);
            }
}

// Verify activities and solve for occupancy
const occupancyHistory = [];
{
    function pushToHistory(date, persons) {
        const prev = occupancyHistory[occupancyHistory.length - 1];
        if (prev && prev.persons.size === persons.size)
            if ([...prev.persons].every((p) => persons.has(p)))
                return;
        const families = new Map();
        for (const p of persons) {
            const f = personToFamily.get(p);
            if (!families.has(f))
                families.set(f, 1);
            else
                families.set(f, families.get(f) + 1);
        }
        occupancyHistory.push({
            date: dayjs(date, 'YYYYMMDD'),
            families,
            persons: new Set(persons),
        });
    }
    const occupancy = new Set(); // must start with empty occupancy
    let extraStep = null; // used when a '0' action is indicated
    for (const d in data.activities) {
        const dd = dayjs(d, 'YYYYMMDD');
        if (extraStep && !dd.isSame(extraStep)) {
            // another activity necessary to record the change
            pushToHistory(extraStep, occupancy);
        }
        const todayOccupancy = new Set(occupancy);
        for (const p in data.activities[d]) {
            if (!personToFamily.has(p)) {
                console.error(`data.activities[${d}].${p} does not belong to any family`);
                process.exit(1);
            }
            const action = data.activities[d][p];
            switch (action) {
                case 0: // skip a day
                    if (!occupancy.has(p)) {
                        console.error(`data.activities[${d}].${p} was not previous there`);
                        process.exit(1);
                    }
                    todayOccupancy.delete(p);
                    extraStep = dd.add(1, 'day');
                    break;
                case +1: // move in
                    if (occupancy.has(p)) {
                        console.error(`data.activities[${d}].${p} was already there`);
                        process.exit(1);
                    }
                    todayOccupancy.add(p);
                    occupancy.add(p);
                    extraStep = null;
                    break;
                case -1: // move out
                    if (!occupancy.has(p)) {
                        console.error(`data.activities[${d}].${p} was not previous there`);
                        process.exit(1);
                    }
                    todayOccupancy.delete(p);
                    occupancy.delete(p);
                    extraStep = null;
                    break;
                default:
                    console.error(`data.activities[${d}].${p} has invalid action: ${action}`);
                    process.exit(1);
            }
        }
        pushToHistory(dd, todayOccupancy);
    }
    if (extraStep) {
        pushToHistory(extraStep, occupancy);
    }
    dbg(occupancyHistory);
}

// Ask for information
let bill, start ,end, amount, duration;
{
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
    bill = data.bills[process.argv[3] || await rl.question('Which bill to generate? ')];
    start = dayjs(process.argv[4] || await rl.question('Bill start date (incl.)? (YYYYMMDD) '), 'YYYYMMDD');
    end = dayjs(process.argv[5] || await rl.question('Bill end date (incl.)? (YYYYMMDD) '), 'YYYYMMDD');
    amount = +(process.argv[6] || await rl.question('Amount? '));
    duration = end.diff(start, 'day', true) + 1;
    process.argv[6] || await rl.question(`Duration is ${duration} days, right?`);
    rl.close();
}

// Compute intervals
const intervals = [];
{
    // Find the lastest activity that is either
    // on the start date OR earlier than start date
    let id = occupancyHistory.findLastIndex(({ date }) => !date.isAfter(start));
    // Previous activity date, OR start date
    let prevDate = start;
    let date = start;
    // Function to get occupancy on a specific id
    const occ = (i) => i < 0
        ? { date: dayjs('1970-01-01'), families: new Set(), persons: new Set() }
        : occupancyHistory[Math.min(i, occupancyHistory.length - 1)];
    function pushInterval(date) {
        const int = {};
        int.duration = date.diff(prevDate, 'day', true) + 1;
        if (int.duration === 1)
            int.head = `${prevDate.format('YYYYMMDD')}(1d)`;
        else
            int.head = `${prevDate.format('YYYYMMDD')}~${date.format('YYYYMMDD')}(${int.duration}d)`;
        int.ref = occ(id);
        intervals.push(int);
    }
    while (true) {
        if (occ(id + 1).date.isSame(date)) {
            pushInterval(date.subtract(1, 'day'));
            prevDate = date;
            id++;
        }
        if (date.isSame(end)) {
            pushInterval(date);
            break;
        }
        date = date.add(1, 'day');
    }
    dbg(intervals);
}

// Compute and display shares
let sharesReport = '';
const billed = [];
{
    function shareToString(share, simplifyOne) {
        let str = '';
        for (const { duration, n } of share) {
            if (!n)
                continue;
            if (str)
                str += '+';
            if (simplifyOne && n === 1)
                str += `${duration}`;
            else
                str += `${duration}*${n}`;
        }
        return str;
    }
    function shareToValue(share) {
        return share.reduce((v, { duration, n }) => v + duration * n, 0);
    }
    function listFamiliesInOrder(families) {
        let str = '';
        for (const f in data.families)
            if (families.has(f)) {
                if (str)
                    str += ', ';
                str += f;
            }
        if (!str)
            return 'nobody';
        return str;
    }
    function listPersonsInOrder(persons) {
        let str = '';
        for (const f in data.families)
            for (const p of data.families[f].persons)
                if (persons.has(p)) {
                    if (str)
                        str += ', ';
                    str += p;
                }
        if (!str)
            return 'nobody';
        return str;
    }
    function coerceToNearest(fund) {
        const equalityTolerance = 1e-8;
        const coercionTolerance = 1e-12;
        const round = (v, n) => Math.round(v * Math.pow(10, n)) * Math.pow(10, -n);
        const t = round(fund, -Math.log10(equalityTolerance));
        const c = round(fund, -Math.log10(coercionTolerance));
        dbg(fund, t, c);
        return Math.abs(t - c) < coercionTolerance / 10 ? t : fund;
    }
    sharesReport += `${bill.desc} bill: ${start.format('YYYYMMDD')}~${end.format('YYYYMMDD')}(${duration}d) ${coerceToNearest(amount)}\n`;
    sharesReport += `billing method: ${bill.mode}\n`;
    switch (bill.mode) {
        case 'per-person-per-day': {
            const totalShares = []; // [{ duration, n }]
            const familyShares = {}; // { <family>: [{ duration, n }] }
            for (const { head, duration, ref } of intervals) {
                totalShares.push({ duration, n: ref.persons.size });
                for (const f of ref.families) {
                    if (!familyShares[f[0]])
                        familyShares[f[0]] = [];
                    familyShares[f[0]].push({ duration, n: f[1] });
                }
                sharesReport += `${head}: ${listPersonsInOrder(ref.persons)}\n`;
            }
            const amountPerShare = amount / shareToValue(totalShares);
            sharesReport += `${bill.desc} per person per day: $${coerceToNearest(amount)}/(${shareToString(totalShares)})=$${coerceToNearest(amountPerShare)}\n`;
            for (const f in data.families) {
                if (!familyShares.hasOwnProperty(f))
                    continue;
                const owes = amountPerShare * shareToValue(familyShares[f]);
                sharesReport += `${f}: $${coerceToNearest(amountPerShare)}*(${shareToString(familyShares[f])})=$${coerceToNearest(owes)}\n`;
                billed.push({ tmpl: data.families[f].tmpl, owes });
            }
            break;
        }
        case 'per-family-per-day': {
            const totalShares = []; // [{ duration, n }]
            const familyShares = {}; // { <family>: [{ duration, n }] }
            for (const { head, duration, ref } of intervals) {
                totalShares.push({ duration, n: ref.families.size });
                for (const f of ref.families) {
                    if (!familyShares[f[0]])
                        familyShares[f[0]] = [];
                    familyShares[f[0]].push({ duration, n: 1 });
                }
                sharesReport += `${head}: ${listFamiliesInOrder(ref.families)}\n`;
            }
            const amountPerShare = amount / shareToValue(totalShares);
            sharesReport += `${bill.desc} per family per day: $${amount}/(${shareToString(totalShares, true)})=$${amountPerShare}\n`;
            for (const f in data.families) {
                if (!familyShares.hasOwnProperty(f))
                    continue;
                const owes = amountPerShare * shareToValue(familyShares[f]);
                sharesReport += `${f}: $${amountPerShare}*(${shareToString(familyShares[f], true)})=$${owes}\n`;
                billed.push({ tmpl: data.families[f].tmpl, owes });
            }
            break;
        }
        default:
            console.error(`Unknown mode: ${bill.mode}`);
            break;
    }
    dbg(billed);
}

// Display billed
let billedReport = '';
if (bill.tmpl) {
    let str = '';
    for (const { tmpl, owes } of billed) {
        const t = typeof tmpl === 'object' ? tmpl[bill.desc] : tmpl;
        str += t.replace(/\$\{owes\}/g, owes) + '\n';
    }
    billedReport = bill.tmpl.replace(/\$\{amount\}/g, amount).replace(/\$\{content\}/g, str);
}

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
