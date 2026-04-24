# Conflux Editor v21 — Phase 4

**Copy/Paste/Flip 명료화 + Long-press Paste (500ms)**

Flip 버튼의 이중 의미를 제거하고 long-press로 flip-paste 분리.

## 문제 분석

기존 Flip 버튼(`onclick="doPaste(true)"`)은 상태에 따라 두 가지 다른 동작:
- `nTool === 'sel' && selectedNotes.size > 0` → 선택 노트 in-place 반전 (clipboard 무관)
- 그 외 → clipboard 내용을 반전해서 붙여넣기

한 버튼이 문맥에 따라 다르게 동작해서 혼란. 사용자가 "Flip 눌렀는데 왜 붙여넣기가 되지?" 또는 "Flip 눌렀는데 왜 clip empty 토스트가 뜨지?" 같은 혼동.

## 수정

**세 버튼의 의미를 명료히 분리:**

| 버튼 | 동작 |
|---|---|
| **Copy** | 기존 그대로 |
| **Paste** (짧은 탭) | 일반 붙여넣기 |
| **Paste** (길게 누르기 500ms) | Flip-paste (clipboard 좌우 반전 후 붙여넣기) |
| **Flip** | **선택된 노트 좌우 반전** (clipboard 무관) |

**키보드 단축키 (Notes 탭):**
- `Ctrl+V` → 일반 붙여넣기 (기존과 동일)
- `Ctrl+F` → **선택 노트 반전** (이전에는 flip-paste도 됐음)

Shape 탭은 기존 의미 유지 (Shape에는 sel+flip 콤보가 원래 없었음):
- `Ctrl+F` → `doShapePaste(true)` (Shape flip-paste)

## 새 함수

### `doFlipSelected()` (main.js)

선택된 노트를 제자리에서 좌우 반전. Wide 노트는 channel 0 고정이라 건너뜀. Channel 1↔4, 2↔3 매핑. Notes 탭의 기존 편집 패턴(`saveHist('n')` snapshot)과 일관성 유지. Phase 7-1에서 Command로 마이그레이션 가능.

반전할 노트가 하나도 없으면 "Nothing to flip" 토스트 (예: wide만 선택한 경우).

## Paste 버튼 Long-press 구현

기존 `onclick="doPaste(false)"` 인라인 바인딩 제거. DOMContentLoaded에서 pointer 이벤트 수동 바인딩:

```
pointerdown  → lpTimer 시작 (500ms), .lp 클래스 추가 (주황색 피드백)
pointermove  → 10px 이상 이동 시 타이머 취소 (스크롤 의도)
pointerup    → lpTimer 활성 → 일반 paste / 이미 fire됨 → no-op
pointercancel → 타이머 취소
500ms 경과 후 자동 → doPaste(true) fire, .lp 제거
```

**왜 인라인 onclick을 아예 제거했나:**
- onclick과 pointer 이벤트 공존 시 중복 실행 가능성
- pointerup에서 "짧은 탭"을 감지하는 게 더 정확 (타이머 상태 검사)
- 500ms 타이머가 fire된 직후 사용자가 손 떼면 pointerup도 오는데, onclick도 오면 paste가 두 번 발생

**왜 pointer 이벤트인가 (touch 이벤트 대신):**
- PointerEvent는 touch + mouse + pen 통합 처리
- Samsung S24+ 크롬 완전 지원
- 기존 코드(Quick LN long-press line 1112-1164)도 pointerdown/pointerup 쓰는 중 — 일관성

**드리프트 임계값 10px:**
- 사용자가 스크롤하려다 실수로 버튼에 손을 댄 경우 감지
- `dx² + dy² > 100` (10px² = 100)
- 손가락이 진짜로 버튼 안에서 떨림 정도는 10px 미만이라 안전

## 시각 피드백

버튼을 눌러서 타이머 진행 중일 때 `.lp` 클래스 적용. CSS:

```css
.t.lp{background:var(--orange);color:#000;border-color:var(--orange);transition:...}
```

일반 상태(`var(--bg3)`, 회색) → 눌렀을 때(주황색 fill) → 떼거나 타이머 fire 후 원복. 주황색은 Flip 버튼 색(`var(--orange)`)과 일치하여 "이 상태에서 손 떼면 flip-paste 된다"는 의도를 시각적으로 암시.

## 코드 변경 요약

```js
// 이전 (doPaste에 sel+flip 분기 혼재)
function doPaste(mirror) {
  if (mirror && nTool === 'sel' && selectedNotes.size > 0) {
    // ...in-place flip (wrong concern)
    return;
  }
  if (clipboard.length === 0) { toast('Clipboard empty'); return; }
  // ...normal paste
}

// 현 (단일 책임)
function doPaste(mirror) {
  if (clipboard.length === 0) { toast('Clipboard empty'); return; }
  // ...paste with optional channel mirror
}

function doFlipSelected() {
  if (selectedNotes.size === 0) { toast('No notes selected'); return; }
  // ...flip channels on selection
}
```

## 파일 변경

| 파일 | 변경 | 줄 변화 |
|---|---|---|
| `main.js` | doPaste 단순화, doFlipSelected 신규, long-press init | 4297 → 4365 (+68) |
| `index.html` | Flip/Paste 버튼 onclick 변경, .lp CSS 추가 | 386 → 388 (+2) |

기타 9개 파일 (`cache.js`, `commands.js`, `constants.js`, `overlaps.js`, `renderer.js`, `scheduler.js`, `shape.js`, `state.js`, `timing.js`) 무변경.

## 회귀 검증 체크리스트

**Phase 4 의도 동작:**
- [ ] 선택 없이 Flip 버튼 → "No notes selected" 토스트
- [ ] Wide만 선택 후 Flip → "Nothing to flip" 토스트
- [ ] 일반 노트 선택 후 Flip → 제자리에서 좌우 반전 (Line 1↔4, 2↔3)
- [ ] Flip → Ctrl+Z (undo) → 복원
- [ ] Copy → Paste 짧게 탭 → 일반 붙여넣기
- [ ] Copy → Paste 500ms 길게 → 좌우 반전 붙여넣기 ("Flip-Pasted N note(s)")
- [ ] Clipboard 비어있는 상태에서 Paste 탭/길게 → 둘 다 "Clipboard empty" 토스트
- [ ] Paste 버튼 누른 채 손가락 10px 이상 움직임 → 타이머 취소, 아무 동작 없음
- [ ] Paste 버튼 눌렀을 때 주황색 하이라이트 표시, 500ms 후 자동 원복

**단축키 (데스크탑 테스트):**
- [ ] Notes 탭 Ctrl+F → 선택 노트 반전 (이전에는 flip-paste도 했음)
- [ ] Notes 탭 Ctrl+V → 일반 붙여넣기 (변화 없음)
- [ ] Shape 탭 Ctrl+F → 기존 flip-paste (변화 없음)

**회귀 (Phase 4 외):**
- [ ] Notes 탭 Copy 기능 정상
- [ ] Notes 탭 Paste 일반 동작 정상 (이전 단일 탭과 동일)
- [ ] Notes 탭 Sel+Del 다중 삭제 정상
- [ ] Notes 탭 Quick LN long-press (노트 툴 300ms) 여전히 작동 — 별도 영역이라 간섭 없음
- [ ] Shape 탭 Copy/Paste/Flip 기존 동작 유지
- [ ] Meta 탭 command undo/redo 정상

**Phase 3-1 / 3-4 / 1 회귀:**
- [ ] Shape Sel+Del 다중 삭제 정상
- [ ] Wide head + step 겹침 렌더링 정상
- [ ] Play 탭 Autoplay 토글 / 처음부터 시작 / 전체화면 정상

## 설계 결정

**왜 Command 패턴 미사용인가 (`FlipSelectedNotes` factory):**

계획서 §7-4에서 Phase 4 `FlipSelectedNotes` Command 제안. 그러나 사용자 지시("Shape 탭 undo 전략은 옵션 1 (snapshot 유지)")와 일관성을 위해 `saveHist('n')` snapshot으로 구현. Phase 3-1의 DeleteShapeEvents도 factory만 선언하고 실제로는 saveHist 사용하는 선례 존재 (commands.js 해당 블록 코멘트 참조).

Notes 탭 전체가 snapshot 방식인데 Flip만 Command로 분리하면 undo 순서가 꼬일 수 있음:
- snapshot edit → Command edit → snapshot edit 시퀀스에서 Ctrl+Z가 어느 스택을 pop할지 분기 로직 필요
- 계획서 §7-1 "점진적 이관" 원칙상 Notes 전체 편집을 동시에 Command로 옮기는 phase가 생길 때 Flip도 같이.

**왜 touchstart/touchend 대신 pointerdown/pointerup:**

- PointerEvent가 touch/mouse/pen 통합 (cross-input)
- 기존 코드(Quick LN long-press)와 동일 패턴으로 유지
- Samsung S24+ Chromium 완벽 지원

**왜 인라인 onclick 완전 제거 (HTML):**

pointer 이벤트로 짧은 탭/긴 탭을 exclusive하게 처리하려면 onclick의 중복 실행을 막아야 함. 브라우저가 pointerup 직후 click 이벤트를 발사하는데, onclick과 pointerup에서 각각 paste를 호출하면 두 번 실행됨. 그래서 onclick을 HTML에서도 제거하고 JS에서도 `removeAttribute('onclick'); onclick=null`로 이중 방어.

## 추가 노트

Shape 탭 Paste 버튼에 동일 long-press를 적용할지는 이번 phase 범위 외로 남김. Shape의 Flip 버튼은 원래 명확한 flip-paste(sel+flip 콤보 없음)라 혼란이 없어 scope 유지. 필요 시 동일 `initPasteLongPress` 패턴을 `sPasteBtn`에 적용 가능.

Paste 버튼 색상(`var(--green)`)과 long-press 피드백 색(`var(--orange)`)의 대비는 "눌렀을 때 결과가 달라진다"를 시각적으로 잘 전달함. 피드백 색을 일부러 Flip 버튼의 주황과 일치시켜 "지금 손을 떼면 이 색 버튼이 의미하는 동작(flip)이 일어난다"를 암시.

## 다음 Phase

계획서 §작업 순서:
- **Phase 5** — 노트 라인 이동 (Shift → / Shift ←)
- Phase 3-2/3-3 — Step/Linear 통합 + schemaVersion 2
- Phase 2 — Measure numbering (sourceMeasure 필드)
- Phase 3-5 — LR 역전 실시간 swap
- Phase 6 — Play 판정 개선 (D2: LN miss 세분화)
