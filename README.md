# Phase 3-2/3-3 Fix — 무한 점 추가 + step lock 버그

## 수정한 두 문제

### 문제 1: 같은 tick에 점 무한 추가

**증상**: 사용자가 같은 tick에 반복해서 탭하면 P3, P4, P5… 점이 무한정 쌓임. Normalize 후 사실상 마지막 점만 효과를 갖지만 데이터에 잉여 점이 누적.

**원인**: 이전 버전의 `addShapeEvt`는 "같은 tick + 다른 위치면 새 점 추가"만 분기. **점 개수 제한 없음**.

**수정**: `addShapeEvt`에서 같은 tick·같은 side의 기존 점 개수를 세서:

| N (기존 점 수) | 동작 |
|---|---|
| 0 | 새 점 push (일반 새 점) |
| 1 | 위치 같으면 no-op, 다르면 새 점 push (step 워크플로우) |
| 2+ | **마지막 점 위치/easing만 갱신** (P3, P4 추가 차단) |

이는 사용자 멘탈 모델과 일치: "step의 도착 위치를 조정한다". 데이터적으로도 의미 있는 점은 P1(시작)과 P2(도착)뿐. P3 이상은 `normalize` 후 모두 duration=0인 zombie 점이 되어 마지막 것만 효과.

### 문제 2: Linear → step 변환 후 영구 lock

**증상**: Linear 점을 sel+drag-move로 끌어서 다른 점과 같은 tick에 두면 (의도된 step 변환), 그 후 다시 다른 tick으로 끌어 옮겨도 **여전히 step (duration=0)** 유지. 한 번 step이 된 점은 영원히 step.

**원인**: `dragMoveSel`의 onMove 핸들러 (line 2418-2426)에 step 보존 분기가 있었음:

```js
// 버그 코드
if (ev.duration === 0) { ev.startTick = newDest; }       // 'step 유지'
else { ev.startTick = 0; ev.duration = newDest; }        // '일반 유지'
```

이건 "한 번 step이면 영원히 step, 한 번 일반이면 영원히 일반"을 코드로 박은 셈. Phase 3-3의 의도("드래그로 tick이 같아지면 step, 달라지면 linear로 자동 전환")와 정반대.

**수정**: 분기 자체를 제거. 항상 `ev.startTick = 0; ev.duration = newDest`로 표현하고, **normalize가 결정하게 위임**:

```js
// 수정 후
ev.startTick = 0;
ev.duration = newDest;
// normalize: dest === prevEnd면 duration=0으로 자동 변환 (step)
//            dest > prevEnd면 duration > 0 (linear 보간)
```

이제 사용자가 tick을 옮길 때마다 normalize가 매번 step/linear를 새로 결정. 같은 tick에 두면 step, 다른 tick으로 떨어뜨리면 linear 복귀.

## 미해결 문제 (별도 phase 검토)

### 문제 3: Cen + Step 조합의 비직관적 시각화 (Image 1)

Cen 도구는 한 번 탭에 left+right 두 점 동시 생성. Step 워크플로우(같은 tick 두 번 탭)와 곱해지면 점 4개 (left 2 + right 2) 생성. 사용자 멘탈 모델에서는 "한 step 동작"이지만 화면에는 4개의 별개 점이 보임.

이건 **본질적인 표현 한계**라 단순 fix가 아니라 UX 재설계 필요. 별도 phase 검토 권고:
- 시각화 통합 (점 쌍을 묶어 표시)
- 또는 Cen 도구가 step과 함께 쓰일 때 단일 멘탈 단위로 다루기

## 변경 파일

| 파일 | 변경 | 줄 변화 |
|---|---|---|
| `main.js` | addShapeEvt 분기 재작성 (N=0/1/2+ 케이스), dragMoveSel의 step-preserve 분기 제거 | 4648 → 4670 (+22) |

기타 파일 무변경.

## 회귀 검증

### 문제 1 (무한 점 추가)
- [ ] 같은 tick에 점 P1 (위치 16) → 같은 tick 위치 32 탭 → P2 추가됨 (step 효과)
- [ ] 또 같은 tick 위치 8 탭 → P3 **추가 안 됨**, 대신 P2 위치가 8로 갱신됨
- [ ] 또 같은 tick 위치 24 탭 → P3 추가 안 됨, P2 위치 24로 갱신
- [ ] 점 개수가 2개로 안정됨 (탭 무한 반복해도)

### 문제 2 (step lock 해제)
- [ ] Linear 점 두 개 (tick 500과 tick 1000) → 두 번째 점을 sel+drag로 첫 번째와 같은 tick (500)으로 옮김 → step 효과 발생, 라벨 'Step'으로 표시
- [ ] 그 점을 다시 sel+drag로 tick 1500으로 옮김 → **Linear로 복귀**, 라벨 'Lin'으로 표시
- [ ] 점을 tick 500↔1500 왔다갔다 → step↔linear가 자동 토글

### 회귀
- [ ] Phase 3-2 정상 (Step 버튼 없음, 키 1-4 정상)
- [ ] Phase 3-3 step 만들기 정상 (같은 tick 두 번 탭)
- [ ] Phase 3-1 sel+del 정상
- [ ] Phase 3-5 Blue/Red 곡선 교차 정상
- [ ] Mirror 정상
- [ ] 기존 채보 로드 정상

## 설계 결정

### §a. "마지막 점만 갱신"이 P1 보존을 보장

`D.shapeEvents.filter`는 원본 순서 보존. `D.shapeEvents.push` 순서가 곧 chain 순서 (normalize의 stable sort가 같은 _dest 내에서 push 순서 유지). 따라서 `sameTickSameSide[length-1]`이 항상 "step의 도착점 = P2"이고, P1은 안전하게 보존됨.

### §b. drag handler에서 step 결정을 normalize에 위임

step/linear 결정을 두 곳에서 하면 일관성 깨짐. Drag handler는 "사용자 의도(이 점은 dest tick X에 있다)"만 표현하고, **chain 정합성(이전 점과의 상대 위치 → step or linear)** 은 `normalizeShapeChain`이 단독 결정. 이 패턴이 `addShapeEvt`에서도 동일 — 단일 책임.

### §c. 문제 3을 미루는 이유

Cen + step의 시각 복잡도는 데이터 구조 자체가 "한 동작 = 4 점"이라 발생. 해결하려면:
- 시각화에서 점을 묶어 표시 (drawS의 dot 렌더 코드 큰 변경)
- 또는 Cen 도구의 데이터 모델 변경 (left/right 쌍을 단일 entry로)

둘 다 작업량이 크고 다른 부분과 영향 범위 큼. 현재 fix scope 외.
