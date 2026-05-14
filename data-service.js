(function (root, factory) {
  const service = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = service;
  if (root) {
    root.DataService = service;
    root.localDateISO = service.localDateISO;
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

  return {
    getInjectionColumns,
    moveInjectionCell,
    renameInjectionRefs,
    countInjectionRefs,
    localDateISO,
  };
});
