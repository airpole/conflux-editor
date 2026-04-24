# Conflux Editor v21 — Phase 3-5

**체인의 방향성 제거 — Blue/Red 모델**

Shape 체인의 시맨틱을 "left/right boundary"에서 "두 개의 독립된 색 곡선"으로 전환. 역전 개념이 사라져서 normalize 알고리즘 불필요.

## 배경

Phase 3-4 README에 이미 언급: *"LR 역전 상태(left > right, 계획서 §D3가 Phase 3-5에서 해결 예정)가 가능한 현 시점에서..."*

기존에는 Left 체인과 Right 체인이 각각 "판의 왼쪽 boundary"와 "오른쪽 boundary"라는 **방향 의미**를 가졌음. 사용자가 편집 중 교차를 만들면 "역전"이라는 오류 상태가 됨.

하지만 실제 편집 워크플로우는 **교차를 적극 활용**함:
> A는 Linear로 -4에서 4까지 움직이고, B는 A를 축으로 sine 곡선을 그리는 경우, A를 깔아놓고 B만 움직여서 내가 원하는 모양을 만드는 게 훨씬 편함. (사용자 Q3 답)

이 워크플로우를 지원하려면 역전을 "허용"하고 렌더링 시점에 교정해야 함. 그런데 여기서 **발상 전환**: 체인에 방향 의미가 없다면, 교차는 오류가 아니라 자연스러운 상태가 됨.

## 해결 — 발상 전환

| | 기존 | Phase 3-5 |
|---|---|---|
| 체인 이름 | Left / Right | Blue / Red |
| 의미 | 판의 왼/오 boundary | 단순 색 식별자 |
| 교차 | "역전" = 오류 상태 | 정상, 의도된 편집 |
| 데이터 필드 | `isRight: bool` | **동일 필드** (의미만 재해석) |
| Normalize 알고리즘 | 필요 (이벤트 삽입, 수치 이분법) | **불필요** |
| 렌더링 교정 | 복잡한 데이터 정리 | 매 tick min/max (1줄) |

**데이터 구조와 필드명은 무변경** — schemaVersion bump 없음, 호환성 완벽. 오로지 *의미 재해석 + 렌더링 레이어 1줄 추가 + UI 레이블 변경*.

## 동작 — 세 탭 정리

### Shape 탭 (편집)

- Blue 체인 (파란 선, `isRight=false`)과 Red 체인 (분홍 선, `isRight=true`)을 각각 raw 데이터 그대로 표시
- 사용자는 두 곡선을 독립적으로 조작 — Blue로 축을 깔고 Red로 장식하는 등 자유롭게
- 교차 시각적으로 보임 (편집 피드백)
- Mirror 기능 그대로 작동 (중심축 기준 반대 체인 대칭 이벤트 생성)

### Notes 탭

- 영향 없음. Notes 탭은 애초에 Shape를 소비하지 않음 (4-column fixed grid)
- 코드 변경 0줄

### Preview / Play 탭 (drawGameFrame)

- 매 tick에서 `actualLeft = min(blue.pos, red.pos)`, `actualRight = max(blue.pos, red.pos)`
- 판 boundary가 자연스럽게 정렬된 상태로 렌더
- 교차 구간에서 판이 "뒤집혀" 보이는 현상 해결
- Blue/Red 식별은 gameplay에서 무의미 — 플레이어는 판의 위치만 본다

## 구현

### `drawGameFrame`의 `getTkInfo` 캐시에서 swap

```js
// 기존
info = {sh: getShape(tk), lines: getLines(tk)};

// Phase 3-5
const raw = getShape(tk);
const sh = raw.left <= raw.right ? raw : { left: raw.right, right: raw.left };
info = { sh, lines: getLines(tk) };
```

`getTkInfo(tk).sh`를 소비하는 drawGameFrame 내부 15+ 곳이 **자동으로 정리된 값을 받음**. 단일 수정점으로 전체 전파.

### 직접 `getShape` 호출 2곳 — Step connector, Wide head step rendering

`getTkInfo`를 거치지 않는 `getShape(stk - 0.0001)` / `getShape(stk + 0.0001)` 패턴이 drawGameFrame 내 2곳 있음:
- Step horizontal connector 그리기
- Wide head의 step 겹침 렌더링 (Phase 3-4)

양쪽 모두 동일 min/max swap 적용.

### UI 리라벨

```html
<!-- 기존 -->
<button title="Left boundary [Q]">Left</button>
<button title="Right boundary [W]">Right</button>

<!-- Phase 3-5 -->
<button title="Blue chain [Q]" style="color:#6bb5ff;border-color:#6bb5ff">Blue</button>
<button title="Red chain [W]" style="color:#ff6b8a;border-color:#ff6b8a">Red</button>
```

버튼 색상을 해당 체인 색으로 바꿔 단어 이름과 시각적으로 일치. 단축키 Q/W 유지.

Pinch 툴팁도 `L&R` → `Blue&Red`로 업데이트.

### 시맨틱 주석 — `shape.js`

`isRight` 필드의 의미 재해석을 파일 상단 주석에 명시. 미래의 본인(또는 다른 개발자)이 코드를 읽을 때 "왜 isRight인데 right 의미가 없지?" 혼동 방지.

## 변경 요약

| 파일 | 변경 | 줄 변화 |
|---|---|---|
| `main.js` | drawGameFrame `getTkInfo` swap, Step connector swap, Wide head step swap | 4452 → 4474 (+22) |
| `index.html` | Shape 툴바 Left/Right → Blue/Red + 색상, Pinch 툴팁 | 388 → 388 (0; in-place 변경) |
| `shape.js` | 상단 주석에 시맨틱 재해석 명시 | 238 → 253 (+15) |

기타 8개 파일 무변경.

## 설계 결정 기록

### §a. 왜 필드명을 바꾸지 않았나 (isRight 유지)

- `isRight`가 코드 전반 (shape.js의 `isStepTick`, `normalizeShapeChain`, `resolveArcEasing`, `buildShapePointArrays`, drawS의 수많은 분기, main.js의 Shape 툴 로직) 깊이 박혀 있음
- 필드명 변경 시 migration 로직 + schemaVersion bump + 모든 호출처 동기 변경
- **의미론적 재해석으로 충분** — 데이터가 무엇인지는 코드가 결정하지 이름이 결정하지 않음
- 기존 JSON 저장 파일 완벽 호환
- 단점: 미래 개발자가 `isRight`를 보고 "오른쪽 체인"으로 오해할 여지 — 주석으로 방어

### §b. 왜 Shape 탭은 raw 유지인가

- 편집자는 **체인 단위**로 사고: "Blue 곡선을 여기까지 밀자", "Red 곡선에 sine 더하자"
- 이 편집 모델은 "두 독립 곡선"이지 "boundary pair"가 아님
- Shape 탭에서도 min/max로 그리면 편집자가 Blue를 끌었는데 화면에서 Red처럼 보일 수 있음 → WYSIWYG 깨짐
- 교차 시각화는 편집 피드백의 일부 — 사용자가 의도한 모양 그대로 보여주는 게 맞음

### §c. 왜 drawGameFrame은 min/max인가

- 플레이어는 "체인 identity"를 인식할 이유 없음 — 판의 boundary만 있으면 됨
- 데이터의 교차는 플레이어에게 의미 전달 불가
- Preview는 "게임 중 어떻게 보일지" 미리 확인하는 용도 — Play와 동일 동작이 맞음

### §d. Normalize 알고리즘을 왜 안 썼나

이전 턴의 X2 계획에서는 JSON export 시 `normalizeLRInversions(data)` 함수로 역전 구간을 이벤트 삽입으로 "평탄화"하는 알고리즘이 필요했음. 구체적으로:
- 체인 교차점 수치 이분법 (모든 easing 종류 지원)
- 역전 구간 경계에 새 이벤트 삽입
- 이벤트 수 증가 감수

Blue/Red 모델에서 **이 전체가 불필요**. 이유는 간단: "역전"이라는 개념 자체가 없음. 교차는 정상 상태이므로 정리할 것이 없음.

이것이 이 phase의 가장 큰 수익 — **복잡한 알고리즘 구현 회피**.

### §e. Mirror 기능의 새 해석

기존: "Left 이벤트를 만들면 Right에도 중심축 대칭으로"

새: "Blue 이벤트를 만들면 Red에도 중심축 대칭으로"

**동작 완전 동일**. 코드 무변경. 다만 개념적으로:
- 기존: "대칭 boundary 생성 (쌍으로 움직이는 판)"
- 새: "대칭 곡선 생성 (Blue-Red 쌍이 거울상)"

후자가 더 자연스러운 설명. 예를 들어 "X자로 교차하는 대칭 모양"은 기존 의미로는 성립 안 하지만 (양쪽 boundary가 교차하면 판이 이상함), 새 의미로는 정상 (두 곡선이 대칭으로 교차).

## 회귀 검증 체크리스트

**기본 동작:**
- [ ] Shape 탭에서 Blue 버튼 선택 → 이벤트 생성 → 파란 선에 점 찍힘
- [ ] Red 버튼 선택 → 이벤트 생성 → 분홍 선에 점 찍힘
- [ ] 버튼 색상이 각 체인 색과 일치
- [ ] 단축키 Q (Blue), W (Red) 작동
- [ ] Mirror 기능: Mirror ON + Blue 이벤트 생성 → Red에도 중심축 대칭 이벤트 생성

**교차 처리:**
- [ ] Blue를 Linear로 -4 → +4 배치 (전체 영역 훑는 축)
- [ ] Red에 sine으로 Blue 주변 진동하게 배치 (중간중간 Blue를 가로지름)
- [ ] Shape 탭: 두 선이 교차되어 보임 (정상 — 편집 피드백)
- [ ] Preview 탭: 판 boundary가 자연스럽게 min/max로 정렬, 교차 없음
- [ ] Play 탭: Preview와 동일 시각화

**Phase 3-4 회귀:**
- [ ] Wide head step 겹침이 Preview/Play에서 정상 (교차 없는 shape에서 기존과 동일)
- [ ] 교차 있는 shape에서도 Wide head가 정상 범위로 그려짐 (rx0/rw가 정리된 boundary 기준)

**Phase 3-1/4/5 회귀:**
- [ ] Shape Sel+Del 다중 삭제
- [ ] Notes 탭 Copy/Paste/Flip, Paste long-press
- [ ] Notes 탭 drag x축 라인 이동, Line 1/4 invalid 빨간 테두리

**호환성:**
- [ ] 기존 저장된 JSON 파일 로드 → 정상 작동
- [ ] 새로 저장 후 다시 로드 → 동일 동작
- [ ] Import 후 export → 데이터 동일 (normalize 없음)

**기존 교차 채보:**
- [ ] 역전이 있던 기존 채보 → Preview/Play에서 판이 정리되어 보임 (사용자 말: "고쳐지는 게 맞음")

## 사용자 멘탈 모델 전환

이전:
> "Left는 왼쪽 boundary, Right는 오른쪽. 둘이 교차하면 안 됨 (역전)."

이후:
> "Blue와 Red는 독립된 두 곡선. 어느 쪽이 왼쪽에 올지는 매 순간 달라질 수 있음. 게임은 알아서 min/max로 판을 그린다."

후자의 모델이:
- 편집 자유도 ↑
- 설명 난이도 ↓ ("그냥 두 색 곡선")
- 버그 가능성 ↓ ("역전" 상태 자체가 존재 안 함)

## 다음 Phase

계획서 §작업 순서:
- **Phase 6** — Play 판정 개선 (LN tail 콤보, drawGameFrame invalid 표시 검토)
- Phase 3-2/3-3 + Phase 2 — Step/Linear 통합 + Measure numbering (schemaVersion 2 bump, 묶음 처리)
- Phase 7 — Notes 탭 Command 이관
