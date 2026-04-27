# Conflux Editor v21 — Phase 3-2 + 3-3

**Step easing 제거 + Linear 동작 통합 (schemaVersion 2 도입)**

Step을 별도 easing 타입에서 제거하고, "instant jump" 효과는 duration=0 Linear로 통합. 사용자가 같은 tick에 두 점을 두면 자동으로 step 효과 발생.

## 배경

기존 데이터 모델에서 `easing: 'Step'`은 별도 타입이었지만, 실제 동작은 `_evalSorted`의 `e.duration <= 0 → instant jump` 로직이 처리. 즉 **'Step' 라벨은 자료적으로 잉여**.

같은 tick에 점이 둘 있으면(연속된 두 이벤트의 destTick이 같으면), `normalizeShapeChain`이 자동으로 두 번째 이벤트의 duration을 0으로 만듦. 이게 step 효과 그 자체.

따라서 Step을 별도 타입으로 유지할 이유가 없음. Linear로 통합하면 코드 단순화 + UI 단순화.

## 결정

- **Phase 2 (sourceMeasure)**: 스킵. 사용자 결정 — Meta는 채보 작성 전 한 번만 설정하므로 자동 재계산 메커니즘 불필요.
- **Phase 3-2/3-3**: 묶어서 처리.

## 변경

### 데이터 모델 (state.js)

`schemaVersion: 2` 필드 추가. 의미:
- v1 (또는 absent): Step easing이 있을 수 있음. 로드 시 Linear로 자동 변환.
- v2: 현재. Step easing 없음. duration=0이 instant jump 표현.

### 마이그레이션 (main.js loadChartData)

```js
D.shapeEvents.forEach(e => {
  if (e.easing === 'Still' || e.easing === 'Arc') e.easing = 'Linear'; // 기존
  if (e.easing === 'Step') e.easing = 'Linear';                        // 신규
});
// ...
D.schemaVersion = 2;  // 항상 보장
```

기존 `'Still'`/`'Arc'` 마이그레이션은 v17 시절 호환성으로 이미 있었음. `'Step'`만 추가.

`'Step'` 데이터를 `'Linear'`로 바꿔도 **렌더링 결과 무변경** — `_evalSorted`가 `duration <= 0`을 보고 instant jump 처리하므로 easing 값은 무의미.

### 코드 정리

- `shape.js shapeEventCmp`: Step 후순위 tiebreaker 제거 (Step 값이 더 이상 없으므로 의미 없음)
- `shape.js resolveArcEasing`: `'Step'` 분기 제거 — `duration === 0` 체크가 동일 의미
- `main.js addShapeEvt`: Step 분기 제거. 일반 분기로 통합. **+ Phase 3-3 동작**: 같은 destTick + 다른 위치면 새 점 추가 (덮어쓰기 X), 같은 위치면 easing만 갱신 (no-op)
- `main.js Pinch`: `easingL === 'Step' && easingR === 'Step'` 특수 케이스 제거
- `main.js pickEase`: `easeNames`에서 `'Step'` 제거
- `main.js 키보드 단축키`: `5번 = Step` 제거 (1-4만 유효)

### UI 정리

- `index.html`: `easeBtn_Step` 버튼 제거 ("St")
- `index.html`: `easeS`/`easeRS` hidden select에서 `<option>Step</option>` 제거

### 라벨 표시 (시각 정보 유지)

`drawS`의 이벤트 라벨에서 `duration === 0 ? 'Step' : ...` 표현은 **유지**. 'Step'이 데이터의 easing 값이 아니라 **동작 설명**임을 주석으로 명시. 사용자에게는 "이 점은 instant jump"라는 시각적 단서가 여전히 필요.

## Phase 3-3 동작 요약

### 같은 tick에 새 점 추가

사용자가 tick 1000에 이미 점 P1이 있는 상태에서 tick 1000에 새 점 P2를 추가하면:

| 시나리오 | 동작 |
|---|---|
| P2 위치 == P1 위치 | no-op (기존 점 easing만 갱신) |
| P2 위치 != P1 위치 | 새 이벤트 push → normalize 후 P2가 duration=0 (instant jump from P1 to P2 at tick 1000) |

### 드래그로 tick 같게/다르게

`normalizeShapeChain`이 매 drag 종료 시 destTick 기준으로 정렬 + duration 재계산. 즉:
- 점을 끌어서 다른 점과 같은 tick에 두면 → 자동 duration=0 (step 효과)
- 점을 끌어서 다른 tick으로 옮기면 → 자동 duration > 0 (linear 보간)

이건 **이미 구현되어 있던 동작**. Phase 3-3이 별도 코드 추가 없이 기존 normalize 메커니즘으로 자연스럽게 작동함.

## 변경 파일

| 파일 | 변경 | 줄 변화 |
|---|---|---|
| `state.js` | schemaVersion 필드 + 의미 주석 | 28 → 28 (+9 주석) |
| `main.js` | 마이그레이션, addShapeEvt 재작성, Pinch 단순화, pickEase/단축키 정리, 라벨 주석 | 4632 → 4648 (+16) |
| `shape.js` | shapeEventCmp 단순화, resolveArcEasing Step 분기 제거 | 251 → 250 (-1) |
| `index.html` | Step 버튼/option 제거 | 389 → 387 (-2) |

기타 7개 파일 무변경.

## 데이터 호환성

- **v20 이전 파일** (Step easing 포함): 로드 시 자동 Linear로 변환. 시각적 동작 무변경.
- **새 저장 파일**: schemaVersion: 2 명시.
- **v21 → v20 다운그레이드**: 미지원. 새 schema 파일을 옛 코드에 로드 시 — 옛 코드도 `_evalSorted`의 duration=0 처리는 동일하므로 시각적으로 동일하게 작동할 가능성이 높지만 보장 안 됨.

## 회귀 검증 체크리스트

### 마이그레이션
- [ ] 기존 'Step' 이벤트가 포함된 v20 JSON 로드 → 정상 작동, 시각적 무변경
- [ ] 로드 후 다시 저장 → schemaVersion: 2가 들어감
- [ ] 새로 만든 채보도 schemaVersion: 2

### Step 효과 (Phase 3-3 의도)
- [ ] 빈 shape에서 tick 1000에 Linear 점 P1 (위치 16) 추가 → 정상 곡선
- [ ] 같은 tick 1000에 Linear 점 P2 (위치 32) 추가 → P1까지 부드럽게 가다가 tick 1000에서 P2로 instant jump
- [ ] 같은 tick 1000에 Linear 점 P3 (위치 16, P1과 같은 위치) 추가 → no-op (점 추가 안 됨, 화면 변화 없음)

### 드래그 동작
- [ ] 일반 Linear 점을 드래그해서 다른 점과 같은 tick에 둠 → instant jump 효과로 변환
- [ ] 같은 tick의 두 점 중 하나를 끌어서 tick 다르게 만듦 → linear 보간으로 복귀
- [ ] Step-like인 점을 다시 끌어 옮김 → 정상 작동

### Mirror
- [ ] Mirror ON 상태에서 Linear 점 생성 → Blue/Red 양쪽 대칭 점 생성 (기존과 동일)
- [ ] Mirror ON + 같은 tick 두 번 탭 (위치 다르게) → 양쪽에 step 효과 동시 생성

### UI
- [ ] Shape 탭 toolbar에 'St' 버튼 없음
- [ ] easing 선택 가능: Arc, Out, In, Lin (Step 제외)
- [ ] 키보드 1-4번 정상, 5번은 무반응
- [ ] 이벤트 라벨에 duration=0인 점은 'Step' 텍스트 표시 (시각 단서 유지)

### Pinch (Step+Step 특수 케이스 제거 영향)
- [ ] Pinch 도구로 점 생성 → 탭한 위치에 양쪽 점 생성 (이전: Step+Step일 때 자동 중심 snap, 지금은 항상 탭 위치)

### Phase 3-4 회귀 (Step 관련 wide head 처리)
- [ ] Wide head + step 겹침 → 정상 렌더 (Phase 3-4 fix 그대로 작동)

### Phase 1, 4, 5, 6, 3-1, 3-5 회귀
- [ ] Notes 탭 Copy/Paste/Flip
- [ ] Notes 탭 drag 라인 이동, Line 1/4 invalid 빨간 테두리
- [ ] Shape 탭 Sel+Del 다중 삭제
- [ ] Shape 탭 Blue/Red 색상, 곡선 교차 시각화
- [ ] Play 탭 D2 판정 (LN head/tail 분리)

## 설계 결정 기록

### §a. 'Step' 라벨을 시각 표시에 유지

데이터에서는 'Step' easing 제거하지만, UI 라벨 `duration === 0 ? 'Step' : ...`은 그대로. 이유:
- 사용자에게 "이 점은 instant jump"라는 정보 전달이 여전히 필요
- 'Step'이라는 단어가 직관적 (한국어로도 "스텝" 하면 즉시 이해)
- 데이터 모델과 UI 라벨이 1:1 일치할 필요 없음 — 라벨은 "동작 표현", 데이터는 "저장 형식"

### §b. addShapeEvt의 same-tick 분기

기존 코드: 같은 destTick에 점이 있으면 무조건 덮어쓰기 (`exist.targetPos = pos`).

새 코드: 위치가 같으면 덮어쓰기 (안전한 no-op), 위치가 다르면 새 점 추가 (step 효과 생성).

이 분기 없이 항상 새 점 추가하면 — 사용자가 "이 점 위치 살짝 조정하려고 다시 탭"한 경우에도 점이 두 개 생성되어 의도치 않은 step 발생. 위치 비교(`Math.abs(...) < 0.01`)로 미세 차이 허용.

### §c. Pinch의 Step+Step 특수 케이스 제거

기존: Pinch에서 양쪽 다 Step이면 탭 위치를 무시하고 현재 shape의 중심으로 자동 snap. 이건 "Step+Step으로 같은 tick에 양쪽 instant jump하면 가운데 모이는 게 자연스럽다"는 가정.

새 코드: Step이라는 별도 easing이 없으니 이 분기 자체가 무의미. 항상 탭 위치 사용. 사용자가 가운데로 모으고 싶으면 직접 가운데를 탭하면 됨.

### §d. schemaVersion을 D 자체에 두는 이유

대안: 마이그레이션 시점에만 체크하는 변수.

선택: `D.schemaVersion = 2` 필드. 이유:
- 항상 일관된 schema (코드가 schemaVersion 존재 가정 가능)
- 저장 시 자동으로 JSON에 포함
- 미래 schema bump 시 점진적 마이그레이션 코드 작성 용이

## 다음 Phase

계획서 §작업 순서:
- **Phase 7** — Notes 탭 Command 이관 (snapshot으로 추가된 기능들을 점진 Command로)

이게 마지막 phase. 그 후 v21 안정화.
