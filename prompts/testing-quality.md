# Testing & Quality Assurance Prompts

## Unit Testing Prompt
```
Write comprehensive unit tests for [COMPONENT/FUNCTION/MODULE]. Cover:
- Happy path scenarios
- Edge cases and error conditions
- Input validation
- Mock external dependencies
- Test coverage > 80%

Use [TESTING FRAMEWORK] and follow [TESTING PATTERNS].
```

## Integration Testing Prompt
```
Create integration tests for [FEATURE/SYSTEM]. Test scenarios:
- End-to-end workflows
- External service interactions
- Database operations
- API endpoint validation
- Performance under load

Use [TESTING TOOLS] and provide test data fixtures.
```

## Security Testing Prompt
```
Perform security analysis and implement protections for [FEATURE/SYSTEM]:
- Input validation and sanitization
- Authentication bypass prevention
- SQL injection protection
- XSS prevention
- CSRF protection
- Secure configuration

Provide security test cases and vulnerability assessments.
```

## Performance Testing Prompt
```
Implement performance tests and optimizations for [FEATURE/SYSTEM]:
- Load testing with [X] concurrent users
- Response time benchmarks (< [Y]ms)
- Memory usage profiling
- Database query optimization
- Caching strategy implementation

Provide performance metrics and optimization recommendations.
```

## MCP Tool Usage (Testing)
- Before running tests:
  - Use `get_task` / `get_context` to understand current test expectations.
- After running tests:
  - Use `update_context` to write `testStatus` and structured `testReport`.
  - Prefer one consolidated `update_context` write; only send additional writes for materially new findings.
  - Do not loop repeated equivalent `update_context` patches.
  - Do not use `update_task_status` during QA transitions.
  - Workflow controls task lifecycle; completion is handled by the `tests-passing` transition.
- For file-level failure tracking:
  - Use `get_file_context` on files implicated by failures and record `todos`/`relatedFiles`.
