// 양산대응 잉크 (테스트 중) — separate management page

function TestInksPage({ ctx }) {
  const { data, setData, notify } = ctx;
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [quickAdd, setQuickAdd] = useState({ name: '', brand: '', targetProduct: '', status: '내부검증', note: '' });
  // cascade picker open context: null | 'quick' | 'edit'
  const [pickerOpen, setPickerOpen] = useState(null);

  const STATUS_OPTS = ['내부검증', '시양산', '양산대응'];
  // dayFromDate는 ui.jsx의 헬퍼 사용 — fallback '월' 으로 양산대응 시작 요일 기본 처리
  const statusTone = (s) => s === '양산대응' ? 'ok' : s === '시양산' ? 'warn' : 'info';

  const list = data.testInks || [];

  const filtered = useMemo(() => {
    let l = list;
    if (search) {
      const q = search.toLowerCase();
      l = l.filter(t => t.name.toLowerCase().includes(q) || (t.targetProduct || '').toLowerCase().includes(q) || (t.brand || '').toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') l = l.filter(t => t.status === statusFilter);
    return l;
  }, [list, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { 내부검증: 0, 시양산: 0, 양산대응: 0 };
    for (const t of list) if (c[t.status] !== undefined) c[t.status]++;
    return c;
  }, [list]);

  const updateData = (testInks) => setData({ ...data, testInks });

  const handleQuickAdd = () => {
    if (!quickAdd.name) return;
    const today = localDateISO();
    updateData([{ ...quickAdd, addedDate: today }, ...list]);
    setQuickAdd({ name: '', brand: '', targetProduct: '', status: '내부검증', note: '' });
    notify(`'${quickAdd.name}' 테스트 잉크 추가됨`);
  };

  const handleSave = (t) => {
    const idx = list.indexOf(editing);
    const next = [...list];
    next[idx] = t;
    updateData(next);
    setEditing(null);
    notify('수정 완료');
  };

  const handleDelete = (t) => {
    updateData(list.filter(x => x !== t));
    setConfirmDelete(null);
    notify('삭제됨');
  };

  const handlePromote = (t) => {
    // Promote to regular ink production plan
    const newData = { ...data };
    newData.testInks = list.filter(x => x !== t);
    const blank = Object.fromEntries(['월','화','수','목','금','토','일'].map(d => [d, { 현재고: 0, 가용일수: null, 필요수량: d === '월' ? 0 : undefined, 제조량: null, 호기: null }]));
    newData.inkPlan = [{ name: t.name, days: blank }, ...newData.inkPlan];
    setData(newData);
    notify(`'${t.name}' 정식 잉크로 승격되었습니다`);
  };

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">양산대응 잉크 (테스트 중)</div>
            <div className="page__meta">시양산·내부검증 중인 잉크를 별도 관리 · 생산계획에는 <strong>테스트 중</strong>으로만 표시되며 수량 기입 불가</div>
          </div>
          <div className="page__actions">
            <button className="btn"><Icon name="download" /> 내보내기</button>
          </div>
        </div>
      </div>

      <div className="page__body">
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div className="kpi" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__label">전체 테스트 잉크</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{list.length}<span className="kpi__unit">종</span></div>
          </div>
          <div className="kpi kpi--ok" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__accent" />
            <div className="kpi__label">양산대응</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{counts.양산대응}</div>
          </div>
          <div className="kpi kpi--warn" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__accent" />
            <div className="kpi__label">시양산</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{counts.시양산}</div>
          </div>
          <div className="kpi" style={{ flex: 1, padding: '10px 14px' }}>
            <div className="kpi__label">내부검증</div>
            <div className="kpi__value" style={{ fontSize: 20 }}>{counts.내부검증}</div>
          </div>
        </div>

        <Card flush>
          <div className="toolbar">
            <input className="input input--search" placeholder="잉크명 · 대상 제품 · 브랜드 검색" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 240 }} />
            <Seg
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: '전체' },
                { value: '내부검증', label: '내부검증' },
                { value: '시양산', label: '시양산' },
                { value: '양산대응', label: '양산대응' },
              ]}
            />
            <div className="spacer" />
            <span style={{ fontSize: 11, color: 'var(--ink-500)' }}>{filtered.length}건</span>
          </div>

          <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 380px)' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="sticky-col" style={{ width: 160 }}>잉크명</th>
                  <th>브랜드</th>
                  <th>대상 제품</th>
                  <th style={{ width: 110 }}>단계</th>
                  <th>메모</th>
                  <th style={{ width: 160 }} title="양산대응이 시작된 날짜. 요일은 이 날짜에서 자동 계산됨.">등록일 (시작일)</th>
                  <th style={{ width: 160, textAlign: 'right' }}>액션</th>
                </tr>
              </thead>
              <tbody>
                {/* Quick add row */}
                <tr style={{ background: 'var(--brand-50)' }}>
                  <td className="sticky-col" style={{ background: 'var(--brand-50)' }}>
                    <input className="input" placeholder="신규 잉크명*" value={quickAdd.name} onChange={e => setQuickAdd({ ...quickAdd, name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }} style={{ width: '100%' }} />
                  </td>
                  <td>
                    {quickAdd.brand ? (
                      <span className="tag" style={{ background: 'var(--brand-50)', color: 'var(--brand-700)', cursor: 'pointer' }} onClick={() => setPickerOpen('quick')} title="브랜드/제품 변경">
                        {quickAdd.brand}
                      </span>
                    ) : (
                      <button className="btn btn--sm btn--ghost" onClick={() => setPickerOpen('quick')} style={{ width: '100%' }}>
                        <Icon name="search" size={11} /> 브랜드 선택
                      </button>
                    )}
                  </td>
                  <td>
                    {quickAdd.targetProduct ? (
                      <span style={{ fontWeight: 500, color: 'var(--ink-800)', cursor: 'pointer' }} onClick={() => setPickerOpen('quick')} title="제품 변경">
                        {quickAdd.targetProduct}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--ink-400)', fontSize: 11 }}>(브랜드 먼저)</span>
                    )}
                  </td>
                  <td>
                    <select className="input select" value={quickAdd.status} onChange={e => setQuickAdd({ ...quickAdd, status: e.target.value })} style={{ width: '100%' }}>
                      {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <input className="input" placeholder="메모" value={quickAdd.note} onChange={e => setQuickAdd({ ...quickAdd, note: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') handleQuickAdd(); }} style={{ width: '100%' }} />
                  </td>
                  <td style={{ color: 'var(--ink-500)', fontSize: 11 }}>오늘 ({dayFromDate(new Date().toISOString().slice(0,10))})</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn--primary btn--sm" onClick={handleQuickAdd} disabled={!quickAdd.name}><Icon name="plus" size={11} /> 추가</button>
                  </td>
                </tr>
                {filtered.map((t, idx) => {
                  // name 기반 findIndex로 stale reference 회피
                  const updateField = (key, value) => {
                    const cur = data.testInks || [];
                    const realIdx = cur.findIndex(x => x.name === t.name);
                    if (realIdx < 0) return;
                    const next = [...cur];
                    next[realIdx] = { ...cur[realIdx], [key]: value };
                    updateData(next);
                  };
                  const startDay = dayFromDate(t.addedDate);
                  return (
                  <tr key={t.name + idx}>
                    <td className="sticky-col" style={{ fontWeight: 600 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Icon name="flask" size={12} />{t.name}
                      </span>
                    </td>
                    <td><span className="tag">{t.brand || '—'}</span></td>
                    <td style={{ color: 'var(--brand-700)' }}>{t.targetProduct || '—'}</td>
                    <td><Pill tone={statusTone(t.status)} dot>{t.status}</Pill></td>
                    <td style={{ color: 'var(--ink-600)', fontSize: 11.5 }}>{t.note || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="date"
                          className="input"
                          value={t.addedDate || ''}
                          onChange={e => updateField('addedDate', e.target.value)}
                          style={{ height: 26, padding: '0 6px', fontSize: 11, flex: 1 }}
                        />
                        {startDay && (
                          <Pill tone="info">{startDay}</Pill>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn--sm btn--ghost" onClick={() => handlePromote(t)} title="정식 잉크로 승격">
                        <Icon name="check" size={11} /> 승격
                      </button>
                      <button className="btn btn--sm btn--ghost" onClick={() => setEditing(t)}><Icon name="edit" size={11} /></button>
                      <button className="btn btn--sm btn--ghost btn--danger" onClick={() => setConfirmDelete(t)}><Icon name="trash" size={11} /></button>
                    </td>
                  </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan="100" className="muted" style={{ textAlign: 'center', padding: 40 }}>등록된 테스트 잉크가 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--info-100)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--info-600)', fontSize: 12, color: 'var(--ink-700)' }}>
          <strong>안내</strong> · 여기 등록된 잉크는 <strong>잉크 생산계획</strong>에서 <em>테스트 중</em>으로 잠긴 행으로 표시됩니다. 수량 기입은 불가하나 "이 잉크가 사용됨"은 인지할 수 있습니다. 양산이 확정되면 <strong>승격</strong> 버튼으로 정식 잉크 계획에 추가하세요.
        </div>

        {editing && (
          <Modal
            title="테스트 잉크 수정"
            onClose={() => setEditing(null)}
            footer={
              <>
                <button className="btn" onClick={() => setEditing(null)}>취소</button>
                <button className="btn btn--primary" onClick={() => handleSave(editing)}><Icon name="save" size={12} /> 저장</button>
              </>
            }
          >
            <div className="row-2">
              <div className="field">
                <label className="field__label">잉크명<span className="req">*</span></label>
                <input className="input" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="field">
                <label className="field__label">단계</label>
                <select className="input select" value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value })}>
                  {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label className="field__label">브랜드 / 대상 제품</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  {editing.brand || editing.targetProduct ? (
                    <>
                      <span className="tag" style={{ background: 'var(--brand-50)', color: 'var(--brand-700)' }}>
                        {editing.brand || '브랜드 미지정'}
                      </span>
                      <span style={{ color: 'var(--ink-400)' }}>/</span>
                      <span style={{ fontWeight: 500 }}>{editing.targetProduct || '제품 미지정'}</span>
                      <button className="btn btn--sm btn--ghost" onClick={() => setPickerOpen('edit')} style={{ marginLeft: 'auto' }}>
                        <Icon name="edit" size={11} /> 변경
                      </button>
                    </>
                  ) : (
                    <button className="btn btn--sm" onClick={() => setPickerOpen('edit')}>
                      <Icon name="search" size={11} /> 브랜드/제품 선택
                    </button>
                  )}
                </div>
                <div className="field__hint">마스터에서 브랜드 → 제품으로 좁혀서 선택. 둘 다 동시에 채워져.</div>
              </div>
            </div>
            <div className="field">
              <label className="field__label">등록일 (= 양산대응 시작일)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="date" className="input" value={editing.addedDate || ''} onChange={e => setEditing({ ...editing, addedDate: e.target.value })} />
                {editing.addedDate && (
                  <Pill tone="info">{dayFromDate(editing.addedDate)}요일</Pill>
                )}
              </div>
              <div className="field__hint">이 날짜의 요일 이전 셀은 양산 데이터 유지, 이 날짜 요일부터 잠금. 요일은 등록일에서 자동 계산.</div>
            </div>
            <div className="field">
              <label className="field__label">메모</label>
              <input className="input" style={{ width: '100%' }} value={editing.note || ''} onChange={e => setEditing({ ...editing, note: e.target.value })} />
            </div>
          </Modal>
        )}

        {pickerOpen && (
          <Modal
            title={`${pickerOpen === 'quick' ? '신규 양산대응 — ' : '수정 — '}브랜드/제품 선택`}
            onClose={() => setPickerOpen(null)}
            footer={<button className="btn" onClick={() => setPickerOpen(null)}>닫기</button>}
          >
            <CascadePicker
              products={data.products}
              mode="product"
              currentValue={pickerOpen === 'quick' ? quickAdd.targetProduct : editing?.targetProduct}
              initialBrand={pickerOpen === 'quick' ? quickAdd.brand : (editing?.brand || '')}
              onSelect={(productName) => {
                const p = data.products.find(x => x.name === productName);
                const brand = p?.brand || '';
                if (pickerOpen === 'quick') {
                  setQuickAdd({ ...quickAdd, brand, targetProduct: productName });
                } else if (editing) {
                  setEditing({ ...editing, brand, targetProduct: productName });
                }
                setPickerOpen(null);
              }}
            />
          </Modal>
        )}

        {confirmDelete && (
          <Modal title="테스트 잉크 삭제" onClose={() => setConfirmDelete(null)} footer={
            <>
              <button className="btn" onClick={() => setConfirmDelete(null)}>취소</button>
              <button className="btn btn--danger" onClick={() => handleDelete(confirmDelete)}><Icon name="trash" size={12} /> 삭제</button>
            </>
          }>
            <p style={{ fontSize: 13 }}><strong>{confirmDelete.name}</strong> 테스트 잉크를 삭제하시겠습니까?</p>
          </Modal>
        )}
      </div>
    </div>
  );
}

window.TestInksPage = TestInksPage;
