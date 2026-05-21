# Weekly Editor Check

이 문서는 Markdown 렌더 보기와 원문 보기 전환을 확인하기 위한 정상 샘플입니다.

## Checklist

- 제목과 본문이 정상적으로 렌더링되어야 합니다.
- **굵게 표시**, `inline code`, [외부 링크](https://example.com) 가 보여야 합니다.
- 표와 코드 블록이 함께 있어도 레이아웃이 깨지지 않아야 합니다.

| 항목 | 상태 | 비고 |
| :--- | :--- | :--- |
| Markdown surface | ready | raw 토글 확인 |
| Selection | pending | 수동 검증 |
| Save round-trip | pending | LF 유지 확인 |

```ts
const release = {
  format: "markdown",
  surface: "rendered",
  valid: true,
};
```

마지막 문단은 스크롤과 selection을 확인하기 위한 일반 텍스트입니다.
