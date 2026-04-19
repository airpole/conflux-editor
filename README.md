# Conflux Editor v21 — Phase 1

**Preview → Play 통합 + Autoplay 토글**

Preview 탭을 제거하고, Play 탭 하나로 스크러빙·세션 판정·자동 재생을 모두 처리. 4가지 경우(autoplay ON/OFF × Play/Restart)가 모두 전체화면 진입, HUD는 네 경우 모두 동일.

## 파일 구조 (11개, v20과 동일)

```
index.html      main.js
constants.js    state.js
cache.js        timing.js    shape.js    overlaps.js
commands.js     renderer.js  scheduler.js  # +autoJudge
```

## Phase 1 변경 요약

### 1. 탭 구성 — `Notes / Shapes / Play / Meta` (4개)

`Preview` 탭 완전 제거. `prev` 라우팅 키도 `TAB_MAP`에서 제거.

### 2. Play 탭 컨트롤 바 (단일 줄)

```
[▶/⏸]  [↺]  [============seek============]  00:00  [☐ Auto]
```

- `▶/⏸` (`playToggle`) — 현재 seek 위치에서 재생 / 일시정지 (=기존 "여기서부터")
- `↺` (`playRestart`) — 처음부터 (LEAD_IN 2초 포함)
- seek slider (`playSeekTo`) — 세션 비활성 시만 작동. Play/Restart 누르면 여기 위치에서 시작
- `☐ Auto` (체크박스) — 켜면 자동 SYNC 판정 모드

**탭 간 seek 위치 공유**: seek slider는 `sharedMs`를 조정. Notes/Shapes 탭에서 이동한 위치가 Play 탭에도 반영되고, Play 탭에서 조정한 위치가 다른 탭 seek에도 반영됨.

### 3. Autoplay 동작

| Autoplay | 판정 | 히트사운드 | 화면 |
|---|---|---|---|
| OFF | 키 입력 (기존 Play) | keydown 시 즉시 | 전체화면 + HUD |
| ON | 자동 SYNC | 150ms pre-schedule | 전체화면 + HUD |

**autoplay ON 시 키 입력 무시**: `handlePlayKeyDown/Up`에 `if (playAutoplay) return;` 가드. 자동으로만 판정, 유저 터치는 pause 외엔 반응 안 함.

### 4. 전체화면

**4가지 조합 모두 전체화면 진입**. `startPlay(fromBeginning, autoplay)` 내부에서 `playFullscreen = true` 강제. `stopPlay` 시 해제 + 일반 Play 탭 idle 화면 복귀.

### 5. `scheduler.js` 확장 — `autoJudge`

```js
resetAutoJudger(curMs)                        // O(log N), binary-search rebind
autoJudge(curMs, isDone, onHit)               // O(1~k)/frame
```

Preview의 auto-hit 로직이 `drawGameFrame` 내부(O(N)/frame)에서 돌던 것을, scheduler 패턴으로 포팅. `notesSorted` 캐시를 재사용하므로 추가 메모리 오버헤드 0. 노트 편집 시 version 추적으로 자동 rebind.

autoplay 모드의 playLoop:
```js
if (playAutoplay) {
  scheduleHitsounds(curMs, 150, actx, playHitAt);
  autoJudge(curMs, n => playHitMap.has(n),
            (n, diff) => applyJudgment(n, diff, curMs, /*silent=*/true));
}
```

`applyJudgment`의 `silent` 플래그는 오토플레이 시 `playHit()` 즉시 재생 생략용 (hitsound는 scheduleHitsounds가 AudioContext에 미리 scheduling함).

### 6. `drawGameFrame` 단순화

**이전**: `opts.hitMap === null`이면 "preview mode"로 들어가서 내부적으로 hitSet에 자동 기록, HUD까지 직접 그림. 분기 5곳.

**이후**: `hitMap`은 항상 `Map`, `missSet`은 항상 `Set`. 분기 완전 제거. idle 상태는 공유 `_EMPTY_HITMAP`/`_EMPTY_MISSSET` 전달.

HUD 내부 렌더링은 제거됨. `drawPlayScreen`이 `drawUnifiedHUD`를 명시적으로 호출 (기존 구조).

### 7. 제거된 함수·변수 (v20 → v21)

**함수 5개**: `pvToggle`, `pvStop`, `pvRestart`, `pvSeekTo`, `pvFullscreen`, `pvExitFullscreen`, `rszFSCanvas`, `drawP`, `getPvMs` (총 9개)

**상태 10개**: `pvOn`, `pvMs`, `pvRAF`, `pvT0`, `pvMs0`, `pvAudioStarted`, `pvFSOn`, `hitSet`, `hitEndSet`, `pvLastJudg`

**DOM**: `#prevP`, `.pv-fs` 오버레이, `#pvFS`, `#pvFSCv`, `#pvSeek`, `#pvTime`, `#pvPlayBtn`, `#pvFSPlayBtn`, `#pvI`, `#pvFSI`, `#pvFSSeek`, `#pvFSTime`, `#playStartBtns`, `#playStopBtn`, `#playStatsTxt`

**신규 추가**: `playToggle`, `playRestart`, `playSeekTo` (함수), `playAutoplay` (상태), `#playBtn`, `#playSeek`, `#playTime`, `#playAutoChk` (DOM), `_EMPTY_HITMAP`/`_EMPTY_MISSSET` (공유 stub)

## 숫자

| 항목 | v20 Phase 5 | v21 Phase 1 | 차이 |
|---|---|---|---|
| 파일 수 | 11 | 11 | 0 |
| main.js | 4371 | 4253 | **−118** |
| index.html | 428 | 386 | −42 |
| scheduler.js | 168 | 194 | +26 (autoJudge) |
| constants.js | 51 | 51 | 0 |
| 총 JS | ~5316 | ~5224 | −92 |

## 회귀 검증 체크리스트

**Play 탭 기본 동작:**
- [ ] Play 탭 진입 시 static preview가 sharedMs 위치에 표시
- [ ] Notes 탭에서 노트 편집 → Play 탭 전환 → 그 위치의 static preview
- [ ] Play 탭 seek slider로 위치 이동 → 다른 탭 seek에도 반영
- [ ] Space 키로 playToggle 작동 (Play 탭 활성 시)

**Autoplay OFF (기존 Play 모드):**
- [ ] ▶ 버튼 → 현재 seek 위치에서 시작 → 전체화면 진입
- [ ] ↺ 버튼 → 처음부터 (lead-in 2초) → 전체화면 진입
- [ ] 키 입력 판정 정상 (SYNC/PERFECT/GOOD/MISS)
- [ ] 노트 miss 판정이 기존과 동일한 타이밍 (±100ms)
- [ ] Wide 노트 miss 판정 ±100ms
- [ ] LN tail release 판정
- [ ] 세션 종료 시 toast로 결과 요약
- [ ] 연속 두 번 ▶ → 두 번째도 정상
- [ ] 음악 끝 + 2초 후 자동 종료

**Autoplay ON:**
- [ ] Auto 체크박스 ON → ▶ → 모든 노트 자동 SYNC
- [ ] 히트사운드가 정확한 타이밍에 (노트 head ms에 맞춰)
- [ ] 키 눌러도 아무 반응 없음
- [ ] HUD (combo/score/counters/title 등) 정상 표시
- [ ] 중간에 pause 버튼 누르면 즉시 정지, 결과 toast 나오지 않음
- [ ] Auto ON + ↺ → 처음부터 자동 재생
- [ ] 재생 중 Auto 체크박스 조작은 세션 끝나기 전까지 영향 없음 (세션 시작 시점 값 고정)

**전체화면:**
- [ ] 4가지 모두 전체화면 진입 (Auto × {Play, Restart})
- [ ] 전체화면 종료 (Escape 키, pause 버튼, native gesture) 시 Play 탭으로 복귀
- [ ] 전체화면 canvas가 16:9 비율로 레터박스 정렬

**Seek 관련:**
- [ ] Play 세션 중 seek slider 조작 무시 (`playSeekTo`는 `playActive` 시 early return)
- [ ] 세션 시작 전 seek slider 이동 → static preview 그 위치로 이동
- [ ] 세션 종료 후 seek 값이 종료 위치 반영

**탭 간 상호작용:**
- [ ] Play 탭에서 세션 중 다른 탭 전환 시도 → 세션 자동 종료 (`goTab`의 stopPlay)
- [ ] Play 세션 중 Meta 탭의 BPM 변경 불가능 (탭 이동 시 세션 종료됨)
- [ ] 세션 종료 후 Notes 탭 이동 → 세션 종료 위치에서 작업 이어가기

**Edit command 회귀 (Phase 1 바깥이지만 확인):**
- [ ] Meta 탭 BPM 추가/편집/삭제 → undo/redo 정상
- [ ] Notes 편집 → saveHist 기반 undo 정상
- [ ] Shapes 편집 → saveHist 기반 undo 정상

**파일 로드/저장:**
- [ ] v20 저장 파일 로드 정상
- [ ] 로드 후 Play 탭 진입 → 정상 static preview
- [ ] 자동 저장 정상 (60초 주기 + beforeunload)

## 실행

```bash
python3 -m http.server 8000   # 또는 GitHub Pages
```

GitHub Pages 배포 시 11개 파일 모두 root에 평탄하게 업로드.

## 다음 Phase

계획서 §작업 순서 추천 기준:
- **Phase 3-1** — Shape sel+del 다중 삭제 (사용자 가장 불편, 구현 쉬움)
- **Phase 3-4** — Wide head + step 렌더링 버그 수정
- **Phase 4** — Flip 명료화 + long-press paste
- ...

Phase 1에서 놓친 점 있으면 Phase 2 이후로 넘어가기 전에 수정.
