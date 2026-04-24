# Conflux Editor v21 — Phase 5

**노트 라인 이동 (drag-based) + 겹침 시각 피드백**

기존 y축 drag-move에 x축(라인) 이동을 확장. 동시에 Line 1/4의 잘못된 겹침을 빨간 테두리로 실시간 경고.

## 개요

Notes 탭의 sel tool에서 이미 선택된 노트를 누르고 끌면:
- **y축 (시간)**: 기존 그대로 매 frame tick 이동
- **x축 (라인)**: column 너비의 50% 임계 초과 시 한 칸씩 step 이동 (히스테리시스)

두 축은 독립. 대각선 드래그로 시간과 라인 동시 이동 가능.

## §1. X축 드래그 — 히스테리시스

**왜 단순 `round(dx/colW)`가 아닌가:**
round 방식은 경계(0.5)에서 손가락이 떨리면 한 프레임에 한 칸씩 진동. 히스테리시스는 임계 넘을 때마다 기준점을 이동해서, 반대 방향으로 **다시 0.5*colW 더 움직여야** 역이동. 안정적.

**구현:**
```js
const dx = x - dragMoveX0;  // drag 시작점으로부터의 x 변위
while (dx - dragMoveColDelta * colW > threshold) {
  shift(+1); dragMoveColDelta++;
}
while (dx - dragMoveColDelta * colW < -threshold) {
  shift(-1); dragMoveColDelta--;
}
```
`while`을 쓰는 이유는 빠른 플릭에서 한 프레임에 여러 column을 넘을 수 있기 때문. 한 번에 1칸씩만 이동하면 드래그가 손가락보다 느리게 따라감.

**그룹 연대 clamp:**
선택 중 가장 오른쪽 노트가 Line 4면 `shift(+1)`은 전체 거부. 한 명만 막혀도 아무도 안 움직임. 반대 방향은 대칭. Wide 노트는 channel 고정(0)이라 계산에서 제외(선택에는 남음).

Clamp 거부 시 `dragMoveColDelta`도 그대로 유지 → 사용자가 반대 방향으로 임계만 넘으면 즉시 반응. "막힌 방향으로 쌓아둔 거리"를 되돌릴 필요 없음.

## §2. 겹침 시각 피드백

### 노란색 (기존) — Line 2/3
`OVERLAP_CHANNELS`에서 같은 tick 범위가 겹치면 merged/yellow. 드래그든 수동 배치든 구분 없음. 기존 `noteOverlapMap` 로직 그대로.

### 빨간 테두리 + halo (신규) — Line 1/4
물리 키 1개인 라인에서 겹침 = 입력 불가능한 상태. `overlaps.js`의 loop를 모든 채널로 확장하되, Line 1/4에서 감지된 겹침은 `{type: 'invalid'}`로 표시. 양쪽 노트 모두에 표시 (어느 쪽을 지울지는 사용자가 결정).

```js
// overlaps.js
for (const ch of [1, 2, 3, 4]) {
  const isOverlapCapable = OVERLAP_CHANNELS.includes(ch);
  // ...겹침 감지 (기존과 동일 알고리즘)
  if (!isOverlapCapable) {
    ovm.set(a, {type:'invalid'});
    ovm.set(b, {type:'invalid'});
    continue;
  }
  // ...기존 merged/yellow/clipped 로직
}
```

### 렌더링
`drawN` (Notes 탭), `drawS` (Shape 탭) 두 곳에서 head 패스에 빨간 테두리 + halo:
```js
if (ov && ov.type === 'invalid') {
  ctx.strokeStyle = INVALID_COLOR;  // '#ff3040'
  ctx.lineWidth = 2;
  ctx.shadowColor = INVALID_COLOR;
  ctx.shadowBlur = 8;
  ctx.strokeRect(...);
  ctx.strokeRect(...);  // halo 강조 위해 두 번
}
```
`classifyNotesForZOrder`에서 `'invalid'` → `normW` 버킷으로 라우팅 (흰색 채움 유지). 빨간 테두리만 덮어씌움.

**drawGameFrame은 이번 phase 범위 밖** (계획서 §2.6). Play 중 판정 혼란 방지. Phase 6에서 게임 상태와 함께 재검토.

### 실시간 반응
매 드래그 step마다 `invalidateNoteOverlaps()` 호출. 다음 frame에 색상 즉시 반영.

## §3. 히스토리

기존 y축 drag-move와 동일: `pointerup` 시점에 `moved === true`면 `saveHist('n')`. x축/y축 모두 같은 `moved` 플래그로 판정. 드래그 한 번 = 히스토리 1 엔트리. 뗐다 잡으면 별개 엔트리.

Phase 4와 일관된 snapshot 방식 — Command 이관은 Phase 7에서.

## §4. 파일 변경

| 파일 | 변경 | 줄 변화 |
|---|---|---|
| `constants.js` | `INVALID_COLOR = '#ff3040'` 추가 | 51 → 52 (+1) |
| `overlaps.js` | loop를 모든 채널로 확장, `'invalid'` 타입 생성, classifyNotesForZOrder 라우팅 | 103 → 107 (+4) |
| `main.js` | INVALID_COLOR import, dragMoveX0/dragMoveColDelta 상태, shiftSelectedByDelta 헬퍼, x축 hysteresis, drawN/drawS 빨간 테두리 | 4366 → 4452 (+86) |

기타 파일 (index.html, cache.js, commands.js, renderer.js, scheduler.js, shape.js, state.js, timing.js) 무변경.

## §5. 회귀 검증 체크리스트

**드래그 기본 동작:**
- [ ] Line 2 노트 선택 → 오른쪽으로 `colW*0.5` 이상 드래그 → Line 3으로 이동
- [ ] 계속 오른쪽 → Line 4로 이동
- [ ] Line 4 도달 후 더 오른쪽 → 정지 유지
- [ ] 정지 상태에서 왼쪽 드래그 → 즉시 Line 3으로 복귀 (히스테리시스 재시작)
- [ ] 대각선 드래그 → y와 x 동시 이동

**그룹 연대 clamp:**
- [ ] Line 2·3·4 섞인 선택 → 오른쪽 드래그 → 전체 정지 (Line 4가 경계)
- [ ] Line 1·2·3 섞인 선택 → 왼쪽 드래그 → 전체 정지 (Line 1이 경계)
- [ ] 정지된 상태에서 반대 방향 드래그 → 다른 노트도 같이 이동

**Wide 노트:**
- [ ] Line 2 + Wide 섞인 선택 → 드래그 → 일반 노트만 이동, Wide 고정
- [ ] Wide만 선택 → 드래그 → 아무 동작 없음

**겹침 피드백:**
- [ ] Line 3에 있는 노트 선택 → Line 2로 드래그 → Line 2 기존 노트와 만남 → **노란색** 실시간
- [ ] 더 드래그해서 벗어남 → 흰색 복귀
- [ ] Line 2 노트 선택 → Line 1로 드래그 → Line 1 기존 노트와 만남 → **빨간 테두리 + halo** 실시간
- [ ] Line 4도 동일
- [ ] 빨간 상태로 손 뗌 → 저장됨 (취소 아님), Ctrl+Z로 복원 가능 (Q3-d 옵션 3)

**히스토리:**
- [ ] 드래그(x+y 모두 움직임) → 떼기 → Ctrl+Z → 원위치
- [ ] 드래그 중 일시 정지 후 손 뗌 → 다시 잡고 이어 드래그 → Ctrl+Z → 두 번째만 복원

**렌더링 일관성:**
- [ ] Notes 탭에서 invalid 빨간 테두리 표시
- [ ] Shape 탭에서도 같은 노트의 invalid 표시
- [ ] Preview/Play 탭(drawGameFrame)에서는 빨간 테두리 없음 (의도)

**Phase 4 회귀:**
- [ ] Flip 버튼 / Paste long-press 정상
- [ ] Ctrl+F / Ctrl+V 정상

**Phase 3-1 / 3-4 / 1 회귀:**
- [ ] Shape Sel+Del 다중 삭제
- [ ] Wide head step 렌더링
- [ ] Play 탭 Autoplay / 전체화면 / 처음부터 시작
- [ ] Line 2·3 기존 노란색 overlap (merged/yellow/hidden/clipped) 정상
- [ ] 기존 y축 단독 drag-move (x 임계 이하 움직임)

## §6. 설계 결정 기록

### §6-a. 히스테리시스 vs round
round는 경계 진동. 히스테리시스는 임계 통과 시 기준점 이동 → 반대 방향으로 다시 임계 통과해야 역이동. 리듬게임 편집의 빠른 플릭 처리에 필수.

### §6-b. 그룹 연대 clamp (Q2-C)
Line 2·3·4 섞인 선택 중 Line 4가 막혀도 다른 노트는 진행하면, Line 4 노트 2개가 겹쳐서 의도치 않은 invalid 상태 발생. 전체 정지가 깔끔 + 덜 놀람.

### §6-c. invalid 감지를 overlaps.js 안에 통합
세 canvas(drawN/drawS/drawGameFrame)가 같은 `noteOverlapMap`을 읽음. 감지 로직을 한 곳에 두면 자동 일관성. 분산 시 동기화 버그 위험.

### §6-d. drawGameFrame 제외 (§2.6)
Play 중 빨간 테두리는 판정 혼란. Phase 6 판정 개선에서 게임 상태와 함께 재검토 예정. Preview 모드만 적용할지도 그때 결정.

### §6-e. snapshot 유지 (Command 미사용)
Phase 4와 동일 근거. 기존 y축 drag-move가 snapshot이라 x축만 Command로 가면 undo 순서 꼬임. 같은 드래그의 두 축은 같은 메커니즘이 맞음. Phase 7에서 Notes 탭 전체 Command 이관할 때 같이.

### §6-f. invalid 노트를 normW로 라우팅
흰색 채움 유지(`classifyNotesForZOrder` → normW 버킷). 그 위에 빨간 테두리를 head-pass에서 덮어씀. 기존 clipped와 동일한 z-order 처리 — 검증된 패턴.

### §6-g. 빨간 테두리 두 번 stroke
기존 선택 테두리(초록 #4aff8a)와 동일 패턴. shadowBlur로 halo 효과 강조.

## §7. 추가 노트

**INVALID_COLOR 재사용 가능성:**
다른 위치에서도 "이건 안 되는 상태" 경고가 필요할 때 `constants.js`의 `INVALID_COLOR`를 재사용. 예: 향후 Step 이벤트의 LR 역전 감지(Phase 3-5)에서 같은 빨간색으로 경고.

**Line 1/4 판정 로직:**
현재 Play 모드는 채널당 1개 입력 가정. Line 1/4에서 invalid가 있으면 Play 판정도 오동작 가능. Phase 6에서 "같은 채널 같은 tick에 노트가 2개 이상이면 하나만 판정" 같은 방어 로직이 필요할 수 있음.

**Shape 탭에서 노트 선택/드래그 불가:**
Shape 탭은 노트를 표시만 하고 편집은 Notes 탭에서만 가능. Phase 5는 Notes 탭 전용 기능이고 Shape 탭은 "겹침 상태 확인용 디스플레이"로만 업데이트됨.

## §8. 다음 Phase

계획서 §작업 순서:
- Phase 3-2/3-3 — Step/Linear 통합 + schemaVersion 2
- Phase 2 — Measure numbering
- Phase 3-5 — LR 역전 실시간 swap (INVALID_COLOR 재사용 기회)
- Phase 6 — Play 판정 개선 (LN tail 콤보 + drawGameFrame invalid 표시 검토)
- Phase 7 — Notes 탭 Command 이관 (drag-move/flip/paste snapshot → Command)
