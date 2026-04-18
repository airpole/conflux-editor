# Conflux Editor v20 — Phase 1

v19 단일 5305줄 HTML을 ES 모듈 5개로 분리했습니다. 기능 변경 0, 로직 변경 0 — **순수 구조 이동만**.

## 파일 구조

```
index.html                 # HTML/CSS만 (<script type="module">로 main.js 로드)
src/
  constants.js             # 52줄 — TPB, 색상, 키 매핑, 저지먼트 윈도우, $ 헬퍼
  core/
    state.js               # 22줄 — D (차트 데이터 트리)
  domain/
    timing.js              # 214줄 — compBPM, t2ms, ms2t, 타임시그, getGridLines
                           #   bpmS 캐시는 모듈 로컬로 봉인됨
    shape.js               # 245줄 — ease, getShape, getLines, shape 캐시
                           #   shape/lines 캐시 모두 모듈 로컬
  main.js                  # 4481줄 — 나머지 전부 (렌더링, 입력, UI, 플레이, 오디오)
```

## 실행 방법

모듈 스크립트는 `file://`로 열리지 않습니다. 로컬 서버가 필요합니다.

```bash
cd conflux-editor-v20-phase1
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 열기
```

또는 VS Code Live Server 확장, `npx serve` 등 어떤 정적 서버도 가능.

## Phase 1에서 바꾼 것

1. **5개 파일로 분리**. 모듈 간 의존 방향: `constants → state → timing, shape → main`.
2. **bpmS / shape / lines / TS 캐시를 해당 모듈의 모듈 스코프에 봉인.** main.js에서 직접 접근 불가 (`_cachedLeftChain` 등 내부 이름 15개 전부 leak 없음 확인).
3. **4개 inline assignment handler를 addEventListener로 변환** (module scope let에는 `onchange="..."`로 도달 불가):
   - `mGlobalOff` (`globalOffset`)
   - `mHitVol` (`hitVol`)
   - `mSpd` (`pvSpd`)
   - `mThk` (`nThk`)
4. **나머지 44개의 onclick=, oninput= 핸들러는 유지.** main.js 맨 아래의 `Object.assign(window, {...})` 블록에서 필요한 57개 함수 + `D` + `$`를 `window`에 노출.

## Phase 1에서 바꾸지 않은 것

- 전역 let 변수 30+개 (`selectedNotes`, `pendLN`, `edPlay`, `pvOn`, …) — 전부 main.js 모듈 스코프로 이사만 했음.
- 렌더링 경로 — `drawN`, `drawS`, `drawGameFrame` 모두 그대로.
- Undo/redo — 스냅샷 기반 `saveHist('n'|'s'|'m')` 그대로.
- 캐시 invalidation 호출 지점 — 호출자가 `invalidateShapeCache()`를 매번 부르는 v19 패턴 유지. Phase 2에서 자동화.
- 오디오/판정/입력 로직 — 1:1 복사.

## 다음 단계 (Phase 2부터)

plan 문서의 로드맵대로:
- **Phase 2** (반나절): 5개 dirty-flag 캐시 → 일반화된 `defineCache`/`invalidate` 추상화
- **Phase 3** (저녁 1회): Command 패턴 도입 (기존 saveHist와 병행)
- **Phase 4** (저녁 1–2회, 가장 큰 이득): `drawN`/`drawS`/`drawGameFrame`의 1000줄 중복 → 공유 `renderNotes`

## 검증 체크리스트 (다음 실행 시)

직접 열어서 해볼 것들:
- [ ] 차트 파일 로드 (auto-save 프롬프트 포함)
- [ ] Notes 탭에서 Tap / Long / Wide / Wide Long 그리기
- [ ] Shapes 탭에서 왼쪽/오른쪽 경계 편집, Step/Linear/Sine easing
- [ ] Preview 재생 (오디오 싱크, 히트사운드)
- [ ] Play 모드 (키 6개 입력, 콤보, 판정)
- [ ] Undo/Redo (각 탭에서)
- [ ] Files 모달 (저장, 불러오기, 삭제)
- [ ] Meta 탭: Global Offset, Hitsound Volume, Speed, Note Thickness 슬라이더가 반응하는지 ← **이번에 수정한 4개**

문제가 있으면 v19로 언제든 돌아갈 수 있음 (파일이 별도).
