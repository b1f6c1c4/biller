import { describe, expect, test } from '@jest/globals';
import yaml from 'yaml';
import Biller from './index.js';

describe('coerceToNearest', () => {
  test('120.57', () => {
    expect(Biller.coerceToNearest(120.57)).toBe('120.57');
    expect(Biller.coerceToNearest(120.57000000000049)).toBe('120.57');
    expect(Biller.coerceToNearest(120.56999999999951)).toBe('120.57');
    // 120.56999999999950 is actually 120.569999999999495798874704633 so...
    expect(Biller.coerceToNearest(120.56999999999950)).toBe('120.5699999999995');
  });
  test('23.456', () => {
    expect(Biller.coerceToNearest(23.456)).toBe('23.456');
    expect(Biller.coerceToNearest(23.45600000000005)).toBe('23.456');
    expect(Biller.coerceToNearest(23.45599999999995)).toBe('23.456');
  });
  test('torture', () => {
    // 0.1234567899995000 is actually 0.123456789999499993992770896512 so...
    expect(Biller.coerceToNearest(+0.1234567899995000)).toBe('0.1234567899995');
    expect(Biller.coerceToNearest(-0.1234567800004999)).toBe('-0.12345678');
    expect(Biller.coerceToNearest(+0.1234567899989999)).toBe('0.1234567899989999');
    expect(Biller.coerceToNearest(+0.1234567800010000)).toBe('0.123456780001');
    expect(Biller.coerceToNearest(+123456.12345678999)).toBe('123456.12345679');
    expect(Biller.coerceToNearest(-123456.12345678000)).toBe('-123456.12345678');
    expect(Biller.coerceToNearest(+123456.12345678998)).toBe('123456.12345678998');
    expect(Biller.coerceToNearest(+123456.12345678001)).toBe('123456.12345678001');
    expect(Biller.coerceToNearest(+1234567890.1234999)).toBe('1234567890.1234999');
    expect(Biller.coerceToNearest(-1234567890.1234000)).toBe('-1234567890.1234');
    // 1234567890.1234997 is actually 1234567890.12349963188171386719 so...
    expect(Biller.coerceToNearest(+1234567890.1234997)).toBe('1234567890.1234996');
    // 1234567890.1234001 is actually 1234567890.12340021133422851563 so...
    expect(Biller.coerceToNearest(+1234567890.1234001)).toBe('1234567890.1234002');
  });
});

describe('weird activities', () => {
  const strip = (activities) => Object.fromEntries(new Biller({
    families: { T: { persons: ['t1', 't2'] } },
    bills: [{ desc: 't', mode: 'per-person-per-day' }],
    activities,
  }).occupancyHistory.map(({ date, families, persons }) => [
    date.format('YYYYMMDD'),
    [...persons.keys()].sort(),
  ]));
  test('skips', () => {
    expect(strip({
      20220101: { t1: +1, t2: +1 },
      20220105: { t1: 0, t2: 0 },
      20220106: { t1: -1, t2: 0 },
      20220108: { t1: +1 },
      20220110: { t2: 0 },
    })).toStrictEqual({
      20220101: ['t1', 't2'],
      20220105: [],
      20220107: ['t2'],
      20220108: ['t1', 't2'],
      20220110: ['t1'],
      20220111: ['t1', 't2'],
    });
  });
});

describe('example families', () => {
  const data = yaml.parse(`
families:
  W&E:
    persons: [ Willow, Emersyn ]
  M&M:
    persons: [ Mckenna, Mia ]
  S:
    persons: [ Steven ]
bills:
  - desc: water
    mode: per-person-per-day
  - desc: internet
    mode: per-family-per-day
  - desc: insurance
    mode: per-person
  - desc: rent
    mode: per-family
activities:
  # nobody was there before that
  20220101: { Willow: +1, Emersyn: +1 } # Moving in
  20220105: { Mia: +1, Steven: +1 } # Moving in
  20220110: { Willow: -1 } # Moving out
  20220115: { Mia: 0 } # temporarily not home on that day
  20220116: { Mia: 0 } # temporarily not home on that day
`);
  const biller = new Biller(data);

  test('water', () => {
    const {
      sharesReport,
      billedReport,
    } = biller.compute({
      billName: 'water',
      start: '20220101',
      end: '20220131',
      amount: 33.12,
    });
    expect(sharesReport).toBe(`water bill: 20220101~20220131(31d) 33.12
20220101~20220104(4d): Willow, Emersyn
20220105~20220109(5d): Willow, Emersyn, Mia, Steven
20220110~20220114(5d): Emersyn, Mia, Steven
20220115~20220116(2d): Emersyn, Steven
20220117~20220131(15d): Emersyn, Mia, Steven
water per person per day: $33.12/(4*2+5*4+5*3+2*2+15*3)=$0.36
W&E: $0.36*(4*2+5*2+5*1+2*1+15*1)=$14.4
M&M: $0.36*(5*1+5*1+15*1)=$9
S: $0.36*(5*1+5*1+2*1+15*1)=$9.72
`);
    expect(billedReport).toBe('');
  });

  test('internet', () => {
    const {
      sharesReport,
      billedReport,
    } = biller.compute({
      billName: 'internet',
      start: '20220101',
      end: '20220131',
      amount: 38.678,
    });
    expect(sharesReport).toBe(`internet bill: 20220101~20220131(31d) 38.678
20220101~20220104(4d): W&E
20220105~20220109(5d): W&E, M&M, S
20220110~20220114(5d): W&E, M&M, S
20220115~20220116(2d): W&E, S
20220117~20220131(15d): W&E, M&M, S
internet per family per day: $38.678/(4+5*3+5*3+2*2+15*3)=$0.466
W&E: $0.466*(4+5+5+2+15)=$14.446
M&M: $0.466*(5+5+15)=$11.65
S: $0.466*(5+5+2+15)=$12.582
`);
    expect(billedReport).toBe('');
  });

  test('insurance', () => {
    const {
      sharesReport,
      billedReport,
    } = biller.compute({
      billName: 'insurance',
      start: '20220101',
      end: '20220131',
      amount: 38.678,
    });
    expect(sharesReport).toBe(`insurance bill: 20220101~20220131(31d) 38.678
20220101~20220104(4d): Willow, Emersyn
20220105~20220109(5d): Willow, Emersyn, Mia, Steven
20220110~20220114(5d): Emersyn, Mia, Steven
20220115~20220116(2d): Emersyn, Steven
20220117~20220131(15d): Emersyn, Mia, Steven
insurance per person: $38.678/4=$9.6695
W&E: $9.6695*2=$19.339
M&M: $9.6695*1=$9.6695
S: $9.6695*1=$9.6695
`);
    expect(billedReport).toBe('');
  });

  test('rent', () => {
    const {
      sharesReport,
      billedReport,
    } = biller.compute({
      billName: 'rent',
      start: '20220101',
      end: '20220131',
      amount: 9876,
    });
    expect(sharesReport).toBe(`rent bill: 20220101~20220131(31d) 9876
20220101~20220104(4d): W&E
20220105~20220109(5d): W&E, M&M, S
20220110~20220114(5d): W&E, M&M, S
20220115~20220116(2d): W&E, S
20220117~20220131(15d): W&E, M&M, S
rent per family: $9876/3=$3292
W&E: $3292
M&M: $3292
S: $3292
`);
    expect(billedReport).toBe('');
  });
});
