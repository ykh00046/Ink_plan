// 잉크 추가 및 관리 페이지 — 잉크 → 호기 매핑 마스터

function MachinesPage({ ctx }) {
  const { data, setData, notify } = ctx;
  const [search, setSearch] = useState('');
  const [machineFilter, setMachineFilter] = useState('all');
  const [editingIdx, setEditingIdx] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [newRow, setNewRow] = useState({ code: '', name: '', machine: '' });
  const [quickAdd, setQuickAdd] = useState({ code: '', name: '', machine: '' });

  const machineList = useMemo(() => {
    const s = new Set((data.machineAssignments || []).map(a => a.machine).filter(Boolean));
    return Array.from(s).sort((a, b) => {
      const an = parseInt(a) || 999;
      const bn = parseInt(b) || 999;
      return an - bn;
    });
  }, [data.machineAssignments]);

  // 중복 검사용 정규화된 이름 집합 (inkPlan + machineAssignments)
  const existingInkNamesNorm = useMemo(() => {
    const s = new Set();
    for (const i of (data.inkPlan || [])) {
      if (i.name) s.add(DataService.normalizeInkName(i.name));
    }
    for (const a of (data.machineAssignments || [])) {
      const n = inkOfAssignment(a);
      if (n) s.add(DataService.normalizeInkName(n));
    }
    return s;
  }, [data.inkPlan, data.machineAssignments]);

  const isDuplicateInk = (name) => {
    const norm = DataService.normalizeInkName(name);
    return norm && existingInkNamesNorm.has(norm);
  };

  // 품목코드 중복 검사
  const existingCodesNorm = useMemo(() => {
    const s = new Set();
    for (const a of (data.machineAssignments || [])) {
      if (a.code) s.add(a.code.trim().toLowerCase());
    }
    return s;
  }, [data.machineAssignments]);

  const isDuplicateCode = (code) => {
    const norm = code.trim().toLowerCase();
    return norm && existingCodesNorm.has(norm);
  };

  const filtered = useMemo(() => {
    let list = data.machineAssignments || [];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        inkOfAssignment(a).toLowerCase().includes(q)
        || (a.machine || '').toLowerCase().includes(q)
        || (a.code || '').toLowerCase().includes(q)
      );
    }
    if (machineFilter !== 'all') list = list.filter(a => a.machine === machineFilter);
    return list;
  }, [data.machineAssignments, search, machineFilter]);

  // 표 성능: 한 번에 그리는 행 수 제한 (1500+ 행 통째 DOM이면 버벅임)
  const VISIBLE_LIMIT = 200;
  const visible = filtered.slice(0, VISIBLE_LIMIT);
  const hiddenCount = filtered.length - visible.length;

  // 호기별 분포
  const byMachine = useMemo(() => {
    const m = {};
    for (const a of (data.machineAssignments || [])) {
      if (!m[a.machine]) m[a.machine] = [];
      m[a.machine].push(inkOfAssignment(a));
    }
    return m;
  }, [data.machineAssignments]);

  const handleSaveEdit = (target) => {
    // target 은 data.machineAssignments 의 실제 객체(필터는 참조 보존). 위치 인덱스 대신
    // 객체로 찾아 검색/필터가 바뀌어도 엉뚱한 행을 덮어쓰지 않게 한다.
    const newData = { ...data };
    newData.machineAssignments = [...newData.machineAssignments];
    const realIdx = newData.machineAssignments.indexOf(target);
    if (realIdx < 0) { setEditingIdx(null); return; }
    newData.machineAssignments[realIdx] = { ...target, machine: editValue };
    setData(newData);
    setEditingIdx(null);
    notify('호기 배정이 변경되었습니다');
  };

  const handleDelete = (a) => {
    const newData = { ...data };
    newData.machineAssignments = newData.machineAssignments.filter(x => x !== a);
    setData(newData);
    notify('잉크가 삭제되었습니다');
  };

  // 잉크 마스터에 등록 (machineAssignments + inkPlan). 품목코드 필수.
  const registerInk = ({ code, name, machine }) => {
    if (!code || !name) return false;
    const newData = { ...data };
    newData.machineAssignments = [
      { ink: name, machine: machine || '', code },
      ...(newData.machineAssignments || []),
    ];
    if (!(data.inkPlan || []).some(i => DataService.normalizeInkName(i.name) === DataService.normalizeInkName(name))) {
      const blank = Object.fromEntries(WEEKDAYS.map(d => [d, {
        '현재고': null, '가용일수': null, '필요수량': d === '월' ? null : undefined, '제조량': null,
      }]));
      newData.inkPlan = [{ name, days: blank }, ...(newData.inkPlan || [])];
    }
    setData(newData);
    return true;
  };

  const handleQuickAdd = () => {
    const code = quickAdd.code.trim();
    const name = quickAdd.name.trim();
    if (!name) return;
    if (!code) { notify('품목코드를 입력해야 등록할 수 있어'); return; }
    if (isDuplicateCode(code)) { notify(`품목코드 '${code}'는 이미 등록되어 있어`); return; }
    if (isDuplicateInk(name)) {
      notify(`'${name}' 잉크는 이미 등록되어 있어`);
      return;
    }
    registerInk({ code, name, machine: quickAdd.machine.trim() });
    notify(`'${name}' 잉크 추가됨`);
    setQuickAdd({ code: '', name: '', machine: '' });
  };

  const handleAdd = () => {
    const code = newRow.code.trim();
    const name = newRow.name.trim();
    if (!name) return;
    if (!code) { notify('품목코드를 입력해야 저장할 수 있어'); return; }
    if (isDuplicateCode(code)) { notify(`품목코드 '${code}'는 이미 등록되어 있어`); return; }
    if (isDuplicateInk(name)) {
      notify(`'${name}' 잉크는 이미 등록되어 있어`);
      return;
    }
    registerInk({ code, name, machine: newRow.machine.trim() });
    setAddOpen(false);
    setNewRow({ code: '', name: '', machine: '' });
    notify('잉크가 추가되었습니다');
  };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">잉크 추가 및 관리</div>
            <div className="page__meta-chips">
              <span className="page__meta-chip">전체 <strong>{(data.machineAssignments || []).length}</strong>개 잉크</span>
              <span className="page__meta-chip">호기 <strong>{machineList.length}</strong>대</span>
              {(() => {
                const noCode = (data.machineAssignments || []).filter(a => !a.code).length;
                return noCode > 0 ? (
                  <span className="page__meta-chip page__meta-chip--warn" title="품목코드가 비어있는 잉크 — 발주·집계에서 제외됩니다">코드 미입력 <strong>{noCode}</strong></span>
                ) : null;
              })()}
            </div>
          </div>
          <div className="page__actions">
            <button className="btn"><Icon name="download" /> 내보내기</button>
            <button className="btn btn--primary" onClick={() => setAddOpen(true)}><Icon name="plus" size={12} /> 상세 등록</button>
          </div>
        </div>
      </div>

      <div className="page__body">
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <Card flush>
            <div className="toolbar">
              <input className="input input--search" placeholder="잉크 또는 호기 검색" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 200 }} />
              <select className="input select" value={machineFilter} onChange={e => setMachineFilter(e.target.value)}>
                <option value="all">전체 호기</option>
                {machineList.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <div className="spacer" />
              <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>{filtered.length}건 / 전체 {(data.machineAssignments || []).length}</span>
            </div>
            <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 280px)' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th style={{ width: 110 }}>품목코드</th>
                    <th>잉크명</th>
                    <th style={{ width: 140 }}>사용 호기</th>
                    <th style={{ width: 100, textAlign: 'right' }}>액션</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Quick add row */}
                  <tr style={{ background: 'var(--brand-50)' }}>
                    <td className="row-num" style={{ background: 'var(--brand-50)' }}>+</td>
                    <td>
                      <input
                        className="input"
                        placeholder="품목코드*"
                        value={quickAdd.code}
                        onChange={e => setQuickAdd({ ...quickAdd, code: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }}
                        style={{
                          width: '100%',
                          fontFamily: 'JetBrains Mono, monospace',
                          borderColor: (quickAdd.name.trim() && !quickAdd.code.trim()) || (quickAdd.code.trim() && isDuplicateCode(quickAdd.code)) ? 'var(--bad-500)' : undefined,
                        }}
                      />
                      {quickAdd.code.trim() && isDuplicateCode(quickAdd.code) && (
                        <div style={{ fontSize: 10, color: 'var(--bad-600)', marginTop: 2 }}>이미 쓰는 코드</div>
                      )}
                    </td>
                    <td>
                      <input
                        className="input"
                        placeholder="신규 잉크명*"
                        value={quickAdd.name}
                        onChange={e => setQuickAdd({ ...quickAdd, name: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }}
                        style={{
                          width: '100%',
                          borderColor: quickAdd.name && isDuplicateInk(quickAdd.name) ? 'var(--bad-500)' : undefined,
                        }}
                      />
                      {quickAdd.name && isDuplicateInk(quickAdd.name) && (
                        <div style={{ fontSize: 10, color: 'var(--bad-600)', marginTop: 2 }}>이미 등록된 잉크</div>
                      )}
                    </td>
                    <td>
                      <input
                        className="input"
                        placeholder="호기 (예: 3호기)"
                        list="machine-list"
                        value={quickAdd.machine}
                        onChange={e => setQuickAdd({ ...quickAdd, machine: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }}
                        style={{ width: '100%' }}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn btn--primary btn--sm"
                        onClick={handleQuickAdd}
                        disabled={!quickAdd.name.trim() || !quickAdd.code.trim() || isDuplicateInk(quickAdd.name) || isDuplicateCode(quickAdd.code)}
                      >
                        <Icon name="plus" size={11} /> 추가
                      </button>
                    </td>
                  </tr>
                  {visible.map((a, idx) => {
                    const inkName = inkOfAssignment(a);
                    return (
                      <tr key={inkName + (a.machine || '') + idx}>
                        <td className="row-num">{idx + 1}</td>
                        <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: a.code ? 'var(--ink-700)' : 'var(--bad-500)' }}>
                          {a.code || '미입력'}
                        </td>
                        <td style={{ fontWeight: 500 }}>{inkName}</td>
                        <td>
                          {editingIdx === a ? (
                            <input
                              className="input" autoFocus
                              list="machine-list"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => handleSaveEdit(a)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(a); if (e.key === 'Escape') setEditingIdx(null); }}
                              style={{ width: 120 }}
                            />
                          ) : (
                            <span className="tag" style={{ background: 'var(--brand-50)', color: 'var(--brand-700)', cursor: 'pointer' }} onClick={() => { setEditingIdx(a); setEditValue(a.machine || ''); }}>
                              {a.machine || <span style={{ color: 'var(--ink-400)' }}>호기 미지정</span>}
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="row-act" onClick={() => { setEditingIdx(a); setEditValue(a.machine || ''); }}>수정</button>
                          <button className="row-act row-act--danger" style={{ marginLeft: 4 }} onClick={() => handleDelete(a)}>삭제</button>
                        </td>
                      </tr>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <tr><td colSpan="100" style={{ textAlign: 'center', padding: '12px', color: 'var(--ink-500)', fontSize: 12, background: 'var(--ink-50)' }}>
                      위 {VISIBLE_LIMIT}개만 표시 중 · <strong>{hiddenCount}개 더 있음</strong> — 검색으로 좁혀보세요
                    </td></tr>
                  )}
                  {filtered.length === 0 && (
                    <tr><td colSpan="100">
                      <div className="empty-state">
                        <div className="empty-state__title">
                          {search || machineFilter !== 'all' ? '조건에 맞는 잉크 없음' : '등록된 잉크 없음'}
                        </div>
                        <div className="empty-state__hint">표 맨 위 행에서 품목코드·잉크명·호기를 입력해 추가하세요.</div>
                      </div>
                    </td></tr>
                  )}
                </tbody>
              </table>
              <datalist id="machine-list">{machineList.map(m => <option key={m} value={m} />)}</datalist>
            </div>
            <div className="tbl-footnote">
              <span>호기 태그를 클릭하면 바로 변경 · 신규 등록 시 잉크 생산계획에도 자동 추가</span>
            </div>
          </Card>

          <Card title="호기별 잉크 분포">
            <div style={{ maxHeight: 'calc(100vh - 290px)', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(byMachine)
                .sort((a, b) => b[1].length - a[1].length)
                .slice(0, 30)
                .map(([machine, inks]) => (
                  <div key={machine} style={{ padding: '8px 10px', border: '1px solid var(--ink-200)', borderRadius: 'var(--radius-sm)', background: 'var(--ink-50)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <strong style={{ fontSize: 12, color: 'var(--brand-700)' }}>{machine || '미지정'}</strong>
                      <span className="badge-count">{inks.length}종</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-600)', lineHeight: 1.5, wordBreak: 'break-word' }}>
                      {inks.slice(0, 8).join(' · ')}
                      {inks.length > 8 && <span style={{ color: 'var(--ink-500)' }}> 외 {inks.length - 8}개</span>}
                    </div>
                  </div>
                ))}
            </div>
          </Card>
        </div>

        {addOpen && (
          <Modal
            title="신규 잉크 등록"
            onClose={() => setAddOpen(false)}
            footer={
              <>
                <button className="btn" onClick={() => setAddOpen(false)}>취소</button>
                <button
                  className="btn btn--primary"
                  onClick={handleAdd}
                  disabled={!newRow.name.trim() || !newRow.code.trim() || isDuplicateInk(newRow.name) || isDuplicateCode(newRow.code)}
                ><Icon name="save" size={12} /> 저장</button>
              </>
            }
          >
            <div className="field">
              <label className="field__label">품목코드<span className="req">*</span></label>
              <input
                className="input"
                value={newRow.code}
                onChange={e => setNewRow({ ...newRow, code: e.target.value })}
                placeholder="예: BC1499"
                autoFocus
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  borderColor: newRow.code.trim() && isDuplicateCode(newRow.code) ? 'var(--bad-500)' : undefined,
                }}
              />
              {!newRow.code.trim() && (
                <div className="field__hint" style={{ color: 'var(--bad-600)' }}>품목코드는 필수입니다.</div>
              )}
              {newRow.code.trim() && isDuplicateCode(newRow.code) && (
                <div className="field__hint" style={{ color: 'var(--bad-600)' }}>이미 등록된 품목코드 — 다른 코드를 사용해.</div>
              )}
            </div>
            <div className="row-2">
              <div className="field">
                <label className="field__label">잉크명<span className="req">*</span></label>
                <input
                  className="input"
                  value={newRow.name}
                  onChange={e => setNewRow({ ...newRow, name: e.target.value })}
                  placeholder="신규 잉크명"
                  style={{ borderColor: newRow.name && isDuplicateInk(newRow.name) ? 'var(--bad-500)' : undefined }}
                />
                {newRow.name && isDuplicateInk(newRow.name) && (
                  <div className="field__hint" style={{ color: 'var(--bad-600)' }}>이미 등록된 잉크 — 다른 이름을 사용해.</div>
                )}
              </div>
              <div className="field">
                <label className="field__label">사용 호기</label>
                <input className="input" list="machine-list-m" value={newRow.machine} onChange={e => setNewRow({ ...newRow, machine: e.target.value })} placeholder="예: 3호기, 야간1호기" />
                <datalist id="machine-list-m">{machineList.map(m => <option key={m} value={m} />)}</datalist>
                <div className="field__hint">비워두면 호기 미지정 잉크로 등록됨.</div>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}

window.MachinesPage = MachinesPage;
