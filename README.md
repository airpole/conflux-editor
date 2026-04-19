# Conflux Editor v20 — Phase 3

Command 패턴 도입 + Notes 탭 UI 정리. tempo/TS 편집을 Meta 탭으로 일원화.

## UX 변경 (v19 대비)

**Notes 탭 툴바에서 BPM / Beat 버튼 제거.** 곡의 BPM과 박자 설정은 Meta 탭 전담.

이유: v19는 같은 작업을 두 탭에서 할 수 있었는데, 이게 undo 스택 관리를 복잡하게 만들고 모바일 UI에서는 "어느 탭에서 편집했지?" 추적이 어려움. 곡의 변속 설정은 채보 시작 전에 한 번 입력하는 메타 정보이고, 기믹성 패턴 BPM 변속은 나중에 별도 기능으로.

**Notes 툴바 첫 줄 (이전 → 현재):**
- 이전: Undo Redo Sel Del Note Long Wide WLN BPM Beat Txt (11개)
- 현재: Undo Redo Sel Del Note Long Wide WLN Txt (9개)

키보드 단축키 T/Y도 제거. BPM 마커, 박자 마커의 시각 표시는 Notes 탭에서 그대로 보임 — Meta에서 추가한 것도 채보하면서 확인 가능.

## 파일 구조 (9개, 평탄)

```
index.html      # <script src="./main.js">
main.js         # 4423줄
constants.js    state.js    cache.js (Phase 2)
timing.js       # bpmSegments를 cache.js 위에서 동작하도록 재구조화
shape.js        overlaps.js (Phase 2)
commands.js     # Command 패턴 + 팩토리 6개 (NEW)
```

## Phase 3 핵심 변경

### 1. `commands.js` 신설 (163줄)

```js
function cmd(name, apply, undo, invalidates) { ... }
function dispatch(command)                // apply + invalidate + push to undo stack
function undoCmd() / redoCmd()
function onDispatch(fn)                   // 구독: apply/undo/redo 모두에서 호출
```

편집 site마다 "`compBPM()` → `renderList()` → `draw*()` → `saveHist()`" 체인을 반복하지 않음. Command에 `invalidates: ['tempo']`만 선언하고, `onDispatch`로 구독한 `_afterMetaCommand`가 apply/undo/redo 모두에서 자동 실행.

### 2. 팩토리 6개

- `AddTempo(entry)` / `DeleteTempo(entry)` / `EditTempoBpm(tick, oldBpm, newBpm)`
- `AddTimeSig(entry)` / `DeleteTimeSig(entry)` / `EditTimeSig(tick, oldTs, newTs)`

Index 대신 **tick을 식별자로** 사용. 정렬이 섞여도 apply/undo가 엉키지 않음.

### 3. `timing.js` 재구조화

Phase 2에서 TS만 캐시로 옮겼었는데, 이번에 `bpmS`(BPM segment array)도 `defineCache('bpmSegments', ['tempo'], ...)`로 이사. `compBPM()`은 이제 `invalidate(['tempo'])` wrapper. `t2ms/ms2t`는 `get('bpmSegments')`로 lazy 읽기.

Command가 `invalidates: ['tempo']`만 선언하면 bpmSegments 자동 재계산 — 수동 `compBPM()` 호출 불필요.

### 4. `main.js`의 `undo(w)`/`redo(w)` 분기

```js
function undo(w) {
  if (w === 'm' && hasCmdUndo()) { undoCmd(); return; }
  // ... legacy saveHist fallback ...
}
```

**병존 전략**: Meta 스코프(`w === 'm'`)만 command 스택을 먼저 본다. Notes/Shapes 편집은 그대로 saveHist 사용.

### 5. 이관된 편집 site

| Site | Phase 2까지 | Phase 3 |
|---|---|---|
| Meta 탭 Add Tempo | `D.tempo.push + compBPM + saveHist('m')` | `dispatch(AddTempo(...))` |
| Meta 탭 Edit Tempo BPM | 인라인 대입 | `dispatch(EditTempoBpm(...))` |
| Meta 탭 Delete Tempo (X 버튼) | 배열 splice | `dispatch(DeleteTempo(...))` |
| Meta 탭 Add/Edit/Delete TS | 각 수동 처리 | `dispatch(AddTS/EditTS/DeleteTS(...))` |
| Notes 캔버스 BPM 도구 | 있었음 | **제거** (Meta 탭 전담) |
| Notes 캔버스 TS 도구 | 있었음 | **제거** |

## Meta 탭 사용법

- **추가**: Meta 탭 하단의 Tempo/Time Signature 섹션에서 마디 입력 + BPM/박자 입력 후 Add
- **편집**: 리스트의 BPM 값이나 분자/분모를 직접 수정 (blur 시 반영)
- **삭제**: 리스트 우측의 ✕ 버튼 클릭 (초기 tempo/TS — tick=0 — 는 삭제 불가)

Undo 버튼은 Meta 탭에 없음. 실수로 추가했으면 ✕로 지우면 되고, 설정은 채보 전 한 번만 만지는 작업이라 복원 UI가 필요 없다는 판단.

## 숫자

| 항목 | Phase 2 | Phase 3 | 차이 |
|---|---|---|---|
| 파일 수 | 8 | 9 | +1 (commands.js) |
| main.js 줄 수 | 4416 | 4423 | +7 |
| `saveHist('m')` 호출 | 9곳 | 3곳 | -6 (남은 3곳은 import/load/init baseline) |
| `dispatch()` 호출 | 0 | 7 | — |
| Notes 툴바 버튼 수 | 11 | 9 | -2 (BPM, Beat) |

## 실행 방법

```bash
python3 -m http.server 8000   # 또는 GitHub Pages에 그대로
```

## 검증 체크리스트

- [ ] Meta 탭: Add Tempo → 리스트에 나타남
- [ ] Meta 탭: BPM 숫자 직접 편집 → 반영
- [ ] Meta 탭: ✕ 클릭 → 삭제
- [ ] TS에 대해서도 위 3개
- [ ] Notes 탭 툴바에서 BPM/Beat 버튼이 안 보이는지
- [ ] Notes 탭 캔버스에서 BPM이 표시되는지 (Meta에서 추가한 것) — 시각 표시는 유지
- [ ] Notes 탭 undo 버튼 — Notes 편집만 되돌리는지 (기존 동작)
- [ ] Shape 탭 undo 버튼 — Shape 편집만 되돌리는지 (기존 동작)

## 다음 (Phase 4)

계획 문서 §5 Phase 4 — 가장 큰 ROI:
- `drawN` (400줄) + `drawS` (650줄) + `drawGameFrame` (600줄)의 **공유 코드 ~1000줄**을 하나의 `renderNotes(ctx, vp, notes, opts)`로 추출
- 저녁 1–2회 분량, 가장 위험하지만 가장 이득
