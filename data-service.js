(function (root, factory) {
  const service = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = service;
  if (root) {
    root.DataService = service;
    root.localDateISO = service.localDateISO;
    root.parseDateLocal = service.parseDateLocal;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function getInjectionColumns(days) {
    return days.flatMap(day => [
      { day, shift: 'day', label: '주' },
      { day, shift: 'night', label: '야' },
    ]);
  }

  function cloneScheduleWithShift(machine, day, shift, value) {
    return {
      ...machine,
      schedule: {
        ...machine.schedule,
        [day]: {
          ...(machine.schedule?.[day] || {}),
          [shift]: value,
        },
      },
    };
  }

  function moveInjectionCell(data, floor, source, target) {
    if (
      source.mi === target.mi &&
      source.day === target.day &&
      source.shift === target.shift
    ) {
      return data;
    }

    const value = data.injection[floor][source.mi].schedule[source.day][source.shift];
    const nextFloor = [...data.injection[floor]];
    nextFloor[source.mi] = cloneScheduleWithShift(nextFloor[source.mi], source.day, source.shift, '');
    const targetMachine = source.mi === target.mi ? nextFloor[source.mi] : nextFloor[target.mi];
    nextFloor[target.mi] = cloneScheduleWithShift(targetMachine, target.day, target.shift, value);

    return {
      ...data,
      injection: {
        ...data.injection,
        [floor]: nextFloor,
      },
    };
  }

  function renameInjectionRefs(injection, oldName, newName) {
    if (!oldName || oldName === newName) return injection;
    const next = {};
    for (const floor of Object.keys(injection || {})) {
      next[floor] = (injection[floor] || []).map(machine => ({
        ...machine,
        schedule: Object.fromEntries(
          Object.entries(machine.schedule || {}).map(([day, shifts]) => [
            day,
            {
              ...shifts,
              day: shifts.day === oldName ? newName : shifts.day,
              night: shifts.night === oldName ? newName : shifts.night,
            },
          ])
        ),
      }));
    }
    return next;
  }

  function countInjectionRefs(data, productName) {
    if (!productName || !data?.injection) return 0;
    let count = 0;
    for (const floor of Object.keys(data.injection)) {
      for (const machine of data.injection[floor] || []) {
        for (const shifts of Object.values(machine.schedule || {})) {
          if (shifts.day === productName) count++;
          if (shifts.night === productName) count++;
        }
      }
    }
    return count;
  }

  function localDateISO(now = new Date()) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 'YYYY-MM-DD' 를 로컬 자정 Date 로 파싱.
  // new Date('YYYY-MM-DD') 는 UTC 자정으로 해석되어 음수 타임존에서 요일/일자가
  // 하루 어긋나므로, 연·월·일을 직접 넣어 로컬 기준 Date 를 만든다.
  function parseDateLocal(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), day = Number(m[3]);
    const d = new Date(y, mo - 1, day);
    // 롤오버 거부: '2026-13-40' 같은 범위 초과 입력은 무효 처리
    if (isNaN(d) || d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) {
      return null;
    }
    return d;
  }

  function getVisibleWeekdays(days, today, mode) {
    if (mode !== '3days') return days;
    const idx = days.indexOf(today);
    if (idx < 0) return today ? [today] : [];
    const end = Math.min(days.length - 1, idx + 2);
    return days.slice(idx, end + 1);
  }

  function updateMachineAssignment(assignments, inkName, machine) {
    const ink = String(inkName || '').trim();
    const nextMachine = String(machine || '').trim();
    if (!ink) return assignments || [];

    const source = assignments || [];
    const idx = source.findIndex(a => (a.ink || a.product || a.name || '') === ink);
    if (idx < 0) return nextMachine ? [...source, { ink, machine: nextMachine }] : source;

    if (!nextMachine) return source.filter((_, i) => i !== idx);

    const next = [...source];
    next[idx] = { ink, machine: nextMachine };
    return next;
  }

  function lotPrefix(inkName) {
    return String(inkName || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  }

  function dateMMDD(dateISO) {
    const d = parseDateLocal(dateISO);
    if (!d) return '';
    return String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }

  function dateFromLotNo(lotNo, fallbackDateISO) {
    const s = String(lotNo || '').toUpperCase();
    const m = s.match(/[A-Z0-9]*?(\d{2})(\d{2})\d{2}$/);
    if (!m) return fallbackDateISO || localDateISO();
    const base = parseDateLocal(fallbackDateISO) || new Date();
    const yyyy = base.getFullYear();
    const dateISO = `${yyyy}-${m[1]}-${m[2]}`;
    return parseDateLocal(dateISO) ? dateISO : (fallbackDateISO || localDateISO());
  }

  function lotSequenceForDate(lots, inkName, dateISO) {
    const ink = String(inkName || '');
    const prefix = lotPrefix(inkName);
    const mmdd = dateMMDD(dateISO);
    let maxSeq = 0;
    for (const lot of (lots || [])) {
      if (lot.ink !== ink || lot.registeredDate !== dateISO) continue;
      const lotNo = String(lot.lotNo || '');
      const suffix = lotNo.startsWith(prefix + mmdd) ? Number(lotNo.slice((prefix + mmdd).length)) : Number(lot.order);
      if (!isNaN(suffix)) maxSeq = Math.max(maxSeq, suffix);
    }
    return maxSeq + 1;
  }

  function nextInventoryLotNo(inkName, dateISO, lots) {
    const prefix = lotPrefix(inkName);
    const mmdd = dateMMDD(dateISO);
    const seq = lotSequenceForDate(lots, inkName, dateISO);
    return `${prefix}${mmdd}${String(seq).padStart(2, '0')}`;
  }

  function initialInventoryLot(lots, inkName) {
    const ink = String(inkName || '');
    const inkLots = initialInventoryLots(lots, ink);
    return inkLots.find(l => l.role === 'initial' || l.order === 1) || inkLots[0] || null;
  }

  function initialInventoryLots(lots, inkName) {
    const ink = String(inkName || '');
    return (lots || [])
      .filter(l => l.ink === ink && l.role !== 'relabel' && !l.parentId)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function relabelLotsForInitial(lots, initialLot) {
    if (!initialLot) return [];
    const sameInkInitials = initialInventoryLots(lots, initialLot.ink);
    const canUseLegacy = sameInkInitials.length <= 1;
    return (lots || [])
      .filter(l => l.ink === initialLot.ink && (l.role === 'relabel' || Number(l.order) > 1))
      .filter(l => l.parentId === initialLot.id || (!l.parentId && canUseLegacy))
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }

  function relabelLotsForDate(lots, inkName, dateISO) {
    const initial = initialInventoryLot(lots, inkName);
    return relabelLotsForInitial(lots, initial).filter(l => l.registeredDate === dateISO);
  }

  function actualInventoryLotForInitial(lots, initialLot, dateISO) {
    if (!initialLot) return null;
    const relabels = relabelLotsForInitial(lots, initialLot)
      .filter(l => !dateISO || l.registeredDate <= dateISO);
    return relabels[relabels.length - 1] || initialLot;
  }

  function actualInventoryLot(lots, inkName, dateISO) {
    return actualInventoryLotForInitial(lots, initialInventoryLot(lots, inkName), dateISO);
  }

  function relabelInventoryLot(inventory, initialLotId, dateISO, idFactory) {
    const inv = inventory || { lots: [], daily: {} };
    const initial = (inv.lots || []).find(l => l.id === initialLotId && l.role !== 'relabel')
      || initialInventoryLot(inv.lots, initialLotId)
      || null;
    if (!initial) return inv;
    const existing = relabelLotsForInitial(inv.lots, initial);
    const nextOrder = Math.max(1, ...existing.map(l => Number(l.order || 1))) + 1;
    if (nextOrder > 3) return inv;

    const prefix = lotPrefix(initial.ink);
    const mmdd = dateMMDD(dateISO);
    const lot = {
      id: idFactory ? idFactory() : `L${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      ink: String(initial.ink || ''),
      lotNo: `${prefix}${mmdd}${String(nextOrder).padStart(2, '0')}`,
      registeredDate: dateISO,
      role: 'relabel',
      order: nextOrder,
      parentId: initial.id,
    };
    return {
      ...inv,
      lots: [...(inv.lots || []), lot],
      daily: {
        ...(inv.daily || {}),
        [dateISO]: { ...((inv.daily || {})[dateISO] || {}) },
      },
    };
  }

  function removeInventoryLot(inventory, lotId) {
    const inv = inventory || { lots: [], daily: {} };
    const removeIds = new Set([lotId]);
    for (const lot of inv.lots || []) {
      if (lot.parentId === lotId) removeIds.add(lot.id);
    }
    const daily = {};
    for (const [dateISO, valueMap] of Object.entries(inv.daily || {})) {
      const nextMap = { ...(valueMap || {}) };
      for (const id of removeIds) delete nextMap[id];
      daily[dateISO] = nextMap;
    }
    const next = {
      ...inv,
      lots: (inv.lots || []).filter(l => !removeIds.has(l.id)),
      daily,
    };
    if (Array.isArray(inv.order)) next.order = inv.order.filter(id => !removeIds.has(id));
    return next;
  }

  function removeInventoryInk(inventory, inkName) {
    const inv = inventory || { lots: [], daily: {} };
    const ids = new Set((inv.lots || []).filter(l => l.ink === inkName).map(l => l.id));
    const daily = {};
    for (const [dateISO, valueMap] of Object.entries(inv.daily || {})) {
      const nextMap = { ...(valueMap || {}) };
      for (const id of ids) delete nextMap[id];
      daily[dateISO] = nextMap;
    }
    const next = {
      ...inv,
      lots: (inv.lots || []).filter(l => l.ink !== inkName),
      daily,
    };
    if (Array.isArray(inv.order)) next.order = inv.order.filter(id => !ids.has(id));
    return next;
  }

  return {
    getInjectionColumns,
    moveInjectionCell,
    renameInjectionRefs,
    countInjectionRefs,
    localDateISO,
    parseDateLocal,
    getVisibleWeekdays,
    updateMachineAssignment,
    lotSequenceForDate,
    nextInventoryLotNo,
    dateFromLotNo,
    initialInventoryLots,
    initialInventoryLot,
    actualInventoryLot,
    actualInventoryLotForInitial,
    relabelLotsForDate,
    relabelLotsForInitial,
    relabelInventoryLot,
    removeInventoryLot,
    removeInventoryInk,
  };
});
