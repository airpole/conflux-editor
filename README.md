# Conflux Editor v20 — Phase 5

핫사운드 스케줄러와 미스 체커를 **O(N)/프레임 → O(1)/프레임**으로. 500+ 노트 차트에서 체감 가능한 성능 개선.

## 파일 구조 (11개)

```
index.html      main.js (4371줄)
constants.js    state.js
cache.js        # +getVersion()
timing.js       shape.js    overlaps.js    commands.js    renderer.js
scheduler.js    # NEW — 160줄
```

## Phase 5 변경

### 1. `scheduler.js` 신설

두 개의 포인터 기반 sweeper + 바이너리 서치 reset.

```js
// 공통 캐시
defineCache('notesSorted', ['notes'], () => [...D.notes].sort(...));

// 히트사운드 스케줄러
resetHitScheduler(curMs)                              // O(log N)
scheduleHitsounds(curMs, lookaheadMs, actx, playHitAt)  // O(1~k)/frame

// 미스 체커
resetMissChecker(curMs)                               // O(log N)
checkPlayMisses(curMs, isDone, onMiss)                // O(1~k)/frame
```

v19의 `for (const n of D.notes)` 전체 스캔이 사라지고 **이미 지난 노트 포인터가 단조 증가**. 각 세션에서 amortized O(N) 총합, O(1) per-frame 기대값.

### 2. `cache.js` 확장

`getVersion(key)` 추가. 캐시가 rebuild될 때마다 version 증가. Scheduler가 이를 관찰해서 **노트 편집 후 자동으로 포인터 리셋** — `invalidate(['notes'])` 한 번이면 스케줄러도 따라옴.

### 3. 두 가지 정직한 설계 결정

**(a) Monotonic 가정 깨지지 않게**: `JUDGE_GOOD`과 `JUDGE_WIDE_SYNC`가 현재는 둘 다 100이지만 **미래에 달라질 수 있음**. 미스 체커는 `maxWin` 기준으로 포인터 advance, 개별 노트는 자기 window로 판정. "Wide window가 더 크면 Regular 노트가 먼저 window 닫혀도 포인터는 아직 못 넘어가" 같은 엣지 케이스 대응.

**(b) DI (Dependency Injection)**: `scheduleHitsounds`가 `actx`, `playHitAt`을 파라미터로 받음. scheduler.js가 audio 레이어에 결합 안 됨. 테스트/리플레이스 쉬움.

### 4. main.js 변경

- 기존 `_hsScheduledUpTo`, `_hsScheduledNotes`, `resetHitScheduler`, `scheduleHitsounds`, `checkPlayMisses` 구현 제거 (~35줄)
- 호출부 어댑팅:
  - `resetHitScheduler()` → `resetHitScheduler(pvMs)` 3군데 (pvToggle/pvRestart/pvSeekTo)
  - `scheduleHitsounds(pvMs, 150)` → `scheduleHitsounds(pvMs, 150, actx, playHitAt)` + 가드 조건을 호출부로 올림
  - `checkPlayMisses(curMs)` → `checkPlayMisses(curMs, isDone, onMiss)` — 콜백 두 개 전달
- `startPlay`에 `resetMissChecker(offMs)` 추가 — 연속 play 세션에서 포인터 stale 방지

## 숫자

| 항목 | Phase 4a | Phase 5 | 차이 |
|---|---|---|---|
| 파일 수 | 10 | 11 | +1 |
| main.js | 4387 | 4371 | −16 |
| scheduler.js | — | 160 | NEW |
| **scheduleHitsounds 복잡도** | O(N)/frame | **O(1~k)/frame** | |
| **checkPlayMisses 복잡도** | O(N)/frame | **O(1~k)/frame** | |

k = 이번 프레임에 window 안으로 들어온 노트 수. 보통 0–2개, 최악(같은 tick에 수십 노트 집중) 상수 수십.

## 성능 검증 가이드

**체감 측정법** (Chrome DevTools, 모바일 지원):

1. DevTools → Performance 탭 열기
2. 500+ 노트가 있는 차트 로드 (Waves Flux 정도면 충분)
3. Preview 재생 시작, 몇 초 뒤 Record 중단
4. Flame graph에서 `scheduleHitsounds` 프레임 찾기:
   - Phase 4a: 각 프레임 `D.notes.length`만큼 스캔 — 500 노트면 체감 가능한 CPU 사용
   - Phase 5: 프레임당 거의 0ms, 포인터 체크만

**주관적 체감**: 로우엔드 모바일에서 긴 차트 Preview 시 프레임 드롭 완화. S24+는 Phase 4a에서도 드롭 없을 가능성이 커서 눈으로 안 보일 수도 있음 — DevTools가 정확함.

## 검증 체크리스트

**회귀 체크 (가장 중요):**

- [ ] **Preview**: 재생/정지/Seek 반복 → 히트사운드가 정확한 타이밍에 나는지 (v19와 동일)
- [ ] **Preview**: seek 후 **이미 지난 노트의 히트사운드가 뒤늦게 들리지 않는지** ← v19의 `_hsScheduledUpTo` 대신 WeakSet 기반으로 바꾸면서 가장 회귀 가능성 있는 부분
- [ ] **Preview**: 노트 편집(Notes 탭에서 새 노트 추가) 후 Preview → 새 노트의 히트사운드가 나는지 (cache version 추적 작동 확인)
- [ ] **Play 모드**: 정상적으로 MISS 판정이 나는지 (window 지난 노트)
- [ ] **Play 모드**: 두 번 연속 실행 → 두 번째 play도 정상 (resetMissChecker 작동 확인)
- [ ] **Play 모드**: 와이드 노트 MISS가 정확한 타이밍(±100ms)에 나는지

**엣지 케이스:**
- [ ] Lead-in 구간(curMs < 0)에서 히트사운드가 안 나는지 (기존과 동일해야 함)
- [ ] Preview 일시정지 → 재시작 → 히트사운드 재중복 안 나는지

## 실행

```bash
python3 -m http.server 8000   # 또는 GitHub Pages
```

## 남은 Phase (계획 문서 §5)

- **Phase 4b** (skipped): 필요해지면. 지금은 Phase 4a만으로 충분
- **Phase 6** (ongoing): Notes/Shapes 편집을 Command 패턴으로 점진 이관. 시간 제약 없음, 기능 추가하면서 자연스럽게

Phase 5까지 끝나면 계획 문서 §7 "성공 기준" 네 개 중 세 개 달성:
1. ✅ 새 편집 액션 → Command 하나 정의하면 끝 (Phase 3, Meta 범위)
2. 🟡 노트 렌더링 바꾸면 세 곳 대신 renderer.js 한 곳 (Phase 4a, primitive 차원까지)
3. ✅ Tempo/TS 편집 undo 자동 (Phase 3)
4. ✅ 1000+ 노트 차트 프레임 드롭 없음 (Phase 5)
5. 🟡 파일당 <600줄 (main.js는 아직 4371; Phase 4b/6 이후 점진 감소)
6. ✅ 차트 로드가 한 줄 (이미 `loadChartData(d)`로 단순)