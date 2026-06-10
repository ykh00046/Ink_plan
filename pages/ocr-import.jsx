// INK 요청서 OCR 입력 페이지
// 이미지 업로드 → Gemini 2.5 Flash (structured output) → 파싱 결과 표시
// 매칭/머지는 다음 라운드에서.

const GEMINI_ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const OCR_SYSTEM_PROMPT = `당신은 콘택트렌즈 잉크 생산 문서 전문 OCR 파서입니다.
이미지는 'INK 요청서'(상단 표)와 '약품요청서'(하단 표)로 구성됩니다.

## INK 요청서 표 구조 (중요)
표는 좌→우로 다음과 같이 구성됩니다:
- (A) 층 그룹: 3F / 1F (행 묶음 라벨)
- (B) 호기 컬럼: 10~59 정수
- (C) 시프트 컬럼 3개를 **가로로 나란히** 가짐:
    1) 요청일 주간   (헤더에 표시된 첫 번째 날짜 D)
    2) 요청일 야간   (헤더에 표시된 첫 번째 날짜 D)
    3) 명일 주간     (헤더에 표시된 두 번째 날짜 D+1)
- 각 시프트 컬럼은 (구분=brand) 와 (제품명) 두 개의 sub-column으로 다시 나뉩니다 (총 6개 셀).

## 출력 규칙 (반드시 지킬 것)
1. \`shifts\` 배열은 **정확히 3개 요소**: shift='주간', shift='야간', shift='명일주간' (이 순서).
2. 각 시프트의 \`rows\`는 그 시프트 컬럼에 보이는 모든 호기 행을 담는다. **세 시프트 모두 같은 호기 목록을 가져야** 한다 (한 시프트만 채우고 다른 두 시프트를 비우는 일은 금지). 같은 호기의 주야명 값이 동일하더라도 세 row 모두 출력하라.
3. 호기 번호는 행 좌측 호기 열에서 추출(정수). 층(3F/1F)도 함께.
4. 구분(brand)·제품명은 **시프트 컬럼별로 따로** 추출.
   - 같은 호기여도 시프트마다 다를 수 있다 (예: 호기 50: 주간=From/Clear Beige, 야간=Bella/BELLA_Ocean Blue).
   - 한 시프트의 brand·제품명을 다른 시프트의 셀로 절대 전파하지 마.
   - 통합셀(merged)이 표시되어 있어도 그 셀이 실제 차지하는 sub-column 안에서만 적용. 시프트 컬럼 경계를 절대 넘지 마.
   - brand 셀이 진짜 비어 있으면 \`brand=""\` 로 둘 것 (이전 row의 brand 복제 금지).
5. brand 핵심 키워드 후보: IRIS, PIA, PIA_M, BELLA, ALCON, SOLEKO, From, Bella, TEST 등.
6. variant는 "/액상" 또는 "_M" 같은 하위 구분. 없으면 빈 문자열.
7. 제품명은 원본 그대로(특수문자·숫자·%·_·공백 포함).
8. 행 전체가 TEST(brand=TEST 이고 제품명=TEST)인 호기는 그 시프트의 row에도 \`brand="TEST", product_name="TEST"\` 그대로 기록. 누락 금지.
9. **빈 셀 처리**: brand·제품명 모두 비어있는 시프트 셀은 그 시프트의 row만 생략 가능. 단 같은 호기의 다른 시프트가 채워져 있으면 그 시프트는 반드시 출력.
10. \`request_date\` = 헤더 첫째 날짜(YYYY-MM-DD), \`next_date\` = 헤더 둘째 날짜(YYYY-MM-DD). 둘 다 필수.

## 약품요청서 파싱 규칙
1. 하단 작은 표에서 약품명 코드, 농도(구분), 3F/1F 대수를 추출.
2. 대수가 비어있으면 null.
3. "N-TOP"의 "추가 필요량" 칸도 그대로 추출.

## 날짜 형식
- "2026년 05월 12일 (화)" → "2026-05-12"
- 헤더에 표시된 요청일을 request_date로 기록.`;

const OCR_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    request_date: { type: 'string', description: '요청일 YYYY-MM-DD (헤더 첫째 날짜)' },
    next_date: { type: 'string', description: '명일 YYYY-MM-DD (헤더 둘째 날짜) — 반드시 채울 것' },
    shifts: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      description: '정확히 3개 요소: 주간/야간/명일주간 순서. 각 시프트의 rows에는 그 시프트 컬럼에 보이는 모든 호기 행을 담아라.',
      items: {
        type: 'object',
        properties: {
          shift: { type: 'string', enum: ['주간', '야간', '명일주간'] },
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                machine_no: { type: 'integer' },
                floor: { type: 'string', description: '3F 또는 1F. 모르면 빈 문자열' },
                brand: { type: 'string', description: '이 시프트 컬럼의 brand. 다른 시프트의 brand로 채우지 마.' },
                variant: { type: 'string', description: '액상/M 등. 없으면 빈 문자열' },
                product_name: { type: 'string' },
              },
              required: ['machine_no', 'brand', 'product_name'],
            },
          },
        },
        required: ['shift', 'rows'],
      },
    },
    chemicals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          grade: { type: 'string' },
          qty_3f: { type: 'number', nullable: true },
          qty_1f: { type: 'number', nullable: true },
          note: { type: 'string' },
        },
        required: ['code'],
      },
    },
  },
  required: ['request_date', 'next_date', 'shifts'],
};

// 이미지를 캔버스로 다운스케일 + JPEG 압축 → 토큰 절약·전송시간 단축
async function compressImage(file, maxDim = 1600, quality = 0.85) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }

  const origW = img.naturalWidth, origH = img.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(origW, origH));
  const w = Math.round(origW * scale);
  const h = Math.round(origH * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  // 표·글자 보존: high-quality interpolation
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const comma = dataUrl.indexOf(',');
  const base64 = dataUrl.slice(comma + 1);
  // base64 길이 → 대략 바이트 수 (4 base64 chars = 3 bytes)
  const bytes = Math.round(base64.length * 0.75);
  return {
    base64,
    mime: 'image/jpeg',
    info: { origW, origH, w, h, bytes },
  };
}

// 작업장 어휘 grounding 텍스트 — 마스터·사출계획에서 파생(DataService 순수 함수).
// 같은 호기는 제품이 반복되는 도메인 특성을 이용해 브랜드/제품명 철자 수렴을 돕는다.
function buildGroundingText(data) {
  const { brands, machines } = DataService.buildOcrGroundingHints(data || {});
  if (!brands.length && !machines.length) return '';
  const lines = ['## 작업장 참고 어휘 (철자 수렴용 — 이미지 내용이 항상 우선)'];
  if (brands.length) lines.push(`알려진 브랜드: ${brands.join(', ')}`);
  if (machines.length) {
    lines.push('알려진 호기와 최근 배정 제품(같은 호기는 제품이 반복되는 경우가 많음):');
    for (const m of machines) {
      if (m.products.length) lines.push(`- ${m.floor} ${m.no}호기: ${m.products.join(' | ')}`);
    }
    lines.push(`전체 호기 번호: ${machines.map(m => m.no).join(', ')}`);
  }
  lines.push('주의: 위 목록은 글자가 흐릿할 때 표기를 수렴시키는 참고용일 뿐이다. 이미지에 보이는 값이 목록과 명백히 다르면 이미지를 그대로 따르고, 목록에 없는 새 브랜드·제품도 보이는 그대로 추출하라.');
  return lines.join('\n');
}

async function callGemini(apiKey, model, file, groundingText) {
  // 1) 이미지 압축 (1600px / JPEG 0.85)
  const t0 = performance.now();
  const compressed = await compressImage(file, 1600, 0.85);
  const compressMs = Math.round(performance.now() - t0);

  const parts = [
    { text: OCR_SYSTEM_PROMPT },
    ...(groundingText ? [{ text: groundingText }] : []),
    { inline_data: { mime_type: compressed.mime, data: compressed.base64 } },
    { text: '이 이미지를 파싱하여 구조화된 JSON으로 반환하세요.' },
  ];
  const body = {
    contents: [{ parts }],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: OCR_RESPONSE_SCHEMA,
      temperature: 0.1,
      // 2) thinking 끄기 (gemini-2.5-flash 계열 지원) — 표 OCR은 추론 거의 불필요
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  // 타임아웃 가드 — 무료 등급 혼잡/네트워크 스톨 시 무한 대기 방지 (90초)
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 90000);
  let res;
  try {
    res = await fetch(`${GEMINI_ENDPOINT_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`응답 지연(90초 초과) — Gemini 무료 등급이 혼잡한 시간대일 수 있어요. 잠시 후 재시도하거나, 설정에서 다른 모델로 바꿔보세요. (현재: ${model})`);
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.error?.message || JSON.stringify(j); } catch (e) { detail = await res.text(); }
    if (res.status === 429) {
      throw new Error(`한도 초과 (${model}): RPM 또는 RPD 한도에 걸렸어. 설정에서 더 큰 한도 모델(예: gemini-3.1-flash-lite)로 바꾸거나 잠시 후 재시도.\n\n원문: ${detail}`);
    }
    if (res.status === 503) {
      throw new Error(`모델 과부하 (${model}): Gemini 쪽이 혼잡합니다. 1~2분 후 재시도하거나 설정에서 다른 모델로 바꿔보세요.`);
    }
    throw new Error(`Gemini ${res.status}: ${detail}`);
  }

  const json = await res.json();
  const textPart = json.candidates?.[0]?.content?.parts?.find(p => p.text)?.text;
  if (!textPart) throw new Error('빈 응답: ' + JSON.stringify(json).slice(0, 200));

  let parsed;
  try { parsed = JSON.parse(textPart); }
  catch (e) { throw new Error('JSON 파싱 실패: ' + textPart.slice(0, 200)); }

  return {
    parsed,
    usage: json.usageMetadata,
    image: compressed.info,
    compressMs,
  };
}

function OcrImportPage({ ctx }) {
  const { apiKey, geminiModel, notify, setOcrResult, setView, data, saveSettings } = ctx;
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [status, setStatus] = useState('idle'); // idle | uploading | parsing | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [usage, setUsage] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef(null);

  // Cleanup blob URL
  useEffect(() => {
    if (!previewUrl) return undefined;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const pickFile = (f) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setError('이미지 파일만 업로드 가능합니다.');
      setStatus('error');
      return;
    }
    setFile(f);
    // 이전 blob URL 해제는 위 useEffect([previewUrl]) cleanup이 담당.
    // (paste 리스너가 []로 1회 등록되므로 여기서 previewUrl 을 직접 읽지 않음)
    setPreviewUrl(URL.createObjectURL(f));
    setResult(null);
    setError('');
    setStatus('idle');
  };

  // 파일을 data URL 문자열로 읽기 — blob URL과 달리 페이지 생명주기와 무관해
  // 검수 페이지로 안전하게 넘길 수 있다(revoke 관리 불필요).
  const fileToDataUrl = (f) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('파일 읽기 실패'));
    reader.readAsDataURL(f);
  });

  const onDrop = (e) => {
    e.preventDefault();
    pickFile(e.dataTransfer.files?.[0]);
  };

  const onPaste = (e) => {
    const item = Array.from(e.clipboardData?.items || []).find(it => it.type.startsWith('image/'));
    if (item) pickFile(item.getAsFile());
  };

  useEffect(() => {
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const run = async () => {
    if (!apiKey) {
      setError('우측 상단 [설정]에서 Gemini API 키를 먼저 입력하세요.');
      setStatus('error');
      return;
    }
    if (!file) return;
    setStatus('parsing');
    setError('');
    setResult(null);
    setElapsed(0);
    const t0 = performance.now();
    const tick = setInterval(() => setElapsed(Math.round((performance.now() - t0) / 100) / 10), 100);
    try {
      const { parsed, usage: u, image, compressMs } = await callGemini(apiKey, geminiModel, file, buildGroundingText(data));
      const totalMs = Math.round(performance.now() - t0);
      setResult(parsed);
      setUsage({ ...u, ms: totalMs, compressMs, image, model: geminiModel });
      setStatus('done');
      // 검수 페이지로 전달할 수 있도록 보존.
      // blob(previewUrl)은 이 페이지 언마운트 시 revoke되므로, 생명주기와
      // 무관한 data URL로 변환해 넘긴다(검수 페이지에서 원본 이미지 표시 가능).
      let sourceImageUrl = '';
      try { sourceImageUrl = await fileToDataUrl(file); }
      catch (e) { console.warn('원본 이미지 data URL 변환 실패:', e); }
      setOcrResult({
        parsed,
        sourceImageUrl,
        sourceFileName: file.name,
        parsedAt: new Date().toISOString(),
        model: geminiModel,
      });
      notify(`OCR 완료 (${(totalMs / 1000).toFixed(1)}s) — 검수 페이지로 이동`);
      // 자동으로 검수 페이지로 이동
      setView('review');
    } catch (e) {
      setError(String(e.message || e));
      setStatus('error');
    } finally {
      clearInterval(tick);
    }
  };

  const stats = useMemo(() => {
    if (!result) return null;
    const totalRows = (result.shifts || []).reduce((s, sh) => s + (sh.rows?.length || 0), 0);
    const machines = new Set();
    for (const sh of result.shifts || []) for (const r of sh.rows || []) machines.add(r.machine_no);
    return { totalRows, machines: machines.size, chemicals: result.chemicals?.length || 0 };
  }, [result]);

  return (
    <div className="page">
      <div className="page__head">
        <div className="page__title-row">
          <div>
            <div className="page__title">INK 요청서 입력</div>
            <div className="page__meta-chips">
              <span className={`page__meta-chip ${apiKey ? 'page__meta-chip--today' : 'page__meta-chip--warn'}`}>
                {apiKey ? '✓ API 연결됨' : '⚠ API 키 필요'}
              </span>
              {/* 설정 모달까지 안 가고 바로 모델 변경 — 변경 즉시 저장(설정과 동일 저장 경로) */}
              <select
                value={geminiModel || 'gemini-3.1-flash-lite'}
                onChange={e => {
                  saveSettings(apiKey || '', e.target.value);
                  notify(`모델 변경: ${e.target.value}`);
                }}
                title={(window.GEMINI_MODELS || []).find(g => g.value === geminiModel)?.meta || '파싱에 사용할 Gemini 모델'}
                style={{
                  font: 'inherit', fontSize: 11, fontWeight: 500,
                  padding: '2px 6px', borderRadius: 999,
                  border: '1px solid var(--ink-200)', background: 'var(--ink-50)',
                  color: 'var(--ink-700)', cursor: 'pointer', maxWidth: 230,
                }}
              >
                {(window.GEMINI_MODELS || [{ value: geminiModel, label: geminiModel, meta: '' }]).map(g => (
                  <option key={g.value} value={g.value}>{g.label} — {g.meta}</option>
                ))}
              </select>
              <span className="page__meta-chip">현장 스캔 → Gemini Vision → 검수</span>
            </div>
          </div>
          <div className="page__actions">
            {file && (
              <button className="btn" onClick={() => { setFile(null); setPreviewUrl(''); setResult(null); setError(''); setStatus('idle'); }}>
                <Icon name="refresh" /> 새로 시작
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="page__body">
        <div className="ocr-grid">

          {/* 좌측: 업로드 + 이미지 미리보기 */}
          <Card title="원본 이미지">
            {!file && (
              <div
                className="ocr-dropzone"
                onDrop={onDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => inputRef.current?.click()}
              >
                <div className="ocr-dropzone__icon">
                  <Icon name="image" size={32} />
                </div>
                <div className="ocr-dropzone__title">
                  이미지를 드롭하거나 클릭해서 선택
                </div>
                <div className="ocr-dropzone__hint">
                  PNG · JPG · WEBP<br />
                  페이지에서 Ctrl+V로 붙여넣기도 가능
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  onChange={e => pickFile(e.target.files?.[0])}
                  style={{ display: 'none' }}
                />
              </div>
            )}

            {file && (
              <>
                <div className="ocr-file-bar">
                  <Icon name="image" size={14} />
                  <span className="ocr-file-bar__name">{file.name}</span>
                  <span className="ocr-file-bar__size">{(file.size / 1024).toFixed(1)} KB</span>
                  <button className="btn btn--sm btn--ghost" onClick={() => { setFile(null); setPreviewUrl(''); setResult(null); }} title="제거">
                    <Icon name="x" size={12} />
                  </button>
                </div>
                <div className="ocr-preview">
                  <img src={previewUrl} alt="원본" />
                </div>
                <button
                  className="btn btn--primary ocr-run-btn"
                  onClick={run}
                  disabled={status === 'parsing'}
                >
                  {status === 'parsing'
                    ? <><Icon name="refresh" size={12} /> 파싱 중...</>
                    : <><Icon name="sparkle" size={12} /> Gemini로 파싱</>}
                </button>
              </>
            )}
          </Card>

          {/* 우측: 파싱 결과 */}
          <Card
            title="파싱 결과"
            actions={result && <button className="btn btn--sm" onClick={() => setShowRaw(s => !s)}><Icon name="settings" size={12} /> {showRaw ? '표 보기' : 'Raw JSON'}</button>}
          >
            {status === 'idle' && !file && (
              <div className="empty-state">
                <div className="empty-state__title">아직 이미지 없음</div>
                <div className="empty-state__hint">좌측에 이미지를 업로드하면 여기에 파싱 결과가 표시됩니다.</div>
              </div>
            )}
            {status === 'idle' && file && (
              <div className="empty-state">
                <div className="empty-state__title">파싱 대기</div>
                <div className="empty-state__hint">좌측의 [Gemini로 파싱] 버튼을 눌러 시작하세요.</div>
              </div>
            )}
            {status === 'parsing' && (
              <div className="ocr-status">
                <div className="spinner" />
                <div className="ocr-status__time">
                  이미지 분석 중... <strong>{elapsed.toFixed(1)}s</strong>
                </div>
                <div className="ocr-status__substep">
                  이미지 압축 → Gemini 호출 → 응답 파싱
                </div>
              </div>
            )}
            {status === 'error' && (
              <div className="ocr-error">
                <div className="ocr-error__title">
                  <Icon name="x" size={14} /> 오류
                </div>
                <div className="ocr-error__detail">{error}</div>
              </div>
            )}
            {status === 'done' && result && (
              <ResultView result={result} usage={usage} stats={stats} showRaw={showRaw} onReview={() => setView('review')} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--ink-500)', fontSize: 12 }}>
      {text}
    </div>
  );
}

function ResultView({ result, usage, stats, showRaw, onReview }) {
  if (showRaw) {
    return (
      <pre style={{
        background: 'var(--ink-50)', padding: 12, borderRadius: 8, fontSize: 11,
        fontFamily: 'JetBrains Mono, monospace', maxHeight: 'calc(100vh - 320px)', overflow: 'auto', margin: 0,
      }}>{JSON.stringify(result, null, 2)}</pre>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, fontSize: 11, flexWrap: 'wrap' }}>
        <Pill tone="info">요청일 {result.request_date || '?'}</Pill>
        {result.next_date && <Pill tone="default">명일 {result.next_date}</Pill>}
        <Pill tone="ok">{stats.totalRows}행</Pill>
        <Pill tone="ok">{stats.machines}대 호기</Pill>
        {stats.chemicals > 0 && <Pill tone="default">약품 {stats.chemicals}개</Pill>}
        {usage && (
          <span style={{ marginLeft: 'auto', color: 'var(--ink-500)' }}>
            {usage.model} · {usage.totalTokenCount || '?'} tok · {(usage.ms / 1000).toFixed(1)}s
            {usage.image && <> · 이미지 {usage.image.w}×{usage.image.h} ({Math.round(usage.image.bytes / 1024)}KB)</>}
          </span>
        )}
      </div>

      <div style={{ maxHeight: 'calc(100vh - 340px)', overflow: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 60 }}>호기</th>
              <th style={{ width: 50 }}>층</th>
              <th style={{ width: 90 }}>시프트</th>
              <th style={{ width: 110 }}>브랜드</th>
              <th style={{ width: 70 }}>variant</th>
              <th>제품명</th>
            </tr>
          </thead>
          <tbody>
            {(result.shifts || []).flatMap(sh =>
              (sh.rows || []).map((r, i) => (
                <tr key={`${sh.shift}-${r.machine_no}-${i}`}>
                  <td style={{ fontWeight: 600 }}>{r.machine_no}</td>
                  <td style={{ color: 'var(--ink-500)' }}>{r.floor || ''}</td>
                  <td>
                    <Pill tone={sh.shift === '주간' ? 'info' : sh.shift === '야간' ? 'default' : 'warn'}>{sh.shift}</Pill>
                  </td>
                  <td>{r.brand}</td>
                  <td style={{ color: 'var(--ink-500)' }}>{r.variant || ''}</td>
                  <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{r.product_name}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {result.chemicals && result.chemicals.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-600)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
            약품요청서
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>코드</th>
                <th style={{ width: 60 }}>등급</th>
                <th style={{ width: 70, textAlign: 'right' }}>3F</th>
                <th style={{ width: 70, textAlign: 'right' }}>1F</th>
              </tr>
            </thead>
            <tbody>
              {result.chemicals.map((c, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{c.code}</td>
                  <td>{c.grade}</td>
                  <td style={{ textAlign: 'right' }}>{c.qty_3f ?? ''}</td>
                  <td style={{ textAlign: 'right' }}>{c.qty_1f ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', padding: 12, background: 'var(--brand-50)', borderRadius: 8 }}>
        <div style={{ flex: 1, fontSize: 12, color: 'var(--ink-700)', lineHeight: 1.5 }}>
          <strong>다음 단계</strong>: 제품명을 마스터와 매칭하고 필요 시 마스터를 현장 표기로 정정합니다.
        </div>
        <button className="btn btn--primary" onClick={onReview}>
          <Icon name="arrow" size={12} /> 검수 시작
        </button>
      </div>
    </>
  );
}

window.OcrImportPage = OcrImportPage;
