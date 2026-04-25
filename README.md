# Conflux Editor v21 — Phase 6

**Play 모드 판정 개선 (D2 정책 + LN tail 콤보 + Preview invalid 표시)**

LN의 head/tail을 별개 판정으로 분리. Mid-release 시각 dim. Preview에 Line 1/4 invalid 경고 표시.

## 정책 요약 (D2 확정)

| 상태 | 콤보 | Miss 카운트 | Score 기여 |
|---|---|---|---|
| Head 성공 | +1 | 0 | head type (S/P/G) 가중치 |
| Tail 성공 (LN 완주) | +1 추가 | 0 | +1 (SYNC 가중치) |
| Head miss | 0으로 리셋 | +2 (LN), +1 (non-LN) | 0 |
| Mid-release | 0으로 리셋 | +1 | head 가중치만 (tail 0) |
| Mid-release 후 재진입 | 불가 (`playHitMap.has` 자동 차단) | — | — |

## 데이터 구조 변경

**기존 `playHitMap`**: `note → {diff, type, hitMs}`

**신규 `playHitMap`**:
```js
// Non-LN
{headHit:true, headDiff, headType, headMs, isLN:false, tailDone:true}

// LN (head 성공 직후)
{headHit:true, headDiff, headType, headMs, isLN:true,
 tailDone:false, tailFailed:false, tailMs}

// LN (tail 결정 후)
//   완주: tailDone:true,  tailFailed:false
//   중간 release: tailDone:true, tailFailed:true
```

**`playMissSet`**: 의미 좁힘 — head를 놓친 노트만 (`checkPlayMisses` 콜백). Mid-release는 `playHitMap`의 `tailFailed` 플래그로 판단.

## 새 함수

### `applyTailSuccess(note, curMs)`
LN의 tail 성공 처리. `tailDone=true`, 콤보 +1. 재호출 idempotent (이미 tailDone이면 no-op).

### `applyMidRelease(note, curMs)`
LN의 mid-release 처리. `tailFailed=true`, 콤보 0 리셋, "MISS" 텍스트 +1.

## 판정 흐름

### 수동 Play

1. `handlePlayKeyDown`: head 윈도우 안에 들어온 노트 찾아서 `applyJudgment` (콤보+1, headType 기록). LN이면 `playHoldState[ch]=note`로 hold 시작.
2. `handlePlayKeyUp`: hold 중인 LN이 있으면 release 시점을 tail tick과 비교.
   - `curMs < tailMs - JUDGE_GOOD` → mid release: `applyMidRelease` (콤보 리셋, miss +1)
   - 그 외 → tail success: `applyTailSuccess` (콤보 +1)
3. `checkPlayMisses` (scheduler.js, 무수정): head 윈도우 닫혀도 못 잡으면 `playMissSet` 추가, 콤보 리셋. **D2 head-miss → 2 miss는 점수 계산식에서 LN 분기로 처리** (동일 콜백, 별도 카운트 변환 불필요).

### Wide LN (Q1)

`handlePlayKeyUp`에서 key transfer 우선 시도. 다른 key가 hold 중이면 transfer (no-op return). 모든 키 떼진 경우에만 일반 LN과 같은 tail 판정.

### Autoplay

기존 `autoJudge`는 head만 처리. **신규 tail sweep**: 매 frame `playHitMap`을 훑어서 `isLN && !tailDone && curMs >= tailMs`인 항목을 `applyTailSuccess`. O(active LN) — 일반적으로 한 자릿수.

## 점수 계산 (drawPlayHUD)

**기존**:
```js
total = sum(LN ? 2 : 1)  // already correct
score = (S + P*0.9 + G*0.5) / total * 1M
mCount = playMissSet.size
```

**신규**:
```js
// Iterate playHitMap once
for rec in playHitMap.values():
  if headType == 'SYNC':  sCount++
  elif PERFECT: pCount++
  elif GOOD: gCount++
  if isLN && tailDone:
    if tailFailed: midReleases++
    else:          tailHits++

// LN head-miss = 2 miss points
headMissPoints = sum(2 if LN else 1 for n in playMissSet)
mCount = headMissPoints + midReleases

total = sum(LN ? 2 : 1)
numerator = (sCount + tailHits) + pCount*0.9 + gCount*0.5
score = numerator / total * 1M
acc   = numerator / total * 100
```

`tailHits`는 분자에 SYNC 가중치(1.0)로 기여. UI counts.sync에는 head SYNC + tail success 합산 표시.

## 시각 dim

`drawGameFrame`의 `_gfState`에 `isMidRelease` 플래그 추가. `(isMissed || isMidRelease) && n.duration > 0 → alpha 0.3`. Wide LN body에도 동일 적용. 

Body consumption (judgment line 위로 깎이는 효과)은 head가 잡히고 정상 진행 중인 LN에만 적용 — mid-release는 깎지 않고 전체 body가 dim 상태로 유지.

## Preview Invalid 표시 (Q4)

`opts.showInvalid` 플래그 추가:
- **활성 Play session** (`playLoop`에서 호출): `false` — 게임 중 빨간 테두리는 시각 노이즈
- **Idle Play preview** (`drawPlayIdle`에서 호출): `true` — 정적 미리보기는 편집 피드백 성격

drawGameFrame head pass에 빨간 테두리 + halo 추가 (LN head + Tap head 둘 다). drawN/drawS와 동일 패턴.

## 위험 지점 점검

### 연속 LN (head1 hit → tail1 잡힌 채 head2 시점)

사용자가 키를 떼지 않으면 head2는 head miss 처리. 새로 키 누르려면 한 번 떼야 함. 자연스러운 리듬게임 동작. **변경 없음**.

### Body consumption + dim 충돌

Mid-release 직후, `s.isHit && !s.isMissed`로 body가 깎이던 기존 로직이 mid-release LN을 잘못 깎을 위험 → `!s.isMidRelease`도 조건에 추가. Mid-release 상태에서는 body 전체가 dim 상태로 유지.

### 재진입 방지

`getPlayJudgment`의 기존 `playHitMap.has(n) || playMissSet.has(n)` 체크가 자동으로 작동. Mid-release한 LN은 `playHitMap`에 entry가 있어서 다시 못 잡음. **추가 코드 불필요**.

## 변경 요약

| 파일 | 변경 | 줄 변화 |
|---|---|---|
| `main.js` | playHitMap schema, applyTailSuccess/applyMidRelease 신규, handlePlayKeyUp 재작성, checkPlayMisses 콜백 주석, autoplay tail sweep, drawPlayHUD 재계산, dim alpha + body consumption 분기, Preview invalid 테두리, opts.showInvalid 분기 | 4501 → 4630 (+129) |

기타 10개 파일 무변경. `scheduler.js`도 무변경 — 콜백 시그니처 그대로 두고 main.js 콜백에서 LN 분기.

## 회귀 검증 체크리스트

### D2 핵심 동작
- [ ] LN head 잡고 tail까지 유지 → 콤보 +2, miss 0
- [ ] LN head 잡고 tail 전에 손 뗌 → 콤보 0, miss +1, "MISS" 텍스트 1회
- [ ] LN head를 놓침 → 콤보 0, miss +2, "MISS" 텍스트 1회 (2회 아님)
- [ ] Mid-release한 LN을 다시 누름 → 무반응 (재진입 차단)
- [ ] 콤보가 한 LN의 head miss로 두 번 0이 되지 않음

### 시각 dim (Q5)
- [ ] Head miss된 LN의 head/body/tail 모두 alpha 0.3
- [ ] Mid-release한 LN의 남은 body 부분이 alpha 0.3 (consumption 정지)
- [ ] Wide LN도 같은 방식으로 dim
- [ ] Tap miss는 alpha 1 유지 (기존 동작)

### Wide LN (Q1)
- [ ] Wide LN을 키 1로 누름 → 키 2로 transfer → 키 1 떼도 hold 유지
- [ ] 모든 키 떼면 tail 판정 (mid-release 또는 success)
- [ ] Wide LN head-miss 시 miss +2

### 점수 / 카운트 (Q3, Q6)
- [ ] LN 1개 완주 시 카운트 sync +2 (head 1 + tail 1) 또는 head-type +1, tail-sync +1 합산
- [ ] LN head-miss 시 miss 카운트 +2
- [ ] Mid-release 시 miss 카운트 +1
- [ ] 분모 total = non-LN 1개, LN 2개 합산
- [ ] 100% accuracy = 모든 head 잡고 모든 LN 완주

### Autoplay
- [ ] Autoplay 모드에서 LN tail이 자동 처리됨 (콤보 정상 누적)
- [ ] Autoplay에서 시각 dim 발생 안 함 (모두 success이므로)

### Preview invalid (Q4)
- [ ] Notes 탭에서 Line 1에 두 노트 → 빨간 테두리 (Phase 5 그대로)
- [ ] Shape 탭에서도 동일 (Phase 5 그대로)
- [ ] Play 탭 idle (정지 상태) → 빨간 테두리 표시
- [ ] Play 활성 시작 → 빨간 테두리 사라짐
- [ ] Play 중지 후 idle → 빨간 테두리 다시 표시

### 회귀
- [ ] 일반 Tap 노트 판정 정상 (SYNC/PERFECT/GOOD)
- [ ] Phase 5 line drag 정상
- [ ] Phase 4 Copy/Paste/Flip 정상
- [ ] Phase 3-5 Blue/Red Shape 탭 정상
- [ ] 기존 채보 로드 후 Play 정상

## 설계 결정 기록

### §a. Tail success도 SYNC 가중치 (PERFECT/GOOD 없음)

D2 정책에서 tail은 "tail tick 도달 후 release"가 기준이고, head처럼 ms 단위 미세 판정이 없음. 자연스럽게 SYNC 한 종류로 처리. 분자에 1.0 가중치로 기여.

### §b. checkPlayMisses 시그니처 무변경

계획서 §6-2는 콜백을 `onMiss(note, missType)`으로 확장 제안했지만, **실제로 LN/non-LN 구분은 note 자체로 가능** (`note.duration > 0`). 콜백을 단순화하고 분기를 점수 계산 시점으로 옮김. scheduler.js 무변경 → 다른 phase의 변경 없는 깔끔한 분리.

### §c. autoplay tail sweep을 main.js에 둔 이유

scheduler.js는 정렬된 노트 리스트 위에서 binary search 기반으로 동작. Tail sweep은 "현재 hold 중인(active) LN"을 봐야 하는데 이건 `playHitMap` 위의 작업이라 scheduler 패턴과 맞지 않음. main.js의 frame loop 안에 직접 두는 게 자연스러움. 성능 영향: O(active LN per frame), 일반적으로 0~5개.

### §d. opts.showInvalid 플래그 분리

Play idle과 active 두 호출처가 같은 함수를 부르되 다른 시각 정책. opts에 boolean 추가 한 줄로 깔끔히 분기. 기본값 미정의 시 falsy → 보수적으로 안 그림.

### §e. 콤보를 LN당 +2로 한 이유

Q2의 사용자 결정. 의미적으로도 일관됨 — score 가중치도 head + tail 별개로 계산하므로, 콤보도 마찬가지로 LN을 두 번의 "성공"으로 인식. UX적으로 LN 완주 시 콤보가 두 칸 쌓이는 시각적 보상이 있음.

## 다음 Phase

계획서 §작업 순서:
- **Phase 3-2/3-3 + Phase 2** (schemaVersion 2 묶음)
- **Phase 7** — Notes 탭 Command 이관
