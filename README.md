# Phase 3-5 Fix — Shape 탭 노트 라인 반전 버그

**증상**: Shape 탭에서 Blue/Red 곡선이 교차하는 구간의 노트가 라인 1↔4, 2↔3으로 반전되어 표시됨. Notes 탭과 Play 탭은 정상.

## 원인

Phase 3-5 원안에서 "Shape 탭은 raw 유지"로 단순화했지만, Shape 탭 캔버스에는 **두 종류의 시각 정보가 공존**합니다:

1. **Blue/Red 곡선**: 사용자가 편집하는 체인의 시각화. raw 사용 맞음 (교차가 의도된 편집).
2. **노트 column 위치**: L1..L4 라인 구역에 속하는 위치. **gameplay 위치**라서 항상 좌→우 정렬되어야 함.
3. **라인 구분선**: 노트와 같은 layout이므로 정렬 필요.

원안에서 Shape 탭의 노트와 라인 구분선까지 raw `sh`를 쓰게 두어서, Blue/Red가 교차하는 구간에서 노트 column이 반전됨.

## 수정

`drawS`의 `getTkInfo` 캐시에 raw `sh`와 정규화된 `shN`을 **둘 다** 저장. 코드를 두 부류로 분리:

- **곡선 그리기** (Blue 선, Red 선, Mirror 축 가이드): `info.sh` (raw)
- **노트와 라인 구분선** (svGNX, wGNX, line dividers, wide head step): `info.shN` (정규화)

## 변경 위치

`main.js` 내 `drawS` 함수 안에서:

| 코드 | 변경 |
|---|---|
| `getTkInfo` 캐시 빌더 | `{sh, shN, lines}` 둘 다 저장 |
| `wGNX` (wide note body) | `info.sh` → `info.shN` |
| line dividers (3 inner lines) | `info.sh` → `info.shN` |
| `svGNX` (note column 계산) | `info.sh` → `info.shN` |
| Wide head step rendering | 직접 `getShape` 호출에 normalize swap 추가 |

곡선 그리기 코드 (Blue 선/Red 선 polyline 빌드, Step connector, Mirror 축)는 그대로 raw 사용 — 사용자가 편집하는 체인의 정체성 유지.

## 데이터 무변경

이전과 동일하게 Shape 데이터 자체는 변경 없음. 렌더링 분기만 정교화.

## 회귀 검증

- [ ] Shape 탭에서 곡선 교차 구간 → 노트 라인 1234 정렬 유지 (이전: 4321로 반전)
- [ ] Notes 탭 / Play 탭은 변화 없음 (이전부터 정상)
- [ ] Blue/Red 곡선 자체는 여전히 raw로 그려짐 (교차 시각적으로 보임)
- [ ] Mirror 모드 축은 raw 중심 그대로 (편집 가이드)
- [ ] 라인 구분선이 노트와 같은 layout으로 자연스럽게 따라감
- [ ] Wide head step 렌더링 정상

## 주안점

**왜 Mirror 축은 raw를 그대로 쓰나**: Mirror는 "Blue 이벤트 만들면 Red에도 대칭"이라는 **체인 단위 편집 도구**. 중심축은 두 체인의 중간이지 boundary 중간이 아님. 정규화하면 사용자가 의도한 거울 동작이 깨짐.

**왜 곡선은 raw로 두는가**: Blue/Red 곡선이 교차되어 보여야 사용자가 "내가 만든 체인이 어떻게 생겼는지" 정확히 알 수 있음. 이 정보가 편집 피드백.

**왜 노트는 정규화하는가**: 노트는 L1..L4 라인 구조에 속함. 라인 구조는 항상 좌→우 정렬 (Notes 탭에서 보듯). 곡선이 교차해도 라인 구조는 그대로니까 노트도 그대로여야 함.
