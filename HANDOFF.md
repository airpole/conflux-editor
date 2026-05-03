# Conflux Editor — v21 Refactor Handoff (Phase A + B-2 완료 + B-1 인프라 준비)

다음 채팅에서 이 문서를 그대로 첫 메시지에 붙여넣으면 새 Claude가 맥락을 잡고 바로 다음 단계에 들어갈 수 있게 작성된 인수인계서.

---

## 0. 어떻게 시작할 건지 (사용자 워크플로우)

새 채팅을 열고 다음을 첨부:
1. **이 문서 (HANDOFF.md)**
2. **`conflux-editor-keyboard-11.zip`** (현재 결과물 전체)

새 Claude에게 보낼 첫 메시지 예시:
> "Conflux Editor v21 리팩토링 이어서 하려고 해. 첨부한 HANDOFF.md를 먼저 다 읽고, 그다음에 zip 안의 코드를 둘러봐. 현재 Phase A + Phase B-2 완료, Phase B-1 인프라 준비 완료. 다음 작업으로 [Phase B-1 doFlipSelected / Phase B-1 doPaste / Phase B-1 sel-del / Phase B-1 노트 입력 핸들러 / Phase C / Phase D] 진행하자."

---

## 1. 사용자 컨텍스트 (요약)

- **개발자**: WINGSTUN / airpole. 군 복무 중 (~Oct 2026), 모바일 전용 (Samsung S24+), 저녁 18:00–21:00 KST 작업창.
- **프로젝트**: Conflux 리듬 게임의 차트 에디터 (vanilla ES modules, Canvas 2D, GitHub Pages 배포)
- **배포**: `https://airpole.github.io/conflux-editor/`. 플랫 파일 구조 필수. 서브디렉토리 사용 금지. 모든 import는 `./filename.js`. `index.html`의 script src는 `./main.js`.
- **테스트 환경**: Samsung Internet 브라우저, 키보드 없음, 온스크린 Undo/Redo 버튼이 Ctrl+Z 대체.
- **버전 관리 규칙**: `conflux-editor-keyboard-N` 으로 폴더명 증분. **현재 N=11**. 다음 산출물은 `conflux-editor-keyboard-12`.
- **언어**: 사용자는 한국어로 대화. 코드 주석은 한국어/영어 혼용 가능.

## 2. 현재 상태

### 진척 요약
- v9 (Phase A): 6,800줄
- v10: + Phase B-2 game-render → 6,751줄 (-49)
- **v11: + Phase B-2 shape-render + B-1 인프라** → 6,863줄 (+112; commands.js에 노트/텍스트 명령 factory 추가)

### Phase B-2 v11에서 적용된 것 (shape-render.js)
- `_tkInfo` Map + getTkInfo (12줄) → `makeTkInfoCache('raw')` (1줄)
- L curve stroke + R curve stroke (14줄) → `drawShapeBoundary(ctx, lPts, rPts, STYLE_SHAPE_EDITOR)` (1줄)
- 인라인 step horizontal connectors (14줄) → `drawStepConnectors(ctx, stepTks, t2y, p2x, STYLE_SHAPE_EDITOR_STEP, 'raw', {topY: gy, botY: gy+gh})` (2줄)
- import에 makeTkInfoCache, drawShapeBoundary, drawStepConnectors, STYLE_SHAPE_EDITOR, STYLE_SHAPE_EDITOR_STEP 추가
- 헤더 코멘트 갱신
- shape-render.js: 389 → 366줄

### shape-render-helpers.js 보정 (drawS의 실제 인라인 동작과 매칭)
- **STYLE_SHAPE_EDITOR 수정**: fill `#12121266` → `null`, lineWidth `2` → `1.5`, gapStroke `#ffffff44` → `null`. 이전 정의는 Phase A에서 추측으로 만든 것이었고 사용처가 없었음 — drawS의 실제 인라인은 fill 안 함, lineWidth 1.5, gap dashed line 안 그림.
- **STYLE_SHAPE_EDITOR_STEP 신규**: leftStroke `#6bb5ffaa`, rightStroke `#ff6b8aaa`, lineWidth `1.5`, gapStroke null.
- STYLE_GAME / STYLE_GAME_STEP은 변동 없음 — game-render.js 영향 없음.

### Phase B-1 인프라 준비 (commands.js)
HANDOFF v9가 "review/note-commands.js에 도우미들이 이미 있다"고 명시했으나 실제 zip에는 미포함이었음. v11에서 commands.js에 직접 추가:
- `AddNotes(notes)` / `DeleteNotes(notes)` — 다중 추가/삭제 by reference
- `MoveNotes(moves)` — drag end 시 startTick/channel 일괄 변경
- `FlipNotes(pairs)` — channel mirroring (per-note newChannel)
- `SetNoteDuration(note, newDuration)` — LN 길이 변경
- `AddTextEvents(events)` / `DeleteTextEvents(events)` / `EditTextEvent(event, oldFields, newFields)` — 텍스트 이벤트
- 모든 factory가 invalidates: `['notes']` 또는 `['textEvents']` 선언 (textEvents cache는 아직 없지만 미래 호환)

이 factory들은 v11에서 정의만 되고 사용처는 없음 — Phase A의 STYLE_SHAPE_EDITOR / dirty-render.js 같은 사전 인프라 패턴.

### 행동 동등성 검증 (shape-render)
- BPM markers, Grid, Wide LN bodies, line dividers, 2-pass 노트 렌더, shape event dots, center dots/pinch stars, pending-arc, playback line, mirror axis: **변경 없음**
- 색·폭 매칭 표:

| 인라인 | helper |
|---|---|
| L curve `#6bb5ff` w1.5 (no fill) | STYLE_SHAPE_EDITOR.leftStroke `#6bb5ff`, lineWidth 1.5, fill null |
| R curve `#ff6b8a` w1.5 | STYLE_SHAPE_EDITOR.rightStroke `#ff6b8a` |
| Step L `#6bb5ffaa` w1.5 | STYLE_SHAPE_EDITOR_STEP.leftStroke `#6bb5ffaa`, lineWidth 1.5 |
| Step R `#ff6b8aaa` w1.5 | STYLE_SHAPE_EDITOR_STEP.rightStroke `#ff6b8aaa` |
| 인라인 gap line 없음 | gapStroke: null (helper 블록 스킵됨) |

### 가장 큰 파일 (v11)
```
525 game-render.js   ← v10에서 처리됨 (적정선)
404 notes-render.js  ← OK 그대로
392 notes-input.js   ← Phase B-1 타겟 중 하나
368 shape-input.js   ← Phase B-1 타겟 중 하나 (별도 shape-commands 필요)
366 shape-render.js  ← v11에서 처리됨 (적정선)
317 commands.js      ← v11에서 인프라 추가
270 play-render.js   ← OK
```

### v11 진척도 메트릭
```
saveHist 호출 사이트: 35개 (Phase B-1 미진행 — factory만 준비됨)
  shape-input.js: 8, notes-input.js: 6,
  shape-tools.js: 4, notes-tools.js: 4,
  text-events.js: 3, main.js: 2, keyboard.js: 2,
  import-export.js: 2, history.js: 2, file-manager.js: 2, commands.js: 2

onclick= 카운트: 64 (Phase C 미진행)
Lazy import 카운트: 52 (Phase D 미진행)
총 라인: 6,863
```

### 사용자 테스트 권장 (v11)
v11에서 Shape 탭 화면을 v10과 비교:
- 푸른 L curve, 빨간 R curve 선이 동일하게 보임 (#6bb5ff, #ff6b8a, 굵기 1.5)
- Step에서 chain이 점프할 때 가로 segment가 alpha 적용된 동일 색 (#6bb5ffaa, #ff6b8aaa, 굵기 1.5)
- BPM markers (보라 ♩숫자), grid lines, 회색 배경, line dividers, wide LN body, 노트 헤드/바디, shape event dots (파란/빨간 동그라미), center dots (녹색 C), pinch stars, mirror axis는 미변경
- Play 모드 (game-render)는 v10에서 검증됐으므로 변동 없음

### 구조 (변동 없음)

```
Layer 0 (state):     editor-state, audio-state, play-state, utility, constants
Layer 1 (data):      shape, timing, cache, overlaps, scheduler, commands, state, renderer
Layer 1.5 (helpers): grid-render, shape-render-helpers   ← shape-render도 사용 시작
Layer 2 (services):  jacket, audio, load-chart, history, fullscreen, canvas-resize
Layer 3 (UI tools):  tab-nav, grid-picker, edit-options, text-events,
                     notes-tools, shape-tools, key-config, meta-ui,
                     file-manager, import-export, autosave
Layer 4 (render):    notes-render, shape-render, game-render, play-render
Layer 5 (input):     notes-input, shape-input, edit-playback,
                     play-judgment, play-input, play, keyboard
Layer 6 (entry):     main
```

### Phase A 핵심 패턴 (변동 없음)
1. **Shared mutable state objects**: `ES`, `AS`, `PS` 객체 필드로 mutate.
2. **Lazy imports for cycles**: 52개 `import('./...')` 호출.
3. **HTML untouched in Phase A/B**: index.html의 64개 `onclick=`는 Phase C에서 제거.
4. **History snapshot system**: 호환성 위해 saveHist는 유지. Phase B-1에서 호출 사이트들이 commands로 옮겨가며 점진 폐기.

---

## 3. Phase B-1 — Command 마이그레이션 (다음 단계)

### 첫 추천: doFlipSelected (notes-tools.js, 가장 작고 깨끗)
현재 패턴:
```js
export function doFlipSelected() {
  if (ES.selectedNotes.size === 0) { toast('No notes selected'); return; }
  let count = 0;
  for (const n of ES.selectedNotes) {
    if (n.isWide) continue;
    const next = MIRROR_CH[n.channel];
    if (next !== undefined && next !== n.channel) { n.channel = next; count++; }
  }
  if (count === 0) { toast('Nothing to flip'); return; }
  saveHist('n');                                          // ← 변경 후 스냅샷
  import('./notes-render.js').then(m => m.drawN());
  toast(`${count}개 노트 뒤집기`);
}
```

마이그레이션 후 (mutate 전에 pairs 수집, dispatch가 mutate):
```js
import { dispatch, FlipNotes } from './commands.js';

export function doFlipSelected() {
  if (ES.selectedNotes.size === 0) { toast('No notes selected'); return; }
  const pairs = [];
  for (const n of ES.selectedNotes) {
    if (n.isWide) continue;
    const next = MIRROR_CH[n.channel];
    if (next !== undefined && next !== n.channel) {
      pairs.push({ note: n, newChannel: next });
    }
  }
  if (pairs.length === 0) { toast('Nothing to flip'); return; }
  dispatch(FlipNotes(pairs));                              // ← apply가 mutate 수행
  // saveHist 제거. dispatch 후 redraw는 main.js의 onDispatch listener가 처리.
  toast(`${pairs.length}개 노트 뒤집기`);
}
```

**확인 필요**: main.js에 onDispatch listener가 등록돼 있어 dispatch 후 redraw + autoSave 호출하는지. v11 grep:
```
grep -n "onDispatch" main.js commands.js meta-ui.js
```

### 다음 우선순위 (Phase B-1 순서)
1. **notes-tools.js 4사이트** (doFlipSelected, doPaste, sel+del in setNT, ...)
2. **notes-input.js 6사이트** (tap-add, drag-move-commit, LN-add, etc.)
   - Drag move는 incremental이라 까다로움: drag start 시 `oldStartTick/oldChannel` 캡처 → drag 동안 직접 mutate (snapshot 없이) → drag end 시 `dispatch(MoveNotes(moves))` 한 번만
   - shiftSelectedByDelta는 drag end 시 일괄 commit
3. **text-events.js 3사이트** (AddTextEvents, DeleteTextEvents, EditTextEvent)
4. **shape-tools.js + shape-input.js 12사이트** (shape-commands.js 신규 모듈 또는 commands.js 확장)
5. **마지막 정리**: history.js의 `histScopes.n`, `histScopes.s` 제거 (m-scope만 남김)

### 주의사항
- **incremental drag mutation**: drag 동안 노트가 직접 mutate되면 redraw에 OK. drag end 시 dispatch가 다시 mutate를 시도하지 않도록, MoveNotes는 newStartTick/newChannel을 받아 final state로 set. apply는 oldStartTick/oldChannel을 처음 호출 시 capture (위 factory 정의 참고).
- **redraw 책임**: dispatch 후 자동 redraw가 일어나야 함. main.js에 `onDispatch(() => { drawN(); drawS(); })` 같은 listener가 등록돼 있는지 확인 (이미 m-scope 명령들이 작동하므로 있을 것).
- **autosave**: 마찬가지로 onDispatch 안에 scheduleAutoSave가 있어야.

---

## 4. Phase C — Inline HTML Handler 제거 (변동 없음)

64개 onclick → addEventListener + data-action 디스패처. 그룹별 작업 단위:
1. 탭 네비 (4개)
2. Notes 툴바 (~15개)
3. Shape 툴바 (~15개)
4. Meta 탭 (~10개)
5. File 모달 + Play 컨트롤 + 모달 닫기 (~10개)
6. Text event 모달 (~5개)
7. Jacket / 오디오 / 기타 (~5개)

---

## 5. Phase D — Lazy Import 정리 + Dirty Render (변동 없음)

lazy import 52개 정리 + dirty-render.js 도입. dirty-render.js는 review/ 폴더에서 만들어졌다고 v9 HANDOFF에 적혀있으나 **실제로는 zip 미포함** — Phase D 진입 시 새로 만들어야 함.

---

## 6. 하지 말아야 할 것 (소폭 갱신)

- ❌ 서브디렉토리 만들기 — 모든 파일은 루트에
- ❌ `import` 경로에 `/` 두 개 이상 — `./filename.js`만
- ❌ Phase A/B-2 검증된 부분 임의 수정
- ❌ HTML 구조 변경 (Phase C는 attribute만 변경, 마크업 동일)
- ❌ 다음 파일들 수정 (이미 깨끗함, 단 commands.js와 shape-render-helpers.js는 새 factory/profile 추가는 OK):
  - `cache.js`, `state.js`, `constants.js`, `scheduler.js`, `renderer.js`, `overlaps.js`, `timing.js`, `shape.js`, `grid-render.js`
- ❌ Step easing 부활 (D4 결정에 따라 'Step' → 'Linear' 자동 마이그레이션)

## 7. 사용자 의사결정 이력 (변동 없음)

- D1: tempo/TS entry에 `sourceMeasure` 문자열 필드
- D2: LN miss scoring — head-miss=2, mid-release=1, full-success=0
- D3: drag 시 boundary type 실시간 swap
- D4: `easing: 'Step'` → `'Linear'` 자동 마이그레이션, schemaVersion=2

## 8. 빠른 사실 확인용 명령어

```bash
# 모든 파일 syntax check
for f in *.js; do node --check "$f" 2>&1 | head -3; done

# 큰 파일 순위
wc -l *.js | sort -rn | head -15

# saveHist 호출 사이트 (Phase B-1 진척도 측정)
grep -c "saveHist" *.js | grep -v ":0$"

# onclick= 카운트 (Phase C 진척도 측정)
grep -c "onclick=" index.html

# Lazy import 카운트 (Phase D 진척도 측정)
grep -E "import\(['\"]\\./" *.js | wc -l

# Note command factory 사용 사이트 (Phase B-1 진척도 정량화)
grep -nE "AddNotes|DeleteNotes|MoveNotes|FlipNotes|SetNoteDuration|AddTextEvents|DeleteTextEvents|EditTextEvent" *.js | grep -v "commands.js"
```

## 9. 다음 단계 추천 순서

1. **Phase B-1 doFlipSelected** (가장 작은 단위, 사용자가 모바일에서 flip 한 번 하고 undo/redo 시 정상 동작 확인)
2. **Phase B-1 doPaste, sel+del** (notes-tools.js 마저)
3. **Phase B-1 notes-input.js** (tap/drag — drag end 시 MoveNotes commit)
4. **Phase B-1 text-events.js**
5. **Phase B-1 shape-input.js + shape-tools.js** (shape-commands factory들 추가 후)
6. **Phase B-1 마무리**: history.js의 n/s scope 제거
7. **Phase C** (inline handler 정리)
8. **Phase D** (lazy import + dirty render)

각 Phase B-1 단계가 끝날 때마다 사용자가 모바일에서 해당 작업 + Ctrl+Z (Undo 버튼) 해보고 동작 확인.

---

**v11 산출 채팅에서 작성. 다음 채팅에 zip + 이 문서 첨부하면 정확히 이어받음.**
