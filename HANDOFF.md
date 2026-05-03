# Conflux Editor — v21 Refactor Handoff (Phase A + B-2/game-render 완료)

다음 채팅에서 이 문서를 그대로 첫 메시지에 붙여넣으면 새 Claude가 맥락을 잡고 바로 다음 단계에 들어갈 수 있게 작성된 인수인계서.

---

## 0. 어떻게 시작할 건지 (사용자 워크플로우)

새 채팅을 열고 다음을 첨부:
1. **이 문서 (HANDOFF.md)**
2. **`conflux-editor-keyboard-10.zip`** (현재 결과물 전체)

새 Claude에게 보낼 첫 메시지 예시:
> "Conflux Editor v21 리팩토링 이어서 하려고 해. 첨부한 HANDOFF.md를 먼저 다 읽고, 그다음에 zip 안의 코드를 둘러봐. 현재 Phase A + Phase B-2 game-render 완료 상태야. 다음 작업으로 [Phase B-2 shape-render / Phase B-1 / Phase C / Phase D] 진행하자."

---

## 1. 사용자 컨텍스트 (요약)

- **개발자**: WINGSTUN / airpole. 군 복무 중 (~Oct 2026), 모바일 전용 (Samsung S24+), 저녁 18:00–21:00 KST 작업창.
- **프로젝트**: Conflux 리듬 게임의 차트 에디터 (vanilla ES modules, Canvas 2D, GitHub Pages 배포)
- **배포**: `https://airpole.github.io/conflux-editor/`. 플랫 파일 구조 필수. 서브디렉토리 사용 금지. 모든 import는 `./filename.js`. `index.html`의 script src는 `./main.js`.
- **테스트 환경**: Samsung Internet 브라우저, 키보드 없음, 온스크린 Undo/Redo 버튼이 Ctrl+Z 대체.
- **버전 관리 규칙**: `conflux-editor-keyboard-N` 으로 폴더명 증분. **현재 N=10** (Phase A + B-2 game-render). 다음 산출물은 `conflux-editor-keyboard-11`.
- **언어**: 사용자는 한국어로 대화. 코드 주석은 한국어/영어 혼용 가능.

## 2. 현재 상태

### v9 (Phase A) → v10 (+ Phase B-2 game-render 부분)
- **v9**: 44개 .js + index.html, 6,800줄
- **v10**: 44개 .js + index.html, 6,751줄 (-49)
- game-render.js: 574 → **525줄** (Phase B-2 1단계로 helper 통합)

### Phase B-2 v10에서 구체적으로 적용된 것 (game-render.js만)
- `const _tkInfo = new Map(); ...` (12줄) → `makeTkInfoCache('normalized')` (2줄)
- 인라인 filled body + 양쪽 outer boundary stroke (18줄) → `drawShapeBoundary(ctx, lP, rP, STYLE_GAME)` (1줄)
- 인라인 step horizontal connectors (31줄) → `drawStepConnectors(ctx, stepTicks, tk2y, p2x, STYLE_GAME_STEP, 'normalized', {topY: gy, botY: gy+gh})` (2줄)
- import 라인에 `makeTkInfoCache, drawShapeBoundary, drawStepConnectors, STYLE_GAME, STYLE_GAME_STEP` 추가
- 헤더 코멘트 갱신 (Phase A → Phase B 진행상황 반영)

### 행동 동등성 검증
- Helper 색상/폭 프로필이 인라인 코드의 hex/width와 1:1 매칭됨:
  - STYLE_GAME: fill `#121212`, leftStroke/rightStroke `#ffffff44`, lineWidth `1.5`
  - STYLE_GAME_STEP: leftStroke/rightStroke `#ffffff88`, lineWidth `1.8`, gapStroke `#ffffff66`, gapWidth `1.5`
- Helper의 `lP.length < 2` early-return은 원본의 fill 가드와 동등 (lP=1일 때 stroke는 시각적으로 무효였음)
- 모든 44개 파일 `node --check` 통과, 의존성 그래프 명시적 검증 완료

### 가장 큰 파일 (v10 기준)
```
525 game-render.js   ← Phase B-2 1차 완료 (적정선)
404 notes-render.js  ← OK 그대로 유지
392 notes-input.js   ← OK
389 shape-render.js  ← Phase B-2 다음 타겟 (~200줄 목표)
368 shape-input.js   ← OK
270 play-render.js   ← OK
```

### v10 진척도 메트릭 (HANDOFF §8 빠른 사실 확인용 명령어 결과)
```
saveHist 호출 사이트: 35개 (Phase B-1 미진행)
  shape-input.js: 8, notes-input.js: 6,
  shape-tools.js: 4, notes-tools.js: 4,
  text-events.js: 3, main.js: 2, keyboard.js: 2,
  import-export.js: 2, history.js: 2, file-manager.js: 2, commands.js: 2

onclick= 카운트: 64 (Phase C 미진행)
Lazy import 카운트: 52 (Phase D 미진행)
총 라인: 6,751
```

### Phase A 핵심 패턴 (꼭 따라야 함, 변동 없음)
1. **Shared mutable state objects**: `ES`, `AS`, `PS` 객체 필드로 mutate.
2. **Lazy imports for cycles**: 52개 `import('./...')` 호출. Cycle 안 생기면 정적으로.
3. **HTML untouched in Phase A/B**: index.html의 64개 `onclick=`는 Phase C에서 제거.
4. **History snapshot system 그대로**: `saveHist('n'|'s'|'m')` 31개 호출, B-1에서 commands.js로.

### 구조 (변동 없음)

```
Layer 0 (state):     editor-state, audio-state, play-state, utility, constants
Layer 1 (data):      shape, timing, cache, overlaps, scheduler, commands, state, renderer
Layer 1.5 (helpers): grid-render, shape-render-helpers   ← game-render가 사용 시작
Layer 2 (services):  jacket, audio, load-chart, history, fullscreen, canvas-resize
Layer 3 (UI tools):  tab-nav, grid-picker, edit-options, text-events,
                     notes-tools, shape-tools, key-config, meta-ui,
                     file-manager, import-export, autosave
Layer 4 (render):    notes-render, shape-render, game-render, play-render
Layer 5 (input):     notes-input, shape-input, edit-playback,
                     play-judgment, play-input, play, keyboard
Layer 6 (entry):     main
```

### 사용자 테스트 권장
v10에서 Play 모드 (idle 화면 + 실제 plays)를 v9와 비교해서 모양이 동일한지 확인:
- shape body 색이 동일 (#121212 회색)
- 좌/우 boundary stroke 색·굵기 동일 (#ffffff44, 1.5)
- step 자리에서 가로 직선 connector 색·굵기 동일 (#ffffff88, 1.8)
- step에서 chain이 교차할 때 dashed gap line이 동일 (#ffffff66, 1.5)
- Note rendering, hit effects, judgment line, text events overlay는 helper화 안 됨 — 그대로

---

## 3. Phase B-2 다음 타겟: shape-render.js

`shape-render.js` (389줄)에는 `drawS`가 있음. Phase B-2 game-render와 동일한 패턴 적용:
- **`STYLE_SHAPE_EDITOR` profile** 사용 (raw chains, blue/red, crossing dashes)
- **`makeTkInfoCache('raw')`** 사용 (drawS는 raw + normalized 둘 다 보관해야 함)
- **`drawShapeBoundary`** 호출
- **`drawStepConnectors(..., 'raw', {topY: gy, botY: gy+gh})`** 호출
- **`drawGrid(ctx, layout, divPerBeat, STYLE_SHAPE)`** 호출 (drawS는 grid도 helper화 가능. game-render는 grid가 없음)

### 작업 순서
1. shape-render.js 열어서 위 4개 (grid, tk-info, boundary, step-connectors) 인라인 블록 위치 식별
2. import 추가
3. 인라인 → helper 호출로 1:1 교체
4. helper와 인라인의 색·폭 프로필 매칭 검증 (`STYLE_SHAPE_EDITOR`, `STYLE_SHAPE` 정의 참고)
5. node --check + 의존성 그래프 검증
6. 사용자가 Shape 탭 화면 v9 ↔ v11 시각 비교 가능하도록 **diff에 포함된 색/폭 매칭 테이블 명시**

### 주의: drawS는 raw chains 표시
drawS는 두 개의 곡선을 독립적으로 보여줘야 하므로 normalize 안 함. helper가 'raw' 모드를 지원하니 그대로 사용 가능. drawS의 step에서 chain이 교차하면 dashed line이 그어져야 하는데 helper가 raw 모드에서 두 케이스 (prs<cls or crs<pls) 모두 한 dashed segment로 처리 (game은 normalized라 별도). 이건 원본 drawS도 동일 동작.

---

## 4. Phase B-1 — Command 마이그레이션 (변동 없음)

이전 HANDOFF §3 그대로. `commands.js`는 v10에서 그대로 유지 (`AddNote`, `DeleteNotes`, `MoveNotes`, `FlipNotes`, `PasteNotes`, `SetNoteDuration` 도우미가 들어있음 — phase A 시점에 미리 만들어둠).

작업 순서 권장:
1. notes-tools.js의 `doFlipSelected`, `doCopy`/`doPaste`, `shiftSelectedByDelta`부터
2. notes-input.js의 tap/drag handlers
3. shape 쪽 동일 (note-commands 같은 shape-commands.js 새로 만들기)
4. 텍스트 이벤트는 별도 (AddTextEvent / DeleteTextEvent / EditTextEvent)
5. 모두 끝난 뒤 `history.js`의 `histScopes.n`, `histScopes.s` 제거. m-scope만 남김.

행동 변화 없음 — undo/redo 동일 동작 보장. 한 카테고리씩 잘게 자르기.

---

## 5. Phase C — Inline HTML Handler 제거 (변동 없음)

이전 HANDOFF §4 그대로. 64개 onclick →addEventListener + data-action 디스패처.

그룹별 작업 단위:
1. 탭 네비 (4개)
2. Notes 툴바 (~15개)
3. Shape 툴바 (~15개)
4. Meta 탭 (~10개)
5. File 모달 + Play 컨트롤 + 모달 닫기 (~10개)
6. Text event 모달 (~5개)
7. Jacket / 오디오 / 기타 (~5개)

---

## 6. Phase D — Lazy Import 정리 + Dirty Render (변동 없음)

이전 HANDOFF §5 그대로. lazy import 52개 정리 + dirty-render.js 도입.

---

## 7. 하지 말아야 할 것 (변동 없음)

- ❌ 서브디렉토리 만들기 — 모든 파일은 루트에
- ❌ `import` 경로에 `/` 두 개 이상 — `./filename.js`만
- ❌ Phase A/B-2 game-render 검증된 부분 임의 수정
- ❌ HTML 구조 변경 (Phase C는 attribute만 변경, 마크업 동일)
- ❌ `cache.js`, `state.js`, `constants.js`, `scheduler.js`, `renderer.js`, `overlaps.js`, `commands.js`, `timing.js`, `shape.js`, `grid-render.js`, `shape-render-helpers.js` 수정 (이미 깨끗함)
- ❌ Step easing 부활 (D4 결정에 따라 'Step' → 'Linear' 자동 마이그레이션)

## 8. 사용자 의사결정 이력 (참고, 변동 없음)

- D1: tempo/TS entry에 `sourceMeasure` 문자열 필드
- D2: LN miss scoring — head-miss=2, mid-release=1, full-success=0
- D3: drag 시 boundary type 실시간 swap
- D4: `easing: 'Step'` → `'Linear'` 자동 마이그레이션, schemaVersion=2

## 9. 빠른 사실 확인용 명령어

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
```

## 10. 다음 단계 추천 순서

1. **Phase B-2 shape-render** (이번 산출물의 직접 후속)
2. **Phase B-1** (command 마이그레이션) — 한 카테고리씩 잘게
3. **Phase C** (inline handler 정리)
4. **Phase D** (lazy import + dirty render)

이 v10 산출물 다음으로 가장 자연스러운 건 **shape-render**다. game-render와 같은 helper를 사용하므로 패턴 익숙하고, 사용자가 픽셀 비교만 하면 검증 끝.

---

**v10 산출 채팅에서 작성. 다음 채팅에 zip + 이 문서 첨부하면 정확히 이어받음.**
