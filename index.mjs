import debug from 'debug';
import dayjs from 'dayjs';

const dbg = debug('biller');

export default class Biller {
    constructor(data) {
        this.data = data;

        // Verify persons and families
        this.personToFamily = new Map();
        for (const f in data.families)
            for (const p of data.families[f].persons)
                if (this.personToFamily.has(p)) {
                    console.error(`${p} belongs to multiple families`);
                    process.exit(1);
                } else {
                    this.personToFamily.set(p, f);
                }

        // Verify activities and solve for occupancy
        this.occupancyHistory = [];
        {
            const pushToHistory = (date, persons) => {
                const prev = this.occupancyHistory[this.occupancyHistory.length - 1];
                if (prev && prev.persons.size === persons.size)
                    if ([...prev.persons].every((p) => persons.has(p)))
                        return;
                const families = new Map();
                for (const p of persons) {
                    const f = this.personToFamily.get(p);
                    if (!families.has(f))
                        families.set(f, 1);
                    else
                        families.set(f, families.get(f) + 1);
                }
                this.occupancyHistory.push({
                    date: dayjs(date, 'YYYYMMDD'),
                    families,
                    persons: new Set(persons),
                });
            };
            const occupancy = new Set(); // must start with empty occupancy
            let extraStep = null; // used when a '0' action is indicated
            for (const d in this.data.activities) {
                const dd = dayjs(d, 'YYYYMMDD');
                if (extraStep && !dd.isSame(extraStep)) {
                    // another activity necessary to record the change
                    pushToHistory(extraStep, occupancy);
                }
                const todayOccupancy = new Set(occupancy);
                for (const p in this.data.activities[d]) {
                    if (!this.personToFamily.has(p)) {
                        console.error(`data.activities[${d}].${p} does not belong to any family`);
                        process.exit(1);
                    }
                    const action = this.data.activities[d][p];
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
            dbg(this.occupancyHistory);
        }
    }

    compute({ bill, start, end, amount }) {
        const startt = dayjs(start, 'YYYYMMDD');
        const endd = dayjs(end, 'YYYYMMDD');
        const duration = endd.diff(startt, 'day', true) + 1;
        // Compute intervals
        this.intervals = [];
        // Find the lastest activity that is either
        // on the start date OR earlier than start date
        let id = this.occupancyHistory.findLastIndex(({ date }) => !date.isAfter(start));
        // Previous activity date, OR start date
        let prevDate = startt;
        let date = startt;
        // Function to get occupancy on a specific id
        const occ = (i) => i < 0
            ? { date: dayjs('1970-01-01'), families: new Set(), persons: new Set() }
            : this.occupancyHistory[Math.min(i, this.occupancyHistory.length - 1)];
        const pushInterval = (date) => {
            const int = {};
            int.duration = date.diff(prevDate, 'day', true) + 1;
            if (int.duration === 1)
                int.head = `${prevDate.format('YYYYMMDD')}(1d)`;
            else
                int.head = `${prevDate.format('YYYYMMDD')}~${date.format('YYYYMMDD')}(${int.duration}d)`;
            int.ref = occ(id);
            this.intervals.push(int);
        };
        while (true) {
            if (occ(id + 1).date.isSame(date)) {
                pushInterval(date.subtract(1, 'day'));
                prevDate = date;
                id++;
            }
            if (date.isSame(endd)) {
                pushInterval(date);
                break;
            }
            date = date.add(1, 'day');
        }
        dbg(this.intervals);

        // Compute and display shares
        let sharesReport = '';
        const billed = [];
        const shareToString = (share, simplifyOne) => {
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
        };
        const shareToValue = (share) => {
            return share.reduce((v, { duration, n }) => v + duration * n, 0);
        };
        const listFamiliesInOrder = (families) => {
            let str = '';
            for (const f in this.data.families)
                if (families.has(f)) {
                    if (str)
                        str += ', ';
                    str += f;
                }
            if (!str)
                return 'nobody';
            return str;
        };
        const listPersonsInOrder = (persons) => {
            let str = '';
            for (const f in this.data.families)
                for (const p of this.data.families[f].persons)
                    if (persons.has(p)) {
                        if (str)
                            str += ', ';
                        str += p;
                    }
            if (!str)
                return 'nobody';
            return str;
        };
        const coerceToNearest = (fund) => {
            const equalityTolerance = 1e-8;
            const coercionTolerance = 1e-12;
            const round = (v, n) => Math.round(v * Math.pow(10, n)) * Math.pow(10, -n);
            const t = round(fund, -Math.log10(equalityTolerance));
            const c = round(fund, -Math.log10(coercionTolerance));
            dbg(fund, t, c);
            return Math.abs(t - c) < coercionTolerance / 10 ? t : fund;
        };
        sharesReport += `${bill.desc} bill: ${start}~${end}(${duration}d) ${coerceToNearest(amount)}\n`;
        switch (bill.mode) {
            case 'per-person-per-day': {
                const totalShares = []; // [{ duration, n }]
                const familyShares = new Map(); // { <family>: [{ duration, n }] }
                for (const { head, duration, ref } of this.intervals) {
                    totalShares.push({ duration, n: ref.persons.size });
                    for (const f of ref.families) {
                        if (!familyShares.has(f[0]))
                            familyShares.set(f[0], []);
                        familyShares.get(f[0]).push({ duration, n: f[1] });
                    }
                    sharesReport += `${head}: ${listPersonsInOrder(ref.persons)}\n`;
                }
                const amountPerShare = amount / shareToValue(totalShares);
                sharesReport += `${bill.desc} per person per day: $${coerceToNearest(amount)}/(${shareToString(totalShares)})=$${coerceToNearest(amountPerShare)}\n`;
                for (const f in this.data.families) {
                    if (!familyShares.has(f))
                        continue;
                    const owes = amountPerShare * shareToValue(familyShares.get(f));
                    sharesReport += `${f}: $${coerceToNearest(amountPerShare)}*(${shareToString(familyShares.get(f))})=$${coerceToNearest(owes)}\n`;
                    billed.push({ tmpl: this.data.families[f].tmpl, owes });
                }
                break;
            }
            case 'per-family-per-day': {
                const totalShares = []; // [{ duration, n }]
                const familyShares = new Map(); // { <family>: [{ duration, n }] }
                for (const { head, duration, ref } of this.intervals) {
                    totalShares.push({ duration, n: ref.families.size });
                    for (const f of ref.families) {
                        if (!familyShares.has(f[0]))
                            familyShares.set(f[0], [])
                        familyShares.get(f[0]).push({ duration, n: 1 });
                    }
                    sharesReport += `${head}: ${listFamiliesInOrder(ref.families)}\n`;
                }
                const amountPerShare = amount / shareToValue(totalShares);
                sharesReport += `${bill.desc} per family per day: $${coerceToNearest(amount)}/(${shareToString(totalShares, true)})=$${coerceToNearest(amountPerShare)}\n`;
                for (const f in this.data.families) {
                    if (!familyShares.has(f))
                        continue;
                    const owes = amountPerShare * shareToValue(familyShares.get(f));
                    sharesReport += `${f}: $${coerceToNearest(amountPerShare)}*(${shareToString(familyShares.get(f), true)})=$${coerceToNearest(owes)}\n`;
                    billed.push({ tmpl: this.data.families[f].tmpl, owes });
                }
                break;
            }
            case 'per-person': {
                const persons = new Set();
                for (const { head, duration, ref } of this.intervals) {
                    for (const p of ref.persons)
                        persons.add(p);
                    sharesReport += `${head}: ${listPersonsInOrder(ref.persons)}\n`;
                }
                const amountPerShare = amount / persons.size;
                sharesReport += `${bill.desc} per person: $${coerceToNearest(amount)}/(${persons.size})=$${coerceToNearest(amountPerShare)}\n`;
                for (const f in this.data.families) {
                    const share = this.data.familes[f].persons.reduce((v, p) => persons.has(p) ? v + 1 : v, 0);
                    if (!share)
                        continue;
                    const owes = amountPerShare * share;
                    sharesReport += `${f}: $${coerceToNearest(amountPerShare)}*(${share})=$${coerceToNearest(owes)}\n`;
                    billed.push({ tmpl: this.data.families[f].tmpl, owes });
                }
                break;
            }
            case 'per-family': {
                const families = new Set();
                for (const { head, duration, ref } of this.intervals) {
                    for (const f of ref.families) {
                        families.add(f);
                    }
                    sharesReport += `${head}: ${listFamiliesInOrder(ref.families)}\n`;
                }
                const totalShares = families.size;
                const amountPerShare = amount / shareToValue(totalShares);
                sharesReport += `${bill.desc} per family: $${coerceToNearest(amount)}/(${families.size})=$${coerceToNearest(amountPerShare)}\n`;
                for (const f in this.data.families) {
                    if (!families.has(f))
                        continue;
                    sharesReport += `${f}: $${coerceToNearest(amountPerShare)}`;
                    billed.push({ tmpl: this.data.families[f].tmpl, owes: amountPerShare });
                }
                break;
            }
            default:
                console.error(`Unknown mode: ${bill.mode}`);
                break;
        }
        dbg(billed);

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

        return { sharesReport, billedReport };
    }
}
