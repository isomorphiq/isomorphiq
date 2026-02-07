import { appendSection, normalizeStringArray } from "./basic-utils.ts";

const TEST_OUTPUT_SECTION_LIMIT = 8_000;
const FAILURE_SNIPPET_LIMIT = 8;
const FAILURE_SNIPPET_CHAR_LIMIT = 260;

const parseTestStatusLine = (value: string): "passed" | "failed" | null => {
    const match = value.match(/test status\s*:\s*(passed|failed)/i);
    if (!match) {
        return null;
    }
    return match[1].toLowerCase() === "passed" ? "passed" : "failed";
};

const normalizeTextLines = (value: string): string[] =>
    value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

const uniqueStrings = (values: string[]): string[] =>
    values.reduce<string[]>(
        (acc, value) => (acc.includes(value) ? acc : [...acc, value]),
        [],
    );

const truncateText = (value: string, maxChars: number): string => {
    if (value.length <= maxChars) {
        return value;
    }
    const omitted = value.length - maxChars;
    return `${value.slice(0, maxChars)}\n...[truncated ${omitted} chars]`;
};

const trimSnippet = (value: string): string =>
    value.length <= FAILURE_SNIPPET_CHAR_LIMIT
        ? value
        : `${value.slice(0, FAILURE_SNIPPET_CHAR_LIMIT - 3).trim()}...`;

const extractCommandLines = (value: string): string[] => {
    if (value.trim().length === 0) {
        return [];
    }
    const lines = normalizeTextLines(value);
    const commandMatches = lines.flatMap((line) => {
        const bracketed = line.match(/^\[[^\]]+\]\s*command:\s*(.+)$/i);
        if (bracketed && bracketed[1].trim().length > 0) {
            return [bracketed[1].trim()];
        }
        const prefixed = line.match(
            /^(?:repro steps?|repro commands?|command)\s*:\s*(.+)$/i,
        );
        if (prefixed && prefixed[1].trim().length > 0) {
            return [prefixed[1].trim()];
        }
        return [];
    });
    return uniqueStrings(commandMatches);
};

const extractFailureSnippetsFromText = (value: string): string[] => {
    if (value.trim().length === 0) {
        return [];
    }
    const lines = normalizeTextLines(value);
    const snippets: string[] = [];
    const shouldIncludeLine = (line: string): boolean =>
        /\b(error|failed|failure|exception|traceback|timeout)\b/i.test(line)
        || /\bTS\d{4}\b/.test(line)
        || /\bexpected\b.*\breceived\b/i.test(line)
        || /^\[[^\]]+\]\s*(?:status:\s*fail|error:)/i.test(line)
        || /^x\b/i.test(line);

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!shouldIncludeLine(line)) {
            continue;
        }
        snippets.push(trimSnippet(line));
        if (snippets.length >= FAILURE_SNIPPET_LIMIT) {
            break;
        }
    }
    return uniqueStrings(snippets);
};

const extractInlineList = (lines: string[], label: string): string[] => {
    const prefix = label.toLowerCase();
    const line = lines.find((entry) => entry.toLowerCase().startsWith(prefix));
    if (!line) {
        return [];
    }
    const remainder = line.slice(label.length).replace(/^:\s*/, "").trim();
    if (remainder.length === 0) {
        return [];
    }
    return remainder
        .split(/,|\s*\|\s*|\s*;\s*/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
};

const extractListAfterLabel = (lines: string[], label: string): string[] => {
    const prefix = label.toLowerCase();
    const index = lines.findIndex((entry) => entry.toLowerCase().startsWith(prefix));
    if (index < 0) {
        return [];
    }
    return lines
        .slice(index + 1)
        .filter((entry) => entry.startsWith("-"))
        .map((entry) => entry.replace(/^-+\s*/, "").trim())
        .filter((entry) => entry.length > 0);
};

const extractInlineValue = (lines: string[], label: string): string => {
    const prefix = label.toLowerCase();
    const line = lines.find((entry) => entry.toLowerCase().startsWith(prefix));
    if (!line) {
        return "";
    }
    return line.slice(label.length).replace(/^:\s*/, "").trim();
};

export const inferTestReportFromExecution = (
    execution: { summary?: string; output?: string; error?: string } | null | undefined,
): { testStatus?: "passed" | "failed"; testReport?: Record<string, unknown> } => {
    const combined = [execution?.summary, execution?.output, execution?.error]
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .join("\n");
    if (combined.length === 0) {
        return {};
    }

    const status = parseTestStatusLine(combined);
    const lines = normalizeTextLines(combined);
    const failedTests = [
        ...extractInlineList(lines, "Failed tests"),
        ...extractListAfterLabel(lines, "Failed tests"),
    ].filter((value, index, list) => list.indexOf(value) === index);
    const reproSteps = [
        ...extractInlineList(lines, "Repro steps"),
        ...extractListAfterLabel(lines, "Repro steps"),
        ...extractInlineList(lines, "Repro commands"),
        ...extractListAfterLabel(lines, "Repro commands"),
        ...extractCommandLines(combined),
    ].filter((value, index, list) => list.indexOf(value) === index);
    const inferredFailureSnippets = extractFailureSnippetsFromText(combined);
    const suspectedRootCause =
        extractInlineValue(lines, "Suspected root cause")
        || extractInlineValue(lines, "Root cause")
        || (status === "failed" ? inferredFailureSnippets[0] ?? "" : "");
    const inferredFailedTests =
        status === "failed" && failedTests.length === 0
            ? inferredFailureSnippets.slice(0, 5)
            : [];
    const notes = extractInlineValue(lines, "Notes");

    const hasReport =
        failedTests.length > 0
        || inferredFailedTests.length > 0
        || reproSteps.length > 0
        || suspectedRootCause.length > 0
        || notes.length > 0;

    return {
        ...(status ? { testStatus: status } : {}),
        ...(hasReport
            ? {
                testReport: {
                    failedTests: uniqueStrings([...failedTests, ...inferredFailedTests]),
                    reproSteps,
                    suspectedRootCause,
                    notes,
                },
            }
            : {}),
    };
};

export const buildTestReportSection = (
    context: Record<string, unknown>,
    lastTestResult: unknown,
): string | null => {
    const rawStatus = typeof context.testStatus === "string" ? context.testStatus.trim() : "";
    const report =
        context.testReport && typeof context.testReport === "object"
            ? (context.testReport as Record<string, unknown>)
            : null;
    const failedTests = normalizeStringArray(report?.failedTests);
    const reproSteps = normalizeStringArray(report?.reproSteps);
    const suspectedRootCause =
        typeof report?.suspectedRootCause === "string" ? report.suspectedRootCause.trim() : "";
    const notes = typeof report?.notes === "string" ? report.notes.trim() : "";

    const lastResultRecord =
        lastTestResult && typeof lastTestResult === "object"
            ? (lastTestResult as Record<string, unknown>)
            : null;
    const lastSummary = typeof lastResultRecord?.summary === "string" ? lastResultRecord.summary.trim() : "";
    const lastError = typeof lastResultRecord?.error === "string" ? lastResultRecord.error.trim() : "";
    const lastOutput = typeof lastResultRecord?.output === "string" ? lastResultRecord.output.trim() : "";
    const failureSnippets = uniqueStrings([
        ...extractFailureSnippetsFromText(suspectedRootCause),
        ...extractFailureSnippetsFromText(notes),
        ...extractFailureSnippetsFromText(lastSummary),
        ...extractFailureSnippetsFromText(lastError),
        ...extractFailureSnippetsFromText(lastOutput),
    ]).slice(0, FAILURE_SNIPPET_LIMIT);

    let lines: string[] = rawStatus.length > 0 ? [`Test status: ${rawStatus}`] : [];
    lines = appendSection(lines, "Failed tests", failedTests);
    lines = appendSection(lines, "Repro steps", reproSteps);
    lines = suspectedRootCause.length > 0 ? [...lines, `Suspected root cause: ${suspectedRootCause}`] : lines;
    lines = appendSection(lines, "Failure snippets", failureSnippets);
    lines = notes.length > 0 ? [...lines, `Notes: ${notes}`] : lines;
    lines = lastSummary.length > 0 ? [...lines, `Last test summary: ${lastSummary}`] : lines;
    lines = lastError.length > 0 ? [...lines, `Last test error: ${lastError}`] : lines;
    lines = lastOutput.length > 0
        ? [...lines, `Last test output:\n${truncateText(lastOutput, TEST_OUTPUT_SECTION_LIMIT)}`]
        : lines;

    return lines.length > 0 ? lines.join("\n") : null;
};

export const buildFailurePacketSection = (
    context: Record<string, unknown>,
    lastTestResult: unknown,
): string | null => {
    const reportSection = buildTestReportSection(context, lastTestResult);
    const report =
        context.testReport && typeof context.testReport === "object"
            ? (context.testReport as Record<string, unknown>)
            : null;
    const rawStatus = typeof context.testStatus === "string" ? context.testStatus.trim().toLowerCase() : "";
    const failedTests = normalizeStringArray(report?.failedTests);
    const reproSteps = uniqueStrings([
        ...normalizeStringArray(report?.reproSteps),
        ...(reportSection ? extractCommandLines(reportSection) : []),
    ]);
    const suspectedRootCause =
        typeof report?.suspectedRootCause === "string" ? report.suspectedRootCause.trim() : "";
    const notes = typeof report?.notes === "string" ? report.notes.trim() : "";
    const failureSnippets = uniqueStrings([
        ...extractFailureSnippetsFromText(suspectedRootCause),
        ...extractFailureSnippetsFromText(notes),
        ...(reportSection ? extractFailureSnippetsFromText(reportSection) : []),
    ]).slice(0, FAILURE_SNIPPET_LIMIT);

    const likelyFailure =
        rawStatus === "failed"
        || failedTests.length > 0
        || failureSnippets.length > 0
        || suspectedRootCause.length > 0;
    if (!likelyFailure) {
        return null;
    }

    const lines = [
        "QA failure packet (root-cause priority):",
        `- Test status: ${rawStatus.length > 0 ? rawStatus : "failed"}`,
        `- Failing checks/tests: ${failedTests.length > 0 ? failedTests.join("; ") : "not explicitly listed"}`,
        `- Repro commands: ${reproSteps.length > 0 ? reproSteps.join("; ") : "not explicitly listed"}`,
        `- Suspected root cause: ${suspectedRootCause.length > 0 ? suspectedRootCause : "not explicitly captured"}`,
        `- Key failure excerpts: ${failureSnippets.length > 0 ? failureSnippets.join(" | ") : "none extracted"}`,
    ];

    if (reportSection && reportSection.length > 0) {
        lines.push("", "Detailed test report context:", reportSection);
    }

    return lines.join("\n");
};
