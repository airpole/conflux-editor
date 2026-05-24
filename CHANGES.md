# Conflux 버그 수정 변경 요약 (Round 1 + 2 누적)

## 이번 round (round 2) 추가 변경

### #13 — 마이그레이션 안내 정정
이전 round 1 안내 ("LeaF Aleph-0의 BPM 500 → 250으로 변경 필요") 는 **잘못된 안내**. 정정:

- **음악과 노트의 sync는 `t2ms`/`ms2t` 함수가 결정하는데, 이 함수들은 BPM(D.tempo)만 보고 박자표 분모를 보지 않음**. 따라서 분모 처리 수정은 sync에 영향 없음.
- 사용자가 보고서에 적은 "7/8 입력 후 BPM 2배 올려서 우회"는 **마디 시간을 절반으로 줄이기 위한 우회책**이었음. 분모 수정 후 새 차트에서는 자연스러운 BPM(250)으로 입력하면 됨.
- **기존 차트는 그대로 두면 sync는 그대로 유지됨**. 단 시각적으로 변경되는 부분이 있음:

#### 시각적 변경 확인 포인트 (사용자가 LeaF Aleph-0 차트로 확인해야 할 것)
1. **그리드 라인**: 7/8 영역(tick 245760-259200, 33마디 부근)에서 박자 라인이 8분음표 단위로 촘촘하게 그려짐. 기존엔 4분음표 단위로 7개 (마디 1개)였던 게 신규엔 8분음표 단위로 14개 (마디 2개).
2. **마디 번호**: 같은 영역에 마디가 33, 34로 두 개 표시. 기존엔 33만 표시되고 그 마디가 두 배 길게 보였음.
3. **메트로놈**: 7/8 영역 재생 시 8분음표 단위로 7번 클릭, 1박째마다 다운비트 톤.

만약 위 변경이 보이지 않는다면 브라우저 캐시 무효화 필요.

---

### 빨간 테두리 표시 통일
- **Notes**: wide-wide invalid도 빨간 테두리 표시 (round 1 #4에서 이미 처리)
- **Shapes**: normal 노트만 표시 (기존 동작 유지, 변경 없음 — `shape-render.js` line 210에 이미 `!n.isWide` 가드 있음)
- **Play**: 라이브 재생 중에도 wide+normal 전부 표시
  - `play-render.js`: `drawPlayScreen`의 `showInvalid: false` → `true`

### Notes에서 wide LN body 위 라인 구분선 문제
- `notes-render.js`: 채널 구분선과 wide LN body의 그리기 순서를 바꿈
  - 기존: wide LN body → 채널 구분선 (구분선이 LN body 위에 그어져 보임)
  - 신규: 채널 구분선 → wide LN body (LN body가 구분선을 덮어 깔끔)
- 결과: shapes/play와 동일한 시각

### Shapes에서 BPM/박자 마커가 마디 번호와 겹침
- `shape-render.js`: BPM/TS 마커 라벨을 화면 **오른쪽 끝**에 우측정렬로 그리도록 변경
  - 기존: `gx + 3` (왼쪽) — 마디 번호와 같은 위치라 겹쳤음
  - 신규: `gx + gw - 3` 우측정렬
- TS(박자표) 마커도 새로 추가 — 기존엔 BPM만 표시됐음. Notes 탭과 동일하게 양쪽 정보 표시
- BPM과 TS가 같은 tick에 있으면 BPM 위, TS 아래로 stack

---

## Round 1에서 처리된 항목 (이번에도 모두 포함)

### #1 Shape init 복사 제외 — `shape-tools.js`
`doShapeCopy()`에서 init 이벤트(`easing === null`) 필터링.

### #3 노트 선택 우선순위 — `notes-input.js`
`findNoteAt()`에 priority: tap(0) → hold(1) → wide tap(2) → wide hold(3). Sel/Del 양쪽에 적용.

### #4 Wide-wide 겹침 빨간 표시 — `overlaps.js`, `notes-render.js`, `game-render.js`
overlaps.js에 wide 노트 간 invalid 검출 추가. notes-render/game-render는 wide도 ov 조회.

### #6 Restart 시 첫 노트 효과음 — `play.js`, `scheduler.js`
- `playLoop`: audio 시작 시점에 `resetHitScheduler(curMs)` 호출
- `scheduleHitsounds`: `LATE_TOL_MS = 50` 도입 — 약간 늦은 노트도 즉시 emit

### #7 탭 전환 후 첫 재생 싱크 — `play.js`
`startPlay`를 두 단계로 분리해 AudioContext가 suspended 상태면 `resume()` 완료 후 진행.

### #8 Auto 초기 동기화 — `play.js`
`_startPlayImpl` 진입 시점에 체크박스 상태를 PS.playAutoplay에 직접 반영. 체크박스가 source of truth.

### #9 Jacket preview 표시 — `jacket.js`
`_syncJacketUI`를 실제 HTML 요소 ID(`jacketPrev`, `jacketLbl`, `jacketClearBtn`)에 맞게 수정.

### #11 Quick-long + tap 겹침 표시 (L1/L4) — `notes-input.js`
L1/L4에서 quick-long 시 기존 tap을 displace하지 않고 추가 → invalid 빨간 테두리로 표시. L2/L3는 기존 displace 유지.

### #13 박자표 분모 처리 — `timing.js`, `edit-playback.js`, `grid-render.js`
- timing.js: `tpbUnit = TPB * 4 / ts.denominator`, `tpm = tpbUnit * ts.numerator`
- edit-playback.js: 메트로놈도 분모 단위 비트로 클릭
- grid-render.js: subdivision skip을 beat tick set과 매칭

---

## 변경된 파일 (13개)
- `edit-playback.js` (round 1)
- `game-render.js` (round 1)
- `grid-render.js` (round 1)
- `jacket.js` (round 1)
- `notes-input.js` (round 1)
- `notes-render.js` (round 1 + round 2)
- `overlaps.js` (round 1)
- `play.js` (round 1)
- `play-render.js` (round 2 신규)
- `scheduler.js` (round 1)
- `shape-render.js` (round 2 신규)
- `shape-tools.js` (round 1)
- `timing.js` (round 1)

---

## 여전히 보류
- **#2** Notes/Shape follow 등속도 — 사용자가 "일단 수정하지 않는 것으로 생각중"
- **#5** -1 보라색 마디 싱크 — 차트 정보 필요
- **#10** 저장 시스템 — v26에서 정상
- **#12** 31.1 표기 — 사용자 결정으로 현행 유지
