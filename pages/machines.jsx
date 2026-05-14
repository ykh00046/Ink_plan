// 잉크 추가 페이지 — 잉크 → 호기 매핑 마스터
// (원래는 '호기 배정'이었으나, 데이터가 사실 '잉크→호기'라서 명칭 정정)

function MachinesPage({ ctx }) {
  const { data, setData, notify } = ctx;
  const [search, setSearch] = useState('');
  const [machineFilter, setMachineFilter] = useState('all');
  const [editingIdx, setEditingIdx] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [newRow, setNewRow] = useState({ name: '', machine: '' });
  const [quickAdd, setQuickAdd] = useState({ name: '', machine: '' });

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
      if (i.name) s.add(i.name.trim().toLowerCase());
    }
    for (const a of (data.machineAssignments || [])) {
      const n = inkOfAssignment(a);
      if (n) s.add(n.trim().toLowerCase());
    }
    return s;
  }, [data.inkPlan, data.machineAssignments]);

  const isDuplicateInk = (name) => {
    const norm = name.trim().toLowerCase();
    return norm && existingInkNamesNorm.has(norm);
  };

  const filtered = useMemo(() => {
    let list = data.machineAssignments || [];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        inkOfAssignment(a).toLowerCase().includes(q)
        || (a.machine || '').toLowerCase().includes(q)
      );
    }
    if (machineFilter !== 'all') list = list.filter(a => a.machine === machineFilter);
    return list;
  }, [data.machineAssignments, search, machineFilter]);

  // 호기별 분포
  const byMachine = useMemo(() => {
    const m = {};
    for (const a of (data.machineAssignments || [])) {
      if (!m[a.machine]) m[a.machine] = [];
      m[a.machine].push(inkOfAssignment(a));
    }
    return m;
  }, [data.machineAssignments]);

  const handleSaveEdit = (idx) => {
    const newData = { ...data };
    newData.machineAssignments = [...newData.machineAssignments];
    const target = filtered[idx];
    const realIdx = newData.machineAssignments.indexOf(target);
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

  const handleQuickAdd = () => {
    const name = quickAdd.name.trim();
    if (!name) return;
    if (isDuplicateInk(name)) {
      notify(`'${name}' 잉크는 이미 등록되어 있어`);
      return;
    }
    const newData = { ...data };
    newData.machineAssignments = [
      { ink: name, machine: quickAdd.machine.trim() },
      ...(newData.machineAssignments || []),
    ];
    // 잉크 마스터에도 등록 (inkPlan에 없으면 빈 days로 추가)
    if (!(data.inkPlan || []).some(i => i.name?.trim().toLowerCase() === name.toLowerCase())) {
      const blank = Object.fromEntries(['월','화','수','목','금','토','일'].map(d => [d, {
        '현재고': null, '가용일수': null, '필요수량': d === '월' ? null : undefined, '제조량': null,
      }]));
      newData.inkPlan = [{ name, days: blank }, ...(newData.inkPlan || [])];
    }
    setData(newData);
    notify(`'${name}' 잉크 추가됨`);
    setQuickAdd({ name: '', machine: '' });
  };

  const handleAdd = () => {
    const name = newRow.name.trim();
    if (!name) return;
    if (isDuplicateInk(name)) {
      notify(`'${name}' 잉크는 이미 등록되어 있어`);
      return;
    }
    const newData = { ...data };
    newData.machineAssignments = [{ ink: name, machine: newRow.machine.trim() }, ...(newData.machineAssignments || [])];
    if (!(data.inkPlan || []).some(i => i.name?.trim().toLowerCase() === name.toLowerCase())) {
      const blank = Object.fromEntries(['월','화','수','목','금','토','일'].map(d => [d, {
        '현재고': null, '가용일수': null, '필요수량': d === '월' ? null : undefined, '제조량': null,
      }]));
      newData.inkPlan = [{ name, days: blank }, ...(newData.inkPlan || [])];
    }
    setData(newData);
    setAddOpen(false);
    setNewRow({ name: '', machine: '' });
    notify('잉크가 추가되었습니다');
  };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">잉크 추가</div>
            <div className="page__meta">잉크 마스터 · 사용 호기 매핑</div>
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
                        disabled={!quickAdd.name.trim() || isDuplicateInk(quickAdd.name)}
                      >
                        <Icon name="plus" size={11} /> 추가
                      </button>
                    </td>
                  </tr>
                  {filtered.map((a, idx) => {
                    const inkName = inkOfAssignment(a);
                    return (
                      <tr key={inkName + (a.machine || '') + idx}>
                        <td className="row-num">{idx + 1}</td>
                        <td style={{ fontWeight: 500 }}>{inkName}</td>
                        <td>
                          {editingIdx === idx ? (
                            <input
                              className="input" autoFocus
                              list="machine-list"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => handleSaveEdit(idx)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(idx); if (e.key === 'Escape') setEditingIdx(null); }}
                              style={{ width: 120 }}
                            />
                          ) : (
                            <span className="tag" style={{ background: 'var(--brand-50)', color: 'var(--brand-700)', cursor: 'pointer' }} onClick={() => { setEditingIdx(idx); setEditValue(a.machine || ''); }}>
                              {a.machine || <span style={{ color: 'var(--ink-400)' }}>호기 미지정</span>}
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn--sm btn--ghost" onClick={() => { setEditingIdx(idx); setEditValue(a.machine || ''); }}><Icon name="edit" size={11} /></button>
                          <button className="btn btn--sm btn--ghost btn--danger" onClick={() => handleDelete(a)}><Icon name="trash" size={11} /></button>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && <tr><td colSpan="100" className="muted" style={{ textAlign: 'center', padding: 40 }}>잉크가 없습니다</td></tr>}
                </tbody>
              </table>
              <datalist id="machine-list">{machineList.map(m => <option key={m} value={m} />)}</datalist>
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
                      <span className="tag">{inks.length}종</span>
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
                  disabled={!newRow.name.trim() || isDuplicateInk(newRow.name)}
                ><Icon name="save" size={12} /> 저장</button>
              </>
            }
          >
            <div className="row-2">
              <div className="field">
                <label className="field__label">잉크명<span className="req">*</span></label>
                <input
                  className="input"
                  value={newRow.name}
                  onChange={e => setNewRow({ ...newRow, name: e.target.value })}
                  placeholder="신규 잉크명"
                  autoFocus
                  style={{ borderColor: newRow.name && isDuplicateInk(newRow.name) ? 'var(--bad-500)' : undefined }}
                />
                {newRow.name && isDuplicateInk(newRow.name) && (
                  <div className="field__hint" style={{ color: 'var(--bad-600)' }}>이미 등록된 잉크 — 다른 이름을 사용해.</div>
                )}
                {!newRow.name && (
                  <div className="field__hint">새 잉크명을 입력. 기존 잉크에 호기만 바꾸려면 위 표에서 직접 수정.</div>
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
