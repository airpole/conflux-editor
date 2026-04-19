# Conflux Editor v20 — Phase 4a

렌더링 통합의 **절반**. `drawN`/`drawS`/`drawGameFrame` 세 함수에서 노트 색 결정, overlap 분기, head 그리기 primitive 4개를 `renderer.js`로 추출. 세 함수 내부의 좌표 계산/반복문은 Phase 4b로.

## 파일 구조 (10개)

```
index.html      main.js (4387줄)
constants.js    state.js    cache.js
timing.js       shape.js    overlaps.js    commands.js
renderer.js     # NEW — 98줄, 4개 primitive
```

## Phase 4a 변경

### `renderer.js` 신설 (98줄, 4 exports)

```js
resolveNoteColor(n, ov)              // → {headCol, bodyCol}
headColorAtTick(baseCol, ov, tk)     // partial-yellow 판정 시 흰색/노란색 결정
splitBodyByOverlap(n, ov, st, et, defaultCol)  // → [{tkFrom, tkTo, col}]
drawNoteHead(ctx, isWide, x, y, w, h, color, radius?)  // rect vs roundRect
```

모두 좌표계 독립적. caller가 자기 tk→y 변환 유지.

### 3개 draw 함수 재배선

**drawN** (400 → 387줄, −13):
- `drawNoteOnCanvas` 내부에서 색 결정 분기 3줄 → `resolveNoteColor` 호출
- body segment split (if/else 8줄) → `splitBodyByOverlap` + forEach
- head 그리기 (조건+색설정+roundRect/fillRect) → `drawNoteHead`

**drawS** (423 → 394줄, −29):
- 위와 동일
- **추가**: Tap/LN head 두 블록이 원본에서 동일 코드의 복붙이었는데 (13줄 × 2) 하나로 통합. startTick에 head 그리는 게 유일한 동작이라 분기 의미 없음
- Wide step-tick bridge는 그대로 유지 (별도 로직)

**drawGameFrame** (605 → 607줄, +2):
- body pass consumption clamp 분리: 원본 inline `Math.max(s.ov.yellowStart, st)` 같은 boundary 보정이 primitive 밖의 drawGF 호출 직전에 동일하게 적용됨
- head pass: LN은 `headColorAtTick`, Tap은 `drawHead` 그대로 (v19의 미묘한 차이 보존 — Tap head는 partial-yellow 판정 안 함)
- `isMissed` 처리: `effectiveOv = s.isMissed ? null : s.ov` 패턴으로 overlap styling disable

### 수학적 등가성

drawGameFrame body pass가 가장 미묘 — consumption-trimmed `st`와 overlap 경계 `yellowStart/yellowEnd`의 상호작용. 3가지 핵심 케이스를 수기로 증명:

1. **`curTk > yellowEnd`** (소비가 yellow 완전히 통과):
   - 원본/새: Seg A/C 각각의 조건 분기가 동일하게 skip하고 NORMAL_BODY 하나만 `[st, et]`에 그림
2. **`curTk ∈ [yellowStart, yellowEnd]`** (소비가 yellow 중간에서 멈춤):
   - 원본/새: `[st, yellowEnd]` OVERLAP + `[yellowEnd, et]` NORMAL
3. **`curTk < yellowStart`** (일반):
   - 원본/새: 세 segment 그대로

clipped/plain/missed 케이스도 동일. 픽셀 동일성 수학적으로 보장.

## 숫자

| 항목 | Phase 3 | Phase 4a | 차이 |
|---|---|---|---|
| 파일 수 | 9 | 10 | +1 |
| main.js | 4423 | 4387 | **−36** |
| drawN | 400 | 387 | −13 |
| drawS | 423 | 394 | −29 |
| drawGameFrame | 605 | 607 | +2 |

세 함수 합계: 1428 → 1388 (−40). renderer.js 98줄 추가까지 합산하면 총 +58줄 증가지만, **중복 코드가 single-source로 정리**됨. 새 hit effect/색상 규칙 추가 시 세 곳 대신 `renderer.js` 한 곳만 고치면 됨 (primitive 차원에서는).

## 검증 체크리스트

**이 단계는 pixel-identical이 목표. 눈으로 확인할 것:**

- [ ] **Notes 탭**: Tap/Long/Wide/Wide Long 노트 그리기, 선택 시 초록 outline 정상
- [ ] **Notes 탭**: Lines 2/3에 오버랩 노트 배치 → 노란색 하이라이트 규칙 4가지 케이스:
  - [ ] merged (완전히 같은 범위 2개): 노란 하나만 보임
  - [ ] fullYellow (한쪽이 다른 쪽을 포함): 노란 하나만 보임
  - [ ] yellow partial (끝이 다름): 겹친 구간만 노란, 나머지 흰
  - [ ] clipped (흰 노트가 노란 뒤에 일부 숨음): 흰 노트의 clip 구간만 비어보임
- [ ] **Shape 탭**: 동일한 오버랩 4가지가 Shape 탭에서도 같은 색으로 보이는지
- [ ] **Shape 탭**: Wide LN의 step-tick bridge가 정상 (step 지점에서 가로선)
- [ ] **Preview/Play**: 
  - [ ] 노트가 shape 따라 휘면서 정상 렌더링
  - [ ] Hit된 Tap: 100ms 페이드아웃
  - [ ] Hit된 LN: head 사라지고 body가 판정선부터 소비
  - [ ] Missed Tap: 판정선 지나 계속 스크롤 (색상 변화 없음)
  - [ ] Missed LN: body 전체가 기본색으로 (overlap 분기 무시)

## 실행

```bash
python3 -m http.server 8000   # 또는 GitHub Pages
```

## 다음 (Phase 4b)

Phase 4a에서 놔둔 것들:
- `drawBodySeg` / `svDrawBodyPoly` / `drawGFBody`: 좌표계가 달라 공유 못함 — viewport 추상화 필요
- Z-order 2-pass loop: 3군데 거의 동일한 구조
- visible-range iteration: 이것도 3군데

Phase 4b 목표: `renderNotes(ctx, viewport, notes, opts)` 하나로 위 3가지를 통합. 제일 큰 변화.