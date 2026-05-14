(() => {
  const MISSING = ["DARK", "SOUL", "LUXE", "BRONZE", "MAPLE", "BURNT", "ZERO", "CHANEL", "POTTER", "FARAISE", "PEAT", "LEMON", "EXODUS", "IRON", "SPIRAL", "ROOSTER", "MAVERICK", "GLOBAL", "METHOD"];
  const raw = localStorage.getItem('inkPlanData');
  if (!raw) { console.log('inkPlanData 없음 — 새로고침 후 [초기화] 한 번 누르면 clean.json에서 자동 로드됨'); return; }
  const data = JSON.parse(raw);
  if (!data.inkPlan) data.inkPlan = [];
  const existing = new Set(data.inkPlan.map(i => i.name));
  const emptyDays = () => Object.fromEntries(["\uc6d4", "\ud654", "\uc218", "\ubaa9", "\uae08", "\ud1a0", "\uc77c"].map(k => [k, {
    '현재고': null, '가용일수': null, '제조량': null, '호기': null
  }]));
  let added = 0;
  for (const name of MISSING) {
    if (existing.has(name)) continue;
    data.inkPlan.push({ name, days: emptyDays() });
    added++;
  }
  localStorage.setItem('inkPlanData', JSON.stringify(data));
  console.log('✓', added, '개 잉크 마스터 추가됨. 총 inkPlan:', data.inkPlan.length);
  location.reload();
})();