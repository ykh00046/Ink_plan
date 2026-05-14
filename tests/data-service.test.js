const assert = require('node:assert/strict');
const test = require('node:test');

const DataService = require('../data-service.js');

test('builds two injection columns per day in day then night order', () => {
  assert.deepEqual(DataService.getInjectionColumns(['월', '화']), [
    { day: '월', shift: 'day', label: '주' },
    { day: '월', shift: 'night', label: '야' },
    { day: '화', shift: 'day', label: '주' },
    { day: '화', shift: 'night', label: '야' },
  ]);
});

test('moves an injection cell without restoring the source cell', () => {
  const data = {
    injection: {
      '3층': [
        { machine: 'A', schedule: { 월: { day: 'P1', night: '' }, 화: { day: '', night: '' } } },
        { machine: 'B', schedule: { 월: { day: '', night: '' }, 화: { day: '', night: '' } } },
      ],
    },
  };

  const next = DataService.moveInjectionCell(data, '3층', { mi: 0, day: '월', shift: 'day' }, { mi: 1, day: '화', shift: 'night' });

  assert.equal(next.injection['3층'][0].schedule.월.day, '');
  assert.equal(next.injection['3층'][1].schedule.화.night, 'P1');
  assert.equal(data.injection['3층'][0].schedule.월.day, 'P1');
});

test('renames product references inside injection schedules', () => {
  const injection = {
    '3층': [
      { machine: 'A', schedule: { 월: { day: 'OLD', night: 'KEEP' } } },
    ],
  };

  const next = DataService.renameInjectionRefs(injection, 'OLD', 'NEW');

  assert.equal(next['3층'][0].schedule.월.day, 'NEW');
  assert.equal(next['3층'][0].schedule.월.night, 'KEEP');
  assert.equal(injection['3층'][0].schedule.월.day, 'OLD');
});

test('counts product references inside injection schedules', () => {
  const data = {
    injection: {
      '3층': [
        { schedule: { 월: { day: 'P1', night: 'P2' }, 화: { day: 'P1', night: '' } } },
      ],
      '1층': [
        { schedule: { 월: { day: '', night: 'P1' } } },
      ],
    },
  };

  assert.equal(DataService.countInjectionRefs(data, 'P1'), 3);
  assert.equal(DataService.countInjectionRefs(data, 'P3'), 0);
});
