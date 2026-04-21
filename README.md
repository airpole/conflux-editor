# Conflux Editor v21 — Phase 3-4

**Wide head + step 겹침 렌더링 버그 수정**

Step tick에서 wide head가 끊겨 보이는 문제를 통일된 bridge 로직으로 해결.

## 문제 분석

Step tick에서 shape는 한 순간에 `[pls, prs]` → `[cls, crs]`로 점프함. Wide head는 얇은 가로 띠라서 step 직전과 직후의 띠가 boundary 차이만큼 끊겨 보일 수 있음.

기존 코드는 두 가지 **gap 케이스**만 처리:
- `prs < cls`: 이전 right보다 이후 left가 더 오른쪽 → 둘 사이 빈 공간을 wide 색으로 메꿈
- `crs < pls`: 이전 left보다 이후 right가 더 왼쪽 → 마찬가지

하지만 다음 케이스는 **bridge가 안 그려져서 끊김 발생**:
- 한쪽 boundary만 점프 (예: left 그대로, right만 -2 → +4)
- 양쪽이 같은 방향으로 점프 (예: 둘 다 오른쪽으로 이동)
- 이전 polygon과 이후 polygon이 부분 겹침

이 케이스들은 polygon 합집합으로 보면 끊긴 게 없어 보이지만, **wide head의 얇은 두께** 때문에 시각적으로 두 별개의 띠로 갈라져 보임.

## 수정

Step tick에서 wide head 한 묶음의 bridge 범위를 **`[min(pls, cls), max(prs, crs)]`** 로 설정 (left끼리 min, right끼리 max).

**왜 4개 모두에서 min/max가 아니라 left-pair/right-pair인가:**
LR 역전 상태(`left > right`, 계획서 §D3가 Phase 3-5에서 해결 예정)가 가능한 현 시점에서, 4개 boundary 모두에 min/max를 쓰면 polygon 실제 영역을 넘어 bridge가 leak함. 좌-쌍 min과 우-쌍 max를 쓰면 두 step polygon의 합집합 범위 내로 bridge가 머물러 자연스러운 형태가 됨.

**`left ≤ right` 불변식이 깨지지 않는 한 두 공식은 결과가 같음** — 차이는 LR 역전 케이스에서 드러남. Phase 3-5에서 LR 역전이 사라지면 두 공식은 동일 결과가 되지만, 명확성을 위해 left-pair/right-pair 표기를 유지.

**모든 케이스 커버:**
- Gap 케이스 (이전 정상): 두 polygon 사이를 자연스레 잇기
- 한쪽 점프: min/max 차이만큼의 띠로 양쪽 polygon을 시각적으로 잇기
- 부분 겹침: 합집합을 덮음
- LR 역전 (현재 가능, Phase 3-5 후 사라짐): polygon 바깥으로 leak하지 않음

**적용 위치 2곳 (동일 로직):**
- `drawS` — Shape 편집 탭
- `drawGameFrame` — Preview / Play 탭

## 코드 변경 요약

```js
// Phase 3-4 초안 (잘못 — LR 역전 시 leak)
const lo = Math.min(pls, prs, cls, crs);
const hi = Math.max(pls, prs, cls, crs);

// Phase 3-4 최종 (Rule B)
const lo = Math.min(pls, cls);   // left끼리 min
const hi = Math.max(prs, crs);   // right끼리 max

if (hi - lo > 0.1) {
  ctx.strokeStyle = WIDE_COLOR; ctx.lineWidth = nThk * 0.9;
  ctx.beginPath(); ctx.moveTo(p2x(lo), y); ctx.lineTo(p2x(hi), y); ctx.stroke();
}
```

색·두께·y 좌표는 기존 그대로 유지. 분기만 단순화·확장.

## 파일 변경

| 파일 | 변경 | 줄 변화 |
|---|---|---|
| `main.js` | drawS, drawGameFrame 두 곳 step bridge 통합 | 4297 → 4302 (+5) |

## 회귀 검증 체크리스트

**의도된 수정:**
- [ ] Step에서 한쪽만 점프하는 wide head → 끊김 없이 bridge로 메꿔짐
- [ ] Step에서 양쪽이 같은 방향으로 점프 → 끊김 없이 bridge
- [ ] Step에서 양쪽이 반대 방향으로 점프 (gap 케이스, 기존 정상) → 여전히 정상
- [ ] Preview/Play에서도 동일하게 바뀜
- [ ] Step bridge 두께·색이 wide head와 시각적으로 일치 (`nThk * 0.9`, `WIDE_COLOR`)

**회귀 (Phase 3-4 외):**
- [ ] Wide head가 step에 없는 경우 (일반 위치) → 영향 없음
- [ ] 일반 (non-wide) 노트 → 영향 없음 (이 코드는 isWide만 처리)
- [ ] LN body는 별도 polygon → bridge와 무관, 영향 없음
- [ ] Shape line dividers, measure lines → 무관

**Phase 3-1 / Phase 1 회귀:**
- [ ] Shape Sel+Del 다중 삭제 정상
- [ ] Play 탭 4가지 조합 (Auto × Play/Restart) 전체화면 정상
- [ ] Static preview HUD 표시 정상

## 추가 노트

`renderer.js`에 `drawStepBridge` primitive로 추출 가능 (계획서 §7-2 권고). 두 호출부가 거의 동일 로직(`drawHead` 색만 다름)이라 향후 정리 후보. Phase 3-4 범위는 버그 수정만 — 리팩터링은 별도 phase에서.

## 다음 Phase

계획서 §작업 순서:
- Phase 4 — Flip 명료화 + long-press paste
- Phase 5 — 노트 라인 이동
- Phase 3-2/3-3 — Step/Linear 통합
- Phase 2 — Measure numbering
- Phase 3-5 — LR 역전 swap
- Phase 6 — Play 판정 개선 (LN tail 콤보 포함)
