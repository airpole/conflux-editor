# Conflux Editor v21 — Phase 3-1

**Shape sel + del 다중 삭제**

Shape 탭 툴바의 `Sel` → `Del` 콤보로 여러 shape 점을 한 번에 삭제.
v21 Phase 1에서 통합된 Play 탭 구조 유지, 변경 사항 없음.

## Phase 3-1 변경 요약

### 1. Shape 툴바 `Sel + Del` 콤보 활성화

**이전**: Shape 탭 `Del` 버튼은 `setST('del')` 호출하지만 `setST`가 `del` 분기를 처리하지 않아 무반응. shape 점 삭제는 키보드 `Delete`/`Backspace`로만 가능 → 모바일에서 사실상 불가능.

**이후**: Notes 탭 (`setNT('del')`) 과 동일한 패턴으로 `setST` 수정:
- `sTool === 'sel'` + 선택 있음 + `del` 버튼 탭 → **선택된 shape 일괄 삭제**
- 그 외 → 기존대로 `sTool = 'del'` 설정 (현재 빈 동작)

### 2. `sel-on` 스타일 적용 (Shape 탭)

Notes 탭 Sel 버튼은 녹색 배경(`sel-on` 클래스)으로 "선택 모드" 시각화가 되지만, Shape 탭 Sel 버튼은 보라색(`on`)만 사용하고 있었음. 이제 두 탭이 동일한 시각 피드백.

### 3. 키보드 Delete와 툴바 버튼 통일

`doShapeSelectionDelete()` helper 신설. 툴바 `setST('del')`과 키보드 `Delete/Backspace` 핸들러가 동일한 helper 호출 → 로직 중복 제거.

**보호 규칙 (기존 그대로 유지):**
- Init event (`easing === null`, Left/Right 앵커 행) 는 삭제 불가 — 선택되어 있어도 silent skip
- 선택된 것이 전부 init뿐이면 `Init 이벤트는 삭제할 수 없습니다` toast

### 4. Undo/Redo 전략

**사용자 확정: 옵션 1 (snapshot 방식)**. Phase 3-1은 기존 `saveHist('s')` 스냅샷 스택 사용. 다중 삭제 후 Ctrl+Z 한 번에 복원.

**근거**: Shape 탭은 기존 편집 전부 snapshot 기반. 여기에 Command를 섞으면 두 스택의 순서 인터리브 문제가 생김 (예: drag→다중삭제→Ctrl+Z가 뭘 되돌려야 하는지 모호). Shape 탭이 전부 Command로 이관되는 Phase 3-5에서 `DeleteShapeEvents` factory도 함께 사용 예정.

**현 상태 (계획)**: `commands.js`에 `DeleteShapeEvents` factory **존재만 함** (Phase 3-5용 예약). `main.js`는 import하지 않고 사용하지 않음.

## 파일 변경

| 파일 | 변경 | 줄 변화 |
|---|---|---|
| `main.js` | `setST` 확장, `doShapeSelectionDelete` 추가, 키보드 Delete handler 통일 | 4266 → 4297 (+31) |
| `commands.js` | `DeleteShapeEvents` factory 예약 (미사용) | 173 → 199 (+26) |
| `index.html` | Shape `Del` 버튼 tooltip 업데이트 | +0 (수정만) |

총 JS 줄 수: 5224 → 5281 (+57)

## 회귀 검증 체크리스트

**Phase 3-1 신규 기능:**
- [ ] Shape 탭 진입 → `Sel` 버튼 녹색(sel-on) 배경으로 표시
- [ ] Shape 점 3개 선택 (Sel 모드) → `Del` 버튼 탭 → 한 번에 3개 삭제
- [ ] 삭제 후 Ctrl+Z (또는 undo 버튼) → 3개 모두 복원
- [ ] Redo → 다시 삭제됨
- [ ] Sel 모드 + 선택 없음 → `Del` 탭 → `sTool = 'del'`로 전환 (기존 동작)
- [ ] Sel 모드 + 선택에 Init event만 포함 → `Del` 탭 → toast "Init 이벤트는 삭제할 수 없습니다", 아무것도 안 삭제됨
- [ ] Sel 모드 + 선택에 Init + 일반 event 혼합 → 일반만 삭제, toast "N개 shape 삭제 (Init M개 유지)"

**회귀 (Phase 3-1 바깥):**
- [ ] 키보드 Delete/Backspace → 동일하게 다중 삭제 동작 (통일 helper 경유)
- [ ] Shape 점 1개 선택 + 키보드 Delete → 단일 삭제 정상
- [ ] Notes 탭 Sel+Del → 기존 동작 유지 (이 phase와 무관)
- [ ] Shape Arc/Line/Pinch 툴 전환 시 선택 해제 정상
- [ ] Shape 드래그 편집 → undo 정상 (기존 snapshot 경로)

**Play 탭 (Phase 1 회귀):**
- [ ] Play 탭 진입 시 static preview에 HUD 표시
- [ ] Autoplay OFF/ON × Play/Restart 네 조합 모두 전체화면 진입

## 다음 Phase

계획서 §작업 순서:
- **Phase 3-4** — Wide head + step 렌더링 버그 수정 (범위 좁음)
- **Phase 4** — Flip 명료화 + long-press paste
- **Phase 5** — 노트 라인 이동
- **Phase 3-2/3-3** — Step/Linear 통합 (schemaVersion 2)
- **Phase 2** — Measure numbering
- **Phase 3-5** — LR 역전 실시간 swap (DeleteShapeEvents Command 이때 활성화)
- **Phase 6** — Play 판정 개선
