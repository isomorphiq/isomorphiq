# Refactoring & Maintenance Prompts

## Code Refactoring Prompt
```
Refactor [COMPONENT/MODULE] using atomic, incremental edits:

Editing approach:
- Use the `edit` tool for targeted changes, never `write` entire files
- Make one logical change per edit call
- Verify each change before proceeding

Refactoring goals:
- Break down large functions (target 20-50 lines, max 80)
- Split large files (target 100-200 lines, refactor at 300+)
- Extract complex logic into focused helper functions
- Remove code duplication
- Improve error handling
- Enhance type safety

Organization:
- Group related functionality by domain
- Use clear, descriptive naming
- Maintain existing functionality while improving code quality
```

## Legacy Code Modernization Prompt
```
Modernize legacy code in [COMPONENT/MODULE]:
- Update to current language features
- Improve dependency management
- Enhance security practices
- Add comprehensive logging
- Implement modern testing patterns

Ensure backward compatibility and provide migration guide.
```

## Performance Optimization Prompt
```
Optimize performance of [COMPONENT/SYSTEM]:
- Identify bottlenecks using profiling
- Implement caching strategies
- Database query optimization
- Memory usage reduction
- Asynchronous processing improvements

Target [X]% improvement in [METRIC] while maintaining functionality.
```

## Technical Debt Reduction Prompt
```
Address technical debt in [AREA/SYSTEM]:
- Remove deprecated code
- Update outdated dependencies
- Fix known bugs and issues
- Improve documentation
- Enhance monitoring and observability

Prioritize by impact and effort, provide implementation plan.
```